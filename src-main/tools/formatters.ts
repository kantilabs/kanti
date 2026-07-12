// Format tool schemas / results for the different LLM providers. Ported from the
// paid renderer formatters (app/src-renderer/lib/tools/formatters.ts) into MAIN.
// The schema formatters strip the extra requiresApproval/readOnly fields — they are
// agent-loop metadata, not part of a provider's function/tool declaration.

import type { ToolSchema, ToolResult } from './types';

/**
 * Format tools for OpenAI/Deepseek (compatible format).
 */
export function formatForOpenAI(tools: ToolSchema[]) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Format tools for Anthropic.
 */
export function formatForAnthropic(tools: ToolSchema[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

/**
 * Format tools for Gemini.
 */
export function formatForGemini(tools: ToolSchema[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/**
 * Parse tool calls from OpenAI/Deepseek response.
 */
export function parseOpenAIToolCalls(toolCalls: any[]) {
  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    parameters: JSON.parse(tc.function.arguments),
  }));
}

/**
 * Parse tool calls from Anthropic response.
 */
export function parseAnthropicToolCalls(content: any[]) {
  return content
    .filter((c: any) => c.type === 'tool_use')
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      parameters: c.input,
    }));
}

/**
 * Parse tool calls from Gemini response.
 */
export function parseGeminiToolCalls(parts: any[]) {
  return parts
    .filter((p: any) => p.functionCall)
    .map((p: any) => ({
      name: p.functionCall.name,
      parameters: p.functionCall.args,
    }));
}

/**
 * Render a single ToolResult into the string a provider tool_result content expects.
 * Success carries data (or message); failure carries the error. Kept a plain string
 * so it slots into Anthropic tool_result content / OpenAI tool message content alike.
 */
export function formatToolResultContent(result: ToolResult): string {
  if (result.success) {
    if (result.data !== undefined) {
      return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    }
    return result.message ?? 'Success';
  }
  return `Error: ${result.error ?? 'Unknown error'}`;
}

/**
 * Format tool results for OpenAI/Deepseek.
 */
export function formatToolResultsForOpenAI(toolCalls: any[], results: ToolResult[]) {
  return toolCalls.map((tc, index) => ({
    role: 'tool',
    tool_call_id: tc.id,
    content: formatToolResultContent(results[index]),
  }));
}

/**
 * Format tool results for Anthropic.
 */
export function formatToolResultsForAnthropic(toolCalls: any[], results: ToolResult[]) {
  return toolCalls.map((tc, index) => ({
    type: 'tool_result',
    tool_use_id: tc.id,
    content: formatToolResultContent(results[index]),
    is_error: !results[index]?.success,
  }));
}

/**
 * Format tool results for Gemini.
 */
export function formatToolResultsForGemini(toolCalls: any[], results: ToolResult[]) {
  return toolCalls.map((tc, index) => ({
    functionResponse: {
      name: tc.name,
      response:
        results[index]?.data ?? {
          success: results[index]?.success,
          message: results[index]?.message,
          error: results[index]?.error,
        },
    },
  }));
}
