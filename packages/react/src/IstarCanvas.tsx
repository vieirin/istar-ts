import type { ElementKind, IstarModel, ModelStore } from '@istar-ts/core';
import { isActorKind, isNodeKind } from '@istar-ts/core';
import type {
  Connection,
  FinalConnectionState,
  IsValidConnection,
  EdgeChange,
  NodeChange,
  OnSelectionChangeParams,
  ReactFlowInstance,
} from '@xyflow/react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  ViewportPortal,
  useConnection,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import type {
  ForwardRefExoticComponent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
  Ref,
  RefAttributes,
} from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Selection, Tool } from './context';
import { IstarProvider, useHasIstarProvider, useIstarEditor } from './context';
import { edgeTypes } from './edges';
import type { IstarFlowEdge, IstarFlowNode } from './layout';
import { modelToFlow } from './layout';
import { nodeTypes } from './nodes';
import { IstarPalette, paletteEntryFor } from './Palette';
import type { IstarExtension, IstarRegistry } from './registry';
import { defaultNameFor, defaultPropertiesFor } from './registry';
import type { ElementIssue } from './issues';

export interface IstarCanvasProps {
  /** Controlled model; pair with `onChange`. Ignored when `store` is given. */
  readonly model?: IstarModel;
  readonly onChange?: (model: IstarModel) => void;
  /** An existing store, for undo/redo and change events. */
  readonly store?: ModelStore;
  readonly registry?: IstarRegistry;
  /** Extensions adapting the editor to another modeller (see `IstarExtension`). */
  readonly extensions?: readonly IstarExtension[];
  readonly readOnly?: boolean;
  /**
   * Host-owned issues (e.g. LSP diagnostics). Forwarded to {@link IstarProvider} when this
   * canvas creates its own provider.
   */
  readonly issues?: readonly ElementIssue[];
  /** Called whenever the editor selection changes. */
  readonly onSelectionChange?: (selection: Selection) => void;
  /**
   * Where to show the add-element / add-link toolbar: `'left'` (default) docks a vertical bar
   * beside the diagram, `'top'` / `'bottom'` show a piStar-style bar above / below it, `false`
   * hides it.
   */
  readonly palette?: 'left' | 'top' | 'bottom' | boolean;
  /** Content rendered beside the diagram (e.g. `<IstarInspector />`). */
  readonly aside?: ReactNode;
  readonly className?: string;
  /** Show zoom controls. Default true. */
  readonly controls?: boolean;
  /** Show a dotted grid behind the diagram. Default false (piStar's paper is plain white). */
  readonly background?: boolean;
  /**
   * Fit the diagram into view once it is laid out. Default true. If the canvas mounts before
   * its container has a usable size (e.g. in panels still animating open), the fit waits until
   * it has one.
   */
  readonly fitView?: boolean;
}

/** Options for {@link IstarCanvasHandle.fitView}. */
export interface IstarFitViewOptions {
  /** Space around the fitted elements, as a fraction of the viewport. React Flow's default is 0.1. */
  readonly padding?: number;
  /** Animation length in ms; instant when omitted. */
  readonly duration?: number;
  /** Fit only these elements (by `IstarElement` id) instead of the whole diagram. */
  readonly nodes?: readonly string[];
}

/**
 * Viewport controls of an `<IstarCanvas>`, reached through its `ref`. The canvas owns its React
 * Flow instance, so apps can't call `useReactFlow()` themselves; use this instead, e.g. to
 * re-fit after the container is resized or to reveal an element selected elsewhere.
 *
 * Each method resolves to `true` once the viewport has changed (after any animation), or
 * `false` if it couldn't (e.g. the canvas isn't ready, or `centerOn` got an unknown id).
 */
