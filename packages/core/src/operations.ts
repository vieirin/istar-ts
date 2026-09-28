/**
 * Pure model operations. Each takes a model and returns a new one; inputs are never mutated.
 * The store (`store.ts`) wraps these with undo/redo and change events, and the React layer can
 * use them directly for controlled components.
 *
 * Behaviour follows the piStar web tool (`istarFunctions.js` and its UI):
 * - removing an actor removes its inner elements; removing an element removes its links;
 * - a dependency is two `DependencyLink`s around a dependum, and removing any of the three
 *   removes the whole dependency (upstream keeps an `otherHalf` reference for this);
 * - moving an actor moves its inner elements with it (they are JointJS-embedded upstream).
 */
import type { LinkCheck } from './constraints';
import { canLink } from './constraints';
import type { ElementKind, LinkKind, NodeKind } from './metamodel';
import { LINK_KIND_INFO, isActorKind, isNodeKind, shortKindName } from './metamodel';
import type {
  CustomProperties,
  Diagram,
  ElementDisplay,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkDisplay,
} from './model';
import { dependencyLinksOf } from './model';
import { inheritSourceLayout } from './serialization';

export class ModelOperationError extends Error {
  override name = 'ModelOperationError';
}

/** Generates ids for new elements and links. piStar uses UUID v4. */
export type IdGenerator = () => string;

export const defaultIdGenerator: IdGenerator = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for non-secure browser contexts, where randomUUID is unavailable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export interface OperationContext {
  readonly createId?: IdGenerator;
}

function derive(from: IstarModel, changes: Partial<IstarModel>): IstarModel {
  return inheritSourceLayout(from, { ...from, ...changes });
}

function requireElement(model: IstarModel, id: string): IstarElement {
  const element = model.elements.get(id);
  if (!element) throw new ModelOperationError(`unknown element "${id}"`);
  return element;
}

function requireLink(model: IstarModel, id: string): IstarLink {
  const link = model.links.get(id);
  if (!link) throw new ModelOperationError(`unknown link "${id}"`);
  return link;
}

function withoutUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out as T;
}

// ---------------------------------------------------------------------------------------------
// Elements

export interface NewElement {
  readonly kind: ElementKind;
  readonly x: number;
  readonly y: number;
  readonly id?: string;
  /** Defaults to the kind's short name ("Goal"), like piStar. */
  readonly name?: string;
  /** Actor to place the element in. Required in practice for iStar nodes (see NodeKindInfo). */
  readonly parent?: string;
  readonly customProperties?: CustomProperties;
  readonly display?: ElementDisplay;
}

export function addElement(
  model: IstarModel,
  input: NewElement,
  ctx: OperationContext = {},
): { model: IstarModel; element: IstarElement } {
  const id = input.id ?? (ctx.createId ?? defaultIdGenerator)();
  if (model.elements.has(id) || model.links.has(id)) {
    throw new ModelOperationError(`id "${id}" is already in use`);
  }
  if (input.parent !== undefined) {
    if (isActorKind(input.kind)) throw new ModelOperationError('actors cannot be nested');
    if (!isActorKind(requireElement(model, input.parent).kind)) {
      throw new ModelOperationError(`parent "${input.parent}" is not an actor`);
    }
  }
  const element: IstarElement = withoutUndefined({
    id,
    kind: input.kind,
    name: input.name ?? shortKindName(input.kind),
    x: input.x,
    y: input.y,
    parent: input.parent,
    customProperties: input.customProperties,
    display: input.display,
  });
  const elements = new Map(model.elements).set(id, element);
  return { model: derive(model, { elements }), element };
}

export interface ElementPatch {
  readonly name?: string;
  /** Replaces the whole map. Use `null` to remove it. */
  readonly customProperties?: CustomProperties | null;
  /** Merged into the current display; a key set to `undefined` is removed. `null` clears it. */
  readonly display?: { readonly [key: string]: unknown } | null;
}

function mergeDisplay<D extends object>(
  current: D | undefined,
  patch: { readonly [key: string]: unknown } | null | undefined,
): D | undefined {
  if (patch === undefined) return current;
  if (patch === null) return undefined;
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? (merged as D) : undefined;
}

export function updateElement(model: IstarModel, id: string, patch: ElementPatch): IstarModel {
  const current = requireElement(model, id);
  const next: IstarElement = withoutUndefined({
    ...current,
    name: patch.name ?? current.name,
    customProperties:
      patch.customProperties === undefined
        ? current.customProperties
        : (patch.customProperties ?? undefined),
    display: mergeDisplay<ElementDisplay>(current.display, patch.display),
  });
  return derive(model, { elements: new Map(model.elements).set(id, next) });
}

/**
 * Moves an element to an absolute position. Moving an actor shifts its inner elements by the
 * same offset.
 */
