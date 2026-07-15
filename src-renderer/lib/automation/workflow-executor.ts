// Workflow Executor - Executes automation workflows with action execution and branching

import type {
  Workflow,
  AutomationAction,
  ActionExecutionResult,
  WorkflowExecution,
  SendRequestConfig,
  ModifyResendConfig,
  DetectConfig,
  ExtractDataConfig,
  SetVariableConfig,
  WaitConfig
} from '$lib/stores/automation';
import { evaluateBranchConditions } from '$lib/tools/condition-evaluator';
import { addActionResult, updateActionResult, updateExecutionStatus } from '$lib/stores/automation';

/**
 * Execute a workflow
 */
export async function executeWorkflow(
  workflow: Workflow,
  executionId: string,
  onProgress?: (action: AutomationAction, result: ActionExecutionResult) => void
): Promise<void> {
  console.log(`Starting workflow execution: ${workflow.name} (${executionId})`);
  
  // Find the first action (action with no incoming branches)
  const firstAction = findFirstAction(workflow);
  
  if (!firstAction) {
    console.error('No starting action found in workflow');
    updateExecutionStatus(workflow.id, executionId, 'failed');
    return;
  }
  
  // Initialize execution context
  const context: ExecutionContext = {
    workflow,
    executionId,
    variables: { ...workflow.variables },
    actionResults: new Map(),
    onProgress
  };
  
  try {
    // Execute the workflow starting from the first action
    await executeAction(firstAction, context);
    
    // Workflow completed successfully
    updateExecutionStatus(workflow.id, executionId, 'completed');
    console.log('Workflow execution completed successfully');
  } catch (error) {
    console.error('Workflow execution failed:', error);
    updateExecutionStatus(workflow.id, executionId, 'failed');
  }
}

/**
 * Execution context to track state during execution
 */
interface ExecutionContext {
  workflow: Workflow;
  executionId: string;
  variables: Record<string, any>;
  actionResults: Map<string, ActionExecutionResult>;
  onProgress?: (action: AutomationAction, result: ActionExecutionResult) => void;
}

/**
 * Find the first action in a workflow (no incoming branches)
 */
function findFirstAction(workflow: Workflow): AutomationAction | null {
  if (workflow.actions.length === 0) return null;
  
  // Find actions that are not referenced by any other action's branches
  const referencedActionIds = new Set<string>();
  
  for (const action of workflow.actions) {
    if (action.passBranch.nextActionId) {
      referencedActionIds.add(action.passBranch.nextActionId);
    }
    if (action.failBranch.nextActionId) {
      referencedActionIds.add(action.failBranch.nextActionId);
    }
  }
  
  // Find first action that isn't referenced and isn't an end action
  const firstAction = workflow.actions.find(
    action => !referencedActionIds.has(action.id) && action.type !== 'end'
  );
  
  return firstAction || workflow.actions[0];
}

/**
 * Execute a single action and handle branching
 */
