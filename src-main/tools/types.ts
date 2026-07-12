// Tool-related TypeScript interfaces — ported from the paid renderer tool layer
// (app/src-renderer/lib/tools/types.ts) and re-homed into Electron MAIN. Two
// additions over the paid original:
//   - ToolSchema gains requiresApproval/readOnly so the agent loop can gate
//     exec/network/state-changing tools behind a human approval.
//   - ToolCtx carries the per-dispatch context (proxy base, project manager,
//     approval callback, finish state) that MAIN dispatch needs instead of the
//     renderer's window.electronAPI.

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: any;
  required?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  /** Gate: true for exec / network / state-changing tools that must clear a human
   *  approval before dispatch runs them. */
  requiresApproval?: boolean;
  /** true for tools that only read (no side effects); may be auto-approved. */
  readOnly?: boolean;
}

export interface ToolCall {
  id?: string;
  name: string;
  parameters: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

export interface ToolExecution {
  toolCall: ToolCall;
  result: ToolResult;
  timestamp: Date;
}

// Provider-specific tool call formats
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface AnthropicToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface GeminiToolCall {
  functionCall: {
    name: string;
    args: Record<string, any>;
  };
}

/**
 * ToolCtx is the per-run context threaded into every dispatch() call. It replaces
 * the renderer's window.electronAPI: dispatch runs entirely in MAIN and reaches the
 * proxy over electron net, the project state via the in-process ProjectManager, and
 * exec/fs via the Phase-4 BackendManager. finished/finishMsg are set by the `finish`
 * tool to end the agent turn loop.
 */
export interface ToolCtx {
  /** Set true by the `finish` tool; the agent loop stops when it sees this. */
  finished: boolean;
  /** The summary passed to `finish`. */
  finishMsg?: string;
  /** Base URL of the go-backend proxy API (e.g. http://localhost:9090). */
  proxyBaseUrl: string;
  /** Returns the in-process ProjectManager main already holds (getCurrentProject /
   *  saveProject). Typed any to avoid coupling to the project module here. */
  getProjectManager(): any;
  /** When true, readOnly tools skip the approval prompt. */
  autoApproveReadOnly: boolean;
  /** Asks the human to approve a requiresApproval tool. Resolves 'allow' | 'deny'. */
  requestApproval: (call: ToolCall) => Promise<'allow' | 'deny'>;
  /** Emits a progress/telemetry event for the UI (opaque payload). */
  emit: (ev: any) => void;
}
