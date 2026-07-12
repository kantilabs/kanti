/**
 * Utility functions for formatting HTTP requests and responses
 * for sending to AI chat
 */

interface FormattedRequestResponse {
  formatted: string;
  isTruncated: boolean;
}

/**
 * Format a captured request and its response for AI analysis
 */
export function formatRequestResponse(
  request: CapturedRequest,
  includeFullResponse: boolean = false
): FormattedRequestResponse {
  const MAX_RESPONSE_LENGTH = 5000;
  let formatted = '';
  let isTruncated = false;

  // Request section
  formatted += '=== HTTP REQUEST ===\n\n';
  formatted += `Method: ${request.method}\n`;
  formatted += `URL: ${request.protocol}://${request.host}${request.path}\n`;
  formatted += `Protocol: ${request.protocol.toUpperCase()}\n\n`;

  // Request headers
  formatted += 'Request Headers:\n';
  if (request.headers && Object.keys(request.headers).length > 0) {
    Object.entries(request.headers).forEach(([key, value]) => {
      formatted += `  ${key}: ${value}\n`;
    });
  } else {
    formatted += '  (none)\n';
  }
  formatted += '\n';

  // Request body
  if (request.body) {
    formatted += 'Request Body:\n';
    formatted += formatBody(request.body, true);
    formatted += '\n\n';
  } else {
    formatted += 'Request Body: (empty)\n\n';
  }

  // Response section
  formatted += '=== HTTP RESPONSE ===\n\n';

  if (request.status) {
    formatted += `Status Code: ${request.status}\n`;
    formatted += `Response Time: ${request.responseTime || 'N/A'} ms\n`;
    formatted += `Response Size: ${formatBytes(request.responseLength || 0)}\n\n`;

    // Response headers
    formatted += 'Response Headers:\n';
    if (request.responseHeaders && Object.keys(request.responseHeaders).length > 0) {
      Object.entries(request.responseHeaders).forEach(([key, value]) => {
        formatted += `  ${key}: ${value}\n`;
      });
    } else {
      formatted += '  (none)\n';
    }
    formatted += '\n';

    // Response body
    if (request.responseBody) {
      const contentType = request.responseHeaders?.['content-type'] || '';

      // Check if response is binary/image
      if (isBinaryContent(contentType)) {
        formatted += 'Response Body:\n';
        formatted += `  [Binary content: ${contentType}, Size: ${formatBytes(request.responseLength || 0)}]\n`;
      } else {
        formatted += 'Response Body:\n';

        if (includeFullResponse) {
          formatted += formatBody(request.responseBody, true);
        } else {
          const truncated = truncateResponse(request.responseBody, MAX_RESPONSE_LENGTH);
          formatted += formatBody(truncated.content, true);
          if (truncated.wasTruncated) {
            isTruncated = true;
            formatted += `\n  ... [truncated, original size: ${formatBytes(request.responseBody.length)}]\n`;
          }
        }
      }
    } else {
      formatted += 'Response Body: (empty)\n';
    }
  } else {
    formatted += 'Status: No response received yet\n';
  }

  return { formatted, isTruncated };
}

/**
 * Create a default analysis prompt for the AI
 */
export function createAnalysisPrompt(requestResponseData: string): string {
  return `Please analyze this HTTP request and response for:

1. **Security Analysis**: Potential vulnerabilities, security headers, authentication issues
2. **API Behavior**: Response patterns, error handling, data structures
3. **Performance Insights**: Response time, payload size, optimization opportunities
4. **Notable Observations**: Anything unusual, interesting, or worth highlighting

${requestResponseData}

Please provide a comprehensive analysis with actionable insights.`;
}

/**
 * Create a context message for user's custom question
 */
export function createContextMessage(requestResponseData: string, userQuestion: string): string {
  return `I have the following HTTP request and response data:

${requestResponseData}

My question: ${userQuestion}`;
}

/**
 * Format body content with proper indentation
 */
function formatBody(body: string, indent: boolean = false): string {
  const prefix = indent ? '  ' : '';

  // Try to parse as JSON for pretty formatting
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 2)
      .split('\n')
      .map(line => prefix + line)
      .join('\n');
  } catch {
    // Not JSON, return as-is with indentation
    return body
      .split('\n')
      .map(line => prefix + line)
      .join('\n');
  }
}

/**
 * Truncate response to a maximum length
 */
function truncateResponse(content: string, maxLength: number): { content: string; wasTruncated: boolean } {
  if (content.length <= maxLength) {
    return { content, wasTruncated: false };
  }

  return {
    content: content.substring(0, maxLength),
    wasTruncated: true
  };
}

/**
 * Check if content type is binary
 */
function isBinaryContent(contentType: string): boolean {
  const binaryTypes = [
    'image/',
    'audio/',
    'video/',
    'application/octet-stream',
    'application/pdf',
    'application/zip',
    'application/x-rar',
    'application/x-tar',
    'application/x-gzip'
  ];

  return binaryTypes.some(type => contentType.toLowerCase().includes(type));
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