async function executeAction(
  action: AutomationAction,
  context: ExecutionContext
): Promise<void> {
  console.log(`Executing action: ${action.config.name} (${action.type})`);
  
  // Create initial result
  const result: ActionExecutionResult = {
    actionId: action.id,
    status: 'running',
    startTime: Date.now()
  };
  
  // Add result to store
  addActionResult(context.workflow.id, context.executionId, result);
  
  // Notify progress callback
  if (context.onProgress) {
    context.onProgress(action, result);
  }
  
  // Handle end action
  if (action.type === 'end') {
    result.status = 'passed';
    result.endTime = Date.now();
    updateActionResult(context.workflow.id, context.executionId, result);
    if (context.onProgress) {
      context.onProgress(action, result);
    }
    console.log('Reached end action, workflow complete');
    return;
  }
  
  try {
    // Execute the action based on its type
    switch (action.type) {
      case 'send-request':
        await executeSendRequest(action, result, context);
        break;
      
      case 'modify-resend':
        await executeModifyResend(action, result, context);
        break;
      
      case 'detect':
        await executeDetect(action, result, context);
        break;
      
      case 'extract-data':
        await executeExtractData(action, result, context);
        break;
      
      case 'set-variable':
        await executeSetVariable(action, result, context);
        break;
      
      case 'wait':
        await executeWait(action, result, context);
        break;
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
    
    // Mark action as completed
    result.endTime = Date.now();
    
    // Store the result in context
    context.actionResults.set(action.id, result);
    
    // Determine which branch to take based on conditions
    const nextAction = await determineNextAction(action, result, context);
    
    // Update final result
    updateActionResult(context.workflow.id, context.executionId, result);
    if (context.onProgress) {
      context.onProgress(action, result);
    }
    
    // Execute next action if exists
    if (nextAction) {
      await executeAction(nextAction, context);
    }
  } catch (error) {
    // Mark action as failed
    result.status = 'failed';
    result.endTime = Date.now();
    result.error = error instanceof Error ? error.message : 'Unknown error';
    
    updateActionResult(context.workflow.id, context.executionId, result);
    if (context.onProgress) {
      context.onProgress(action, result);
    }
    
    console.error(`Action execution failed: ${action.config.name}`, error);
    
    // Try fail branch
    const failAction = action.failBranch.nextActionId
      ? context.workflow.actions.find(a => a.id === action.failBranch.nextActionId)
      : null;
    
    if (failAction) {
      await executeAction(failAction, context);
    }
  }
}

/**
 * Determine next action based on conditions
 */
async function determineNextAction(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<AutomationAction | null> {
  // Evaluate pass branch conditions
  const passBranchResult = evaluateBranchConditions(
    action.passBranch.conditions,
    result
  );
  
  result.conditionResults = passBranchResult.results;
  
  // If pass conditions are met, take pass branch
  if (passBranchResult.allPassed) {
    result.status = 'passed';
    
    if (action.passBranch.nextActionId) {
      return context.workflow.actions.find(
        a => a.id === action.passBranch.nextActionId
      ) || null;
    }
    return null;
  }
  
  // Otherwise, take fail branch
  result.status = 'failed';
  
  if (action.failBranch.nextActionId) {
    return context.workflow.actions.find(
      a => a.id === action.failBranch.nextActionId
    ) || null;
  }
  
  return null;
}

/**
 * Execute a send-request action
 */
async function executeSendRequest(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<void> {
  const config = action.config as SendRequestConfig;
  
  // Substitute variables in the request
  const url = substituteVariables(config.request.url, context.variables);
  const body = config.request.body 
    ? substituteVariables(config.request.body, context.variables)
    : undefined;
  
  const headers = { ...config.request.headers };
  for (const key in headers) {
    headers[key] = substituteVariables(headers[key], context.variables);
  }
  
  console.log(`Sending ${config.request.method} request to ${url}`);
  
  const startTime = Date.now();
  
  try {
    // Use Electron's fetch if available to avoid CORS issues
    let response: any;
    
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fetch) {
      // Use Electron's IPC-based fetch
      const electronResponse = await (window as any).electronAPI.fetch(url, {
        method: config.request.method,
        headers,
        body: body
      });
      
      const responseTime = Date.now() - startTime;
      
      result.response = {
        status: electronResponse.status,
        headers: electronResponse.headers || {},
        body: electronResponse.body,
        time: responseTime
      };
      
      console.log(`Request completed with status ${electronResponse.status} in ${responseTime}ms`);
    } else {
      // Fallback to browser fetch
      response = await fetch(url, {
        method: config.request.method,
        headers,
        body: body
      });
      
      const responseTime = Date.now() - startTime;
      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      
      response.headers.forEach((value: string, key: string) => {
        responseHeaders[key] = value;
      });
      
      result.response = {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
        time: responseTime
      };
      
      console.log(`Request completed with status ${response.status} in ${responseTime}ms`);
    }
  } catch (error) {
    throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Execute a modify-resend action
 */
async function executeModifyResend(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<void> {
  const config = action.config as ModifyResendConfig;
  
  // Get the source action's result
  let sourceResult: ActionExecutionResult | undefined;
  
  if (config.sourceActionId) {
    sourceResult = context.actionResults.get(config.sourceActionId);
  } else {
    // Use the most recent action with a response
    for (const [_, res] of context.actionResults) {
      if (res.response) {
        sourceResult = res;
      }
    }
  }
  
  if (!sourceResult?.response) {
    throw new Error('No source request found to modify');
  }
  
  // Start with the source request (we'll need to reconstruct it)
  // For now, we'll create a basic modified request
  const modifiedRequest = {
    method: 'GET', // Default method
    url: '', // Will need to be set
    headers: { ...sourceResult.response.headers },
    body: sourceResult.response.body
  };
  
  // Apply modifications
  for (const mod of config.modifications) {
    const modValue = substituteVariables(mod.value || '', context.variables);
    
    switch (mod.type) {
      case 'header':
        if (mod.operation === 'set') {
          modifiedRequest.headers[mod.field] = modValue;
        } else if (mod.operation === 'remove') {
          delete modifiedRequest.headers[mod.field];
        }
        break;
      
      case 'body':
        if (mod.operation === 'set') {
          modifiedRequest.body = modValue;
        } else if (mod.operation === 'replace' && mod.pattern) {
          const regex = new RegExp(mod.pattern, 'g');
          modifiedRequest.body = modifiedRequest.body.replace(regex, modValue);
        }
        break;
    }
  }
  
  // For now, throw an error as we need more context about the original request
  throw new Error('Modify-resend action requires full request context (to be implemented)');
}

/**
 * Execute a detect action (regex detection)
 */
async function executeDetect(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<void> {
  const config = action.config as DetectConfig;
  
  // Get the most recent action with a response
  let sourceResult: ActionExecutionResult | undefined;
  for (const [_, res] of context.actionResults) {
    if (res.response) {
      sourceResult = res;
    }
  }
  
  if (!sourceResult?.response) {
    throw new Error('No response available for detection');
  }
  
  const body = sourceResult.response.body;
  const pattern = substituteVariables(config.pattern, context.variables);
  
  console.log(`Detecting pattern: /${pattern}/${config.flags}`);
  
  try {
    const regex = new RegExp(pattern, config.flags);
    const matches = body.match(regex);
    
    // Store matches in extracted data
    result.extractedData = {
      matches: matches || [],
      matchCount: matches ? matches.length : 0
    };
    
    // If extract variable is specified, store the matches
    if (config.extractToVariable && matches) {
      context.variables[config.extractToVariable] = matches;
    }
    
    // Determine if detection passed based on match mode
    let detectionPassed = false;
    
    switch (config.matchMode) {
      case 'any':
        detectionPassed = matches !== null && matches.length > 0;
        break;
      
      case 'all':
        // For 'all' mode, we just check if there are matches
        detectionPassed = matches !== null && matches.length > 0;
        break;
      
      case 'count':
        detectionPassed = matches !== null && matches.length === (config.expectedCount || 0);
        break;
    }
    
    // Copy response from source for condition evaluation
    result.response = sourceResult.response;
    
    console.log(`Detection result: ${detectionPassed ? 'passed' : 'failed'} (${matches?.length || 0} matches)`);
  } catch (error) {
    throw new Error(`Regex detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Execute an extract-data action
 */
async function executeExtractData(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<void> {
  const config = action.config as ExtractDataConfig;
  
  // Get the most recent action with a response
  let sourceResult: ActionExecutionResult | undefined;
  for (const [_, res] of context.actionResults) {
    if (res.response) {
      sourceResult = res;
    }
  }
  
  if (!sourceResult?.response) {
    throw new Error('No response available for extraction');
  }
  
  result.extractedData = {};
  
  // Extract data using configured extractors
  for (const extractor of config.extractors) {
    try {
      let extractedValue: any;
      
      switch (extractor.type) {
        case 'regex': {
          const regex = new RegExp(extractor.pattern);
          const matches = sourceResult.response.body.match(regex);
          extractedValue = matches ? matches[0] : null;
          break;
        }
        
        case 'json-path': {
          const data = JSON.parse(sourceResult.response.body);
          const path = extractor.pattern.split('.');
          let value = data;
          
          for (const key of path) {
            if (value && typeof value === 'object' && key in value) {
              value = value[key];
            } else {
              value = null;
              break;
            }
          }
          
          extractedValue = value;
          break;
        }
        
        case 'header': {
          extractedValue = sourceResult.response.headers[extractor.pattern];
          break;
        }
      }
      
      // Store in context variables
      if (extractedValue !== null && extractedValue !== undefined) {
        context.variables[extractor.variableName] = extractedValue;
        result.extractedData![extractor.name] = extractedValue;
      }
    } catch (error) {
      console.error(`Failed to extract ${extractor.name}:`, error);
    }
  }
  
  // Copy response for condition evaluation
  result.response = sourceResult.response;
}

/**
 * Execute a set-variable action
 */
async function executeSetVariable(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<void> {
  const config = action.config as SetVariableConfig;
  
  const value = substituteVariables(config.value, context.variables);
  context.variables[config.variableName] = value;
  
  result.extractedData = {
    [config.variableName]: value
  };
  
  // Create a dummy response for condition evaluation
  result.response = {
    status: 200,
    headers: {},
    body: '',
    time: 0
  };
  
  console.log(`Set variable ${config.variableName} = ${value}`);
}

/**
 * Execute a wait action
 */
async function executeWait(
  action: AutomationAction,
  result: ActionExecutionResult,
  context: ExecutionContext
): Promise<void> {
  const config = action.config as WaitConfig;
  
  console.log(`Waiting for ${config.duration}ms`);
  await new Promise(resolve => setTimeout(resolve, config.duration));
  
  // Create a dummy response for condition evaluation
  result.response = {
    status: 200,
    headers: {},
    body: '',
    time: config.duration
  };
}

/**
 * Substitute variables in a string
 * Supports {{variableName}} syntax
 */
function substituteVariables(text: string, variables: Record<string, any>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, variableName) => {
    const trimmedName = variableName.trim();
    const value = variables[trimmedName];
    return value !== undefined ? String(value) : match;
  });
}
