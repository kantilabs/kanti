<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';

  // Props
  export let sitemapRoot: SitemapNode;
  export let selectedNode: SitemapNode | null = null;
  export let scopeOnly: boolean = false;
  export let isInScope: (host: string) => boolean;
  export let onNodeSelect: (node: SitemapNode) => void;

  // Interface for sitemap node (matching parent component)
  interface SitemapNode {
    name: string;
    type: 'domain' | 'subdomain' | 'path' | 'parameterized';
    children: Map<string, SitemapNode>;
    requests: any[];
    expanded: boolean;
    parent?: SitemapNode;
    fullPath: string;
  }

  // Graph data structures
  interface GraphNode {
    id: string;
    name: string;
    type: SitemapNode['type'];
    requestCount: number;
    fullPath: string;
    sitemapNode: SitemapNode;
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
  }

  interface GraphLink {
    source: GraphNode | string;
    target: GraphNode | string;
  }

  let svgElement: SVGSVGElement;
  let containerWidth = 0;
  let containerHeight = 0;
  let simulation: d3.Simulation<GraphNode, GraphLink> | null = null;

  // Transform tree to graph
  function transformTreeToGraph(root: SitemapNode): { nodes: GraphNode[], links: GraphLink[] } {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeMap = new Map<string, GraphNode>();

    function traverse(node: SitemapNode, parentId?: string) {
      // Skip if filtering by scope
      if (scopeOnly && node.type === 'domain' && !isInScope(node.name)) {
        return;
      }

      const nodeId = node.fullPath || node.name;

      // Create graph node
      const graphNode: GraphNode = {
        id: nodeId,
        name: node.name,
        type: node.type,
        requestCount: node.requests.length,
        fullPath: node.fullPath,
        sitemapNode: node
      };

      nodes.push(graphNode);
      nodeMap.set(nodeId, graphNode);

      // Create link to parent
      if (parentId && nodeMap.has(parentId)) {
        links.push({
          source: parentId,
          target: nodeId
        });
      }

      // Traverse children
      node.children.forEach(child => {
        traverse(child, nodeId);
      });
    }

    // Start traversal from root's children
    root.children.forEach(child => {
      traverse(child);
    });

    return { nodes, links };
  }

  // Get node color (theme-aware token) based on type
  function getNodeColor(type: SitemapNode['type']): string {
    switch (type) {
      case 'domain': return 'var(--color-graph-domain)';
      case 'subdomain': return 'var(--color-graph-subdomain)';
      case 'path': return 'var(--color-graph-path)';
      case 'parameterized': return 'var(--color-graph-parameterized)';
      default: return 'var(--color-graph-path)';
    }
  }

  // Get node radius based on request count
  function getNodeRadius(requestCount: number): number {
    return Math.max(5, Math.min(20, 5 + requestCount * 0.5));
  }

  // Initialize and update graph
  function updateGraph() {
    if (!svgElement) return;

    // Clear existing content
    d3.select(svgElement).selectAll('*').remove();

    // Get graph data
    const { nodes, links } = transformTreeToGraph(sitemapRoot);

    if (nodes.length === 0) {
      // Show empty state
      const svg = d3.select(svgElement);
      svg.append('text')
        .attr('x', containerWidth / 2)
        .attr('y', containerHeight / 2)
        .attr('text-anchor', 'middle')
        .style('fill', 'var(--color-text-muted)')
        .attr('font-style', 'italic')
        .text('No nodes to display');
      return;
    }

    // Create SVG groups
    const svg = d3.select(svgElement);

    // Add zoom behavior
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create force simulation
    simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(80))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(containerWidth / 2, containerHeight / 2))
      .force('collision', d3.forceCollide().radius(d => getNodeRadius((d as GraphNode).requestCount) + 5));

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter().append('line')
      .style('stroke', 'var(--color-graph-link)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // Create nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter().append('g')
      .attr('class', 'node')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any);

    // Add circles to nodes
    node.append('circle')
      .attr('r', d => getNodeRadius(d.requestCount))
      .style('fill', d => getNodeColor(d.type))
      .style('stroke', d => selectedNode && selectedNode.fullPath === d.fullPath ? 'var(--color-graph-node-stroke-selected)' : 'var(--color-graph-node-stroke)')
      .attr('stroke-width', d => selectedNode && selectedNode.fullPath === d.fullPath ? 3 : 1.5)
      .attr('cursor', 'pointer');

    // Add labels to nodes
    node.append('text')
      .text(d => d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name)
      .attr('x', 0)
      .attr('y', d => getNodeRadius(d.requestCount) + 15)
      .attr('text-anchor', 'middle')
      .style('fill', 'var(--color-graph-label)')
      .attr('font-size', '10px')
      .attr('pointer-events', 'none');

    // Add request count badges
    node.filter(d => d.requestCount > 0)
      .append('text')
      .text(d => d.requestCount)
      .attr('x', 0)
      .attr('y', 4)
      .attr('text-anchor', 'middle')
      .style('fill', 'var(--color-graph-badge-text)')
      .attr('font-size', '8px')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none');

    // Add tooltips
    const tooltip = d3.select('body').append('div')
      .attr('class', 'graph-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', 'var(--color-graph-tooltip-bg)')
      .style('color', 'var(--color-graph-tooltip-text)')
      .style('padding', '8px 12px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('border', '1px solid var(--color-graph-tooltip-border)')
      .style('pointer-events', 'none')
      .style('z-index', '1000');

    node
      .on('mouseover', function(event, d) {
        tooltip.style('visibility', 'visible')
          .html(`
            <strong>${d.name}</strong><br/>
            Type: ${d.type}<br/>
            Requests: ${d.requestCount}<br/>
            Path: ${d.fullPath}
          `);
        d3.select(this).select('circle')
          .style('stroke', 'var(--color-graph-node-stroke-selected)')
          .attr('stroke-width', 2);
      })
      .on('mousemove', function(event) {
        tooltip
          .style('top', (event.pageY - 10) + 'px')
          .style('left', (event.pageX + 10) + 'px');
      })
      .on('mouseout', function(event, d) {
        tooltip.style('visibility', 'hidden');
        d3.select(this).select('circle')
          .style('stroke', selectedNode && selectedNode.fullPath === d.fullPath ? 'var(--color-graph-node-stroke-selected)' : 'var(--color-graph-node-stroke)')
          .attr('stroke-width', selectedNode && selectedNode.fullPath === d.fullPath ? 3 : 1.5);
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        onNodeSelect(d.sitemapNode);
      });

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x || 0)
        .attr('y1', d => (d.source as GraphNode).y || 0)
        .attr('x2', d => (d.target as GraphNode).x || 0)
        .attr('y2', d => (d.target as GraphNode).y || 0);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Drag functions
    function dragstarted(event: any, d: GraphNode) {
      if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: GraphNode) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: GraphNode) {
      if (!event.active && simulation) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Cleanup tooltip on destroy
    return () => {
      tooltip.remove();
    };
  }

  // Update container dimensions
  function updateDimensions() {
    if (svgElement) {
      const rect = svgElement.parentElement?.getBoundingClientRect();
      if (rect) {
        containerWidth = rect.width;
        containerHeight = rect.height;
      }
    }
  }

  // Reactive updates
  $: if (svgElement && sitemapRoot) {
    updateGraph();
  }

  $: if (svgElement && selectedNode) {
    // Update node selection styling
    d3.select(svgElement)
      .selectAll('.node circle')
      .style('stroke', function(d: any) {
        return selectedNode && selectedNode.fullPath === d.fullPath ? 'var(--color-graph-node-stroke-selected)' : 'var(--color-graph-node-stroke)';
      })
      .attr('stroke-width', function(d: any) {
        return selectedNode && selectedNode.fullPath === d.fullPath ? 3 : 1.5;
      });
  }

  onMount(() => {
    updateDimensions();
    updateGraph();

    // Handle window resize
    const handleResize = () => {
      updateDimensions();
      updateGraph();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });

  onDestroy(() => {
    if (simulation) {
      simulation.stop();
    }
    // Remove any tooltips
    d3.selectAll('.graph-tooltip').remove();
  });
</script>

<div class="graph-container">
  <svg bind:this={svgElement} width="100%" height="100%"></svg>
  {#if sitemapRoot.children.size === 0}
    <div class="empty-graph">
      <p>No nodes to visualize</p>
      <p class="hint">Capture some requests to see the graph</p>
    </div>
  {/if}
</div>

<style>
  .graph-container {
    width: 100%;
    height: 100%;
    position: relative;
    background-color: var(--color-graph-bg);
    overflow: hidden;
  }

  .empty-graph {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: var(--color-text-muted);
    font-style: italic;
  }

  .empty-graph p {
    margin: 5px 0;
  }

  .empty-graph .hint {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }

  :global(.graph-tooltip) {
    box-shadow: var(--shadow-lg);
  }
</style>
