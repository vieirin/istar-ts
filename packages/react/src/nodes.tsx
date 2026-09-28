import type { NodeProps, NodeTypes } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { ComponentType, ReactElement } from 'react';
import { memo, useCallback } from 'react';
import { useIstarEditor } from './context';
import type { ActorFlowNode, ElementFlowNode } from './layout';
import { ACTOR_SYMBOL_OFFSET } from './layout';
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
}: NodeProps<ElementFlowNode>): ReactElement | null {
  const { editor, element, editing, setEditing } = useElementNode(data.elementId);
  if (!element) return null;
  const config = editor.registry.elements[element.kind];
  const Component = config.component;
  const size = elementSize(editor.registry, element);
  const linking = editor.tool !== null && editor.tool.type !== 'element';
  return (
    <div
      className={`istar-element${selected ? ' is-selected' : ''}`}
      data-kind={element.kind}
      onDoubleClick={() => !editor.readOnly && setEditing(true)}
    >
      <Component
        element={element}
        width={size.width}
        height={size.height}
        selected={selected}
        editing={editing && !editor.readOnly}
        setEditing={setEditing}
        actions={editor.elementActions(element.id)}
        readOnly={editor.readOnly}
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
  return (
    <div
      className={`istar-actor${selected ? ' is-selected' : ''}${data.collapsed ? ' is-collapsed' : ''}`}
      data-kind={element.kind}
      style={{ width, height }}
    >
      {!data.collapsed && (
        <div
          className="istar-actor-boundary"
          style={
            element.display?.backgroundColor
              ? { background: element.display.backgroundColor }
              : undefined
          }
        />
      )}
      <div
        className="istar-actor-symbol"
        style={{
          left: ACTOR_SYMBOL_OFFSET - ACTOR_RADIUS,
          top: ACTOR_SYMBOL_OFFSET - ACTOR_RADIUS,
          width: symbolSize,
          height: symbolSize,
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!editor.readOnly) setEditing(true);
        }}
      >
        <Component
          element={element}
          width={symbolSize}
          height={symbolSize}
          selected={selected}
          editing={editing && !editor.readOnly}
          setEditing={setEditing}
          actions={editor.elementActions(element.id)}
          readOnly={editor.readOnly}
        />
        <ConnectionHandles connectable={linking && !editor.readOnly} />
      </div>
      <button
        type="button"
        className="istar-actor-toggle nodrag"
        title={data.collapsed ? 'Expand' : 'Collapse'}
        aria-label={data.collapsed ? 'Expand actor' : 'Collapse actor'}
        onClick={(e) => {
          e.stopPropagation();
          editor.store.setCollapsed(element.id, !data.collapsed);
        }}
      >
        {data.collapsed ? '+' : '−'}
      </button>
    </div>
  );
});

export const nodeTypes: NodeTypes = { istarActor: ActorNode, istarElement: ElementNode };
