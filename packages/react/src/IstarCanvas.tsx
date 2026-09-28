import type { ElementKind, IstarModel, ModelStore } from '@istar-ts/core';
import { isActorKind, isNodeKind } from '@istar-ts/core';
import type {
  Connection,
  FinalConnectionState,
  IsValidConnection,
  NodeChange,
  OnSelectionChangeParams,
} from '@xyflow/react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  ViewportPortal,
  useConnection,
  useReactFlow,
} from '@xyflow/react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { Tool } from './context';
import { IstarProvider, useHasIstarProvider, useIstarEditor } from './context';
import { edgeTypes } from './edges';
import type { IstarFlowNode } from './layout';
import { modelToFlow } from './layout';
import { nodeTypes } from './nodes';
import { IstarPalette } from './Palette';
import type { IstarRegistry } from './registry';
import { defaultPropertiesFor } from './registry';

export interface IstarCanvasProps {
  /** Controlled model; pair with `onChange`. Ignored when `store` is given. */
  readonly model?: IstarModel;
  readonly onChange?: (model: IstarModel) => void;
  /** An existing store, for undo/redo and change events. */
  readonly store?: ModelStore;
  readonly registry?: IstarRegistry;
  readonly readOnly?: boolean;
  /** Show the add-element / add-link toolbar. Default true. */
  readonly palette?: boolean;
  /** Content rendered beside the diagram (e.g. `<IstarInspector />`). */
  readonly aside?: ReactNode;
  readonly className?: string;
  /** Show React Flow's zoom controls and dotted background. Default true. */
  readonly controls?: boolean;
  readonly fitView?: boolean;
}

/**
 * An iStar 2.0 diagram editor. Use it standalone (controlled with `model`/`onChange`, or with
 * a `store`), or inside an `<IstarProvider>` together with `<IstarPalette>` and
 * `<IstarInspector>` placed wherever you like.
 */
export function IstarCanvas(props: IstarCanvasProps): ReactElement {
  const hasProvider = useHasIstarProvider();
  const content = (
    <ReactFlowProvider>
      <CanvasLayout {...props} />
    </ReactFlowProvider>
  );
  if (hasProvider) return content;
  return (
    <IstarProvider
      model={props.model}
      onChange={props.onChange}
      store={props.store}
      registry={props.registry}
      readOnly={props.readOnly}
    >
      {content}
    </IstarProvider>
  );
}

function CanvasLayout(props: IstarCanvasProps): ReactElement {
  const editor = useIstarEditor();
  return (
    <div className={`istar-canvas${props.className ? ` ${props.className}` : ''}`}>
      {(props.palette ?? true) && !editor.readOnly && <IstarPalette />}
      <div className="istar-canvas-body">
        <div className={`istar-canvas-flow${toolClass(editor.tool)}`}>
          <Diagram controls={props.controls ?? true} fitView={props.fitView ?? true} />
          <NoticeBar />
        </div>
        {props.aside}
      </div>
    </div>
  );
}

function toolClass(tool: Tool | null): string {
  if (!tool) return '';
  return tool.type === 'element' ? ' is-adding' : ' is-linking';
}

