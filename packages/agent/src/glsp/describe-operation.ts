/**
 * A recorded operation in plain words, for the Propose review (#156): "create Task 'T8' in Actor
 * 'Lab'", not the tool call's JSON. Names are read from the scratch model before the operation
 * ran, then after it (an element the same tool call created, or an element a delete removed).
 */
import type { IstarOperation } from '@istar-ts/actions';
import { metamodelOf } from '@istar-ts/core';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';

type Operation = IstarOperation<string, string>;

function quoted(text: string): string {
  return `'${text}'`;
}

function point(p: { readonly x: number; readonly y: number }): string {
  return `(${Math.round(p.x)}, ${Math.round(p.y)})`;
}

/** One line per operation, a compound's children each on their own line. */
export function describeOperation(
  operation: Operation,
  models: readonly AnyIstarModel[],
): readonly string[] {
  const metamodel = metamodelOf(models[0]!) as AnyMetamodel;
  const elementOf = (id: string) =>
    models.map((m) => m.elements.get(id)).find((e) => e !== undefined);
  const linkOf = (id: string) => models.map((m) => m.links.get(id)).find((l) => l !== undefined);
  const elementLabel = (kind: string): string => metamodel.elements.get(kind)?.label ?? kind;
  const linkLabel = (kind: string): string => metamodel.links.get(kind)?.label ?? kind;
  /** An element as "Kind 'name'", a link as "Kind link", an unknown id as itself. */
  const named = (id: string): string => {
    const element = elementOf(id);
    if (element) return `${elementLabel(element.kind)} ${quoted(element.name)}`;
    const link = linkOf(id);
    if (link)
      return link.name ? `${linkLabel(link.kind)} ${quoted(link.name)}` : linkLabel(link.kind);
    return id;
  };

  switch (operation.kind) {
    case 'createNode': {
      const name = operation.args?.name ?? elementLabel(operation.elementTypeId);
      const where =
        operation.containerId === undefined ? '' : ` in ${named(operation.containerId)}`;
      return [`create ${elementLabel(operation.elementTypeId)} ${quoted(name)}${where}`];
    }
    case 'createEdge': {
      const dependum = operation.args?.dependum?.name;
      const what = dependum === undefined ? '' : ` ${quoted(dependum)}`;
      return [
        `add ${linkLabel(operation.elementTypeId)}${what} from ${named(operation.sourceElementId)} to ${named(operation.targetElementId)}`,
      ];
    }
    case 'deleteElement':
      return [`delete ${operation.elementIds.map(named).join(', ')}`];
    case 'changeBounds':
      return operation.newBounds.map((bounds) => {
        const target = named(bounds.elementId);
        const size = bounds.newSize
          ? `${Math.round(bounds.newSize.width)}×${Math.round(bounds.newSize.height)}`
          : undefined;
        if (bounds.newPosition && size) {
          return `move ${target} to ${point(bounds.newPosition)} and resize it to ${size}`;
        }
        if (bounds.newPosition) return `move ${target} to ${point(bounds.newPosition)}`;
        return size ? `resize ${target} to ${size}` : `keep the bounds of ${target}`;
      });
    case 'changeContainer':
      return [
        operation.targetContainerId === null
          ? `take ${named(operation.elementId)} out of its actor`
          : `move ${named(operation.elementId)} into ${named(operation.targetContainerId)}`,
      ];
    case 'reconnectEdge':
      return [
        `reconnect ${named(operation.edgeElementId)} from ${named(operation.sourceElementId)} to ${named(operation.targetElementId)}`,
      ];
    case 'applyLabelEdit': {
      const [id, key] = operation.labelId.split('#') as [string, string | undefined];
      return [
        key === undefined
          ? `rename ${named(id)} to ${quoted(operation.text)}`
          : `set ${key} of ${named(id)} to ${quoted(operation.text)}`,
      ];
    }
    case 'compound':
      return (operation.operationList as readonly Operation[]).flatMap((child) =>
        describeOperation(child, models),
      );
    case 'istar.addLeg':
      return [`add ${named(operation.sourceElementId)} to ${named(operation.hubId)}`];
    case 'istar.removeLeg':
      return [`remove ${named(operation.legId)}`];
    case 'istar.setCollapsed':
      return [`${operation.collapsed ? 'collapse' : 'expand'} ${named(operation.elementId)}`];
    case 'istar.updateDiagram':
      return ['update the diagram'];
    case 'istar.updateProperties':
      return Object.entries(operation.properties).map(([key, value]) =>
        value === null
          ? `remove ${key} from ${named(operation.elementId)}`
          : `set ${key} of ${named(operation.elementId)} to ${quoted(value)}`,
      );
    case 'istar.updateDisplay':
      return [`restyle ${named(operation.elementId)}`];
    case 'istar.setLinkValue':
      return [
        operation.value === null
          ? `clear the value of ${named(operation.linkId)}`
          : `set the value of ${named(operation.linkId)} to ${quoted(operation.value)}`,
      ];
    case 'istar.updateLinkDisplay':
      return [`reroute ${named(operation.linkId)}`];
    case 'istar.changeLinkKind':
      return operation.linkIds.map(
        (id) => `change the kind of ${named(id)} to ${linkLabel(operation.elementTypeId)}`,
      );
    case 'istar.setFileMetamodel':
      return [
        operation.block
          ? `set the file's metamodel to ${quoted(operation.block.name)}`
          : "clear the file's metamodel",
      ];
    case 'istar.updateModelExtra': {
      const lines: string[] = [];
      if (operation.tool === null) lines.push('remove the model tool');
      else if (operation.tool !== undefined)
        lines.push(`set the model tool to ${quoted(operation.tool)}`);
      for (const [key, value] of Object.entries(operation.set ?? {})) {
        lines.push(`set ${key} of the model to ${quoted(JSON.stringify(value))}`);
      }
      for (const key of operation.remove ?? []) lines.push(`remove ${key} from the model`);
      return lines.length > 0 ? lines : ['update the model'];
    }
    case 'istar.replaceModel':
      return ['replace the model'];
  }
}