export interface IstarCanvasHandle {
  fitView(options?: IstarFitViewOptions): Promise<boolean>;
  /** Centre an element (by `IstarElement` id), keeping the zoom unless `zoom` is given. */
  centerOn(elementId: string, options?: { zoom?: number; duration?: number }): Promise<boolean>;
  zoomIn(options?: { duration?: number }): Promise<boolean>;
  zoomOut(options?: { duration?: number }): Promise<boolean>;
  /** Set the editor selection (e.g. from a tree view outside the canvas). */
  select(selection: Selection): void;
}

/**
 * An iStar 2.0 diagram editor. Use it standalone (controlled with `model`/`onChange`, or with
 * a `store`), or inside an `<IstarProvider>` together with `<IstarPalette>` and
 * `<IstarInspector>` placed wherever you like.
 */
export const IstarCanvas: ForwardRefExoticComponent<
  IstarCanvasProps & RefAttributes<IstarCanvasHandle>
> = forwardRef<IstarCanvasHandle, IstarCanvasProps>(function IstarCanvas(
  props: IstarCanvasProps,
  ref: Ref<IstarCanvasHandle>,
): ReactElement {
  const hasProvider = useHasIstarProvider();
  const content = (
    <ReactFlowProvider>
      <CanvasHandle ref={ref} />
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
      extensions={props.extensions}
      readOnly={props.readOnly}
      issues={props.issues}
      onSelectionChange={props.onSelectionChange}
    >
      {content}
    </IstarProvider>
  );
});

/** Exposes the canvas's React Flow viewport through the `IstarCanvas` ref. */
const CanvasHandle = forwardRef<IstarCanvasHandle>(function CanvasHandle(_props, ref) {
  const flow = useReactFlow<IstarFlowNode, IstarFlowEdge>();
  const { select } = useIstarEditor();
  useImperativeHandle(
    ref,
    () => ({
      fitView: (options) => fitNodes(flow, options),
      centerOn(elementId, { zoom, duration } = {}) {
        const node = flow.getInternalNode(elementId);
        if (!node) return Promise.resolve(false);
        // Nodes inside actors have positions relative to the actor; centre the absolute box.
        const { x, y } = node.internals.positionAbsolute;
        const width = node.measured.width ?? node.width ?? 0;
        const height = node.measured.height ?? node.height ?? 0;
        return flow.setCenter(x + width / 2, y + height / 2, {
          zoom: zoom ?? flow.getZoom(),
          ...(duration !== undefined && { duration }),
        });
      },
      zoomIn: (options) => flow.zoomIn(options),
      zoomOut: (options) => flow.zoomOut(options),
      select,
    }),
    [flow, select],
  );
  return null;
});

/**
 * Fits the viewport to the given elements, or to every visible one, like React Flow's `fitView`
 * (same default padding and zoom limits). `fitView` itself only applies on React Flow's next
 * node update, which may never come, so this fits the measured nodes directly.
 */
function fitNodes(
  flow: ReactFlowInstance<IstarFlowNode, IstarFlowEdge>,
  { padding = 0.1, duration, nodes }: IstarFitViewOptions = {},
): Promise<boolean> {
  const ids = nodes ?? flow.getNodes().flatMap((n) => (n.hidden ? [] : [n.id]));
  const measured = ids.filter((id) => flow.getInternalNode(id)?.measured.width !== undefined);
  if (measured.length === 0) return Promise.resolve(false);
  return flow.fitBounds(flow.getNodesBounds(measured), {
    padding,
    ...(duration !== undefined && { duration }),
  });
}

/** Below this width or height (px) the flow container is still being laid out; don't fit yet. */
const MIN_FIT_SIZE = 50;

/**
 * Fits the diagram once, as soon as it has measured nodes and the container has a usable size.
 * React Flow's own `fitView` prop fits at mount, which clamps to `minZoom` when the container
 * starts out a few pixels wide and never corrects itself when it grows.
 */
