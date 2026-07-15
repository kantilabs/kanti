import { writable, derived, get } from 'svelte/store';
import type { Writable } from 'svelte/store';

// Condition types for pass/fail evaluation
export type ConditionType = 
  | 'status-code'
  | 'response-time'
  | 'body-contains'
  | 'body-not-contains'
  | 'header-exists'
  | 'header-value'
  | 'json-path'
  | 'body-regex'
  | 'body-not-regex';

export type ConditionOperator = 
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'not-contains'
  | 'greater-than'
  | 'less-than'
  | 'exists'
  | 'not-exists';

export interface Condition {
  id: string;
  type: ConditionType;
  operator: ConditionOperator;
  value: string | number;
  field?: string; // For header-value, json-path
}

// Action types
export type ActionType = 
  | 'send-request'
  | 'modify-resend'
  | 'wait'
  | 'extract-data'
  | 'set-variable'
  | 'detect'
  | 'end';

// Base action configuration
export interface BaseActionConfig {
  name: string;
  description?: string;
}

// Send Request action configuration
export interface SendRequestConfig extends BaseActionConfig {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
}

// Modify & Resend action configuration
export interface ModifyResendConfig extends BaseActionConfig {
  sourceActionId?: string; // ID of action to use as base request
  modifications: {
    id: string;
    type: 'header' | 'body' | 'path' | 'parameter';
    operation: 'set' | 'append' | 'remove' | 'replace';
    field: string;
    value?: string;
    pattern?: string; // For replace operation
  }[];
}

// Wait action configuration
export interface WaitConfig extends BaseActionConfig {
  duration: number; // milliseconds
}

// Extract data action configuration
export interface ExtractDataConfig extends BaseActionConfig {
  source: 'response-body' | 'response-headers' | 'status-code';
  extractors: {
    id: string;
    name: string;
    type: 'regex' | 'json-path' | 'header';
    pattern: string;
    variableName: string;
  }[];
}

// Set variable action configuration
export interface SetVariableConfig extends BaseActionConfig {
  variableName: string;
  value: string;
}

// Detect action configuration - analyzes response for regex pattern
export interface DetectConfig extends BaseActionConfig {
  pattern: string; // Regex pattern to search for
  flags: string; // Regex flags (g, i, m, etc.)
  extractToVariable?: string; // Optional: Store matched values in a variable
  matchMode: 'any' | 'all' | 'count'; // Match mode: any match passes, all must match, or count matches
  expectedCount?: number; // For 'count' mode: expected number of matches
}

export type ActionConfig = 
  | SendRequestConfig 
  | ModifyResendConfig 
  | WaitConfig 
  | ExtractDataConfig
  | SetVariableConfig
  | DetectConfig
  | BaseActionConfig;

// Branch definition - points to next action or ends workflow
export interface ActionBranch {
  conditions: Condition[];
  nextActionId: string | null; // null means END
}

// Automation action
export interface AutomationAction {
  id: string;
  type: ActionType;
  config: ActionConfig;
  passBranch: ActionBranch;
  failBranch: ActionBranch;
  position: { x: number; y: number };
  nextActionId?: string | null; // Deprecated, kept for backwards compatibility
}

// Execution result for an action
export interface ActionExecutionResult {
  actionId: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  startTime?: number;
  endTime?: number;
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
    time: number;
  };
  conditionResults?: {
    condition: Condition;
    passed: boolean;
    message?: string;
  }[];
  error?: string;
  extractedData?: Record<string, any>;
}

// Workflow execution
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  actionResults: ActionExecutionResult[];
  variables: Record<string, any>;
}

// Workflow definition
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  actions: AutomationAction[];
  variables: Record<string, any>;
  executionHistory: WorkflowExecution[];
  currentExecution?: WorkflowExecution;
  createdAt: number;
  updatedAt: number;
}

// Store for workflows
export const workflows: Writable<Workflow[]> = writable([]);

// Store for currently selected workflow
export const selectedWorkflowId = writable<string | null>(null);

