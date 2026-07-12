<script lang="ts">
  import { onMount } from 'svelte';
  import {
    workflows,
    selectedWorkflow,
    selectedWorkflowId,
    createWorkflow,
    deleteWorkflow,
    updateWorkflow,
    addAction,
    updateAction,
    deleteAction,
    addCondition,
    removeCondition,
    updateBranchTarget,
    replaceEndAction,
    startWorkflowExecution,
    type ActionType,
    type AutomationAction,
    type Condition,
    type ConditionType,
    type SendRequestConfig,
    type ModifyResendConfig,
    type DetectConfig
  } from '$lib/stores/automation';

  // Constants
  const GRID_SIZE = 40;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2;
  const ZOOM_STEP = 0.4;

  // Drag state
  let isDragging = false;
  let draggedActionType: ActionType | null = null;
  let canvasElement: HTMLElement;
  
  // UI state
  let showNewWorkflowDialog = false;
  let newWorkflowName = 'New Workflow';
  let selectedActionId: string | null = null;
  let showActionEditor = false;
  let showAddConditionDialog = false;
  let conditionBranchType: 'pass' | 'fail' = 'pass';
  let selectedConditionType: ConditionType = 'status-code';
  let showWorkflowSidebar = true;
  let showOutputPanel = true;
  let outputPanelHeight = 250; // pixels
  
  // Canvas state
  let canvasScale = 1;
  let canvasOffsetX = 0;
  let canvasOffsetY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartOffsetX = 0;
  let panStartOffsetY = 0;

  // Action dragging state
  let isDraggingAction = false;
  let draggedAction: AutomationAction | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // End action hover state for replacement
  let hoveredEndActionId: string | null = null;

  // Action palette items
  // NOTE: 'modify-resend' is intentionally omitted from the palette (not yet
  // selectable) because its executor still throws 'to be implemented'. Its
  // node/editor code paths below are kept intact so any legacy workflows that
  // already contain a modify-resend action still render correctly.
  const actionPalette = [
    { type: 'send-request' as ActionType, label: 'Send Request', icon: '📤', color: '#4caf50' },
    { type: 'detect' as ActionType, label: 'Regex Detection', icon: '🔍', color: '#ff9800' },
    { type: 'end' as ActionType, label: 'End', icon: '⬛', color: '#f44336' },
  ];

  // Create initial workflow if none exists
  onMount(() => {
    if ($workflows.length === 0) {
      createWorkflow('Default Workflow');
    }
  });

  // Snap to grid
  function snapToGrid(value: number): number {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  // Handle drag start from palette
  function handlePaletteDragStart(event: DragEvent, actionType: ActionType) {
    isDragging = true;
    draggedActionType = actionType;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', actionType);
    }
  }

  // Handle drag over end action
  function handleEndActionDragOver(event: DragEvent, actionId: string) {
    if (draggedActionType && draggedActionType !== 'end') {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      hoveredEndActionId = actionId;
    }
  }

  // Handle drag leave end action
  function handleEndActionDragLeave(event: DragEvent, actionId: string) {
    if (hoveredEndActionId === actionId) {
      hoveredEndActionId = null;
    }
  }

  // Handle drop on end action
  function handleEndActionDrop(event: DragEvent, action: AutomationAction) {
    event.preventDefault();
    event.stopPropagation();
    hoveredEndActionId = null;

    if (!draggedActionType || draggedActionType === 'end' || !$selectedWorkflow) return;
    if (action.type !== 'end') return;

    // Replace the end action with the new action
    replaceEndAction($selectedWorkflow.id, action.id, draggedActionType, action.position);
    draggedActionType = null;
    isDragging = false;
  }

  // Handle drag over canvas
  function handleCanvasDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  // Handle drop on canvas
  function handleCanvasDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;

    if (!draggedActionType || !$selectedWorkflow) return;

    const rect = canvasElement.getBoundingClientRect();
    const x = snapToGrid((event.clientX - rect.left - canvasOffsetX) / canvasScale);
    const y = snapToGrid((event.clientY - rect.top - canvasOffsetY) / canvasScale);

    addAction($selectedWorkflow.id, draggedActionType, { x, y });
    draggedActionType = null;
  }

  // Handle canvas mouse down for panning
  function handleCanvasMouseDown(event: MouseEvent) {
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) { // Middle mouse or shift+left
      event.preventDefault();
      isPanning = true;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartOffsetX = canvasOffsetX;
      panStartOffsetY = canvasOffsetY;
      canvasElement.style.cursor = 'grabbing';
    }
  }

  // Handle canvas mouse move for panning
  function handleCanvasMouseMove(event: MouseEvent) {
    if (isPanning) {
      canvasOffsetX = panStartOffsetX + (event.clientX - panStartX);
      canvasOffsetY = panStartOffsetY + (event.clientY - panStartY);
    } else if (isDraggingAction && draggedAction && $selectedWorkflow) {
      const rect = canvasElement.getBoundingClientRect();
      const x = snapToGrid((event.clientX - rect.left - canvasOffsetX) / canvasScale - dragOffsetX);
      const y = snapToGrid((event.clientY - rect.top - canvasOffsetY) / canvasScale - dragOffsetY);
      
      updateAction($selectedWorkflow.id, draggedAction.id, {
        position: { x, y }
      });
    }
  }

  // Handle canvas mouse up
  function handleCanvasMouseUp() {
    if (isPanning) {
      isPanning = false;
      canvasElement.style.cursor = '';
    }
    if (isDraggingAction) {
      isDraggingAction = false;
      draggedAction = null;
    }
  }

  // Handle canvas wheel for zooming
  function handleCanvasWheel(event: WheelEvent) {
    event.preventDefault();
    
    const delta = -event.deltaY * 0.001;
    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvasScale + delta * ZOOM_STEP));
    
    if (newScale !== canvasScale) {
      const rect = canvasElement.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      
      // Adjust offset to zoom towards mouse position
      const scaleRatio = newScale / canvasScale;
      canvasOffsetX = mouseX - (mouseX - canvasOffsetX) * scaleRatio;
      canvasOffsetY = mouseY - (mouseY - canvasOffsetY) * scaleRatio;
      
      canvasScale = newScale;
    }
  }

  // Handle action mouse down for dragging
  function handleActionMouseDown(event: MouseEvent, action: AutomationAction) {
    if (event.button === 0 && !event.shiftKey) {
      event.stopPropagation();
      isDraggingAction = true;
      draggedAction = action;
      
      const rect = canvasElement.getBoundingClientRect();
      const mouseX = (event.clientX - rect.left - canvasOffsetX) / canvasScale;
      const mouseY = (event.clientY - rect.top - canvasOffsetY) / canvasScale;
      
      dragOffsetX = mouseX - action.position.x;
      dragOffsetY = mouseY - action.position.y;
    }
  }

  // Handle action selection
  function selectAction(actionId: string, event: MouseEvent) {
    event.stopPropagation();
    if (!isDraggingAction) {
      selectedActionId = actionId;
      showActionEditor = true;
    }
  }

  // Handle workflow creation
  function handleCreateWorkflow() {
    if (newWorkflowName.trim()) {
      createWorkflow(newWorkflowName.trim());
      newWorkflowName = 'New Workflow';
      showNewWorkflowDialog = false;
    }
  }

  // Handle workflow deletion
  function handleDeleteWorkflow(workflowId: string) {
    if (confirm('Are you sure you want to delete this workflow?')) {
      deleteWorkflow(workflowId);
    }
  }

  // Handle workflow execution
  async function executeWorkflow() {
    if (!$selectedWorkflow) return;
    
    const executionId = startWorkflowExecution($selectedWorkflow.id);
    
    // Import workflow executor
    const { executeWorkflow: runWorkflow } = await import('$lib/automation/workflow-executor');
    
    try {
      // Execute the workflow with progress tracking
      await runWorkflow($selectedWorkflow, executionId, (action, result) => {
        console.log(`Action "${action.config.name}" status: ${result.status}`);
        
        // Visual feedback: highlight the action being executed
        if (result.status === 'running') {
          selectedActionId = action.id;
        }
      });
      
      alert('Workflow execution completed successfully!');
    } catch (error) {
      console.error('Workflow execution error:', error);
      alert(`Workflow execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Handle add condition
  function handleAddCondition(type: 'pass' | 'fail') {
    conditionBranchType = type;
    showAddConditionDialog = true;
  }

  // Handle condition addition
  function addNewCondition() {
    if (!$selectedWorkflow || !selectedActionId) return;
    
    // Create appropriate default condition based on type
    let condition: any;
    
    switch (selectedConditionType) {
      case 'status-code':
        condition = {
          type: 'status-code',
          operator: 'equals',
          value: 200
        };
        break;
      case 'response-time':
        condition = {
          type: 'response-time',
          operator: 'less-than',
          value: 1000
        };
        break;
      case 'body-contains':
        condition = {
          type: 'body-contains',
          operator: 'contains',
          value: 'example'
        };
        break;
      case 'body-not-contains':
        condition = {
          type: 'body-not-contains',
          operator: 'not-contains',
          value: 'error'
        };
        break;
      case 'header-exists':
        condition = {
          type: 'header-exists',
          operator: 'exists',
          value: 'Content-Type'
        };
        break;
      case 'header-value':
        condition = {
          type: 'header-value',
          operator: 'equals',
          value: 'application/json',
          field: 'Content-Type'
        };
        break;
      case 'json-path':
        condition = {
          type: 'json-path',
          operator: 'equals',
          value: 'expected_value',
          field: 'data.key'
        };
        break;
      case 'body-regex':
        condition = {
          type: 'body-regex',
          operator: 'contains', // Note: regex conditions use 'contains' operator for consistency
          value: 'pattern.*here'
        };
        break;
      case 'body-not-regex':
        condition = {
          type: 'body-not-regex',
          operator: 'contains', // Note: regex conditions use 'contains' operator for consistency
          value: 'error.*pattern'
        };
        break;
      default:
        condition = {
          type: 'status-code',
          operator: 'equals',
          value: 200
        };
    }
    
    addCondition($selectedWorkflow.id, selectedActionId, conditionBranchType, condition);
    showAddConditionDialog = false;
  }

  // Get action coordinates for branch drawing
  function getActionCenter(action: AutomationAction): { x: number; y: number } {
    return {
      x: action.position.x + 100, // Half of action node width (200px / 2)
      y: action.position.y + 60   // Approximate center height
    };
  }

  // Draw branches with SVG - improved responsive logic
  function drawBranches():{ d: string; color: string; fromId: string; toId: string; type: string; labelX: number; labelY: number }[] {
    if (!$selectedWorkflow) return [];
    
    const branches: { d: string; color: string; fromId: string; toId: string; type: string; labelX: number; labelY: number }[] = [];
    const cardWidth = 200;
    const cardHeight = 120; // Approximate card height
    
    $selectedWorkflow.actions.forEach(action => {
      const from = getActionCenter(action);
      
      // Draw pass branch (green, upper path)
      if (action.passBranch.nextActionId) {
        const targetAction = $selectedWorkflow!.actions.find(a => a.id === action.passBranch.nextActionId);
        if (targetAction) {
          const to = getActionCenter(targetAction);
          
          // Calculate direction and distance
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Determine exit and entry points based on relative positions
          let startX: number, startY: number, endX: number, endY: number;
          let controlPoint1X: number, controlPoint1Y: number;
          let controlPoint2X: number, controlPoint2Y: number;
          
          // Exit from right side, offset upward for pass branch
          startX = from.x + cardWidth / 2;
          startY = from.y - 15;
          
          // Entry point depends on where target is relative to source
          if (dx > cardWidth) {
            // Target is significantly to the right - enter from left
            endX = to.x - cardWidth / 2;
            endY = to.y;
          } else if (dx < -cardWidth) {
            // Target is significantly to the left - enter from right
            endX = to.x + cardWidth / 2;
            endY = to.y;
          } else if (dy > cardHeight) {
            // Target is below - enter from top
            endX = to.x;
            endY = to.y - cardHeight / 2;
          } else if (dy < -cardHeight) {
            // Target is above - enter from bottom
            endX = to.x;
            endY = to.y + cardHeight / 2;
          } else {
            // Default: enter from left
            endX = to.x - cardWidth / 2;
            endY = to.y;
          }
          
          // Calculate control points for smooth curves
          const curveFactor = Math.min(Math.abs(dx) * 0.5, 100);
          
          if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal-dominant path
            controlPoint1X = startX + curveFactor;
            controlPoint1Y = startY;
            controlPoint2X = endX - curveFactor;
            controlPoint2Y = endY;
          } else {
            // Vertical-dominant path
            controlPoint1X = startX;
            controlPoint1Y = startY + (endY - startY) * 0.3;
            controlPoint2X = endX;
            controlPoint2Y = endY - (endY - startY) * 0.3;
          }
          
          // Calculate label position at curve midpoint
          const t = 0.5;
          const labelX = Math.pow(1-t, 3) * startX + 
                        3 * Math.pow(1-t, 2) * t * controlPoint1X + 
                        3 * (1-t) * Math.pow(t, 2) * controlPoint2X + 
                        Math.pow(t, 3) * endX;
          const labelY = Math.pow(1-t, 3) * startY + 
                        3 * Math.pow(1-t, 2) * t * controlPoint1Y + 
                        3 * (1-t) * Math.pow(t, 2) * controlPoint2Y + 
                        Math.pow(t, 3) * endY;
          
          const path = `M ${startX} ${startY} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${endX} ${endY}`;
          branches.push({ d: path, color: '#4caf50', fromId: action.id, toId: targetAction.id, type: 'pass', labelX, labelY });
        }
      }
      
      // Draw fail branch (red, lower path)
      if (action.failBranch.nextActionId) {
        const targetAction = $selectedWorkflow!.actions.find(a => a.id === action.failBranch.nextActionId);
        if (targetAction) {
          const to = getActionCenter(targetAction);
          
          // Calculate direction and distance
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          
          // Determine exit and entry points
          let startX: number, startY: number, endX: number, endY: number;
          let controlPoint1X: number, controlPoint1Y: number;
          let controlPoint2X: number, controlPoint2Y: number;
          
          // Exit from right side, offset downward for fail branch
          startX = from.x + cardWidth / 2;
          startY = from.y + 15;
          
          // Entry point depends on where target is relative to source
          if (dx > cardWidth) {
            // Target is significantly to the right - enter from left
            endX = to.x - cardWidth / 2;
            endY = to.y;
          } else if (dx < -cardWidth) {
            // Target is significantly to the left - enter from right
            endX = to.x + cardWidth / 2;
            endY = to.y;
          } else if (dy > cardHeight) {
            // Target is below - enter from top
            endX = to.x;
            endY = to.y - cardHeight / 2;
          } else if (dy < -cardHeight) {
            // Target is above - enter from bottom
            endX = to.x;
            endY = to.y + cardHeight / 2;
          } else {
            // Default: enter from left
            endX = to.x - cardWidth / 2;
            endY = to.y;
          }
          
          // Calculate control points for smooth curves
          const curveFactor = Math.min(Math.abs(dx) * 0.5, 100);
          
          if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal-dominant path
            controlPoint1X = startX + curveFactor;
            controlPoint1Y = startY;
            controlPoint2X = endX - curveFactor;
            controlPoint2Y = endY;
          } else {
            // Vertical-dominant path
            controlPoint1X = startX;
            controlPoint1Y = startY + (endY - startY) * 0.3;
            controlPoint2X = endX;
            controlPoint2Y = endY - (endY - startY) * 0.3;
          }
          
          // Calculate label position at curve midpoint
          const t = 0.5;
          const labelX = Math.pow(1-t, 3) * startX + 
                        3 * Math.pow(1-t, 2) * t * controlPoint1X + 
                        3 * (1-t) * Math.pow(t, 2) * controlPoint2X + 
                        Math.pow(t, 3) * endX;
          const labelY = Math.pow(1-t, 3) * startY + 
                        3 * Math.pow(1-t, 2) * t * controlPoint1Y + 
                        3 * (1-t) * Math.pow(t, 2) * controlPoint2Y + 
                        Math.pow(t, 3) * endY;
          
          const path = `M ${startX} ${startY} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${endX} ${endY}`;
          branches.push({ d: path, color: '#f44336', fromId: action.id, toId: targetAction.id, type: 'fail', labelX, labelY });
        }
      }
    });
    
    return branches;
  }

  // Get selected action
  $: selectedAction = $selectedWorkflow?.actions.find(a => a.id === selectedActionId);
  $: branches = $selectedWorkflow ? drawBranches() : [];
  
  // Get execution results
  $: executionResults = $selectedWorkflow?.currentExecution?.actionResults || [];
  $: executionStatus = $selectedWorkflow?.currentExecution?.status;
  
  // Format duration
  function formatDuration(startTime?: number, endTime?: number): string {
    if (!startTime || !endTime) return 'N/A';
    const duration = endTime - startTime;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(2)}s`;
  }
  
  // Get action name by ID
  function getActionName(actionId: string): string {
    const action = $selectedWorkflow?.actions.find(a => a.id === actionId);
    return action?.config.name || 'Unknown Action';
  }
  
  // Get status color
  function getStatusColor(status: string): string {
    switch (status) {
      case 'passed': return '#4caf50';
      case 'failed': return '#f44336';
      case 'running': return '#2196f3';
      case 'pending': return '#9e9e9e';
      case 'skipped': return '#ff9800';
      default: return '#9e9e9e';
    }
  }
  
  // Get status icon
  function getStatusIcon(status: string): string {
    switch (status) {
      case 'passed': return '✓';
      case 'failed': return '✗';
      case 'running': return '⟳';
      case 'pending': return '○';
      case 'skipped': return '↷';
      default: return '○';
    }
  }
</script>

<svelte:window on:mousemove={handleCanvasMouseMove} on:mouseup={handleCanvasMouseUp} />

<div class="automation-container">
  <!-- Left Sidebar - Workflows List -->
  <div class="workflows-sidebar" class:hidden={!showWorkflowSidebar}>
    <div class="sidebar-header">
      <h3>Workflows</h3>
      <button class="icon-btn" on:click={() => showNewWorkflowDialog = true} title="New Workflow">
        +
      </button>
    </div>
    
    <div class="workflows-list">
      {#each $workflows as workflow}
        <div 
          class="workflow-item"
          class:active={$selectedWorkflowId === workflow.id}
          on:click={() => selectedWorkflowId.set(workflow.id)}
        >
          <div class="workflow-info">
            <div class="workflow-name">{workflow.name}</div>
            <div class="workflow-meta">
              {workflow.actions.length} action{workflow.actions.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button 
            class="delete-btn"
            on:click|stopPropagation={() => handleDeleteWorkflow(workflow.id)}
            title="Delete workflow"
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  </div>

  <!-- Middle - Canvas Area -->
  <div class="canvas-area">
    <div class="canvas-header">
      <div class="workflow-title">
        {#if $selectedWorkflow}
          <input
            type="text"
            class="workflow-name-input"
            bind:value={$selectedWorkflow.name}
            on:blur={() => $selectedWorkflow && updateWorkflow($selectedWorkflow.id, { name: $selectedWorkflow.name })}
          />
        {:else}
          <span>No workflow selected</span>
        {/if}
      </div>
      
      <div class="canvas-controls">
        <button 
          class="icon-btn toggle-sidebar-btn" 
          on:click={() => showWorkflowSidebar = !showWorkflowSidebar}
          title="{showWorkflowSidebar ? 'Hide' : 'Show'} workflow list"
        >
          {showWorkflowSidebar ? '◀' : '▶'}
        </button>
        <span class="zoom-indicator">{Math.round(canvasScale * 100)}%</span>
        <button class="action-btn" on:click={executeWorkflow} disabled={!$selectedWorkflow || $selectedWorkflow.actions.length === 0}>
          ▶ Run Workflow
        </button>
      </div>
    </div>

    <div 
      class="workflow-canvas"
      class:drag-over={isDragging}
      class:with-output-panel={showOutputPanel}
      style:height={showOutputPanel ? `calc(100% - ${outputPanelHeight}px)` : '100%'}
      bind:this={canvasElement}
      on:dragover={handleCanvasDragOver}
      on:drop={handleCanvasDrop}
      on:mousedown={handleCanvasMouseDown}
      on:wheel={handleCanvasWheel}
    >
      <div 
        class="canvas-content"
        style="transform: translate({canvasOffsetX}px, {canvasOffsetY}px) scale({canvasScale});"
      >
        <!-- SVG for drawing branches -->
        <svg class="branches-svg">
          {#each branches as branch}
            <!-- Connection line -->
            <path
              d={branch.d}
              stroke={branch.color}
              stroke-width="3"
              fill="none"
              marker-end="url(#arrow-{branch.type})"
              class="branch-path"
            />
            <!-- Label on the line -->
            <text
              x={branch.labelX}
              y={branch.labelY}
              class="branch-label"
              fill={branch.color}
              text-anchor="middle"
              dominant-baseline="middle"
            >
              {branch.type === 'pass' ? 'PASS' : 'FAIL'}
            </text>
          {/each}
          
          <!-- Arrow markers -->
          <defs>
            <marker
              id="arrow-pass"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="12"
              markerHeight="12"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4caf50" />
            </marker>
            <marker
              id="arrow-fail"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="12"
              markerHeight="12"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#f44336" />
            </marker>
          </defs>
        </svg>

          {#if $selectedWorkflow}
          {#each $selectedWorkflow.actions as action (action.id)}
            <div
              class="action-node"
              class:selected={selectedActionId === action.id}
              class:end-action={action.type === 'end'}
              class:replaceable-end={action.type === 'end' && hoveredEndActionId === action.id}
              style="left: {action.position.x}px; top: {action.position.y}px;"
              on:click={(e) => selectAction(action.id, e)}
              on:mousedown={(e) => handleActionMouseDown(e, action)}
              on:dragover={(e) => action.type === 'end' && handleEndActionDragOver(e, action.id)}
              on:dragleave={(e) => action.type === 'end' && handleEndActionDragLeave(e, action.id)}
              on:drop={(e) => action.type === 'end' && handleEndActionDrop(e, action)}
            >
              <div class="action-header">
                <span class="action-icon">
                  {#if action.type === 'send-request'}📤
                  {:else if action.type === 'modify-resend'}🔄
                  {:else if action.type === 'detect'}🔍
                  {:else if action.type === 'end'}⬛
                  {/if}
                </span>
                <span class="action-title">{action.config.name}</span>
                <button
                  class="delete-action-btn"
                  on:click|stopPropagation={() => $selectedWorkflow && deleteAction($selectedWorkflow.id, action.id)}
                  title="Delete action"
                >
                  ×
                </button>
              </div>
              
              {#if action.type !== 'end'}
                <div class="action-body">
                  {#if action.type === 'send-request'}
                    {@const config = action.config as SendRequestConfig}
                    <div class="action-detail">{config.request.method} {config.request.url}</div>
                  {:else if action.type === 'modify-resend'}
                    {@const config = action.config as ModifyResendConfig}
                    <div class="action-detail">{config.modifications.length} modification{config.modifications.length !== 1 ? 's' : ''}</div>
                  {:else if action.type === 'detect'}
                    {@const config = action.config as DetectConfig}
                    <div class="action-detail">/{config.pattern}/{config.flags}</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
          
          {#if $selectedWorkflow.actions.length === 0}
            <div class="empty-canvas">
              <p>Drag actions from the palette to build your workflow</p>
              <p class="help-hint">💡 Use scroll wheel to zoom, Shift+drag or middle-click to pan</p>
            </div>
          {/if}
        {:else}
          <div class="empty-canvas">
            <p>Create or select a workflow to get started</p>
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Output Panel -->
    {#if showOutputPanel}
      <div class="output-panel" style:height="{outputPanelHeight}px">
        <div class="output-header">
          <div class="output-title">
            <span class="output-icon">📊</span>
            <h3>Execution Output</h3>
            {#if executionStatus}
              <span class="execution-status" style:color={executionStatus === 'completed' ? '#4caf50' : executionStatus === 'failed' ? '#f44336' : executionStatus === 'running' ? '#2196f3' : '#9e9e9e'}>
                {executionStatus === 'running' ? '⟳ Running' : executionStatus === 'completed' ? '✓ Completed' : executionStatus === 'failed' ? '✗ Failed' : '○ Stopped'}
              </span>
            {/if}
          </div>
          <button class="icon-btn" on:click={() => showOutputPanel = false} title="Hide output panel">
            ▼
          </button>
        </div>
        
        <div class="output-content">
          {#if executionResults.length === 0}
            <div class="output-empty">
              <p>No execution results yet</p>
              <p class="help-text">Run a workflow to see execution output here</p>
            </div>
          {:else}
            <div class="execution-results">
              {#each executionResults as result}
                {@const action = $selectedWorkflow?.actions.find(a => a.id === result.actionId)}
                <div class="result-item" class:expanded={selectedActionId === result.actionId}>
                  <div class="result-header" on:click={() => selectedActionId = selectedActionId === result.actionId ? null : result.actionId}>
                    <div class="result-status-icon" style:color={getStatusColor(result.status)}>
                      {getStatusIcon(result.status)}
                    </div>
                    <div class="result-info">
                      <div class="result-action-name">{getActionName(result.actionId)}</div>
                      <div class="result-meta">
                        <span class="result-status" style:color={getStatusColor(result.status)}>
                          {result.status.toUpperCase()}
                        </span>
                        {#if result.startTime && result.endTime}
                          <span class="result-duration">
                            {formatDuration(result.startTime, result.endTime)}
                          </span>
                        {/if}
                        {#if result.response}
                          <span class="result-http-status" style:color={result.response.status >= 200 && result.response.status < 300 ? '#4caf50' : result.response.status >= 400 ? '#f44336' : '#ff9800'}>
                            HTTP {result.response.status}
                          </span>
                        {/if}
                      </div>
                    </div>
                    <div class="result-toggle">
                      {selectedActionId === result.actionId ? '▲' : '▼'}
                    </div>
                  </div>
                  
                  {#if selectedActionId === result.actionId}
                    <div class="result-details">
                      {#if result.error}
                        <div class="detail-section error-section">
                          <h4>Error</h4>
                          <pre class="error-text">{result.error}</pre>
                        </div>
                      {/if}
                      
                      {#if result.response}
                        <div class="detail-section">
                          <h4>Response</h4>
                          <div class="response-info">
                            <div class="info-row">
                              <span class="info-label">Status:</span>
                              <span class="info-value" style:color={result.response.status >= 200 && result.response.status < 300 ? '#4caf50' : result.response.status >= 400 ? '#f44336' : '#ff9800'}>
                                {result.response.status}
                              </span>
                            </div>
                            <div class="info-row">
                              <span class="info-label">Time:</span>
                              <span class="info-value">{result.response.time}ms</span>
                            </div>
                          </div>
                          
                          {#if Object.keys(result.response.headers).length > 0}
                            <div class="headers-section">
                              <h5>Headers</h5>
                              <div class="headers-list">
                                {#each Object.entries(result.response.headers).slice(0, 5) as [key, value]}
                                  <div class="header-item">
                                    <span class="header-key">{key}:</span>
                                    <span class="header-value">{value}</span>
                                  </div>
                                {/each}
                                {#if Object.keys(result.response.headers).length > 5}
                                  <div class="header-item muted">
                                    ... and {Object.keys(result.response.headers).length - 5} more
                                  </div>
                                {/if}
                              </div>
                            </div>
                          {/if}
                          
                          {#if result.response.body}
                            <div class="body-section">
                              <h5>Body <span class="body-length">({result.response.body.length} chars)</span></h5>
                              <pre class="response-body">{result.response.body.length > 500 ? result.response.body.substring(0, 500) + '...' : result.response.body}</pre>
                            </div>
                          {/if}
                        </div>
                      {/if}
                      
                      {#if result.extractedData && Object.keys(result.extractedData).length > 0}
                        <div class="detail-section">
                          <h4>Extracted Data</h4>
                          <div class="extracted-data">
                            {#each Object.entries(result.extractedData) as [key, value]}
                              <div class="data-item">
                                <span class="data-key">{key}:</span>
                                <span class="data-value">{JSON.stringify(value)}</span>
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/if}
                      
                      {#if result.conditionResults && result.conditionResults.length > 0}
                        <div class="detail-section">
                          <h4>Conditions Evaluated</h4>
                          <div class="conditions-results">
                            {#each result.conditionResults as condResult}
                              <div class="condition-result" class:passed={condResult.passed}>
                                <span class="condition-icon" style:color={condResult.passed ? '#4caf50' : '#f44336'}>
                                  {condResult.passed ? '✓' : '✗'}
                                </span>
                                <span class="condition-text">
                                  {condResult.condition.type} {condResult.condition.operator} {condResult.condition.value}
                                </span>
                                {#if condResult.message}
                                  <span class="condition-message">{condResult.message}</span>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="output-collapsed" on:click={() => showOutputPanel = true}>
        <span class="collapsed-icon">▲</span>
        <span>Show Execution Output</span>
        {#if executionResults.length > 0}
          <span class="result-count">{executionResults.length} result{executionResults.length !== 1 ? 's' : ''}</span>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Right Sidebar - Action Palette & Editor -->
  <div class="right-sidebar">
    {#if showActionEditor && selectedAction}
      <!-- Action Editor -->
      <div class="action-editor">
        <div class="editor-header">
          <h3>Edit Action</h3>
          <button class="close-btn" on:click={() => { showActionEditor = false; selectedActionId = null; }}>×</button>
        </div>
        
        <div class="editor-content">
          {#if selectedAction.type !== 'end'}
            <div class="form-group">
              <label>Action Name</label>
              <input
                type="text"
                class="form-input"
                bind:value={selectedAction.config.name}
                on:blur={() => $selectedWorkflow && selectedAction && updateAction($selectedWorkflow.id, selectedAction.id, { config: selectedAction.config })}
              />
            </div>

            {#if selectedAction.type === 'send-request'}
              {@const config = selectedAction.config as SendRequestConfig}
              <div class="form-group">
                <label>Method</label>
                <select class="form-input" bind:value={config.request.method}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              
              <div class="form-group">
                <label>URL</label>
                <input
                  type="text"
                  class="form-input"
                  bind:value={config.request.url}
                  placeholder="https://example.com/api"
                />
              </div>
              
              <div class="form-group">
                <label>Body</label>
                <textarea
                  class="form-textarea"
                  bind:value={config.request.body}
                  placeholder="Request body (JSON, etc.)"
                  rows="4"
                />
              </div>
            {:else if selectedAction.type === 'modify-resend'}
              {@const config = selectedAction.config as ModifyResendConfig}
              <div class="form-group">
                <label>Modifications</label>
                <p class="help-text">Configure request modifications</p>
                {#if config.modifications.length === 0}
                  <p class="empty-message">No modifications yet</p>
                {:else}
                  {#each config.modifications as mod}
                    <div class="modification-item">
                      <span>{mod.operation} {mod.type}: {mod.field}</span>
                    </div>
                  {/each}
                {/if}
              </div>
            {:else if selectedAction.type === 'detect'}
              {@const config = selectedAction.config as DetectConfig}
              <div class="form-group">
                <label>Regex Pattern</label>
                <input
                  type="text"
                  class="form-input"
                  bind:value={config.pattern}
                  placeholder="Enter regex pattern (e.g., error|fail)"
                />
                <p class="help-text">Pattern will be tested against the response body from the previous request</p>
              </div>
              
              <div class="form-group">
                <label>Flags</label>
                <input
                  type="text"
                  class="form-input"
                  bind:value={config.flags}
                  placeholder="g, i, m, s, u, y"
                  maxlength="10"
                />
                <p class="help-text">Regex flags: g (global), i (case-insensitive), m (multiline), s (dotAll), u (unicode), y (sticky)</p>
              </div>
              
              <div class="form-group">
                <label>Match Mode</label>
                <select class="form-input" bind:value={config.matchMode}>
                  <option value="any">Any Match (Pass if pattern found)</option>
                  <option value="all">All Match (All occurrences must match)</option>
                  <option value="count">Count Match (Specific number of matches)</option>
                </select>
                <p class="help-text">Determines when the action passes to the PASS branch</p>
              </div>
              
              {#if config.matchMode === 'count'}
                <div class="form-group">
                  <label>Expected Count</label>
                  <input
                    type="number"
                    class="form-input"
                    bind:value={config.expectedCount}
                    min="0"
                    placeholder="Number of expected matches"
                  />
                  <p class="help-text">Action passes if number of matches equals this value</p>
                </div>
              {/if}
              
              <div class="form-group">
                <label>Extract to Variable (Optional)</label>
                <input
                  type="text"
                  class="form-input"
                  bind:value={config.extractToVariable}
                  placeholder="variable_name"
                />
                <p class="help-text">Store matched values in a variable for later use</p>
              </div>
            {/if}

            <!-- Branches Section -->
            <div class="conditions-section">
              <h4>Pass Branch</h4>
              <div class="branch-target">
                <label>Next Action:</label>
                <select 
                  class="form-input"
                  value={selectedAction.passBranch.nextActionId || ''}
                  on:change={(e) => $selectedWorkflow && selectedAction && updateBranchTarget($selectedWorkflow.id, selectedAction.id, 'pass', e.currentTarget.value || null)}
                >
                  <option value="">END (Stop workflow)</option>
                  {#if $selectedWorkflow}
                    {#each $selectedWorkflow.actions.filter(a => a.id !== selectedAction.id) as action}
                      <option value={action.id}>{action.config.name}</option>
                    {/each}
                  {/if}
                </select>
              </div>
              <div class="conditions-list">
                <label>Conditions (all must pass):</label>
                {#if selectedAction.passBranch.conditions.length === 0}
                  <p class="empty-message">No conditions (always passes)</p>
                {:else}
                  {#each selectedAction.passBranch.conditions as condition}
                    <div class="condition-item">
                      <span>{condition.type} {condition.operator} {condition.value}</span>
                      <button 
                        class="remove-btn"
                        on:click={() => $selectedWorkflow && selectedAction && removeCondition($selectedWorkflow.id, selectedAction.id, 'pass', condition.id)}
                      >
                        ×
                      </button>
                    </div>
                  {/each}
                {/if}
                <button class="add-condition-btn" on:click={() => handleAddCondition('pass')}>
                  + Add Pass Condition
                </button>
              </div>

              <h4>Fail Branch</h4>
              <div class="branch-target">
                <label>Next Action:</label>
                <select 
                  class="form-input"
                  value={selectedAction.failBranch.nextActionId || ''}
                  on:change={(e) => $selectedWorkflow && selectedAction && updateBranchTarget($selectedWorkflow.id, selectedAction.id, 'fail', e.currentTarget.value || null)}
                >
                  <option value="">END (Stop workflow)</option>
                  {#if $selectedWorkflow}
                    {#each $selectedWorkflow.actions.filter(a => a.id !== selectedAction.id) as action}
                      <option value={action.id}>{action.config.name}</option>
                    {/each}
                  {/if}
                </select>
              </div>
              <div class="conditions-list">
                <label>Conditions (any triggers fail):</label>
                {#if selectedAction.failBranch.conditions.length === 0}
                  <p class="empty-message">No conditions (goes to fail if pass conditions fail)</p>
                {:else}
                  {#each selectedAction.failBranch.conditions as condition}
                    <div class="condition-item">
                      <span>{condition.type} {condition.operator} {condition.value}</span>
                      <button 
                        class="remove-btn"
                        on:click={() => $selectedWorkflow && selectedAction && removeCondition($selectedWorkflow.id, selectedAction.id, 'fail', condition.id)}
                      >
                        ×
                      </button>
                    </div>
                  {/each}
                {/if}
                <button class="add-condition-btn" on:click={() => handleAddCondition('fail')}>
                  + Add Fail Condition
                </button>
              </div>
            </div>
          {:else}
            <p class="help-text">End action - marks the end of the workflow</p>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Action Palette -->
      <div class="action-palette">
        <div class="palette-header">
          <h3>Actions</h3>
        </div>
        <div class="palette-content">
          {#each actionPalette as item}
            <div
              class="palette-item"
              draggable="true"
              on:dragstart={(e) => handlePaletteDragStart(e, item.type)}
              style="border-left-color: {item.color};"
            >
              <span class="palette-icon">{item.icon}</span>
              <span class="palette-label">{item.label}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- New Workflow Dialog -->
{#if showNewWorkflowDialog}
  <div class="modal-overlay" on:click={() => showNewWorkflowDialog = false}>
    <div class="modal-dialog" on:click|stopPropagation>
      <h3>Create New Workflow</h3>
      <input
        type="text"
        class="form-input"
        bind:value={newWorkflowName}
        placeholder="Workflow name"
        on:keydown={(e) => e.key === 'Enter' && handleCreateWorkflow()}
      />
      <div class="modal-actions">
        <button class="btn-secondary" on:click={() => showNewWorkflowDialog = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateWorkflow}>Create</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add Condition Dialog -->
{#if showAddConditionDialog}
  <div class="modal-overlay" on:click={() => showAddConditionDialog = false}>
    <div class="modal-dialog" on:click|stopPropagation>
      <h3>Add {conditionBranchType === 'pass' ? 'Pass' : 'Fail'} Condition</h3>
      <p class="help-text">Basic condition will be added (can be customized later)</p>
      <div class="modal-actions">
        <button class="btn-secondary" on:click={() => showAddConditionDialog = false}>Cancel</button>
        <button class="btn-primary" on:click={addNewCondition}>Add Condition</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .automation-container {
    display: flex;
    height: 100%;
    gap: 10px;
    background-color: transparent;
  }

  /* Workflows Sidebar */
  .workflows-sidebar {
    width: 250px;
    background-color: var(--bg-secondary);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-primary);
    transition: width 0.3s ease, opacity 0.3s ease;
  }

  .workflows-sidebar.hidden {
    width: 0;
    opacity: 0;
    border: none;
    padding: 0;
    margin: 0;
    min-width: 0;
  }

  .sidebar-header {
    padding: 15px;
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .sidebar-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border: none;
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
  }

  .icon-btn:hover {
    background-color: var(--bg-hover);
  }

  .toggle-sidebar-btn {
    font-size: 14px;
  }

  .workflows-list {
    flex: 1;
    overflow-y: auto;
    padding: 5px;
  }

  .workflow-item {
    padding: 12px;
    margin-bottom: 5px;
    background-color: var(--bg-tertiary);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .workflow-item:hover {
    background-color: var(--bg-hover);
  }

  .workflow-item.active {
    background-color: var(--bg-hover);
    border: 1px solid var(--accent-primary);
  }

  .workflow-info {
    flex: 1;
    min-width: 0;
  }

  .workflow-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workflow-meta {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .delete-btn {
    width: 24px;
    height: 24px;
    border: none;
    background-color: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .delete-btn:hover {
    background-color: var(--bg-secondary);
    color: var(--accent-primary);
  }

  /* Canvas Area */
  .canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-primary);
  }

  .canvas-header {
    padding: 15px;
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .workflow-title {
    flex: 1;
  }

  .workflow-name-input {
    background-color: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 500;
    padding: 5px;
    outline: none;
    border-bottom: 2px solid transparent;
    transition: border-color 0.2s;
  }

  .workflow-name-input:focus {
    border-bottom-color: var(--accent-primary);
  }

  .canvas-controls {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .zoom-indicator {
    color: var(--text-muted);
    font-size: 13px;
    min-width: 45px;
    text-align: right;
  }

  .action-btn {
    padding: 8px 16px;
    background-color: var(--accent-primary);
    border: none;
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: opacity 0.2s;
  }

  .action-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .workflow-canvas {
    position: relative;
    background-color: var(--bg-tertiary);
    overflow: hidden;
    background-image: 
      linear-gradient(var(--border-primary) 1px, transparent 1px),
      linear-gradient(90deg, var(--border-primary) 1px, transparent 1px);
    background-size: 40px 40px;
    transition: height 0.3s ease;
  }
  
  .workflow-canvas:not(.with-output-panel) {
    flex: 1;
  }

  .workflow-canvas.drag-over {
    background-color: rgba(76, 175, 80, 0.1);
  }

  .canvas-content {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    transform-origin: 0 0;
  }

  .branches-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .branch-path {
    transition: stroke-width 0.2s;
  }

  .branch-label {
    font-size: 11px;
    font-weight: 700;
    text-shadow: 
      -1px -1px 0 var(--bg-secondary),
      1px -1px 0 var(--bg-secondary),
      -1px 1px 0 var(--bg-secondary),
      1px 1px 0 var(--bg-secondary),
      0 0 4px var(--bg-secondary);
    pointer-events: none;
    user-select: none;
  }

  .empty-canvas {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    pointer-events: none;
  }

  .help-hint {
    font-size: 12px;
    margin-top: 10px;
    opacity: 0.7;
  }

  /* Action Nodes */
  .action-node {
    position: absolute;
    width: 200px;
    background-color: var(--bg-secondary);
    border: 2px solid var(--border-primary);
    border-radius: 8px;
    padding: 10px;
    cursor: move;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .action-node:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .action-node.selected {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(255, 82, 82, 0.2);
  }

  .action-node.end-action {
    background-color: rgba(244, 67, 54, 0.1);
  }

  .action-node.replaceable-end {
    border-color: var(--accent-primary);
    background-color: rgba(76, 175, 80, 0.2);
    box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.3);
    transform: scale(1.05);
  }

  .action-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .action-icon {
    font-size: 20px;
  }

  .action-title {
    flex: 1;
    font-weight: 500;
    color: var(--text-primary);
    font-size: 14px;
  }

  .delete-action-btn {
    width: 20px;
    height: 20px;
    border: none;
    background-color: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .delete-action-btn:hover {
    background-color: var(--bg-tertiary);
    color: var(--accent-primary);
  }

  .action-body {
    margin-bottom: 8px;
  }

  .action-detail {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .action-branches {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .branch-indicator {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }

  .branch-indicator.pass {
    background-color: rgba(76, 175, 80, 0.15);
    color: #4caf50;
  }

  .branch-indicator.fail {
    background-color: rgba(244, 67, 54, 0.15);
    color: #f44336;
  }

  /* Right Sidebar */
  .right-sidebar {
    width: 300px;
    background-color: var(--bg-secondary);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-primary);
  }

  /* Action Palette */
  .action-palette {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .palette-header {
    padding: 15px;
    border-bottom: 1px solid var(--border-primary);
  }

  .palette-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }

  .palette-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }

  .palette-item {
    padding: 12px;
    margin-bottom: 8px;
    background-color: var(--bg-tertiary);
    border-radius: 4px;
    border-left: 4px solid;
    cursor: grab;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .palette-item:hover {
    background-color: var(--bg-hover);
    transform: translateX(5px);
  }

  .palette-item:active {
    cursor: grabbing;
  }

  .palette-icon {
    font-size: 20px;
  }

  .palette-label {
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 500;
  }

  /* Action Editor */
  .action-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .editor-header {
    padding: 15px;
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .editor-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border: none;
    background-color: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .editor-content {
    flex: 1;
    overflow-y: auto;
    padding: 15px;
  }

  .form-group {
    margin-bottom: 15px;
  }

  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .form-input, .form-textarea {
    width: 100%;
    padding: 8px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
  }

  .form-input:focus, .form-textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .form-textarea {
    resize: vertical;
    font-family: monospace;
  }

  .help-text {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
    margin-bottom: 8px;
  }

  .empty-message {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    padding: 8px;
  }

  .modification-item {
    padding: 8px;
    background-color: var(--bg-tertiary);
    border-radius: 4px;
    margin-bottom: 5px;
    font-size: 12px;
    color: var(--text-primary);
  }

  /* Conditions Section */
  .conditions-section {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border-primary);
  }

  .conditions-section h4 {
    margin: 0 0 10px 0;
    font-size: 14px;
    color: var(--text-primary);
  }

  .branch-target {
    margin-bottom: 15px;
  }

  .branch-target label {
    display: block;
    margin-bottom: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .conditions-list {
    margin-bottom: 20px;
  }

  .conditions-list label {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .condition-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    background-color: var(--bg-tertiary);
    border-radius: 4px;
    margin-bottom: 5px;
    font-size: 12px;
    color: var(--text-primary);
  }

  .remove-btn {
    width: 20px;
    height: 20px;
    border: none;
    background-color: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .remove-btn:hover {
    background-color: var(--bg-hover);
    color: var(--accent-primary);
  }

  .add-condition-btn {
    width: 100%;
    padding: 8px;
    background-color: var(--bg-tertiary);
    border: 1px dashed var(--border-primary);
    color: var(--text-muted);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  }

  .add-condition-btn:hover {
    background-color: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-dialog {
    background-color: var(--bg-secondary);
    border-radius: 8px;
    padding: 20px;
    min-width: 400px;
    max-width: 90%;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  }

  .modal-dialog h3 {
    margin: 0 0 15px 0;
    font-size: 18px;
    color: var(--text-primary);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 15px;
  }

  .btn-primary, .btn-secondary {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: opacity 0.2s;
  }

  .btn-primary {
    background-color: var(--accent-primary);
    color: white;
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-secondary {
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background-color: var(--bg-hover);
  }

  /* Output Panel */
  .output-panel {
    border-top: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-secondary);
    transition: height 0.3s ease;
  }

  .output-header {
    padding: 10px 15px;
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--bg-secondary);
  }

  .output-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .output-icon {
    font-size: 18px;
  }

  .output-title h3 {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .execution-status {
    font-size: 12px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    background-color: var(--bg-tertiary);
  }

  .output-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }

  .output-empty {
    text-align: center;
    color: var(--text-muted);
    padding: 40px 20px;
  }

  .output-empty p {
    margin: 5px 0;
  }

  .execution-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    overflow: hidden;
    transition: all 0.2s;
  }

  .result-item.expanded {
    border-color: var(--accent-primary);
  }

  .result-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .result-header:hover {
    background-color: var(--bg-hover);
  }

  .result-status-icon {
    font-size: 18px;
    font-weight: bold;
    min-width: 24px;
    text-align: center;
  }

  .result-info {
    flex: 1;
    min-width: 0;
  }

  .result-action-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .result-meta {
    display: flex;
    gap: 12px;
    font-size: 11px;
    flex-wrap: wrap;
  }

  .result-status {
    font-weight: 600;
  }

  .result-duration, .result-http-status {
    color: var(--text-muted);
  }

  .result-toggle {
    color: var(--text-muted);
    font-size: 12px;
  }

  .result-details {
    padding: 0 12px 12px 48px;
    border-top: 1px solid var(--border-primary);
  }

  .detail-section {
    margin-top: 12px;
  }

  .detail-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .detail-section h5 {
    margin: 8px 0 6px 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .error-section {
    background-color: rgba(244, 67, 54, 0.1);
    padding: 10px;
    border-radius: 4px;
    border-left: 3px solid #f44336;
  }

  .error-text {
    color: #f44336;
    font-size: 12px;
    font-family: monospace;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .response-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .info-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .info-label {
    color: var(--text-muted);
    font-weight: 500;
    min-width: 50px;
  }

  .info-value {
    color: var(--text-primary);
    font-family: monospace;
  }

  .headers-section, .body-section {
    margin-top: 12px;
  }

  .headers-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-item {
    font-size: 11px;
    display: flex;
    gap: 6px;
    padding: 4px 8px;
    background-color: var(--bg-secondary);
    border-radius: 3px;
  }

  .header-item.muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .header-key {
    color: var(--text-muted);
    font-weight: 500;
  }

  .header-value {
    color: var(--text-primary);
    word-break: break-all;
  }

  .body-length {
    color: var(--text-muted);
    font-weight: normal;
    font-size: 10px;
  }

  .response-body {
    font-size: 11px;
    font-family: monospace;
    background-color: var(--bg-secondary);
    padding: 8px;
    border-radius: 4px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    color: var(--text-primary);
  }

  .extracted-data {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .data-item {
    font-size: 12px;
    display: flex;
    gap: 8px;
    padding: 6px 8px;
    background-color: var(--bg-secondary);
    border-radius: 3px;
  }

  .data-key {
    color: var(--text-muted);
    font-weight: 500;
    min-width: 100px;
  }

  .data-value {
    color: var(--text-primary);
    font-family: monospace;
    word-break: break-all;
  }

  .conditions-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .condition-result {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background-color: var(--bg-secondary);
    border-radius: 3px;
    font-size: 12px;
  }

  .condition-result.passed {
    background-color: rgba(76, 175, 80, 0.1);
  }

  .condition-icon {
    font-weight: bold;
    font-size: 14px;
  }

  .condition-text {
    flex: 1;
    color: var(--text-primary);
    font-family: monospace;
  }

  .condition-message {
    color: var(--text-muted);
    font-size: 11px;
    font-style: italic;
  }

  .output-collapsed {
    padding: 8px 15px;
    background-color: var(--bg-tertiary);
    border-top: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    transition: background-color 0.2s;
    font-size: 13px;
    color: var(--text-muted);
  }

  .output-collapsed:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .collapsed-icon {
    font-size: 12px;
  }

  .result-count {
    margin-left: auto;
    padding: 2px 8px;
    background-color: var(--bg-secondary);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
</style>