function Diagram({ controls, fitView }: { controls: boolean; fitView: boolean }): ReactElement {
  const editor = useIstarEditor();
  const { model, registry, store, tool, readOnly } = editor;
  const flow = useReactFlow();
  const graph = useMemo(() => modelToFlow(model, registry), [model, registry]);

  // React Flow owns transient state (drag positions, measurements, selection); the model is
  // re-applied whenever it changes.
  const [nodes, setNodes] = useState<IstarFlowNode[]>(graph.nodes);
  const [syncedGraph, setSyncedGraph] = useState(graph);
  if (syncedGraph !== graph) {
    // Adjust state while rendering when the model changes, keeping React Flow's measurements
    // and selection for nodes that still exist.
    setSyncedGraph(graph);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    setNodes(
      graph.nodes.map((n) => {
        const old = byId.get(n.id);
        return old
          ? ({ ...n, measured: old.measured, selected: old.selected } as IstarFlowNode)
          : n;
      }),
    );
  }

  const onNodesChange = useCallback((changes: NodeChange<IstarFlowNode>[]) => {
    // Removals go through the store (see onDelete) so cascades and undo apply.
    setNodes((ns) =>
      applyNodeChanges(
        changes.filter((c) => c.type !== 'remove'),
        ns,
      ),
    );
  }, []);

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: IstarFlowNode, dragged: IstarFlowNode[]) => {
      store.transaction(() => {
        for (const node of dragged) {
          const before = graph.nodes.find((n) => n.id === node.id);
          const element = store.getModel().elements.get(node.id);
          if (!before || !element) continue;
          const dx = node.position.x - before.position.x;
          const dy = node.position.y - before.position.y;
          // Children of a dragged actor move with it (moveElement shifts them).
          if (element.parent && dragged.some((d) => d.id === element.parent)) continue;
          if (dx !== 0 || dy !== 0) store.moveElement(node.id, element.x + dx, element.y + dy);
        }
      });
    },
    [graph, store],
  );

  const addAt = useCallback(
    (kind: ElementKind, clientX: number, clientY: number, parent?: string) => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const config = registry.elements[kind];
      const size = config.size;
      // Actors are placed by their top-left corner, nodes centred on the click.
      const x = isActorKind(kind) ? point.x : point.x - size.width / 2;
      const y = isActorKind(kind) ? point.y : point.y - size.height / 2;
      const element = store.addElement({
        kind,
        x: Math.round(x),
        y: Math.round(y),
        parent,
        name: config.label,
        customProperties: defaultPropertiesFor(registry, kind, store.getModel()),
      });
      editor.select({ type: 'element', id: element.id });
      editor.setEditingId(element.id);
      editor.setTool(null);
    },
    [editor, flow, registry, store],
  );

  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      if (!tool || tool.type !== 'element') return;
      if (isActorKind(tool.kind)) {
        addAt(tool.kind, event.clientX, event.clientY);
      } else {
        editor.notify(
          `Click on an actor, role or agent to add a ${registry.elements[tool.kind].label}`,
          'info',
        );
      }
    },
    [addAt, editor, registry, tool],
  );

  const onNodeClick = useCallback(
    (event: ReactMouseEvent, node: IstarFlowNode) => {
      if (!tool || tool.type !== 'element') return;
      const clicked = store.getModel().elements.get(node.id);
      if (!clicked) return;
      if (isActorKind(tool.kind)) {
        editor.notify('Actors are added on an empty spot of the diagram', 'info');
        return;
      }
      const actorId = isActorKind(clicked.kind) ? clicked.id : clicked.parent;
      if (!actorId || !isNodeKind(tool.kind)) {
        editor.notify('Elements must be added inside an actor, role or agent', 'info');
        return;
      }
      event.stopPropagation();
      addAt(tool.kind, event.clientX, event.clientY, actorId);
    },
    [addAt, editor, store, tool],
  );

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => editor.checkConnection(connection.source, connection.target).ok,
    [editor],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!tool || tool.type === 'element') return;
      const result =
        tool.type === 'dependency'
          ? store.addDependency({
              depender: connection.source,
              dependee: connection.target,
              dependum: { kind: tool.dependum, name: registry.elements[tool.dependum].label },
            })
          : store.connect({
              kind: tool.kind,
              source: connection.source,
              target: connection.target,
              label: tool.value,
            });
      if (!result.ok) {
        editor.notify(`Invalid link: ${result.reason}`);
        return;
      }
      if ('dependum' in result) {
        editor.select({ type: 'element', id: result.dependum.id });
        editor.setEditingId(result.dependum.id);
      } else {
        editor.select({ type: 'link', id: result.link.id });
      }
    },
    [editor, registry, store, tool],
  );

  const onConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !state.toNode) return;
      if (state.fromNode.id === state.toNode.id && !state.toHandle) return;
      const check = editor.checkConnection(state.fromNode.id, state.toNode.id);
      if (!check.ok) editor.notify(`Invalid link: ${check.reason}`);
    },
    [editor],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      const node = selNodes[0];
      const edge = selEdges[0];
      if (node) editor.select({ type: 'element', id: node.id });
      else if (edge) editor.select({ type: 'link', id: edge.id });
      else editor.select(null);
    },
    [editor],
  );

  const onDelete = useCallback(
    ({
      nodes: removedNodes,
      edges: removedEdges,
    }: {
      nodes: IstarFlowNode[];
      edges: { id: string }[];
    }) => {
      store.transaction(() => {
        const ids = removedNodes.map((n) => n.id).filter((id) => store.getModel().elements.has(id));
        if (ids.length > 0) store.removeElements(ids);
        for (const edge of removedEdges) {
          if (store.getModel().links.has(edge.id)) store.disconnect(edge.id);
        }
      });
    },
    [store],
  );

  // Undo/redo and Escape (cancel tool) while the canvas has focus.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') editor.setTool(null);
      else if (mod && event.key.toLowerCase() === 'z' && !readOnly) {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if (mod && event.key.toLowerCase() === 'y' && !readOnly) {
        event.preventDefault();
        store.redo();
      }
    },
    [editor, readOnly, store],
  );

  return (
    <div className="istar-diagram" tabIndex={-1} onKeyDown={onKeyDown}>
      <ReactFlow<IstarFlowNode>
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        onDelete={onDelete}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={!readOnly && (!tool || tool.type === 'element')}
        nodesConnectable={!readOnly}
        elementsSelectable
        elevateNodesOnSelect={false}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        fitView={fitView}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        {controls && <Background gap={20} size={1} />}
        {controls && <Controls showInteractive={false} />}
        <ConnectionHint />
      </ReactFlow>
    </div>
  );
}

/** While dragging a new link, explains why the hovered target would be rejected. */
function ConnectionHint(): ReactElement | null {
  const editor = useIstarEditor();
  const connection = useConnection();
  if (!connection.inProgress || !connection.toNode || !connection.fromNode) return null;
  if (connection.toNode.id === connection.fromNode.id) return null;
  const check = editor.checkConnection(connection.fromNode.id, connection.toNode.id);
  if (check.ok) return null;
  const { x, y } = connection.to;
  return (
    <ViewportPortal>
      <div
        className="istar-connection-hint"
        style={{ transform: `translate(${x + 12}px, ${y + 12}px)` }}
        role="status"
      >
        {check.reason}
      </div>
    </ViewportPortal>
  );
}

function NoticeBar(): ReactElement | null {
  const { notice, dismissNotice } = useIstarEditor();
  if (!notice) return null;
  return (
    <div
      className={`istar-notice is-${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span>{notice.message}</span>
      <button type="button" aria-label="Dismiss" onClick={dismissNotice}>
        ×
      </button>
    </div>
  );
}
