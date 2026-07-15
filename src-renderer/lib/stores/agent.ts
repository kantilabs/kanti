// Renderer-side agent run state. The turn loop itself runs in MAIN
// (src-main/agent/*); here we only (a) turn the electronAPI.agent event stream
// into a linear, renderable transcript per conversation, (b) hold the pending
// human-approval gate, and (c) drive sendMessage / stop / approve / deny +
// assemble the AgentRunCfg from the settings + backend stores.
//
// The event stream is COALESCED in main (batched text/thinking deltas — the
// documented GUI lock-up fix), so the reducer only appends the already-batched
// chunks. To keep localStorage writes bounded we persist on structural events
// (send, tool_result, turn_end, done, mode change) and NOT on every text delta.

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { apiKeys, baseUrls, currentProvider, currentModel } from './settings';
import { backendStore } from './backend';
import type { AgentRunCfg } from '../../preload';

// ---------------------------------------------------------------------------
// Transcript model
// ---------------------------------------------------------------------------

/** A single tool invocation card. `status` tracks its lifecycle:
 *  running (dispatching) → awaiting (blocked on approval) → done | error. */
export interface ToolItem {
  type: 'tool';
  id: string;
  name: string;
  input: Record<string, any>;
  status: 'running' | 'awaiting' | 'done' | 'error';
  content?: string;
  isError?: boolean;
}

export type AgentItem =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string; sealed?: boolean }
  | { type: 'thinking'; text: string; sealed?: boolean }
  | ToolItem
  | { type: 'notice'; level: 'info' | 'error' | 'stopped'; text: string };

/** A pending approval prompt surfaced to the operator as an inline card. */
export interface PendingApproval {
  toolCallId: string;
  name: string;
  input: Record<string, any>;
  /** True for state-changing / exec / network tools (destructive badge). */
  destructive: boolean;
}

export type AgentStatus = 'idle' | 'running' | 'awaiting-approval' | 'stopped';

export interface AgentConvState {
  status: AgentStatus;
  turn: number;
  items: AgentItem[];
  pendingApprovals: PendingApproval[];
  usage: { inputTokens: number; outputTokens: number };
  finishMsg?: string;
  error?: string;
}

interface AgentStoreState {
  /** Per-conversation run state, keyed by conversationId. */
  convs: Record<string, AgentConvState>;
  /** Which conversations are in Agent mode (vs plain Chat). */
  agentMode: Record<string, boolean>;
  /** Auto-approve read-only tools (proxy status, fs read/list, decode…). */
  autoApproveReadOnly: boolean;
}

