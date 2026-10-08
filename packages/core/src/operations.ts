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
 *
 * Kinds are looked up in the model's metamodel (`metamodelOf`, iStar 2.0 by default), so
 * extended actor, node, link and dependency kinds behave like their built-in counterparts.
 */
import type { LinkCheck } from './constraints';
import { canLink } from './constraints';
import type { ActorKind, DependencyLinkKind, ElementKind, LinkKind } from './metamodel';
import type { AnyMetamodel } from './metamodels';
import type {
  AnyIstarModel,
  CustomProperties,
  Diagram,
  ElementDisplay,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkDisplay,
} from './model';
import { dependencyLinksOf, inheritMetamodel, metamodelOf } from './model';
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

type AnyElement = IstarElement<string>;
type AnyLink = IstarLink<string>;

function any<EK extends string, LK extends string>(model: IstarModel<EK, LK>): AnyIstarModel {
  return model as unknown as AnyIstarModel;
}

function typed<EK extends string, LK extends string>(model: AnyIstarModel): IstarModel<EK, LK> {
  return model as unknown as IstarModel<EK, LK>;
}

function metaOf(model: AnyIstarModel): AnyMetamodel {
  return metamodelOf(model) as unknown as AnyMetamodel;
}

function isActorIn(model: AnyIstarModel, kind: string): boolean {
  return metaOf(model).elements.get(kind)?.category === 'actor';
}

function derive(from: AnyIstarModel, changes: Partial<AnyIstarModel>): AnyIstarModel {
  return inheritMetamodel(from, inheritSourceLayout(from, { ...from, ...changes }));
}

function requireElement(model: AnyIstarModel, id: string): AnyElement {
  const element = model.elements.get(id);
  if (!element) throw new ModelOperationError(`unknown element "${id}"`);
  return element;
}

function requireLink(model: AnyIstarModel, id: string): AnyLink {
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

export interface NewElement<K extends string = ElementKind> {
  readonly kind: K;
  readonly x: number;
  readonly y: number;
  readonly id?: string;
  /** Defaults to the kind's label ("Goal"), like piStar. */
  readonly name?: string;
  /** Actor to place the element in. Required in practice for iStar nodes (see NodeKindInfo). */
  readonly parent?: string;
  readonly customProperties?: CustomProperties;
  readonly display?: ElementDisplay;
}

export function addElement<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  input: NewElement<EK>,
  ctx: OperationContext = {},
): { model: IstarModel<EK, LK>; element: IstarElement<EK> } {
  const m = any(model);
  const metamodel = metaOf(m);
  const definition = metamodel.elements.get(input.kind);
  if (!definition) {
    throw new ModelOperationError(`unknown element kind "${input.kind}" in ${metamodel.name}`);
  }
  const id = input.id ?? (ctx.createId ?? defaultIdGenerator)();
  if (m.elements.has(id) || m.links.has(id)) {
    throw new ModelOperationError(`id "${id}" is already in use`);
  }
  if (input.parent !== undefined) {
    if (definition.category === 'actor') throw new ModelOperationError('actors cannot be nested');
    if (!isActorIn(m, requireElement(m, input.parent).kind)) {
      throw new ModelOperationError(`parent "${input.parent}" is not an actor`);
    }
  }
  const element: AnyElement = withoutUndefined({
    id,
    kind: input.kind,
    name: input.name ?? definition.label,
    x: input.x,
    y: input.y,
    parent: input.parent,
    customProperties: input.customProperties,
    display: input.display,
  });
  const elements = new Map(m.elements).set(id, element);
  return { model: typed(derive(m, { elements })), element: element as IstarElement<EK> };
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

export function updateElement<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  id: string,
  patch: ElementPatch,
): IstarModel<EK, LK> {
  const m = any(model);
  const current = requireElement(m, id);
  const next: AnyElement = withoutUndefined({
    ...current,
    name: patch.name ?? current.name,
    customProperties:
      patch.customProperties === undefined
        ? current.customProperties
        : (patch.customProperties ?? undefined),
    display: mergeDisplay<ElementDisplay>(current.display, patch.display),
  });
  return typed(derive(m, { elements: new Map(m.elements).set(id, next) }));
}

/**
 * Moves an element to an absolute position. Moving an actor shifts its inner elements by the
 * same offset.
 */
export function moveElement<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  id: string,
  x: number,
  y: number,
): IstarModel<EK, LK> {
  const m = any(model);
  const current = requireElement(m, id);
  const dx = x - current.x;
  const dy = y - current.y;
  if (dx === 0 && dy === 0) return model;
  const elements = new Map(m.elements);
  elements.set(id, { ...current, x, y });
  if (isActorIn(m, current.kind)) {
    for (const child of m.elements.values()) {
      if (child.parent === id)
        elements.set(child.id, { ...child, x: child.x + dx, y: child.y + dy });
    }
  }
  return typed(derive(m, { elements }));
}

