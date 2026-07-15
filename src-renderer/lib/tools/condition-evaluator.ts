// Condition Evaluator - Evaluates automation conditions against responses

import type { Condition, ActionExecutionResult } from '$lib/stores/automation';

/**
 * Evaluate a single condition against an action execution result
 */
export function evaluateCondition(
  condition: Condition,
  executionResult: ActionExecutionResult
): { passed: boolean; message?: string } {
  if (!executionResult.response) {
    return { passed: false, message: 'No response available' };
  }

  const { response } = executionResult;
  const { body, headers, status } = response;

  try {
    switch (condition.type) {
      case 'status-code':
        return evaluateStatusCode(condition, status);
      
      case 'response-time':
        return evaluateResponseTime(condition, response.time);
      
      case 'body-contains':
        return evaluateBodyContains(condition, body);
      
      case 'body-not-contains':
        return evaluateBodyNotContains(condition, body);
      
      case 'header-exists':
        return evaluateHeaderExists(condition, headers);
      
      case 'header-value':
        return evaluateHeaderValue(condition, headers);
      
      case 'json-path':
        return evaluateJsonPath(condition, body);
      
      case 'body-regex':
        return evaluateBodyRegex(condition, body);
      
      case 'body-not-regex':
        return evaluateBodyNotRegex(condition, body);
      
      default:
        return { passed: false, message: `Unknown condition type: ${condition.type}` };
    }
  } catch (error) {
    return { 
      passed: false, 
      message: `Error evaluating condition: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Evaluate status code condition
 * Supports individual codes (200, 404) and ranges (2xx, 3xx, 4xx, 5xx)
 */
function evaluateStatusCode(condition: Condition, statusCode: number): { passed: boolean; message?: string } {
  const valueStr = String(condition.value);
  
  // Check if value is a range (e.g., "2xx", "4xx")
  if (valueStr.match(/^[1-5]xx$/i)) {
    const rangePrefix = parseInt(valueStr.charAt(0));
    const rangeMin = rangePrefix * 100;
    const rangeMax = rangePrefix * 100 + 99;
    
    switch (condition.operator) {
      case 'equals':
        const inRange = statusCode >= rangeMin && statusCode <= rangeMax;
        return {
          passed: inRange,
          message: `Status code ${statusCode} ${inRange ? 'is in' : 'is not in'} range ${valueStr} (${rangeMin}-${rangeMax})`
        };
      
      case 'not-equals':
        const notInRange = statusCode < rangeMin || statusCode > rangeMax;
        return {
          passed: notInRange,
          message: `Status code ${statusCode} ${notInRange ? 'is not in' : 'is in'} range ${valueStr} (${rangeMin}-${rangeMax})`
        };
      
      default:
        return { passed: false, message: `Operator ${condition.operator} not supported for status code ranges. Use 'equals' or 'not-equals'.` };
    }
  }
  
  // Handle individual status codes
  const expected = Number(condition.value);
  
  switch (condition.operator) {
    case 'equals':
      return { 
        passed: statusCode === expected,
        message: `Status code ${statusCode} ${statusCode === expected ? 'equals' : 'does not equal'} ${expected}`
      };
    
    case 'not-equals':
      return { 
        passed: statusCode !== expected,
        message: `Status code ${statusCode} ${statusCode !== expected ? 'does not equal' : 'equals'} ${expected}`
      };
    
    case 'greater-than':
      return { 
        passed: statusCode > expected,
        message: `Status code ${statusCode} is ${statusCode > expected ? 'greater than' : 'not greater than'} ${expected}`
      };
    
    case 'less-than':
      return { 
        passed: statusCode < expected,
        message: `Status code ${statusCode} is ${statusCode < expected ? 'less than' : 'not less than'} ${expected}`
      };
    
    default:
      return { passed: false, message: `Unsupported operator for status code: ${condition.operator}` };
  }
}

/**
 * Evaluate response time condition
 */
function evaluateResponseTime(condition: Condition, responseTime: number): { passed: boolean; message?: string } {
  const expected = Number(condition.value);
  
  switch (condition.operator) {
    case 'less-than':
      return { 
        passed: responseTime < expected,
        message: `Response time ${responseTime}ms is ${responseTime < expected ? 'less than' : 'not less than'} ${expected}ms`
      };
    
    case 'greater-than':
      return { 
        passed: responseTime > expected,
        message: `Response time ${responseTime}ms is ${responseTime > expected ? 'greater than' : 'not greater than'} ${expected}ms`
      };
    
    default:
      return { passed: false, message: `Unsupported operator for response time: ${condition.operator}` };
  }
}

/**
 * Evaluate body contains condition
 */
function evaluateBodyContains(condition: Condition, body: string): { passed: boolean; message?: string } {
  const searchText = String(condition.value);
  const contains = body.includes(searchText);
  
  return { 
    passed: contains,
    message: `Response body ${contains ? 'contains' : 'does not contain'} "${searchText}"`
  };
}

/**
 * Evaluate body not contains condition
 */
function evaluateBodyNotContains(condition: Condition, body: string): { passed: boolean; message?: string } {
  const searchText = String(condition.value);
  const contains = body.includes(searchText);
  
  return { 
    passed: !contains,
    message: `Response body ${!contains ? 'does not contain' : 'contains'} "${searchText}"`
  };
}

/**
 * Evaluate header exists condition
 */
function evaluateHeaderExists(condition: Condition, headers: Record<string, string>): { passed: boolean; message?: string } {
  const headerName = String(condition.value);
  const exists = headerName.toLowerCase() in Object.keys(headers).reduce((acc, key) => {
    acc[key.toLowerCase()] = true;
    return acc;
  }, {} as Record<string, boolean>);
  
  return { 
    passed: exists,
    message: `Header "${headerName}" ${exists ? 'exists' : 'does not exist'}`
  };
}

/**
 * Evaluate header value condition
 */
function evaluateHeaderValue(condition: Condition, headers: Record<string, string>): { passed: boolean; message?: string } {
  if (!condition.field) {
    return { passed: false, message: 'Header name (field) is required for header-value condition' };
  }
  
  const headerName = condition.field;
  const expectedValue = String(condition.value);
  const actualValue = headers[headerName];
  
  if (actualValue === undefined) {
    return { passed: false, message: `Header "${headerName}" not found` };
  }
  
  switch (condition.operator) {
    case 'equals':
      return { 
        passed: actualValue === expectedValue,
        message: `Header "${headerName}" value "${actualValue}" ${actualValue === expectedValue ? 'equals' : 'does not equal'} "${expectedValue}"`
      };
    
    case 'contains':
      return { 
        passed: actualValue.includes(expectedValue),
        message: `Header "${headerName}" value "${actualValue}" ${actualValue.includes(expectedValue) ? 'contains' : 'does not contain'} "${expectedValue}"`
      };
    
    default:
      return { passed: false, message: `Unsupported operator for header value: ${condition.operator}` };
  }
}

/**
 * Evaluate JSON path condition (basic implementation)
 */
function evaluateJsonPath(condition: Condition, body: string): { passed: boolean; message?: string } {
  if (!condition.field) {
    return { passed: false, message: 'JSON path (field) is required for json-path condition' };
  }
  
  try {
    const data = JSON.parse(body);
    const path = condition.field.split('.');
    let value = data;
    
    for (const key of path) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return { passed: false, message: `JSON path "${condition.field}" not found` };
      }
    }
    
    const expected = condition.value;
    const actual = String(value);
    
    switch (condition.operator) {
      case 'equals':
        return { 
          passed: actual === String(expected),
          message: `JSON path "${condition.field}" value "${actual}" ${actual === String(expected) ? 'equals' : 'does not equal'} "${expected}"`
        };
      
      case 'contains':
        return { 
          passed: actual.includes(String(expected)),
          message: `JSON path "${condition.field}" value "${actual}" ${actual.includes(String(expected)) ? 'contains' : 'does not contain'} "${expected}"`
        };
      
      default:
        return { passed: false, message: `Unsupported operator for JSON path: ${condition.operator}` };
    }
  } catch (error) {
    return { passed: false, message: 'Invalid JSON in response body' };
  }
}

/**
 * Evaluate body regex condition
 */
function evaluateBodyRegex(condition: Condition, body: string): { passed: boolean; message?: string } {
  const pattern = String(condition.value);
  
  try {
    const regex = new RegExp(pattern);
    const matches = regex.test(body);
    
    return { 
      passed: matches,
      message: `Response body ${matches ? 'matches' : 'does not match'} regex pattern: ${pattern}`
    };
  } catch (error) {
    return { 
      passed: false, 
      message: `Invalid regex pattern: ${pattern} - ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Evaluate body not regex condition
 */
function evaluateBodyNotRegex(condition: Condition, body: string): { passed: boolean; message?: string } {
  const pattern = String(condition.value);
  
  try {
    const regex = new RegExp(pattern);
    const matches = regex.test(body);
    
    return { 
      passed: !matches,
      message: `Response body ${!matches ? 'does not match' : 'matches'} regex pattern: ${pattern}`
    };
  } catch (error) {
    return { 
      passed: false, 
      message: `Invalid regex pattern: ${pattern} - ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Evaluate all conditions in a branch
 */
export function evaluateBranchConditions(
  conditions: Condition[],
  executionResult: ActionExecutionResult
): { allPassed: boolean; results: Array<{ condition: Condition; passed: boolean; message?: string }> } {
  if (conditions.length === 0) {
    return { allPassed: true, results: [] };
  }
  
  const results = conditions.map(condition => ({
    condition,
    ...evaluateCondition(condition, executionResult)
  }));
  
  const allPassed = results.every(result => result.passed);
  
  return { allPassed, results };
}