function emptyConv(): AgentConvState {
  return {
    status: 'idle',
    turn: 0,
    items: [],
    pendingApprovals: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// Tools whose side effects are destructive / irreversible enough to earn the
// red badge on the approval card. Everything else that still needs approval
// (e.g. a read of live session output) gets the neutral "needs approval" look.
const DESTRUCTIVE_TOOLS = new Set<string>([
  'agent_shell_exec',
  'agent_shell_session_start',
  'agent_shell_write',
  'agent_shell_kill',
  'agent_fs_write',
  'kanti_proxy_start',
  'kanti_proxy_stop',
  'kanti_proxy_clear_requests',
  'kanti_proxy_set_scope',
  'kanti_repeater_send',
  'kanti_project_save',
]);

const STORAGE_CONVS = 'agent_convs';
const STORAGE_MODES = 'agent_modes';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const hasApi = () =>
  typeof window !== 'undefined' && !!window.electronAPI?.agent;

function createAgentStore() {
  const initial: AgentStoreState = { convs: {}, agentMode: {}, autoApproveReadOnly: true };

  // Rehydrate persisted transcripts + mode flags. A live run never survives a
  // reload, so status/pendingApprovals are reset to a clean idle state.
  if (browser) {
    try {
      const rawConvs = localStorage.getItem(STORAGE_CONVS);
      if (rawConvs) {
        const parsed = JSON.parse(rawConvs) as Record<string, AgentConvState>;
        for (const [id, c] of Object.entries(parsed)) {
          initial.convs[id] = {
            ...emptyConv(),
            items: Array.isArray(c.items) ? c.items : [],
            usage: c.usage ?? { inputTokens: 0, outputTokens: 0 },
            finishMsg: c.finishMsg,
          };
        }
      }
      const rawModes = localStorage.getItem(STORAGE_MODES);
      if (rawModes) initial.agentMode = JSON.parse(rawModes) || {};
    } catch (err) {
      console.error('Failed to load agent state:', err);
    }
  }

  const { subscribe, update, set } = writable<AgentStoreState>(initial);

  const persist = (state: AgentStoreState) => {
    if (!browser) return;
    try {
      // Persist only the durable transcript, never the transient run flags.
      const durable: Record<string, AgentConvState> = {};
      for (const [id, c] of Object.entries(state.convs)) {
        durable[id] = { ...emptyConv(), items: c.items, usage: c.usage, finishMsg: c.finishMsg };
      }
      localStorage.setItem(STORAGE_CONVS, JSON.stringify(durable));
      localStorage.setItem(STORAGE_MODES, JSON.stringify(state.agentMode));
    } catch (err) {
      console.error('Failed to persist agent state:', err);
    }
  };

  // --- transcript helpers (operate on a mutable conv clone) ------------------

  const sealOpen = (c: AgentConvState) => {
    const last = c.items[c.items.length - 1];
    if (last && (last.type === 'assistant' || last.type === 'thinking')) last.sealed = true;
  };

  const appendDelta = (c: AgentConvState, kind: 'assistant' | 'thinking', text: string) => {
    const last = c.items[c.items.length - 1];
    if (last && last.type === kind && !last.sealed) {
      last.text += text;
    } else {
      c.items.push({ type: kind, text, sealed: false });
    }
  };

  const findTool = (c: AgentConvState, id: string): ToolItem | undefined => {
    for (let i = c.items.length - 1; i >= 0; i--) {
      const it = c.items[i];
      if (it.type === 'tool' && it.id === id) return it;
    }
    return undefined;
  };

  /** Reduce one AgentEvent into the conversation's state. Returns whether the
   *  change is "structural" (worth persisting — i.e. not a mid-stream delta). */
  const reduce = (c: AgentConvState, ev: any): boolean => {
    switch (ev.kind) {
      case 'turn_start':
        c.turn = ev.turn ?? c.turn;
        c.status = 'running';
        c.error = undefined;
        sealOpen(c);
        return true;

      case 'text_delta':
        appendDelta(c, 'assistant', ev.text ?? '');
        return false;

      case 'thinking_delta':
        appendDelta(c, 'thinking', ev.text ?? '');
        return false;

      case 'tool_call':
        sealOpen(c);
        c.items.push({
          type: 'tool',
          id: ev.id,
          name: ev.name,
          input: ev.input ?? {},
          status: 'running',
        });
        return true;

      case 'approval_request': {
        const card = findTool(c, ev.id);
        if (card) card.status = 'awaiting';
        c.pendingApprovals = [
          ...c.pendingApprovals,
          {
            toolCallId: ev.id,
            name: ev.name,
            input: ev.input ?? {},
            destructive: DESTRUCTIVE_TOOLS.has(ev.name),
          },
        ];
        c.status = 'awaiting-approval';
        return true;
      }

      case 'tool_result': {
        const card = findTool(c, ev.id);
        if (card) {
          card.content = ev.content ?? '';
          card.isError = !!ev.isError;
          card.status = ev.isError ? 'error' : 'done';
        } else {
          c.items.push({
            type: 'tool',
            id: ev.id,
            name: ev.name,
            input: {},
            status: ev.isError ? 'error' : 'done',
            content: ev.content ?? '',
            isError: !!ev.isError,
          });
        }
        c.pendingApprovals = c.pendingApprovals.filter((p) => p.toolCallId !== ev.id);
        if (c.status === 'awaiting-approval' && c.pendingApprovals.length === 0) c.status = 'running';
        return true;
      }

      case 'usage':
        c.usage = {
          inputTokens: c.usage.inputTokens + (ev.inputTokens ?? 0),
          outputTokens: c.usage.outputTokens + (ev.outputTokens ?? 0),
        };
        return false;

      case 'turn_end':
        sealOpen(c);
        if (ev.reason === 'finish') {
          c.finishMsg = ev.finishMsg;
          if (ev.finishMsg) c.items.push({ type: 'notice', level: 'info', text: ev.finishMsg });
          c.status = 'idle';
        } else if (ev.reason === 'stopped') {
          c.status = 'stopped';
          c.items.push({ type: 'notice', level: 'stopped', text: 'Run stopped.' });
        } else if (ev.reason === 'max_turns') {
          c.items.push({ type: 'notice', level: 'info', text: 'Reached the turn limit.' });
          c.status = 'idle';
        } else {
          // Plain end_turn: the loop is now KeepAlive-blocked awaiting the next
          // operator message, so the conversation is ready for input again.
          c.status = 'idle';
        }
        return true;

      case 'log':
        return false;

      case 'error':
        c.error = ev.error;
        c.items.push({ type: 'notice', level: 'error', text: `Error: ${ev.error}` });
        return true;

      case 'done':
        c.pendingApprovals = [];
        if (c.status === 'running' || c.status === 'awaiting-approval') c.status = 'idle';
        return true;

      default:
        return false;
    }
  };

  // Route a live event to its conversation, cloning the touched slice so Svelte
  // sees a new reference and re-renders.
  const onEvent = (payload: any) => {
    const convId: string | undefined = payload?.conversationId;
    if (!convId) return;
    update((state) => {
      const prev = state.convs[convId] ?? emptyConv();
      // Shallow-clone conv + its arrays so the reducer can mutate safely.
      const c: AgentConvState = {
        ...prev,
        items: prev.items.map((it) => ({ ...it })),
        pendingApprovals: [...prev.pendingApprovals],
        usage: { ...prev.usage },
      };
      const structural = reduce(c, payload);
      const next = { ...state, convs: { ...state.convs, [convId]: c } };
      if (structural) persist(next);
      return next;
    });
  };

  // Subscribe once to the main-process event stream.
  if (browser && hasApi()) {
    window.electronAPI.agent.onEvent(onEvent);
  }

  // --- actions ---------------------------------------------------------------

  const buildCfg = (): AgentRunCfg => {
    const provider = get(currentProvider);
    const cfg: AgentRunCfg = {
      provider: provider as AgentRunCfg['provider'],
      apiKey: get(apiKeys)[provider] || '',
      baseUrl: get(baseUrls)[provider] || undefined,
      model: get(currentModel),
      backend: get(backendStore).kind,
      autoApproveReadOnly: get({ subscribe }).autoApproveReadOnly,
    };
    return cfg;
  };

  const sendMessage = async (convId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Optimistically show the operator's message + flip to running.
    update((state) => {
      const prev = state.convs[convId] ?? emptyConv();
      const c: AgentConvState = {
        ...prev,
        items: [...prev.items.map((it) => ({ ...it })), { type: 'user', text: trimmed }],
        pendingApprovals: [...prev.pendingApprovals],
        usage: { ...prev.usage },
        status: 'running',
        error: undefined,
      };
      const next = { ...state, convs: { ...state.convs, [convId]: c } };
      persist(next);
      return next;
    });

    if (!hasApi()) return;
    try {
      await window.electronAPI.agent.sendMessage(convId, trimmed, buildCfg());
    } catch (err) {
      onEvent({ conversationId: convId, kind: 'error', error: err instanceof Error ? err.message : String(err) });
      onEvent({ conversationId: convId, kind: 'done' });
    }
  };

  const stop = async (convId: string) => {
    if (!hasApi()) return;
    try {
      await window.electronAPI.agent.stop(convId);
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  const resolve = async (convId: string, id: string, verdict: 'allow' | 'deny') => {
    // Optimistically drop the pending card so the UI can't double-submit.
    update((state) => {
      const prev = state.convs[convId];
      if (!prev) return state;
      const c: AgentConvState = { ...prev, pendingApprovals: prev.pendingApprovals.filter((p) => p.toolCallId !== id) };
      if (verdict === 'allow') {
        c.items = prev.items.map((it) => (it.type === 'tool' && it.id === id ? { ...it, status: 'running' } : it));
        c.status = 'running';
      } else if (c.pendingApprovals.length === 0) {
        c.status = 'running';
      }
      return { ...state, convs: { ...state.convs, [convId]: c } };
    });
    if (!hasApi()) return;
    try {
      await window.electronAPI.agent.resolveApproval(convId, id, verdict);
    } catch (err) {
      console.error('Failed to resolve approval:', err);
    }
  };

  const approve = (convId: string, id: string) => resolve(convId, id, 'allow');
  const deny = (convId: string, id: string) => resolve(convId, id, 'deny');

  const setAutoApproveReadOnly = (v: boolean) =>
    update((state) => ({ ...state, autoApproveReadOnly: v }));

  const setMode = (convId: string, mode: 'chat' | 'agent') =>
    update((state) => {
      const agentMode = { ...state.agentMode, [convId]: mode === 'agent' };
      const next = { ...state, agentMode };
      persist(next);
      return next;
    });

  const clearConversation = (convId: string) =>
    update((state) => {
      const convs = { ...state.convs };
      delete convs[convId];
      const agentMode = { ...state.agentMode };
      delete agentMode[convId];
      const next = { ...state, convs, agentMode };
      persist(next);
      return next;
    });

  return {
    subscribe,
    set,
    sendMessage,
    stop,
    approve,
    deny,
    setAutoApproveReadOnly,
    setMode,
    clearConversation,
  };
}

export const agentStore = createAgentStore();