// Derived store for the currently selected workflow
export const selectedWorkflow = derived(
  [workflows, selectedWorkflowId],
  ([$workflows, $selectedWorkflowId]) => {
    if (!$selectedWorkflowId) return null;
    return $workflows.find(w => w.id === $selectedWorkflowId) || null;
  }
);

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Create a new workflow
export function createWorkflow(name: string = 'New Workflow'): string {
  const workflow: Workflow = {
    id: generateId(),
    name,
    description: '',
    actions: [],
    variables: {},
    executionHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  workflows.update(wfs => [...wfs, workflow]);
  selectedWorkflowId.set(workflow.id);
  
  return workflow.id;
}

// Delete a workflow
export function deleteWorkflow(workflowId: string): void {
  workflows.update(wfs => wfs.filter(w => w.id !== workflowId));
  
  // If we deleted the selected workflow, clear selection
  if (get(selectedWorkflowId) === workflowId) {
    const remaining = get(workflows);
    selectedWorkflowId.set(remaining.length > 0 ? remaining[0].id : null);
  }
}

// Update workflow
export function updateWorkflow(workflowId: string, updates: Partial<Workflow>): void {
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    updatedWorkflows[index] = {
      ...updatedWorkflows[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
}

// Add action to workflow (with automatic decision tree creation)
export function addAction(
  workflowId: string, 
  type: ActionType,
  position: { x: number; y: number },
  skipAutoEndActions: boolean = false
): string {
  const actionId = generateId();
  
  // Create default config based on type
  let config: ActionConfig;
  
  switch (type) {
    case 'send-request':
      config = {
        name: 'Send Request',
        request: {
          method: 'GET',
          url: 'https://example.com',
          headers: {},
          body: ''
        }
      } as SendRequestConfig;
      break;
    
    case 'modify-resend':
      config = {
        name: 'Modify & Resend',
        modifications: []
      } as ModifyResendConfig;
      break;
    
    case 'wait':
      config = {
        name: 'Wait',
        duration: 1000
      } as WaitConfig;
      break;
    
    case 'extract-data':
      config = {
        name: 'Extract Data',
        source: 'response-body',
        extractors: []
      } as ExtractDataConfig;
      break;
    
    case 'set-variable':
      config = {
        name: 'Set Variable',
        variableName: 'variable1',
        value: ''
      } as SetVariableConfig;
      break;
    
    case 'detect':
      config = {
        name: 'Regex Detection',
        pattern: '.*',
        flags: 'g',
        matchMode: 'any'
      } as DetectConfig;
      break;
    
    case 'end':
      config = {
        name: 'End'
      } as BaseActionConfig;
      break;
  }
  
  // Create default conditions based on action type
  let defaultPassConditions: Omit<Condition, 'id'>[] = [];
  let defaultFailConditions: Omit<Condition, 'id'>[] = [];
  
  if (type === 'send-request' || type === 'modify-resend') {
    // Default pass condition: status code in 2xx range
    defaultPassConditions.push({
      type: 'status-code',
      operator: 'equals',
      value: '2xx'
    });
    
    // Default fail condition: status code in 4xx or 5xx range
    defaultFailConditions.push({
      type: 'status-code',
      operator: 'equals',
      value: '4xx'
    });
    defaultFailConditions.push({
      type: 'status-code',
      operator: 'equals',
      value: '5xx'
    });
  }
  
  const action: AutomationAction = {
    id: actionId,
    type,
    config,
    passBranch: {
      conditions: defaultPassConditions.map(c => ({ ...c, id: generateId() })),
      nextActionId: null
    },
    failBranch: {
      conditions: defaultFailConditions.map(c => ({ ...c, id: generateId() })),
      nextActionId: null
    },
    position
  };
  
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    const workflow = updatedWorkflows[index];
    
    // Add the main action
    const newActions = [...workflow.actions, action];
    
    // If this is not an end action and we should auto-create end actions,
    // create default end actions for pass and fail branches
    if (type !== 'end' && !skipAutoEndActions) {
      // Create pass end action (positioned to the right and up)
      const passEndId = generateId();
      const passEndAction: AutomationAction = {
        id: passEndId,
        type: 'end',
        config: { name: 'End (Pass)' },
        passBranch: { conditions: [], nextActionId: null },
        failBranch: { conditions: [], nextActionId: null },
        position: { x: position.x + 300, y: position.y - 100 }
      };
      newActions.push(passEndAction);
      action.passBranch.nextActionId = passEndId;
      
      // Create fail end action (positioned to the right and down)
      const failEndId = generateId();
      const failEndAction: AutomationAction = {
        id: failEndId,
        type: 'end',
        config: { name: 'End (Fail)' },
        passBranch: { conditions: [], nextActionId: null },
        failBranch: { conditions: [], nextActionId: null },
        position: { x: position.x + 300, y: position.y + 100 }
      };
      newActions.push(failEndAction);
      action.failBranch.nextActionId = failEndId;
    }
    
    updatedWorkflows[index] = {
      ...workflow,
      actions: newActions,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
  
  return actionId;
}

// Update action
export function updateAction(
  workflowId: string,
  actionId: string,
  updates: Partial<AutomationAction>
): void {
  workflows.update(wfs => {
    const workflowIndex = wfs.findIndex(w => w.id === workflowId);
    if (workflowIndex === -1) return wfs;
    
    const workflow = wfs[workflowIndex];
    const actionIndex = workflow.actions.findIndex(a => a.id === actionId);
    if (actionIndex === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    const updatedActions = [...workflow.actions];
    updatedActions[actionIndex] = {
      ...updatedActions[actionIndex],
      ...updates
    };
    
    updatedWorkflows[workflowIndex] = {
      ...workflow,
      actions: updatedActions,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
}

// Delete action
export function deleteAction(workflowId: string, actionId: string): void {
  workflows.update(wfs => {
    const workflowIndex = wfs.findIndex(w => w.id === workflowId);
    if (workflowIndex === -1) return wfs;
    
    const workflow = wfs[workflowIndex];
    const updatedWorkflows = [...wfs];
    
    updatedWorkflows[workflowIndex] = {
      ...workflow,
      actions: workflow.actions.filter(a => a.id !== actionId),
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
}

// Replace an end action with a new action (decision tree functionality)
export function replaceEndAction(
  workflowId: string,
  endActionId: string,
  newActionType: ActionType,
  position: { x: number; y: number }
): string | null {
  const wfs = get(workflows);
  const workflowIndex = wfs.findIndex(w => w.id === workflowId);
  if (workflowIndex === -1) return null;
  
  const workflow = wfs[workflowIndex];
  const endAction = workflow.actions.find(a => a.id === endActionId);
  
  // Only allow replacing end actions
  if (!endAction || endAction.type !== 'end') return null;
  
  // Create the new action using addAction (which will auto-create end actions)
  const newActionId = addAction(workflowId, newActionType, position, false);
  
  // Update all actions that point to the old end action to point to the new action
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    const workflow = updatedWorkflows[index];
    const updatedActions = workflow.actions.map(action => {
      const updates: Partial<AutomationAction> = {};
      
      // Check if pass branch points to the end action
      if (action.passBranch.nextActionId === endActionId) {
        updates.passBranch = {
          ...action.passBranch,
          nextActionId: newActionId
        };
      }
      
      // Check if fail branch points to the end action
      if (action.failBranch.nextActionId === endActionId) {
        updates.failBranch = {
          ...action.failBranch,
          nextActionId: newActionId
        };
      }
      
      return Object.keys(updates).length > 0 ? { ...action, ...updates } : action;
    });
    
    // Remove the old end action
    const finalActions = updatedActions.filter(a => a.id !== endActionId);
    
    updatedWorkflows[index] = {
      ...workflow,
      actions: finalActions,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
  
  return newActionId;
}

// Add condition to branch
export function addCondition(
  workflowId: string,
  actionId: string,
  branchType: 'pass' | 'fail',
  condition: Omit<Condition, 'id'>
): string {
  const conditionId = generateId();
  const fullCondition: Condition = {
    ...condition,
    id: conditionId
  };
  
  workflows.update(wfs => {
    const workflowIndex = wfs.findIndex(w => w.id === workflowId);
    if (workflowIndex === -1) return wfs;
    
    const workflow = wfs[workflowIndex];
    const actionIndex = workflow.actions.findIndex(a => a.id === actionId);
    if (actionIndex === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    const updatedActions = [...workflow.actions];
    const action = updatedActions[actionIndex];
    
    const branch = branchType === 'pass' ? action.passBranch : action.failBranch;
    const updatedBranch = {
      ...branch,
      conditions: [...branch.conditions, fullCondition]
    };
    
    updatedActions[actionIndex] = {
      ...action,
      ...(branchType === 'pass' 
        ? { passBranch: updatedBranch }
        : { failBranch: updatedBranch }
      )
    };
    
    updatedWorkflows[workflowIndex] = {
      ...workflow,
      actions: updatedActions,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
  
  return conditionId;
}

// Remove condition from branch
export function removeCondition(
  workflowId: string,
  actionId: string,
  branchType: 'pass' | 'fail',
  conditionId: string
): void {
  workflows.update(wfs => {
    const workflowIndex = wfs.findIndex(w => w.id === workflowId);
    if (workflowIndex === -1) return wfs;
    
    const workflow = wfs[workflowIndex];
    const actionIndex = workflow.actions.findIndex(a => a.id === actionId);
    if (actionIndex === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    const updatedActions = [...workflow.actions];
    const action = updatedActions[actionIndex];
    
    const branch = branchType === 'pass' ? action.passBranch : action.failBranch;
    const updatedBranch = {
      ...branch,
      conditions: branch.conditions.filter((c: Condition) => c.id !== conditionId)
    };
    
    updatedActions[actionIndex] = {
      ...action,
      ...(branchType === 'pass'
        ? { passBranch: updatedBranch }
        : { failBranch: updatedBranch }
      )
    };
    
    updatedWorkflows[workflowIndex] = {
      ...workflow,
      actions: updatedActions,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
}

// Update branch target (next action)
export function updateBranchTarget(
  workflowId: string,
  actionId: string,
  branchType: 'pass' | 'fail',
  nextActionId: string | null
): void {
  workflows.update(wfs => {
    const workflowIndex = wfs.findIndex(w => w.id === workflowId);
    if (workflowIndex === -1) return wfs;
    
    const workflow = wfs[workflowIndex];
    const actionIndex = workflow.actions.findIndex(a => a.id === actionId);
    if (actionIndex === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    const updatedActions = [...workflow.actions];
    const action = updatedActions[actionIndex];
    
    const branch = branchType === 'pass' ? action.passBranch : action.failBranch;
    const updatedBranch = {
      ...branch,
      nextActionId
    };
    
    updatedActions[actionIndex] = {
      ...action,
      ...(branchType === 'pass'
        ? { passBranch: updatedBranch }
        : { failBranch: updatedBranch }
      )
    };
    
    updatedWorkflows[workflowIndex] = {
      ...workflow,
      actions: updatedActions,
      updatedAt: Date.now()
    };
    
    return updatedWorkflows;
  });
}

// Start workflow execution
export function startWorkflowExecution(workflowId: string): string {
  const executionId = generateId();
  
  const execution: WorkflowExecution = {
    id: executionId,
    workflowId,
    startTime: Date.now(),
    status: 'running',
    actionResults: [],
    variables: {}
  };
  
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const updatedWorkflows = [...wfs];
    updatedWorkflows[index] = {
      ...updatedWorkflows[index],
      currentExecution: execution
    };
    
    return updatedWorkflows;
  });
  
  return executionId;
}

// Update execution status
export function updateExecutionStatus(
  workflowId: string,
  executionId: string,
  status: WorkflowExecution['status']
): void {
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const workflow = wfs[index];
    if (!workflow.currentExecution || workflow.currentExecution.id !== executionId) {
      return wfs;
    }
    
    const updatedWorkflows = [...wfs];
    const execution = {
      ...workflow.currentExecution,
      status,
      endTime: status !== 'running' ? Date.now() : undefined
    };
    
    updatedWorkflows[index] = {
      ...workflow,
      currentExecution: execution,
      executionHistory: status !== 'running' 
        ? [...workflow.executionHistory, execution]
        : workflow.executionHistory
    };
    
    return updatedWorkflows;
  });
}

// Add action result to execution
export function addActionResult(
  workflowId: string,
  executionId: string,
  result: ActionExecutionResult
): void {
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const workflow = wfs[index];
    if (!workflow.currentExecution || workflow.currentExecution.id !== executionId) {
      return wfs;
    }
    
    const updatedWorkflows = [...wfs];
    updatedWorkflows[index] = {
      ...workflow,
      currentExecution: {
        ...workflow.currentExecution,
        actionResults: [...workflow.currentExecution.actionResults, result]
      }
    };
    
    return updatedWorkflows;
  });
}

// Update existing action result in execution
export function updateActionResult(
  workflowId: string,
  executionId: string,
  result: ActionExecutionResult
): void {
  workflows.update(wfs => {
    const index = wfs.findIndex(w => w.id === workflowId);
    if (index === -1) return wfs;
    
    const workflow = wfs[index];
    if (!workflow.currentExecution || workflow.currentExecution.id !== executionId) {
      return wfs;
    }
    
    const updatedWorkflows = [...wfs];
    const resultIndex = workflow.currentExecution.actionResults.findIndex(
      r => r.actionId === result.actionId
    );
    
    // If result doesn't exist, add it; otherwise update it
    const updatedResults = resultIndex === -1
      ? [...workflow.currentExecution.actionResults, result]
      : workflow.currentExecution.actionResults.map((r, i) =>
          i === resultIndex ? result : r
        );
    
    updatedWorkflows[index] = {
      ...workflow,
      currentExecution: {
        ...workflow.currentExecution,
        actionResults: updatedResults
      }
    };
    
    return updatedWorkflows;
  });
}

// Clear all workflows
export function clearWorkflows(): void {
  workflows.set([]);
  selectedWorkflowId.set(null);
}

// Get all workflows
export function getAllWorkflows(): Workflow[] {
  return get(workflows);
}

// Save workflows to project
export function saveWorkflowsToProject(project: Project): void {
  const currentWorkflows = get(workflows);
  const currentSelectedId = get(selectedWorkflowId);
  
  if (!project.automation) {
    project.automation = {
      workflows: [],
      selectedWorkflowId: undefined
    };
  }
  
  project.automation.workflows = currentWorkflows;
  project.automation.selectedWorkflowId = currentSelectedId || undefined;
}

// Load workflows from project
export function loadWorkflowsFromProject(project: Project): void {
  if (!project.automation) {
    workflows.set([]);
    selectedWorkflowId.set(null);
    return;
  }
  
  workflows.set(project.automation.workflows || []);
  selectedWorkflowId.set(project.automation.selectedWorkflowId || null);
}
