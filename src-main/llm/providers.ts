// Provider LLM calls, run in the Electron main process via `net.fetch` so they
// work in packaged builds (adapter-static drops server routes, and a renderer
// `fetch` to a provider is blocked by CORS). Ported from the old SvelteKit
// `/api/chat` server route. Non-streaming for now; streaming lands later.
import { net } from 'electron';

export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'gemini' | 'custom';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  messages: ChatMessage[];
  system?: string;
}

export interface ChatResult {
  content: string;
}

// OpenAI-compatible chat completions shape ({role, content}).
interface OpenAIMessage {
  role: string;
  content: string;
}

// Gemini message format.
interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/**
 * Dispatch a chat request to the configured provider.
 * Throws Error with the provider's message on failure.
 */
export async function chat(req: ChatRequest): Promise<ChatResult> {
  const { provider, apiKey, baseUrl, model, messages, system } = req;

  switch (provider) {
    case 'openai':
      return callOpenAICompatible(
        baseUrl || 'https://api.openai.com/v1',
        apiKey,
        model || 'gpt-4o',
        messages,
        system,
        'OpenAI'
      );
    case 'deepseek':
      return callOpenAICompatible(
        baseUrl || 'https://api.deepseek.com/v1',
        apiKey,
        model || 'deepseek-chat',
        messages,
        system,
        'Deepseek'
      );
    case 'custom':
      // OpenAI-compatible endpoint at a configurable baseUrl (owner's
      // llama.cpp server defaults to http://localhost:8080/v1).
      return callOpenAICompatible(
        baseUrl || 'http://localhost:8080/v1',
        apiKey,
        model || 'local',
        messages,
        system,
        'Custom'
      );
    case 'gemini':
      return callGemini(apiKey, model || 'gemini-pro', messages, system);
    case 'anthropic':
      return callAnthropic(apiKey, baseUrl, model || 'claude-3-sonnet-20240229', messages, system);
    default:
      throw new Error(`Invalid provider: ${provider}`);
  }
}

/**
 * OpenAI-compatible chat completions (OpenAI, Deepseek, and the generic
 * `custom` provider all speak this). `baseUrl` should include the API version
 * segment (e.g. `.../v1`); this appends `/chat/completions`.
 */
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  system: string | undefined,
  label: string
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body: OpenAIMessage[] = [];
  if (system) body.push({ role: 'system', content: system });
  for (const m of messages) body.push({ role: m.role, content: m.content });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const response = await net.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages: body, temperature: 0.7 })
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(`${label} API error: ${error?.error?.message || error?.message || `HTTP ${response.status}`}`);
  }

  const data = await response.json();
  return { content: data.choices?.[0]?.message?.content ?? '' };
}

async function callGemini(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  system: string | undefined
): Promise<ChatResult> {
  const modelName = model.startsWith('gemini-') ? model : `gemini-${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const contents: GeminiContent[] = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: 0.7 }
  };
  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] };
  }

  const response = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(`Gemini API error: ${error?.error?.message || `HTTP ${response.status}`}`);
  }

  const data = await response.json();
  return { content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '' };
}

async function callAnthropic(
  apiKey: string,
  baseUrl: string | undefined,
  model: string,
  messages: ChatMessage[],
  system: string | undefined
): Promise<ChatResult> {
  const url = `${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;

  // Anthropic only supports user/assistant roles in `messages`; a system
  // prompt goes in the top-level `system` field.
  const anthropicMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const payload: Record<string, unknown> = {
    model,
    messages: anthropicMessages,
    max_tokens: 4000,
    temperature: 0.7
  };
  if (system) payload.system = system;

  const response = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(`Anthropic API error: ${error?.error?.message || `HTTP ${response.status}`}`);
  }

  const data = await response.json();
  return { content: data.content?.[0]?.text ?? '' };
}

async function safeJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