function useInitialFit(enabled: boolean): void {
  const flow = useReactFlow<IstarFlowNode, IstarFlowEdge>();
  // False while there are no nodes, so a model loaded after mount is still fitted.
  const measured = useNodesInitialized();
  const sized = useStore((s) => s.width >= MIN_FIT_SIZE && s.height >= MIN_FIT_SIZE);
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current || !sized || !measured) return;
    done.current = true;
    void fitNodes(flow);
  }, [enabled, sized, measured, flow]);
}

function CanvasLayout(props: IstarCanvasProps): ReactElement {
  const editor = useIstarEditor();
  const placement =
    props.palette === false || editor.readOnly
      ? null
      : props.palette === 'top' || props.palette === 'bottom'
        ? props.palette
        : 'left';
  const palette = placement && (
    <IstarPalette
      orientation={placement === 'left' ? 'vertical' : 'horizontal'}
      flyout={placement === 'left' ? 'right' : placement === 'top' ? 'below' : 'above'}
    />
  );
  return (
    <div
      className={`istar-canvas${placement ? ` has-palette-${placement}` : ''}${
        props.className ? ` ${props.className}` : ''
      }`}
    >
      {placement !== 'bottom' && palette}
      <div className="istar-canvas-body">
        <div className={`istar-canvas-flow${toolClass(editor.tool)}`}>
          <Diagram
            controls={props.controls ?? true}
            background={props.background ?? false}
            fitView={props.fitView ?? true}
          />
          <ToolHint />
          <NoticeBar />
        </div>
        {props.aside}
      </div>
      {placement === 'bottom' && palette}
    </div>
  );
}

function toolClass(tool: Tool | null): string {
  if (!tool) return '';
  return tool.type === 'element' ? ' is-adding' : ' is-linking';
}

