// Kanti Tool Registry (MAIN) — the kanti_* schemas ported from the paid registry
// (app/src-renderer/lib/tools/registry.ts) plus the agent exec/fs/finish tools that
// dispatch to the Phase-4 backend. Each schema carries requiresApproval (exec /
// network / state-changing) and/or readOnly so the agent loop can gate side effects.

import type { ToolSchema } from './types';

export const kantiTools: Record<string, ToolSchema> = {
  // --- proxy -----------------------------------------------------------------
  kanti_proxy_start: {
    name: 'kanti_proxy_start',
    description: 'Start the Kanti proxy server to intercept HTTP/HTTPS traffic',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Port number for the proxy server (default: 8080)',
          default: 8080,
        },
      },
    },
  },

  kanti_proxy_stop: {
    name: 'kanti_proxy_stop',
    description: 'Stop the Kanti proxy server',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  kanti_proxy_status: {
    name: 'kanti_proxy_status',
    description: 'Get the current status of the proxy server (running/stopped, port, certificate path)',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  kanti_proxy_get_requests: {
    name: 'kanti_proxy_get_requests',
    description: 'Retrieve captured HTTP/HTTPS requests from the proxy',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of requests to return (optional)',
        },
        filter: {
          type: 'string',
          description: 'Filter requests by URL, method, or host (optional)',
        },
      },
    },
  },

  kanti_proxy_clear_requests: {
    name: 'kanti_proxy_clear_requests',
    description: 'Clear all captured requests from the proxy',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  kanti_proxy_set_scope: {
    name: 'kanti_proxy_set_scope',
    description: 'Set the scope filters for the proxy (which domains to capture)',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        inScope: {
          type: 'array',
          description: 'Array of domains/patterns to include in scope (e.g., ["example.com", "*.test.com"])',
        },
        outOfScope: {
          type: 'array',
          description: 'Array of domains/patterns to exclude from scope (optional)',
        },
      },
      required: ['inScope'],
    },
  },

  kanti_proxy_get_scope: {
    name: 'kanti_proxy_get_scope',
    description: 'Get the current scope settings for the proxy',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  kanti_proxy_export_certificate: {
    name: 'kanti_proxy_export_certificate',
    description: 'Get information about exporting the CA certificate for HTTPS interception',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  // --- repeater --------------------------------------------------------------
  kanti_repeater_send: {
    name: 'kanti_repeater_send',
    description: 'Send a custom HTTP request using the repeater functionality',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'HTTP method (GET, POST, PUT, DELETE, etc.)',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        },
        protocol: {
          type: 'string',
          description: 'Protocol (http or https)',
          enum: ['http', 'https'],
          default: 'https',
        },
        host: {
          type: 'string',
          description: 'Target host (e.g., example.com or example.com:8080)',
        },
        path: {
          type: 'string',
          description: 'Request path (e.g., /api/users)',
        },
        headers: {
          type: 'object',
          description: 'HTTP headers as key-value pairs (optional)',
        },
        body: {
          type: 'string',
          description: 'Request body content (optional, for POST/PUT/PATCH)',
        },
      },
      required: ['method', 'host', 'path'],
    },
  },

  // --- project ---------------------------------------------------------------
  kanti_project_save: {
    name: 'kanti_project_save',
    description: 'Save the current Kanti project',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  kanti_project_get_current: {
    name: 'kanti_project_get_current',
    description: 'Get information about the current project',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  // --- encoding --------------------------------------------------------------
  kanti_decode: {
    name: 'kanti_decode',
    description: 'Decode data using various encoding schemes',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Data to decode',
        },
        encoding: {
          type: 'string',
          description: 'Encoding type',
          enum: ['base64', 'url', 'html', 'hex'],
        },
      },
      required: ['data', 'encoding'],
    },
  },

  kanti_encode: {
    name: 'kanti_encode',
    description: 'Encode data using various encoding schemes',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Data to encode',
        },
        encoding: {
          type: 'string',
          description: 'Encoding type',
          enum: ['base64', 'url', 'html', 'hex'],
        },
      },
      required: ['data', 'encoding'],
    },
  },

  // --- agent: shell exec on the Phase-4 backend ------------------------------
  agent_shell_exec: {
    name: 'agent_shell_exec',
    description:
      'Run one shell command line on the selected exec backend (local or docker) ' +
      'and return its stdout, stderr and exit code. A non-zero exit is reported as ' +
      'data, not an error.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: 'The shell command line to run (interpreted by sh -c).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory (workspace-relative or absolute).',
        },
      },
      required: ['cmd'],
    },
  },

  // --- agent: interactive shell session --------------------------------------
  agent_shell_session_start: {
    name: 'agent_shell_session_start',
    description: 'Start a long-lived interactive shell session on the backend. Returns a sessionId.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: 'Optional command line to launch (defaults to an interactive shell).',
        },
      },
    },
  },

  agent_shell_write: {
    name: 'agent_shell_write',
    description: 'Write input (stdin) to a running interactive shell session.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The id returned by agent_shell_session_start.',
        },
        data: {
          type: 'string',
          description: 'The data to write to the session stdin.',
        },
      },
      required: ['sessionId', 'data'],
    },
  },

  agent_shell_read: {
    name: 'agent_shell_read',
    description: 'Read new output from a running interactive shell session since a cursor.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The id returned by agent_shell_session_start.',
        },
        since: {
          type: 'number',
          description: 'Byte cursor to read from (default 0).',
        },
      },
      required: ['sessionId'],
    },
  },

  agent_shell_kill: {
    name: 'agent_shell_kill',
    description: 'Terminate a running interactive shell session.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The id returned by agent_shell_session_start.',
        },
      },
      required: ['sessionId'],
    },
  },

  // --- agent: workspace files via the backend --------------------------------
  agent_fs_read: {
    name: 'agent_fs_read',
    description: 'Read a workspace file from the backend and return its UTF-8 contents.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
        },
      },
      required: ['path'],
    },
  },

  agent_fs_write: {
    name: 'agent_fs_write',
    description: 'Write (create/overwrite) a workspace file on the backend.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
        },
        content: {
          type: 'string',
          description: 'UTF-8 file content to write.',
        },
      },
      required: ['path', 'content'],
    },
  },

  agent_fs_list: {
    name: 'agent_fs_list',
    description: 'List the entries of a workspace directory on the backend.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative directory path (use "." for the root).',
        },
      },
      required: ['path'],
    },
  },

  // --- agent: end the turn loop ----------------------------------------------
  finish: {
    name: 'finish',
    description: 'End the agent turn loop and report a final summary of what was done.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'A summary of the work completed and the final outcome.',
        },
      },
      required: ['summary'],
    },
  },
};

// Get all tool schemas as an array (for sending to AI providers)
export function getToolSchemas(): ToolSchema[] {
  return Object.values(kantiTools);
}

// Get a specific tool schema by name
export function getToolSchema(name: string): ToolSchema | undefined {
  return kantiTools[name];
}

// Check if a tool exists
export function hasToolWithName(name: string): boolean {
  return name in kantiTools;
}