/**
 * Moves an inner element into another actor (or out of any actor with `null`). The element
 * becomes the actor's last child. Links that become invalid are kept; `validateModel` reports
 * them.
 */
export function nestElement<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  id: string,
  parent: string | null,
): IstarModel<EK, LK> {
  const m = any(model);
  const current = requireElement(m, id);
  if (isActorIn(m, current.kind)) throw new ModelOperationError('actors cannot be nested');
  if (current.isDependum) throw new ModelOperationError('a dependum cannot be nested');
  if ((current.parent ?? null) === parent) return model;
  if (parent !== null && !isActorIn(m, requireElement(m, parent).kind)) {
    throw new ModelOperationError(`parent "${parent}" is not an actor`);
  }
  const elements = new Map(m.elements);
  elements.delete(id);
  const { parent: _old, ...rest } = current;
  elements.set(id, parent === null ? rest : { ...rest, parent });
  return typed(derive(m, { elements }));
}

/**
 * Removes elements and everything that depends on them: inner elements of removed actors,
 * links touching removed elements, and the rest of any dependency that loses a part.
 */
export function removeElements<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  ids: Iterable<string>,
): IstarModel<EK, LK> {
  return typed(removeCascade(any(model), new Set(ids), new Set()));
}

export function removeElement<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  id: string,
): IstarModel<EK, LK> {
  requireElement(any(model), id);
  return removeElements(model, [id]);
}