function Diagram({
  controls,
  background,
  fitView,
}: {
  controls: boolean;
  background: boolean;
  fitView: boolean;
}): ReactElement {
  const editor = useIstarEditor();
  const { model, registry, store, tool, readOnly } = editor;
  const flow = useReactFlow();
  const graph = useMemo(() => modelToFlow(model, registry), [model, registry]);
  useInitialFit(fitView);

  // React Flow owns transient state (drag positions, measurements, selection); the model is
  // re-applied whenever it changes, and the editor's selection whenever that changes (e.g.
  // `select()` called from outside the canvas).
  const { selection } = editor;
  const selectionKey = selection && `${selection.type}:${selection.id}`;
  const [initial] = useState(() => showSelection(graph.nodes, graph.edges, selection));
  const [nodes, setNodes] = useState<IstarFlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<IstarFlowEdge[]>(initial.edges);
  const [syncedGraph, setSyncedGraph] = useState(graph);
  const [syncedSelection, setSyncedSelection] = useState(selectionKey);
  if (syncedGraph !== graph || syncedSelection !== selectionKey) {
    // Adjust state while rendering; both updates are computed together, since the model and
    // the selection often change at once (e.g. adding an element selects it).
    let next = { nodes, edges };
    if (syncedGraph !== graph) {
      // Keep React Flow's measurements and selection for nodes that still exist.
      setSyncedGraph(graph);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const selectedEdges = new Set(edges.filter((e) => e.selected).map((e) => e.id));
      next = {
        nodes: graph.nodes.map((n) => {
          const old = byId.get(n.id);
          return old
            ? ({ ...n, measured: old.measured, selected: old.selected } as IstarFlowNode)
            : n;
        }),
        edges: graph.edges.map((e) => (selectedEdges.has(e.id) ? { ...e, selected: true } : e)),
      };
    }
    if (syncedSelection !== selectionKey) {
      setSyncedSelection(selectionKey);
      next = showSelection(next.nodes, next.edges, selection);
    }
    setNodes(next.nodes);
    setEdges(next.edges);
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

  // Links are ordinary selectable objects, as in piStar: React Flow's select changes must be
  // applied for clicks, the inspector and Delete to see them.
  const onEdgesChange = useCallback((changes: EdgeChange<IstarFlowEdge>[]) => {
    setEdges((es) =>
      applyEdgeChanges(
        changes.filter((c) => c.type !== 'remove'),
        es,
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
        name: defaultNameFor(registry, kind, store.getModel()),
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
      // Like piStar: Alt+click on an actor collapses or expands it.
      if (event.altKey && !tool && !readOnly) {
        const actor = store.getModel().elements.get(node.id);
        if (actor && isActorKind(actor.kind)) {
          store.setCollapsed(actor.id, actor.display?.collapsed !== true);
          return;
        }
      }
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
    [addAt, editor, readOnly, store, tool],
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

  const { select } = editor;
  // What React Flow was last handed, for telling its selection reports apart from stale ones.
  // A layout effect runs before React Flow's passive effects adopt the new nodes and report.
  const rendered = useRef({ nodes, edges });
  useLayoutEffect(() => {
    rendered.current = { nodes, edges };
  }, [nodes, edges]);
  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      // React Flow reports its selection an update late, e.g. an empty one at mount before it
      // has seen nodes selected through the editor. Only a report matching the flags rendered
      // now is current; acting on a stale one would undo the editor's selection and loop.
      const current = rendered.current;
      if (
        !sameIds(
          selNodes.map((n) => n.id),
          current.nodes.flatMap((n) => (n.selected ? [n.id] : [])),
        ) ||
        !sameIds(
          selEdges.map((e) => e.id),
          current.edges.flatMap((e) => (e.selected ? [e.id] : [])),
        )
      ) {
        return;
      }
      const node = selNodes[0];
      const edge = selEdges[0];
      if (node) select({ type: 'element', id: node.id });
      else if (edge) select({ type: 'link', id: edge.id });
      else select(null);
    },
    [select],
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
      <ReactFlow<IstarFlowNode, IstarFlowEdge>
        nodes={nodes}
        edges={edges}
        onEdgesChange={onEdgesChange}
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
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        {background && <Background gap={20} size={1} />}
        {controls && <Controls showInteractive={false} />}
        <ConnectionHint />
      </ReactFlow>
    </div>
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Makes React Flow's `selected` flags show the editor's selection. Left alone when they already
 * include it (the selection came from React Flow, possibly with other nodes shift-selected);
 * otherwise exactly the selected element or link is flagged.
 */
function showSelection(
  nodes: IstarFlowNode[],
  edges: IstarFlowEdge[],
  selection: Selection,
): { nodes: IstarFlowNode[]; edges: IstarFlowEdge[] } {
  const shown =
    selection === null
      ? !nodes.some((n) => n.selected) && !edges.some((e) => e.selected)
      : selection.type === 'element'
        ? nodes.some((n) => n.id === selection.id && n.selected)
        : edges.some((e) => e.id === selection.id && e.selected);
  if (shown) return { nodes, edges };
  const nodeId = selection?.type === 'element' ? selection.id : null;
  const edgeId = selection?.type === 'link' ? selection.id : null;
  return {
    nodes: nodes.map((n) =>
      Boolean(n.selected) === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId },
    ),
    edges: edges.map((e) =>
      Boolean(e.selected) === (e.id === edgeId) ? e : { ...e, selected: e.id === edgeId },
    ),
  };
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

/** Like piStar's status bar: says what to do with the active tool, and how to cancel it. */
function ToolHint(): ReactElement | null {
  const { tool, registry, setTool } = useIstarEditor();
  if (!tool) return null;
  const entry = paletteEntryFor(registry, tool);
  return (
    <div className="istar-tool-hint" role="status">
      <span>
        <strong>{entry?.label ?? 'Tool'}:</strong> {entry?.title ?? 'click on the diagram'}
      </span>
      <button type="button" onClick={() => setTool(null)}>
        Cancel (Esc)
      </button>
    </div>
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