export function moveElement(model: IstarModel, id: string, x: number, y: number): IstarModel {
  const current = requireElement(model, id);
  const dx = x - current.x;
  const dy = y - current.y;
  if (dx === 0 && dy === 0) return model;
  const elements = new Map(model.elements);
  elements.set(id, { ...current, x, y });
  if (isActorKind(current.kind)) {
    for (const child of model.elements.values()) {
      if (child.parent === id)
        elements.set(child.id, { ...child, x: child.x + dx, y: child.y + dy });
    }
  }
  return derive(model, { elements });
}

/**
 * Moves an inner element into another actor (or out of any actor with `null`). The element
 * becomes the actor's last child. Links that become invalid are kept; `validateModel` reports
 * them.
 */
export function nestElement(model: IstarModel, id: string, parent: string | null): IstarModel {
  const current = requireElement(model, id);
  if (isActorKind(current.kind)) throw new ModelOperationError('actors cannot be nested');
  if (current.isDependum) throw new ModelOperationError('a dependum cannot be nested');
  if ((current.parent ?? null) === parent) return model;
  if (parent !== null && !isActorKind(requireElement(model, parent).kind)) {
    throw new ModelOperationError(`parent "${parent}" is not an actor`);
  }
  const elements = new Map(model.elements);
  elements.delete(id);
  const { parent: _old, ...rest } = current;
  elements.set(id, parent === null ? rest : { ...rest, parent });
  return derive(model, { elements });
}

/**
 * Removes elements and everything that depends on them: inner elements of removed actors,
 * links touching removed elements, and the rest of any dependency that loses a part.
 */
export function removeElements(model: IstarModel, ids: Iterable<string>): IstarModel {
  return removeCascade(model, new Set(ids), new Set());
}

export function removeElement(model: IstarModel, id: string): IstarModel {
  requireElement(model, id);
  return removeElements(model, [id]);
}

function removeCascade(
  model: IstarModel,
  elementIds: Set<string>,
  linkIds: Set<string>,
): IstarModel {
  // Iterate to a fixed point: each round may remove more elements or links.
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of model.elements.values()) {
      if (elementIds.has(element.id)) continue;
      if (element.parent !== undefined && elementIds.has(element.parent)) {
        elementIds.add(element.id);
        changed = true;
      }
    }
    for (const link of model.links.values()) {
      if (linkIds.has(link.id)) continue;
      if (elementIds.has(link.source) || elementIds.has(link.target)) {
        linkIds.add(link.id);
        changed = true;
      }
    }
    // A dependency that lost a half, or its dependum, goes entirely.
    for (const link of model.links.values()) {
      if (!linkIds.has(link.id) || link.kind !== 'istar.DependencyLink') continue;
      for (const end of [link.source, link.target]) {
        const element = model.elements.get(end);
        if (element?.isDependum && !elementIds.has(end)) {
          elementIds.add(end);
          changed = true;
        }
      }
    }
  }
  if (elementIds.size === 0 && linkIds.size === 0) return model;
  const elements = new Map(model.elements);
  for (const id of elementIds) elements.delete(id);
  const links = new Map(model.links);
  for (const id of linkIds) links.delete(id);
  return derive(model, { elements, links });
}

// ---------------------------------------------------------------------------------------------
// Links

export interface NewLink {
  readonly kind: Exclude<LinkKind, 'istar.DependencyLink'>;
  readonly source: string;
  readonly target: string;
  readonly id?: string;
  /** Contribution value: make, help, hurt or break. */
  readonly label?: string;
  readonly name?: string;
  readonly customProperties?: CustomProperties;
}

export interface ConnectOptions extends OperationContext {
  /** Skip constraint checking (used when loading or scripting known-good data). */
  readonly force?: boolean;
  /**
   * Retry with source and target swapped if the link is invalid as given. Defaults to the
   * metamodel's `tryReversedWhenAdding` (Needed-By and Qualification), as in piStar.
   */
  readonly tryReversed?: boolean;
}

export type ConnectResult =
  | { ok: true; model: IstarModel; link: IstarLink; reversed: boolean }
  | Extract<LinkCheck, { ok: false }>;

/** Adds a link between two elements if the iStar constraints allow it. */
export function connect(
  model: IstarModel,
  input: NewLink,
  options: ConnectOptions = {},
): ConnectResult {
  if ((input.kind as LinkKind) === 'istar.DependencyLink') {
    throw new ModelOperationError('use addDependency to create dependencies');
  }
  let { source, target } = input;
  let reversed = false;
  if (!options.force) {
    let check = canLink(model, source, target, input.kind);
    const tryReversed = options.tryReversed ?? LINK_KIND_INFO[input.kind].tryReversedWhenAdding;
    if (!check.ok && tryReversed) {
      const swapped = canLink(model, target, source, input.kind);
      if (swapped.ok) {
        [source, target] = [target, source];
        reversed = true;
        check = swapped;
      }
    }
    if (!check.ok) return check;
  } else {
    requireElement(model, source);
    requireElement(model, target);
  }
  const id = input.id ?? (options.createId ?? defaultIdGenerator)();
  if (model.elements.has(id) || model.links.has(id)) {
    throw new ModelOperationError(`id "${id}" is already in use`);
  }
  const link: IstarLink = withoutUndefined({
    id,
    kind: input.kind,
    source,
    target,
    label: input.label,
    name: input.name,
    customProperties: input.customProperties,
  });
  return {
    ok: true,
    model: derive(model, { links: new Map(model.links).set(id, link) }),
    link,
    reversed,
  };
}

