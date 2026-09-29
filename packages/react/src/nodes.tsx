import type { NodeProps, NodeTypes, ResizeParams } from '@xyflow/react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { ComponentType, MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { memo, useCallback, useRef } from 'react';
import { useIstarEditor } from './context';
import type { ActorFlowNode, ElementFlowNode } from './layout';
import { ACTOR_SYMBOL_CLASS, ACTOR_SYMBOL_OFFSET } from './layout';
import { elementSize } from './registry';
import { ACTOR_RADIUS } from './shapes';

/**
 * One full-size source handle per node; with `ConnectionMode.Loose` it also accepts incoming
 * connections. It only captures the pointer while a link tool is active (see styles.css), so
 * nodes stay draggable otherwise. The target handle exists so edges have an anchor.
 */
function ConnectionHandles({ connectable }: { connectable: boolean }): ReactElement {
  return (
    <>
      <Handle
        type="source"
        position={Position.Top}
        className="istar-handle"
        isConnectable={connectable}
      />
      <Handle
        type="target"
        position={Position.Top}
        className="istar-handle istar-handle-target"
        isConnectable={connectable}
      />
    </>
  );
}

function useElementNode(elementId: string) {
  const editor = useIstarEditor();
  const { setEditingId } = editor;
  const element = editor.model.elements.get(elementId);
  const editing = editor.editingId === elementId;
  const setEditing = useCallback(
    (value: boolean) => setEditingId(value ? elementId : null),
    [setEditingId, elementId],
  );
  return { editor, element, editing, setEditing };
}

export const ElementNode: ComponentType<NodeProps<ElementFlowNode>> = memo(function ElementNode({
  data,
  selected,
  width,
  height,
}: NodeProps<ElementFlowNode>): ReactElement | null {
  const { editor, element, editing, setEditing } = useElementNode(data.elementId);
  const start = useRef<ResizeParams | null>(null);
  if (!element) return null;
  const config = editor.registry.elements[element.kind];
  const Component = config.component;
  // While resizing, React Flow updates the node's size before the model; render that.
  const size = {
    width: width ?? elementSize(editor.registry, element).width,
    height: height ?? elementSize(editor.registry, element).height,
  };
  const linking = editor.tool !== null && editor.tool.type !== 'element';
  const resizable = config.resizable !== false && !editor.readOnly;

  const commitResize = (end: ResizeParams): void => {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const { store, registry } = editor;
    const current = store.getModel().elements.get(element.id);
    if (!current) return;
    const base = registry.elements[current.kind].size;
    const w = Math.round(end.width);
    const h = Math.round(end.height);
    store.transaction(() => {
      // Like piStar, only sizes that differ from the kind's default are stored in `display`.
      store.updateElement(current.id, {
        display: {
          width: w === base.width ? undefined : w,
          height: h === base.height ? undefined : h,
        },
      });
      const dx = Math.round(end.x - from.x);
      const dy = Math.round(end.y - from.y);
      if (dx !== 0 || dy !== 0) store.moveElement(current.id, current.x + dx, current.y + dy);
    });
  };

  return (
    <div
      className={`istar-element${selected ? ' is-selected' : ''}`}
      data-kind={element.kind}
      onDoubleClick={() => !editor.readOnly && setEditing(true)}
    >
      {resizable && (
        <NodeResizer
          isVisible={selected && !linking}
          minWidth={30}
          minHeight={20}
          color="var(--istar-selection)"
          handleClassName="istar-resize-handle"
          lineClassName="istar-resize-line"
          onResizeStart={(_e, params) => {
            start.current = params;
          }}
          onResizeEnd={(_e, params) => commitResize(params)}
        />
      )}
      <Component
        element={element}
        width={size.width}
        height={size.height}
        selected={selected}
        editing={editing && !editor.readOnly}
        setEditing={setEditing}
        actions={editor.elementActions(element.id)}
        readOnly={editor.readOnly}
        issues={editor.issuesById.get(element.id) ?? []}
      />
      <ConnectionHandles connectable={linking && !editor.readOnly} />
    </div>
  );
});

export const ActorNode: ComponentType<NodeProps<ActorFlowNode>> = memo(function ActorNode({
  data,
  selected,
  width,
  height,
}: NodeProps<ActorFlowNode>): ReactElement | null {
  const { editor, element, editing, setEditing } = useElementNode(data.elementId);
  if (!element) return null;
  const Component = editor.registry.elements[element.kind].component;
  const linking = editor.tool !== null && editor.tool.type !== 'element';
  const symbolSize = ACTOR_RADIUS * 2;
  const component = (w: number, h: number): ReactElement => (
    <Component
      element={element}
      width={w}
      height={h}
      selected={selected}
      editing={editing && !editor.readOnly}
      setEditing={setEditing}
      actions={editor.elementActions(element.id)}
      readOnly={editor.readOnly}
      issues={editor.issuesById.get(element.id) ?? []}
    />
  );
  const rename = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    if (!editor.readOnly) setEditing(true);
  };
  if (data.frameless) {
    // No boundary: the whole node is the symbol, so it all selects, drags and renames.
    return (
      <div
        className={`istar-actor is-frameless${selected ? ' is-selected' : ''}`}
        data-kind={element.kind}
        style={{ width, height }}
      >
        <div className={ACTOR_SYMBOL_CLASS} style={{ inset: 0 }} onDoubleClick={rename}>
          {component(width ?? 0, height ?? 0)}
          <ConnectionHandles connectable={linking && !editor.readOnly} />
        </div>
      </div>
    );
  }
  return (
    <div
      className={`istar-actor${selected ? ' is-selected' : ''}${data.collapsed ? ' is-collapsed' : ''}`}
      data-kind={element.kind}
      style={{ width, height }}
    >
      {!data.collapsed && (
        // piStar's boundary: a rect with rx 100 / ry 40 and a dash-dot stroke. A background
        // colour applies to the actor symbol only, never to the boundary (ui.changeColorElement).
        <svg className="istar-actor-boundary" width={width} height={height} aria-hidden>
          <rect
            x={1}
            y={1}
            width={Math.max(0, (width ?? 0) - 2)}
            height={Math.max(0, (height ?? 0) - 2)}
            rx={100}
            ry={40}
          />
        </svg>
      )}
      <div
        className={ACTOR_SYMBOL_CLASS}
        style={{
          left: ACTOR_SYMBOL_OFFSET - ACTOR_RADIUS,
          top: ACTOR_SYMBOL_OFFSET - ACTOR_RADIUS,
          width: symbolSize,
          height: symbolSize,
        }}
        onDoubleClick={rename}
      >
        {component(symbolSize, symbolSize)}
        <ConnectionHandles connectable={linking && !editor.readOnly} />
      </div>
    </div>
  );
});

export const nodeTypes: NodeTypes = { istarActor: ActorNode, istarElement: ElementNode };
