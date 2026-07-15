<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import type { MarkedOptions } from 'marked';
  import hljs from 'highlight.js';
  import 'highlight.js/styles/atom-one-dark.css';
  import { browser } from '$app/environment';
  import { clickOutside } from '$lib/actions/clickOutside';
  
  // Import our stores
  import { apiKeys, baseUrls, currentProvider, currentModel } from '$lib/stores/settings';
  import { chatStore, type Message, type Conversation } from '$lib/stores/chat';
  import { projectState } from '$lib/stores/project';
  import { agentStore } from '$lib/stores/agent';
  import BackendSelector from '$lib/components/BackendSelector.svelte';
  import AgentToolCard from '$lib/components/agent/AgentToolCard.svelte';
  import AgentApprovalCard from '$lib/components/agent/AgentApprovalCard.svelte';

  // Props
  export let standalone = false;

  // Local state
  let input = '';
  let isLoading = false;
  let chatContainer: HTMLElement | null = null;
  let newChatName = '';
  let isEditingTitle = false;
  let activeConversation: Conversation | null = null;
  let isSidebarOpen = true;
  let editingConversationId: string | null = null;
  let editingConversationName = '';

  // Define a proper type for the highlight function
  type HighlightFunction = (code: string, lang: string) => string;

  // Create properly typed options
  const markedOptions: MarkedOptions & { highlight?: HighlightFunction } = {
    highlight: function(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true
  };

  // Set the options
  marked.setOptions(markedOptions);

  // Subscribe to get the active conversation
  chatStore.activeConversation.subscribe((conversation) => {
    activeConversation = conversation;
  });

  // --- Agent mode -----------------------------------------------------------
  // A conversation is either 'chat' (single-shot llm.chat) or 'agent' (the
  // main-process turn loop). The flag is tracked per conversation in agentStore.
  $: activeId = activeConversation?.id ?? null;
  $: mode = (activeId && $agentStore.agentMode[activeId] ? 'agent' : 'chat') as 'chat' | 'agent';
  $: agentState = activeId ? $agentStore.convs[activeId] : undefined;
  $: agentBusy = agentState?.status === 'running' || agentState?.status === 'awaiting-approval';

  function setMode(m: 'chat' | 'agent'): void {
    if (activeId) agentStore.setMode(activeId, m);
  }

  function stopAgent(): void {
    if (activeId) agentStore.stop(activeId);
  }

  function onApprove(e: CustomEvent<string>): void {
    if (activeId) agentStore.approve(activeId, e.detail);
  }

  function onDeny(e: CustomEvent<string>): void {
    if (activeId) agentStore.deny(activeId, e.detail);
  }

  // Track the last processed message to avoid duplicate auto-submissions
  let lastProcessedMessageCount = 0;

  onMount(() => {
    // Initialize chat container ref
    if (browser) {
      // If no active conversation, create one
      if (!activeConversation && $chatStore.conversations.length === 0) {
        chatStore.createNewConversation();
      }
    }
  });

  // Auto-submit when a request/response analysis message is added (via
  // "Send to Chat" -> analyze mode). The prompt substring below MUST stay in
  // sync with createAnalysisPrompt() in $lib/utils/requestFormatter.
  $: if (activeConversation?.messages && browser && !isLoading && mode === 'chat') {
    const messages = activeConversation.messages;
    const currentMessageCount = messages.length;

    if (currentMessageCount > lastProcessedMessageCount) {
      const lastMessage = messages[currentMessageCount - 1];

      if (lastMessage.role === 'user' &&
          lastMessage.content.includes('Please analyze this HTTP request and response')) {
        // Update the counter before triggering to avoid loops
        lastProcessedMessageCount = currentMessageCount;

        // The user message is already in the conversation; just ask the AI.
        setTimeout(() => {
          requestAssistantResponse();
        }, 100);
      } else {
        // Update counter for non-analysis messages too
        lastProcessedMessageCount = currentMessageCount;
      }
    }
  }

  // Submit the typed message. In chat mode this is a single-shot llm.chat; in
  // agent mode it feeds the main-process turn loop via agentStore.
  async function handleSubmit(): Promise<void> {
    if (!input.trim()) return;

    if (mode === 'agent') {
      // Ensure a conversation exists to key the agent run against.
      let convId = activeId;
      if (!convId) {
        convId = chatStore.createNewConversation();
        agentStore.setMode(convId, 'agent');
      }
      const text = input;
      input = '';
      await agentStore.sendMessage(convId, text);
      setTimeout(() => {
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
      }, 0);
      return;
    }

    if (isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    chatStore.addMessage(userMessage);
    input = '';

    await requestAssistantResponse();
  }

  // Send the active conversation to the main-process LLM relay and append the
  // assistant reply. Used by both manual submit and the auto-analyze flow.
  async function requestAssistantResponse(): Promise<void> {
    if (isLoading) return;

    // Cloud providers require an API key; local/custom endpoints usually don't.
    if ($currentProvider !== 'custom' && !$apiKeys[$currentProvider]) {
      chatStore.addMessage({
        role: 'system',
        content: `Error: No API key set for ${$currentProvider}. Please configure your API key in settings.`,
        timestamp: new Date()
      });
      return;
    }

    isLoading = true;

    try {
      // Send the full conversation (excluding local-only system notices) to the
      // relay. Provider calls run in Electron main via net.fetch so this works
      // in packaged builds.
      const messages = (activeConversation?.messages || [])
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));

      const data = await window.electronAPI.llm.chat({
        provider: $currentProvider as any,
        apiKey: $apiKeys[$currentProvider],
        baseUrl: $baseUrls[$currentProvider] || undefined,
        model: $currentModel,
        messages
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.content,
        timestamp: new Date()
      };

      chatStore.addMessage(assistantMessage);

      // Scroll to bottom
      setTimeout(() => {
        if (chatContainer) {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }
      }, 100);

    } catch (error: unknown) {
      console.error('Error calling AI API:', error);
      chatStore.addMessage({
        role: 'system',
        content: `Error: Failed to get response from ${$currentProvider}. ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date()
      });
    } finally {
      isLoading = false;
    }
  }

  // Create a new conversation
  function createNewChat(): void {
    const name = newChatName.trim() || `Chat ${$chatStore.conversations.length + 1}`;
    chatStore.createNewConversation(name);
    newChatName = '';
  }

  // Start editing a conversation title
  function startEditConversation(id: string, name: string): void {
    editingConversationId = id;
    editingConversationName = name;
  }

  // Save conversation title edit
  function saveConversationEdit(): void {
    if (editingConversationId && editingConversationName.trim()) {
      chatStore.renameConversation(editingConversationId, editingConversationName.trim());
    }
    editingConversationId = null;
  }

  // Cancel conversation title edit
  function cancelConversationEdit(): void {
    editingConversationId = null;
  }

  // Delete the current conversation
  function deleteCurrentChat(): void {
    chatStore.clearActiveConversation();
  }

  // Toggle sidebar visibility
  function toggleSidebar(): void {
    isSidebarOpen = !isSidebarOpen;
  }

  // Handle key press events
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  // Format timestamp
  function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Format date
  function formatDate(date: Date): string {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Process message content with markdown
  function processContent(content: string): string {
    return marked(content) as string;
  }

  // Select a conversation
  function selectConversation(id: string): void {
    chatStore.setActiveConversation(id);
  }

  // Get truncated preview of last message in a conversation
  function getConversationPreview(conversation: Conversation): string {
    if (conversation.messages.length === 0) return "No messages";
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    const content = lastMessage.content;
    return content.length > 40 ? content.substring(0, 40) + "..." : content;
  }

  // Auto-scroll when messages change
  $: if (activeConversation?.messages && chatContainer && browser) {
    setTimeout(() => {
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }, 0);
  }
</script>

<div class="chat-terminal {standalone ? 'standalone' : ''}">
  <div class="terminal-layout {isSidebarOpen ? 'with-sidebar' : 'sidebar-collapsed'}">
    <div class="sidebar" class:hidden={!isSidebarOpen}>
      <div class="sidebar-header">
        <h3>Conversations</h3>
        <button class="new-chat-btn" on:click={createNewChat}>
          <span class="icon">+</span>
          <span class="label">New Chat</span>
        </button>
      </div>
      
      <div class="conversations-list">
        {#if $chatStore.conversations.length === 0}
          <div class="empty-state">No conversations yet</div>
        {:else}
          {#each $chatStore.conversations as conversation (conversation.id)}
            <div 
              class="conversation-item {$chatStore.activeConversationId === conversation.id ? 'active' : ''}"
              on:click={() => selectConversation(conversation.id)}
            >
              {#if editingConversationId === conversation.id}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="edit-title-container" use:clickOutside={saveConversationEdit}>
                  <input 
                    type="text" 
                    bind:value={editingConversationName} 
                    on:keydown={(e) => e.key === 'Enter' && saveConversationEdit()}
                    on:blur={saveConversationEdit}
                    autofocus
                  />
                </div>
              {:else}
                <div class="conversation-info">
                  <div class="conversation-title" on:dblclick={() => startEditConversation(conversation.id, conversation.name)}>
                    {conversation.name}
                    {#if $agentStore.agentMode[conversation.id]}
                      <span class="agent-tag">agent</span>
                    {/if}
                  </div>
                  <div class="conversation-preview">
                    {getConversationPreview(conversation)}
                  </div>
                  <div class="conversation-date">
                    {formatDate(conversation.updatedAt)}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
    
    <div class="chat-content">
      <div class="terminal-header">
        <div class="header-left">
          <button class="toggle-sidebar-btn" on:click={toggleSidebar}>
            {isSidebarOpen ? '◀' : '▶'}
          </button>
          <div class="terminal-title">
            {activeConversation ? activeConversation.name : 'Start a new chat'}
          </div>
          <div class="provider-info">
            <span class="provider-badge">{$currentProvider}</span>
            <span class="model-badge">{$currentModel}</span>
          </div>
        </div>
        <div class="terminal-controls">
          <div class="mode-toggle" role="group" aria-label="Chat mode">
            <button
              class="mode-btn"
              class:active={mode === 'chat'}
              on:click={() => setMode('chat')}
            >Chat</button>
            <button
              class="mode-btn"
              class:active={mode === 'agent'}
              on:click={() => setMode('agent')}
            >Agent</button>
          </div>
          <button class="terminal-btn" title="Delete conversation" on:click={deleteCurrentChat}>🗑️</button>
        </div>
      </div>

      {#if mode === 'agent'}
        <div class="agent-toolbar">
          <BackendSelector />
          <label class="auto-approve">
            <input
              type="checkbox"
              checked={$agentStore.autoApproveReadOnly}
              on:change={(e) => agentStore.setAutoApproveReadOnly(e.currentTarget.checked)}
            />
            <span>Auto-approve read-only</span>
          </label>
          <div class="agent-toolbar-right">
            {#if agentState?.usage && (agentState.usage.inputTokens || agentState.usage.outputTokens)}
              <span class="usage-chip" title="tokens in / out">
                ↑{agentState.usage.inputTokens} ↓{agentState.usage.outputTokens}
              </span>
            {/if}
            <span class="status-chip status-{agentState?.status ?? 'idle'}">
              {agentState?.status ?? 'idle'}
            </span>
            {#if agentBusy}
              <button class="btn btn-danger btn-sm" on:click={stopAgent}>Stop</button>
            {/if}
          </div>
        </div>
      {/if}

      <div class="chat-container" bind:this={chatContainer}>
        {#if mode === 'agent'}
          {#if !agentState || agentState.items.length === 0}
            <div class="welcome-message">
              <p>Agent mode.</p>
              <p>Describe a task and the agent will use tools (with your approval) to carry it out.</p>
            </div>
          {:else}
            {#each agentState.items as item, i (i)}
              {#if item.type === 'user'}
                <div class="message user">
                  <div class="message-content">{@html processContent(item.text)}</div>
                </div>
              {:else if item.type === 'assistant'}
                <div class="message assistant">
                  <div class="message-header">
                    <span class="message-role">{$currentProvider}</span>
                  </div>
                  <div class="message-content">{@html processContent(item.text)}</div>
                </div>
              {:else if item.type === 'thinking'}
                <details class="thinking-block">
                  <summary>Thinking</summary>
                  <div class="thinking-content">{item.text}</div>
                </details>
              {:else if item.type === 'tool'}
                <AgentToolCard card={item} />
              {:else if item.type === 'notice'}
                <div class="agent-notice notice-{item.level}">{item.text}</div>
              {/if}
            {/each}

            {#each agentState.pendingApprovals as approval (approval.toolCallId)}
              <AgentApprovalCard {approval} on:approve={onApprove} on:deny={onDeny} />
            {/each}
          {/if}
        {:else}
          {#if !activeConversation || activeConversation.messages.length === 0}
            <div class="welcome-message">
              <p>Welcome to the AI Chat Terminal!</p>
              <p>Choose your AI provider and start chatting.</p>
            </div>
          {:else}
            {#each activeConversation.messages as message, i (i)}
              <div class="message {message.role}">
                <div class="message-header">
                  <span class="message-role">{message.role === 'assistant' ? $currentProvider : message.role}</span>
                  <span class="message-time">{formatTime(message.timestamp)}</span>
                </div>
                <div class="message-content">
                  {@html processContent(message.content)}
                </div>
              </div>
            {/each}
          {/if}

          {#if isLoading}
            <div class="loading-indicator">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
          {/if}
        {/if}
      </div>
      
      <div class="input-container">
        <textarea
          bind:value={input}
          on:keydown={handleKeydown}
          placeholder={mode === 'agent'
            ? (agentBusy ? 'Queue a message for the running agent… (Shift+Enter for new line)' : 'Describe a task for the agent… (Shift+Enter for new line)')
            : 'Type your message here... (Shift+Enter for new line)'}
          rows="1"
          disabled={mode === 'chat' && isLoading}
        ></textarea>
        <button class="send-btn" on:click={handleSubmit} disabled={(mode === 'chat' && isLoading) || !input.trim()}>
          {mode === 'agent' && agentBusy ? 'Queue' : 'Send'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .chat-terminal {
    display: flex;
    flex-direction: column;
    color: var(--text-primary);
    border-radius: 4px;
    height: 100%;
    width: 100%;
    overflow: hidden;
    font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    background-color: var(--bg-primary);
  }
  
  .chat-terminal.standalone {
    height: calc(100vh - 60px);
    border-radius: 0;
  }
  
  .terminal-layout {
    display: flex;
    height: 100%;
    width: 100%;
  }
  
  .terminal-layout.with-sidebar .chat-content {
    width: calc(100% - 280px);
  }
  
  .terminal-layout.sidebar-collapsed .chat-content {
    width: 100%;
  }
  
  .sidebar {
    width: 280px;
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    height: 100%;
    transition: width 0.2s ease;
    border-right: 1px solid var(--border-primary);
  }
  
  .sidebar.hidden {
    width: 0;
    overflow: hidden;
  }
  
  .sidebar-header {
    padding: 15px;
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .sidebar-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }
  
  .new-chat-btn {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    border-radius: 4px;
    padding: 5px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: background-color 0.2s;
  }
  
  .new-chat-btn:hover {
    background-color: var(--bg-hover);
  }
  
  .conversations-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }
  
  .conversation-item {
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
    border: 1px solid var(--border-secondary);
  }
  
  .conversation-item:hover {
    background-color: var(--bg-hover);
  }
  
  .conversation-item.active {
    background-color: var(--bg-active);
  }
  
  .conversation-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  
  .conversation-title {
    font-weight: bold;
    color: var(--text-primary);
  }
  
  .conversation-preview {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .conversation-date {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  
  .edit-title-container {
    width: 100%;
  }
  
  .edit-title-container input {
    width: 100%;
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-primary);
    padding: 5px;
    font-size: 13px;
    border-radius: 3px;
  }
  
  .empty-state {
    text-align: center;
    padding: 30px 0;
    color: var(--text-muted);
    font-style: italic;
  }
  
  .chat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--bg-primary);
  }
  
  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    border-bottom: 1px solid var(--border-primary);
    background-color: var(--bg-secondary);
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .toggle-sidebar-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 14px;
    padding: 5px;
    border-radius: 3px;
    transition: background-color 0.2s;
  }
  
  .toggle-sidebar-btn:hover {
    background-color: var(--bg-hover);
  }
  
  .terminal-title {
    font-weight: bold;
    color: var(--text-primary);
  }
  
  .terminal-controls {
    display: flex;
    gap: 5px;
  }
  
  .terminal-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: 5px 8px;
    border-radius: 3px;
    transition: background-color 0.2s;
  }
  
  .terminal-btn:hover {
    background-color: var(--bg-hover);
  }

  .provider-info {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: 15px;
  }

  .provider-badge,
  .model-badge {
    background-color: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }

  .provider-badge {
    background-color: var(--accent-primary);
    color: white;
    text-transform: capitalize;
  }

  .chat-container {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .welcome-message {
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    margin-top: 50px;
  }
  
  .message {
    border-radius: 8px;
    padding: 15px;
    max-width: 80%;
    word-wrap: break-word;
  }
  
  .message.user {
    background-color: var(--accent-primary);
    color: white;
    align-self: flex-end;
    margin-left: auto;
  }
  
  .message.assistant {
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    align-self: flex-start;
    border: 1px solid var(--border-primary);
  }
  
  .message.system {
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    align-self: center;
    max-width: 90%;
    font-style: italic;
  }
  
  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 12px;
  }
  
  .message-role {
    font-weight: bold;
    text-transform: capitalize;
  }
  
  .message-time {
    color: var(--text-tertiary);
  }
  
  .message-content {
    line-height: 1.5;
  }
  
  .message-content :global(pre) {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    padding: 10px;
    overflow-x: auto;
    margin: 10px 0;
  }
  
  .message-content :global(code) {
    background-color: var(--bg-tertiary);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'Fira Code', monospace;
  }
  
  .message-content :global(blockquote) {
    border-left: 3px solid var(--accent-primary);
    margin: 10px 0;
    padding-left: 15px;
    color: var(--text-secondary);
  }
  
  .loading-indicator {
    display: flex;
    justify-content: center;
    gap: 5px;
    padding: 20px;
  }
  
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--accent-primary);
    animation: bounce 1.4s infinite ease-in-out both;
  }
  
  .dot:nth-child(1) { animation-delay: -0.32s; }
  .dot:nth-child(2) { animation-delay: -0.16s; }
  
  @keyframes bounce {
    0%, 80%, 100% { 
      transform: scale(0);
    } 40% { 
      transform: scale(1.0);
    }
  }
  
  .input-container {
    display: flex;
    gap: 10px;
    padding: 15px;
    border-top: 1px solid var(--border-primary);
    background-color: var(--bg-secondary);
  }
  
  .input-container textarea {
    flex: 1;
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-primary);
    padding: 10px;
    border-radius: 4px;
    resize: none;
    font-family: inherit;
    min-height: 40px;
    max-height: 120px;
  }
  
  .input-container textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .input-container textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .send-btn {
    background-color: var(--accent-primary);
    border: none;
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .send-btn:hover:not(:disabled) {
    background-color: var(--accent-hover);
  }
  
  .send-btn:disabled {
    background-color: var(--bg-tertiary);
    color: var(--text-muted);
    cursor: not-allowed;
  }

  /* --- Agent mode ---------------------------------------------------------- */
  .terminal-controls {
    align-items: center;
  }

  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    overflow: hidden;
    background-color: var(--bg-tertiary);
  }

  .mode-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: background-color 0.15s, color 0.15s;
  }

  .mode-btn:hover {
    color: var(--text-primary);
  }

  .mode-btn.active {
    background-color: var(--accent-primary);
    color: white;
  }

  .agent-toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 15px;
    border-bottom: 1px solid var(--border-primary);
    background-color: var(--bg-secondary);
    flex-wrap: wrap;
  }

  .auto-approve {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .agent-toolbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .usage-chip {
    font-size: 11px;
    color: var(--text-muted);
    font-family: 'Fira Code', monospace;
  }

  .status-chip {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    border-radius: 10px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
  }

  .status-chip.status-running {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .status-chip.status-awaiting-approval {
    color: var(--status-warning);
    border-color: var(--status-warning);
  }

  .status-chip.status-stopped {
    color: var(--status-error);
    border-color: var(--status-error);
  }

  .thinking-block {
    align-self: flex-start;
    max-width: 80%;
    background-color: var(--bg-secondary);
    border: 1px dashed var(--border-primary);
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .thinking-block summary {
    cursor: pointer;
    font-style: italic;
    color: var(--text-muted);
  }

  .thinking-content {
    margin-top: 8px;
    white-space: pre-wrap;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .agent-notice {
    align-self: center;
    max-width: 90%;
    font-size: 13px;
    padding: 8px 14px;
    border-radius: 8px;
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }

  .agent-notice.notice-error {
    color: var(--status-error);
    border-color: var(--status-error);
  }

  .agent-notice.notice-stopped {
    color: var(--status-warning);
    border-color: var(--status-warning);
  }

  .agent-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border-radius: 8px;
    background-color: var(--accent-primary);
    color: white;
    vertical-align: middle;
    margin-left: 4px;
  }
</style>