export interface NewDependency {
  /** The depender: an actor or one of its inner elements. */
  readonly depender: string;
  /** The dependee: an actor or one of its inner elements. */
  readonly dependee: string;
  readonly dependum: {
    readonly kind: NodeKind;
    readonly name?: string;
    readonly id?: string;
    /** Defaults to the midpoint between depender and dependee, as in piStar. */
    readonly x?: number;
    readonly y?: number;
    readonly customProperties?: CustomProperties;
  };
  readonly linkIds?: readonly [string, string];
}

export type AddDependencyResult =
  | {
      ok: true;
      model: IstarModel;
      dependum: IstarElement;
      links: readonly [IstarLink, IstarLink];
    }
  | Extract<LinkCheck, { ok: false }>;

/** Adds depender → dependum → dependee. */
export function addDependency(
  model: IstarModel,
  input: NewDependency,
  options: Omit<ConnectOptions, 'tryReversed'> = {},
): AddDependencyResult {
  if (!isNodeKind(input.dependum.kind)) {
    throw new ModelOperationError(`${input.dependum.kind} cannot be a dependum`);
  }
  if (!options.force) {
    const check = canLink(model, input.depender, input.dependee, 'istar.DependencyLink');
    if (!check.ok) return check;
  }
  const depender = requireElement(model, input.depender);
  const dependee = requireElement(model, input.dependee);
  const createId = options.createId ?? defaultIdGenerator;
  const added = addElement(
    model,
    {
      kind: input.dependum.kind,
      id: input.dependum.id,
      name: input.dependum.name,
      x: input.dependum.x ?? (depender.x + dependee.x) / 2,
      y: input.dependum.y ?? (depender.y + dependee.y) / 2,
      customProperties: input.dependum.customProperties,
    },
    { createId },
  );
  const dependum: IstarElement = { ...added.element, isDependum: true };
  const [id1, id2] = input.linkIds ?? [createId(), createId()];
  const first: IstarLink = {
    id: id1,
    kind: 'istar.DependencyLink',
    source: depender.id,
    target: dependum.id,
  };
  const second: IstarLink = {
    id: id2,
    kind: 'istar.DependencyLink',
    source: dependum.id,
    target: dependee.id,
  };
  for (const id of [id1, id2]) {
    if (added.model.elements.has(id) || added.model.links.has(id) || id1 === id2) {
      throw new ModelOperationError(`id "${id}" is already in use`);
    }
  }
  return {
    ok: true,
    model: derive(model, {
      elements: new Map(added.model.elements).set(dependum.id, dependum),
      links: new Map(model.links).set(id1, first).set(id2, second),
    }),
    dependum,
    links: [first, second],
  };
}

/** Removes a link. Removing either half of a dependency removes the whole dependency. */
export function disconnect(model: IstarModel, id: string): IstarModel {
  requireLink(model, id);
  return removeCascade(model, new Set(), new Set([id]));
}

export interface LinkPatch {
  /** `null` removes it. */
  readonly label?: string | null;
  readonly name?: string | null;
  readonly customProperties?: CustomProperties | null;
  readonly display?: { readonly [key: string]: unknown } | null;
}

function pick<T>(value: T | null | undefined, fallback: T | undefined): T | undefined {
  return value === undefined ? fallback : (value ?? undefined);
}

export function updateLink(model: IstarModel, id: string, patch: LinkPatch): IstarModel {
  const current = requireLink(model, id);
  const next: IstarLink = withoutUndefined({
    ...current,
    label: pick(patch.label, current.label),
    name: pick(patch.name, current.name),
    customProperties: pick(patch.customProperties, current.customProperties),
    display: mergeDisplay<LinkDisplay>(current.display, patch.display),
  });
  return derive(model, { links: new Map(model.links).set(id, next) });
}

// ---------------------------------------------------------------------------------------------
// Diagram

export function updateDiagram(model: IstarModel, patch: Partial<Diagram>): IstarModel {
  return derive(model, { diagram: withoutUndefined({ ...model.diagram, ...patch }) });
}

/** Where dependency depender/dependee currently point (see `dependencyLinksOf`). */
export function dependencyEnds(
  model: IstarModel,
  dependumId: string,
): { depender?: string; dependee?: string } {
  const { inbound, outbound } = dependencyLinksOf(model, dependumId);
  const fallback = model.elements.get(dependumId)?.dependency;
  return {
    depender: inbound?.source ?? fallback?.source,
    dependee: outbound?.target ?? fallback?.target,
  };
}