function removeCascade(
  model: AnyIstarModel,
  elementIds: Set<string>,
  linkIds: Set<string>,
): AnyIstarModel {
  const metamodel = metaOf(model);
  const isDependencyHalf = (link: AnyLink): boolean =>
    metamodel.links.get(link.kind)?.category === 'dependency';
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
      if (!linkIds.has(link.id) || !isDependencyHalf(link)) continue;
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

export interface NewLink<K extends string = LinkKind> {
  /** Any link kind except dependency kinds (use `addDependency` for those). */
  readonly kind: Exclude<K, DependencyLinkKind>;
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

export type ConnectResult<EK extends string = ElementKind, LK extends string = LinkKind> =
  | { ok: true; model: IstarModel<EK, LK>; link: IstarLink<LK>; reversed: boolean }
  | Extract<LinkCheck, { ok: false }>;

/** Adds a link between two elements if the iStar constraints allow it. */
export function connect<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  input: NewLink<LK>,
  options: ConnectOptions = {},
): ConnectResult<EK, LK> {
  const m = any(model);
  const metamodel = metaOf(m);
  const kind: string = input.kind;
  const definition = metamodel.links.get(kind);
  if (definition?.category === 'dependency') {
    throw new ModelOperationError('use addDependency to create dependencies');
  }
  let { source, target } = input;
  let reversed = false;
  if (!options.force) {
    let check = canLink(m, source, target, kind);
    const tryReversed = options.tryReversed ?? definition?.info.tryReversedWhenAdding;
    if (!check.ok && tryReversed) {
      const swapped = canLink(m, target, source, kind);
      if (swapped.ok) {
        [source, target] = [target, source];
        reversed = true;
        check = swapped;
      }
    }
    if (!check.ok) return check;
  } else {
    if (!definition) {
      throw new ModelOperationError(`unknown link kind "${kind}" in ${metamodel.name}`);
    }
    requireElement(m, source);
    requireElement(m, target);
  }
  const id = input.id ?? (options.createId ?? defaultIdGenerator)();
  if (m.elements.has(id) || m.links.has(id)) {
    throw new ModelOperationError(`id "${id}" is already in use`);
  }
  const link: AnyLink = withoutUndefined({
    id,
    kind,
    source,
    target,
    label: input.label,
    name: input.name,
    customProperties: input.customProperties,
  });
  return {
    ok: true,
    model: typed(derive(m, { links: new Map(m.links).set(id, link) })),
    link: link as IstarLink<LK>,
    reversed,
  };
}

export interface NewDependency<EK extends string = ElementKind, LK extends string = LinkKind> {
  /** The depender: an actor or one of its inner elements. */
  readonly depender: string;
  /** The dependee: an actor or one of its inner elements. */
  readonly dependee: string;
  readonly dependum: {
    /** A node kind (built-in or extended) that can be a dependum. */
    readonly kind: Exclude<EK, ActorKind>;
    readonly name?: string;
    readonly id?: string;
    /** Defaults to the midpoint between depender and dependee, as in piStar. */
    readonly x?: number;
    readonly y?: number;
    readonly customProperties?: CustomProperties;
  };
  /** A dependency link kind. Default `istar.DependencyLink`. */
  readonly linkKind?: LK;
  readonly linkIds?: readonly [string, string];
}

export type AddDependencyResult<EK extends string = ElementKind, LK extends string = LinkKind> =
  | {
      ok: true;
      model: IstarModel<EK, LK>;
      dependum: IstarElement<EK>;
      links: readonly [IstarLink<LK>, IstarLink<LK>];
    }
  | Extract<LinkCheck, { ok: false }>;

/** Adds depender → dependum → dependee. */
export function addDependency<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  input: NewDependency<EK, LK>,
  options: Omit<ConnectOptions, 'tryReversed'> = {},
): AddDependencyResult<EK, LK> {
  const m = any(model);
  const metamodel = metaOf(m);
  const dependumKind: string = input.dependum.kind;
  const dependumDefinition = metamodel.elements.get(dependumKind);
  if (dependumDefinition?.category !== 'node' || dependumDefinition.info?.canBeDependum === false) {
    throw new ModelOperationError(`${dependumKind} cannot be a dependum`);
  }
  const linkKind: string = input.linkKind ?? 'istar.DependencyLink';
  if (metamodel.links.get(linkKind)?.category !== 'dependency') {
    throw new ModelOperationError(`${linkKind} is not a dependency link kind`);
  }
  if (!options.force) {
    const check = canLink(m, input.depender, input.dependee, linkKind);
    if (!check.ok) return check;
  }
  const depender = requireElement(m, input.depender);
  const dependee = requireElement(m, input.dependee);
  const createId = options.createId ?? defaultIdGenerator;
  const added = addElement(
    m,
    {
      kind: dependumKind,
      id: input.dependum.id,
      name: input.dependum.name,
      x: input.dependum.x ?? (depender.x + dependee.x) / 2,
      y: input.dependum.y ?? (depender.y + dependee.y) / 2,
      customProperties: input.dependum.customProperties,
    },
    { createId },
  );
  const dependum: AnyElement = { ...added.element, isDependum: true };
  const [id1, id2] = input.linkIds ?? [createId(), createId()];
  const first: AnyLink = { id: id1, kind: linkKind, source: depender.id, target: dependum.id };
  const second: AnyLink = { id: id2, kind: linkKind, source: dependum.id, target: dependee.id };
  for (const id of [id1, id2]) {
    if (added.model.elements.has(id) || added.model.links.has(id) || id1 === id2) {
      throw new ModelOperationError(`id "${id}" is already in use`);
    }
  }
  return {
    ok: true,
    model: typed(
      derive(m, {
        elements: new Map(added.model.elements).set(dependum.id, dependum),
        links: new Map(m.links).set(id1, first).set(id2, second),
      }),
    ),
    dependum: dependum as IstarElement<EK>,
    links: [first as IstarLink<LK>, second as IstarLink<LK>],
  };
}

/** Removes a link. Removing either half of a dependency removes the whole dependency. */
export function disconnect<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  id: string,
): IstarModel<EK, LK> {
  const m = any(model);
  requireLink(m, id);
  return typed(removeCascade(m, new Set(), new Set([id])));
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

export function updateLink<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  id: string,
  patch: LinkPatch,
): IstarModel<EK, LK> {
  const m = any(model);
  const current = requireLink(m, id);
  const next: AnyLink = withoutUndefined({
    ...current,
    label: pick(patch.label, current.label),
    name: pick(patch.name, current.name),
    customProperties: pick(patch.customProperties, current.customProperties),
    display: mergeDisplay<LinkDisplay>(current.display, patch.display),
  });
  return typed(derive(m, { links: new Map(m.links).set(id, next) }));
}

// ---------------------------------------------------------------------------------------------
// Diagram

export function updateDiagram<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  patch: Partial<Diagram>,
): IstarModel<EK, LK> {
  const m = any(model);
  return typed(derive(m, { diagram: withoutUndefined({ ...m.diagram, ...patch }) }));
}

/** Where dependency depender/dependee currently point (see `dependencyLinksOf`). */
export function dependencyEnds<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  dependumId: string,
): { depender?: string; dependee?: string } {
  const { inbound, outbound } = dependencyLinksOf(model, dependumId);
  const fallback = model.elements.get(dependumId)?.dependency;
  return {
    depender: inbound?.source ?? fallback?.source,
    dependee: outbound?.target ?? fallback?.target,
  };
}
