// Agent conversation + event model (MAIN). The conversation is stored in the
// Anthropic wire shape (a `Block` union) because that is the richest of the
// providers we target — text + first-class thinking (never flattened into text) +
// tool_use + tool_result. The OpenAI-compatible adapter maps this shape to/from
// chat-completions messages. `StreamEvent` is the unified per-family stream the
// providers emit; `AgentEvent` is what the loop emits to the renderer.

/** A single content block in a Message (Anthropic block shape). */
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string; signature?: string }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean };

/** One conversation turn. `system` is used only defensively — the loop keeps the
 *  system prompt out of the history and passes it top-level. */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: Block[];
}

/** Provider-reported token usage (partial per SSE frame; the loop sums them). */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Unified streaming event, one per provider family. The HTTP layer + the two pure
 * SSE parsers (parseAnthropicSSE / parseOpenAISSE) produce these; the loop consumes
 * them, accumulates blocks, and coalesces text/thinking into AgentEvents.
 */
export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | { kind: 'signature'; signature: string }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'done'; stopReason?: string }
  | { kind: 'error'; error: string };

/**
 * What the agent loop emits to the renderer (via the manager → webContents). The
 * text_delta / thinking_delta events are COALESCED (batched ~50ms / ~200 chars) —
 * the documented GUI lock-up fix — so a live run doesn't flood the renderer with a
 * per-token event storm.
 */
export type AgentEvent =
  | { kind: 'turn_start'; turn: number }
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: Record<string, any> }
  | { kind: 'tool_result'; id: string; name: string; content: string; isError: boolean }
  | { kind: 'approval_request'; id: string; name: string; input: Record<string, any> }
  | { kind: 'turn_end'; reason: string; finishMsg?: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'log'; level: string; text: string }
  | { kind: 'error'; error: string }
  | { kind: 'done' };
