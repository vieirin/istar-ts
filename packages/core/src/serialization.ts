/**
 * Reading and writing piStar save files, ported from `tool/app/istarcore/fileManager.js`.
 *
 * Output is produced with the same key order and `JSON.stringify(_, null, 2)` formatting as the
 * piStar web tool, so a file saved by piStar round-trips byte for byte. Keys this library does
 * not interpret are kept and written back.
 */
import type { ElementKind, LinkKind } from './metamodel';
import type { AnyMetamodel, Metamodel } from './metamodels';
import { ISTAR_2_0, MetamodelError, extendMetamodel } from './metamodels';
import type { FileMetamodel } from './file-metamodel';
import {
  FILE_METAMODEL_KEY,
  fileMetamodelExtension,
  validateFileMetamodel,
} from './file-metamodel';
import type {
  CustomProperties,
  Diagram,
  ElementDisplay,
  Extra,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkDisplay,
} from './model';
import {
  dependencyLinksOf,
  hostMetamodelOf,
  metamodelOf,
  setHostMetamodel,
  withMetamodel,
} from './model';
import type { AnyIstarModel } from './model';

// ---------------------------------------------------------------------------------------------
// File format types

export interface PistarElementJson {
  id: string;
  text: string;
  type: string;
  x: number;
  y: number;
  customProperties?: Record<string, string>;
  [key: string]: unknown;
}

export interface PistarActorJson extends PistarElementJson {
  nodes: PistarElementJson[];
}

export interface PistarDependencyJson extends PistarElementJson {
  source: string;
  target: string;
}

export interface PistarLinkJson {
  id: string;
  type: string;
  source: string;
  target: string;
  name?: string;
  customProperties?: Record<string, string>;
  label?: string;
  [key: string]: unknown;
}

/** The hub of an n-ary link, in a hub entry: an element without `text`. */
export interface PistarHubJson {
  id: string;
  type: string;
  x: number;
  y: number;
  customProperties?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * An n-ary link (see `LinkKindDeclaration.arity`) in `links`, as DSM3-goals writes it: no id of
 * its own, its hub, its legs (`starts`) and its end.
 */
export interface PistarHubLinkJson {
  hub: PistarHubJson;
  starts: PistarLinkJson[];
  end?: PistarLinkJson;
  [key: string]: unknown;
}

/**
 * Key of a hub element's `extra` that holds its entry's unknown keys (those beside `hub`,
 * `starts` and `end`), so they are written back on the entry.
 */
export const HUB_ENTRY_KEY = '__hubEntry';

export interface PistarDiagramJson {
  width?: number;
  height?: number;
  name?: string;
  customProperties?: Record<string, string>;
  [key: string]: unknown;
}

/** A piStar save file. Older piStar versions may omit some sections (e.g. `orphans`). */
export interface PistarFile {
  actors: PistarActorJson[];
  orphans?: PistarElementJson[];
  dependencies?: PistarDependencyJson[];
  links?: (PistarLinkJson | PistarHubLinkJson)[];
  display?: Record<string, Record<string, unknown>>;
  tool?: string;
  istar?: string;
  saveDate?: string;
  diagram?: PistarDiagramJson;
  [key: string]: unknown;
}

export class PistarParseError extends Error {
  override name = 'PistarParseError';
}

/** Thrown by `toPistar` for a kind its metamodel doesn't know (rather than writing it wrong). */
export class PistarWriteError extends Error {
  override name = 'PistarWriteError';
}

/**
 * Parse-time bookkeeping that lets `toPistar` reproduce the original key order. It has no
 * meaning for the model itself and may be dropped.
 */
export interface SourceLayout {
  /** Top-level keys in file order. */
  readonly keys: readonly string[];
  /** `display` ids in file order. */
  readonly display: readonly string[];
  /**
   * Each element's, link's and hub entry's keys in file order, by id (a hub's entry under
   * `hubEntryLayoutKey(id)`), and the diagram's under `DIAGRAM_LAYOUT_KEY`. Files written by
   * other tools order keys differently from piStar; this keeps them as they were.
   */
  readonly objects?: ReadonlyMap<string, readonly string[]>;
}

/** The `objects` key of a hub's entry (`{ hub, starts, end }`) in a `SourceLayout`. */
export function hubEntryLayoutKey(hubId: string): string {
  return `${hubId}\u0000entry`;
}
/** The `objects` key of the diagram in a `SourceLayout`. */
export const DIAGRAM_LAYOUT_KEY = '\u0000diagram';

const layouts = new WeakMap<object, SourceLayout>();

/** The key order recorded when `model` was parsed, if it came from `parsePistar`. */
export function getSourceLayout<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
): SourceLayout | undefined {
  return layouts.get(model);
}

/**
 * Carries the recorded key order over to a model derived from `from` (the store does this for
 * every edit, so saving an edited file keeps a stable diff).
 */
export function inheritSourceLayout<M extends IstarModel<string, string>>(
  from: IstarModel<string, string>,
  to: M,
): M {
  const layout = layouts.get(from);
  if (layout && from !== to) layouts.set(to, layout);
  return to;
}

// ---------------------------------------------------------------------------------------------
// Parsing

const ELEMENT_KEYS = new Set(['id', 'text', 'type', 'x', 'y', 'customProperties']);
const ACTOR_KEYS = new Set([...ELEMENT_KEYS, 'nodes']);
const DEPENDENCY_KEYS = new Set([...ELEMENT_KEYS, 'source', 'target']);
const LINK_KEYS = new Set(['id', 'type', 'source', 'target', 'name', 'customProperties', 'label']);
const HUB_KEYS = new Set(['id', 'type', 'x', 'y', 'customProperties']);
const HUB_ENTRY_KEYS = new Set(['hub', 'starts', 'end']);
const DIAGRAM_KEYS = new Set(['width', 'height', 'name', 'customProperties']);
const TOP_LEVEL_KEYS = [
  'actors',
  'orphans',
  'dependencies',
  'links',
  'display',
  'tool',
  'istar',
  'saveDate',
  'diagram',
] as const;
const TOP_LEVEL_KEY_SET: ReadonlySet<string> = new Set(TOP_LEVEL_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extraOf(json: Record<string, unknown>, known: ReadonlySet<string>): Extra | undefined {
  let extra: Record<string, unknown> | undefined;
  for (const key of Object.keys(json)) {
    if (!known.has(key)) (extra ??= {})[key] = json[key];
  }
  return extra;
}

function asArray(value: unknown, where: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PistarParseError(`"${where}" must be an array`);
  return value;
}

/**
 * Parses a piStar save file (JSON text or an already-parsed object). The input is not mutated.
 *
 * Unlike the piStar tool, elements with `x` or `y` equal to 0 are kept: upstream's
 * `if (element.x && element.y)` silently drops them, which looks unintended.
 */
export interface ParsePistarOptions<EK extends string = ElementKind, LK extends string = LinkKind> {
  /**
   * Read the file's own `"metamodel"` block (see `FileMetamodel`) and parse with `metamodel`
   * (or iStar 2.0) extended by it. Default false: the block is kept as an unknown key and not
   * applied, as before. A block whose kinds collide with the metamodel throws `MetamodelError`.
   */
  readonly fileMetamodel?: boolean;
  /**
   * The metamodel whose kinds the file may use. Default iStar 2.0: any other `type` throws,
   * as in the piStar tool. The parsed model remembers it (see `metamodelOf`).
   */
  readonly metamodel?: Metamodel<EK, LK>;
}

// The iStar 2.0 overload comes last, so `parsePistar` passed as a callback types as before.
// With the file's own metamodel, kinds are only known at run time.
export function parsePistar(
  input: string | PistarFile | Record<string, unknown>,
  options: ParsePistarOptions<string, string> & { readonly fileMetamodel: true },
): IstarModel<string, string>;
export function parsePistar<EK extends string, LK extends string>(
  input: string | PistarFile | Record<string, unknown>,
  options: ParsePistarOptions<EK, LK> & { readonly metamodel: Metamodel<EK, LK> },
): IstarModel<EK, LK>;
export function parsePistar(
  input: string | PistarFile | Record<string, unknown>,
  options: ParsePistarOptions,
): IstarModel;
export function parsePistar(input: string | PistarFile | Record<string, unknown>): IstarModel;
export function parsePistar(
  input: string | PistarFile | Record<string, unknown>,
  options: ParsePistarOptions<string, string> = {},
): AnyIstarModel {
  let metamodel: AnyMetamodel = options.metamodel ?? ISTAR_2_0;
  const categoryOf = (kind: string): string | undefined => metamodel.elements.get(kind)?.category;
  let json: unknown;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch (error) {
      throw new PistarParseError(`invalid JSON: ${(error as Error).message}`, { cause: error });
    }
  } else {
    json = structuredClone(input);
  }
  if (!isRecord(json)) throw new PistarParseError('a piStar model must be a JSON object');

  // The file's own constructs extend the host's metamodel before anything is read with it.
  let host: AnyMetamodel | undefined;
  if (options.fileMetamodel && json[FILE_METAMODEL_KEY] !== undefined) {
    const block = validateFileMetamodel(json[FILE_METAMODEL_KEY]);
    host = metamodel;
    metamodel = extendMetamodel(metamodel, fileMetamodelExtension(block));
  }

  const display = isRecord(json.display) ? json.display : {};
  const usedDisplay = new Set<string>();
  const elements = new Map<string, IstarElement<string>>();
  const links = new Map<string, IstarLink<string>>();

  const displayFor = (id: string): Record<string, unknown> | undefined => {
    const entry = display[id];
    if (!isRecord(entry)) return undefined;
    usedDisplay.add(id);
    return entry;
  };

  const objects = new Map<string, readonly string[]>();
  const readElement = (
    raw: unknown,
    where: string,
    known: ReadonlySet<string>,
    extras: Partial<IstarElement<string>>,
  ): IstarElement<string> => {
    if (!isRecord(raw)) throw new PistarParseError(`${where}: expected an object`);
    const { id, type } = raw;
    if (typeof id !== 'string' || id === '') {
      throw new PistarParseError(`${where}: missing "id"`);
    }
    const kind = typeof type === 'string' ? metamodel.elementsByPistarType.get(type) : undefined;
    if (kind === undefined) {
      throw new PistarParseError(`${where} (${id}): unknown element type ${JSON.stringify(type)}`);
    }
    if (elements.has(id) || links.has(id)) {
      throw new PistarParseError(`${where}: duplicated id "${id}"`);
    }
    const element: IstarElement<string> = {
      id,
      kind,
      name: typeof raw.text === 'string' ? raw.text : '',
      x: typeof raw.x === 'number' ? raw.x : 0,
      y: typeof raw.y === 'number' ? raw.y : 0,
      ...extras,
      ...(isRecord(raw.customProperties)
        ? { customProperties: raw.customProperties as CustomProperties }
        : {}),
      ...optional('display', displayFor(id) as ElementDisplay | undefined),
      ...optional('extra', extraOf(raw, known)),
    };
    elements.set(id, element);
    objects.set(id, Object.keys(raw));
    return element;
  };

  asArray(json.actors, 'actors').forEach((raw, i) => {
    const actor = readElement(raw, `actors[${i}]`, ACTOR_KEYS, {});
    if (categoryOf(actor.kind) !== 'actor') {
      throw new PistarParseError(`actors[${i}] (${actor.id}): ${actor.kind} is not an actor kind`);
    }
    asArray((raw as Record<string, unknown>).nodes, `actors[${i}].nodes`).forEach((node, j) => {
      const child = readElement(node, `actors[${i}].nodes[${j}]`, ELEMENT_KEYS, {
        parent: actor.id,
      });
      if (categoryOf(child.kind) === 'actor') {
        throw new PistarParseError(`actors[${i}].nodes[${j}]: actors cannot be nested`);
      }
    });
  });

  asArray(json.orphans, 'orphans').forEach((raw, i) => {
    readElement(raw, `orphans[${i}]`, ELEMENT_KEYS, {});
  });

  asArray(json.dependencies, 'dependencies').forEach((raw, i) => {
    const r = raw as Record<string, unknown>;
    const dependency =
      typeof r.source === 'string' && typeof r.target === 'string'
        ? { dependency: { source: r.source, target: r.target } }
        : {};
    readElement(raw, `dependencies[${i}]`, DEPENDENCY_KEYS, { isDependum: true, ...dependency });
  });

  const readLink = (raw: unknown, where: string): IstarLink<string> => {
    if (!isRecord(raw)) throw new PistarParseError(`${where}: expected an object`);
    const { id, type, source, target } = raw;
    if (typeof id !== 'string' || id === '') throw new PistarParseError(`${where}: missing "id"`);
    const kind = typeof type === 'string' ? metamodel.linksByPistarType.get(type) : undefined;
    if (kind === undefined) {
      throw new PistarParseError(`${where} (${id}): unknown link type ${JSON.stringify(type)}`);
    }
    if (typeof source !== 'string' || typeof target !== 'string') {
      throw new PistarParseError(`${where} (${id}): missing "source" or "target"`);
    }
    if (elements.has(id) || links.has(id)) {
      throw new PistarParseError(`${where}: duplicated id "${id}"`);
    }
    const link: IstarLink<string> = {
      id,
      kind,
      source,
      target,
      ...optional('name', typeof raw.name === 'string' ? raw.name : undefined),
      ...(isRecord(raw.customProperties)
        ? { customProperties: raw.customProperties as CustomProperties }
        : {}),
      ...optional('label', typeof raw.label === 'string' ? raw.label : undefined),
      ...optional('display', displayFor(id) as LinkDisplay | undefined),
      ...optional('extra', extraOf(raw, LINK_KEYS)),
    };
    links.set(id, link);
    objects.set(id, Object.keys(raw));
    return link;
  };

  // An n-ary link: its hub becomes an element, its legs then its end ordinary links.
  const readHubEntry = (raw: Record<string, unknown>, where: string): void => {
    const hub = readElement(raw.hub, `${where}.hub`, HUB_KEYS, {});
    const hubKind = metamodel.elements.get(hub.kind);
    if (hubKind?.role !== 'hub') {
      throw new PistarParseError(`${where}.hub (${hub.id}): ${hub.kind} is not a hub kind`);
    }
    objects.set(hubEntryLayoutKey(hub.id), Object.keys(raw));
    const entryExtra = extraOf(raw, HUB_ENTRY_KEYS);
    if (entryExtra) {
      elements.set(hub.id, { ...hub, extra: { ...hub.extra, [HUB_ENTRY_KEY]: entryExtra } });
    }
    const roleOf = (link: IstarLink<string>): string | undefined => {
      const definition = metamodel.links.get(link.kind);
      return definition?.of === hubKind.of ? definition?.role : undefined;
    };
    asArray(raw.starts, `${where}.starts`).forEach((rawLeg, j) => {
      const leg = readLink(rawLeg, `${where}.starts[${j}]`);
      if (roleOf(leg) !== 'leg' || leg.target !== hub.id) {
        throw new PistarParseError(
          `${where}.starts[${j}] (${leg.id}): not a leg of the hub "${hub.id}"`,
        );
      }
    });
    if (raw.end !== undefined) {
      const end = readLink(raw.end, `${where}.end`);
      if (roleOf(end) !== 'end' || end.source !== hub.id) {
        throw new PistarParseError(`${where}.end (${end.id}): not the end of the hub "${hub.id}"`);
      }
    }
  };

  asArray(json.links, 'links').forEach((raw, i) => {
    if (isRecord(raw) && isRecord(raw.hub)) readHubEntry(raw, `links[${i}]`);
    else readLink(raw, `links[${i}]`);
  });

  let extraDisplay: Record<string, unknown> | undefined;
  for (const [id, value] of Object.entries(display)) {
    if (!usedDisplay.has(id)) (extraDisplay ??= {})[id] = value;
  }

  let diagram: Diagram | undefined;
  if (isRecord(json.diagram)) {
    const d = json.diagram;
    diagram = {
      ...optional('width', typeof d.width === 'number' ? d.width : undefined),
      ...optional('height', typeof d.height === 'number' ? d.height : undefined),
      ...optional('name', typeof d.name === 'string' ? d.name : undefined),
      ...(isRecord(d.customProperties)
        ? { customProperties: d.customProperties as CustomProperties }
        : {}),
      ...optional('extra', extraOf(d, DIAGRAM_KEYS)),
    };
    objects.set(DIAGRAM_LAYOUT_KEY, Object.keys(d));
  }

  const model: AnyIstarModel = {
    elements,
    links,
    ...optional('diagram', diagram),
    ...optional('tool', typeof json.tool === 'string' ? json.tool : undefined),
    ...optional('istar', typeof json.istar === 'string' ? json.istar : undefined),
    ...optional('saveDate', typeof json.saveDate === 'string' ? json.saveDate : undefined),
    ...optional('extraDisplay', extraDisplay),
    ...optional('extra', extraOf(json, TOP_LEVEL_KEY_SET)),
  };
  layouts.set(model, { keys: Object.keys(json), display: Object.keys(display), objects });
  // The block stays in `extra`, so it is written back exactly as read.
  setHostMetamodel(model, host);
  return withMetamodel(model, metamodel);
}

// ---------------------------------------------------------------------------------------------
// Which language a file is in

function parseJson(json: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof json !== 'string') return json;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new PistarParseError(`invalid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (!isRecord(value)) throw new PistarParseError('a piStar model must be a JSON object');
  return value;
}

/** `kaos` for an object whose `type` is `kaos.Softgoal`. */
function prefixOf(value: unknown): string | undefined {
  const type = isRecord(value) ? value.type : undefined;
  const dot = typeof type === 'string' ? type.indexOf('.') : -1;
  return dot > 0 ? (type as string).slice(0, dot) : undefined;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The namespace of the first `type` in a file (`kaos` for `kaos.Softgoal`), looking at actors and
 * their nodes, orphans, dependencies, then links (hub entries included). `undefined` when no
 * element or link has a namespaced type. Throws `PistarParseError` for a string that isn't JSON.
 */
export function detectPrefix(json: string | Record<string, unknown>): string | undefined {
  const file = parseJson(json);
  const candidates = function* (): Generator<unknown> {
    for (const actor of arrayOf(file.actors)) {
      yield actor;
      if (isRecord(actor)) yield* arrayOf(actor.nodes);
    }
    yield* arrayOf(file.orphans);
    yield* arrayOf(file.dependencies);
    for (const link of arrayOf(file.links)) {
      if (isRecord(link) && isRecord(link.hub)) {
        yield link.hub;
        yield* arrayOf(link.starts);
        yield link.end;
      } else {
        yield link;
      }
    }
  };
  for (const candidate of candidates()) {
    const prefix = prefixOf(candidate);
    if (prefix !== undefined) return prefix;
  }
  return undefined;
}

/**
 * Which of `roots` a file is written in: the one whose `prefix` is the file's (`detectPrefix`);
 * for a file without types, the only one whose `file.tool` is the file's `tool`; otherwise
 * `undefined`. Pass the result to `parsePistar(json, { metamodel })`.
 */
export function detectFramework(
  json: string | Record<string, unknown>,
  roots: readonly AnyMetamodel[],
): AnyMetamodel | undefined {
  const file = parseJson(json);
  const prefix = detectPrefix(file);
  if (prefix !== undefined) return roots.find((root) => root.prefix === prefix);
  if (typeof file.tool !== 'string') return undefined;
  const byTool = roots.filter((root) => root.file.tool === file.tool);
  return byTool.length === 1 ? byTool[0] : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

// ---------------------------------------------------------------------------------------------
// Serialization

export interface ToPistarOptions {
  /** Default: the model's metamodel, or iStar 2.0. Decides each kind's `type` and category. */
  metamodel?: AnyMetamodel;
  /**
   * Value for `saveDate`. Defaults to the model's own `saveDate` (so a load/save round trip is
   * lossless); a parsed file that had none keeps none, and a model that was never a file gets
   * the current time. Pass `new Date()` when saving an edited model, as piStar does.
   */
  saveDate?: string | Date;
}

function formatDate(date: Date): string {
  // piStar uses the deprecated `toGMTString`, an alias of `toUTCString`.
  return date.toUTCString();
}

function pistarTypeOf(type: string | undefined, kind: string, metamodel: AnyMetamodel): string {
  if (type === undefined) {
    throw new PistarWriteError(
      `kind "${kind}" is not part of ${metamodel.name}; pass its metamodel (toPistar(model, { metamodel }) or withMetamodel)`,
    );
  }
  return type;
}

/**
 * `value` with its keys in the order `keys` gives (those present), then the rest as built (piStar's
 * order): an object read from a file is written back with the file's key order, and keys the
 * file lacked follow.
 */
function inSourceOrder<T extends object>(value: T, keys: readonly string[] | undefined): T {
  if (!keys) return value;
  const result: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of keys) if (key in record) result[key] = record[key];
  for (const key of Object.keys(record)) if (!(key in result)) result[key] = record[key];
  return result as T;
}

function elementJson(element: IstarElement<string>, metamodel: AnyMetamodel): PistarElementJson {
  return {
    id: element.id,
    text: element.name,
    type: pistarTypeOf(metamodel.elements.get(element.kind)?.pistarType, element.kind, metamodel),
    x: element.x,
    y: element.y,
    ...(element.customProperties ? { customProperties: { ...element.customProperties } } : {}),
  };
}

/** Builds the save-file object for a model. `toPistar` is this plus `JSON.stringify`. */
export function toPistarObject<EK extends string, LK extends string>(
  input: IstarModel<EK, LK>,
  options: ToPistarOptions = {},
): PistarFile {
  const model = input as unknown as AnyIstarModel;
  const metamodel: AnyMetamodel =
    options.metamodel ?? (metamodelOf(input) as unknown as AnyMetamodel);
  const isActorKind = (kind: string): boolean => metamodel.elements.get(kind)?.category === 'actor';
  // Hubs of n-ary links are written in their entry in `links`, not as elements.
  const isHub = (element: IstarElement<string>): boolean =>
    metamodel.elements.get(element.kind)?.role === 'hub';
  const actors: PistarActorJson[] = [];
  const orphans: PistarElementJson[] = [];
  const dependencies: PistarDependencyJson[] = [];
  const children = new Map<string, PistarElementJson[]>();
  const layout = layouts.get(model);
  const sourceOrder = <T extends object>(id: string, value: T): T =>
    inSourceOrder(value, layout?.objects?.get(id));

  for (const element of model.elements.values()) {
    if (isHub(element)) continue;
    if (element.parent !== undefined && !isActorKind(element.kind)) {
      let list = children.get(element.parent);
      if (!list) children.set(element.parent, (list = []));
      list.push(sourceOrder(element.id, { ...elementJson(element, metamodel), ...element.extra }));
    }
  }

  for (const element of model.elements.values()) {
    if (isHub(element)) continue;
    if (isActorKind(element.kind)) {
      actors.push(
        sourceOrder(element.id, {
          ...elementJson(element, metamodel),
          nodes: children.get(element.id) ?? [],
          ...element.extra,
        }),
      );
    } else if (element.isDependum) {
      // Like piStar, derive depender/dependee from the dependency links.
      const { inbound, outbound } = dependencyLinksOf(model, element.id);
      dependencies.push(
        sourceOrder(element.id, {
          ...elementJson(element, metamodel),
          source: inbound?.source ?? element.dependency?.source ?? '',
          target: outbound?.target ?? element.dependency?.target ?? '',
          ...element.extra,
        }),
      );
    } else if (element.parent === undefined || !model.elements.has(element.parent)) {
      orphans.push(
        sourceOrder(element.id, { ...elementJson(element, metamodel), ...element.extra }),
      );
    }
  }

  const linkJson = (link: IstarLink<string>): PistarLinkJson =>
    sourceOrder(link.id, {
      id: link.id,
      type: pistarTypeOf(metamodel.links.get(link.kind)?.pistarType, link.kind, metamodel),
      source: link.source,
      target: link.target,
      ...(link.name !== undefined ? { name: link.name } : {}),
      ...(link.customProperties ? { customProperties: { ...link.customProperties } } : {}),
      ...(link.label !== undefined ? { label: link.label } : {}),
      ...link.extra,
    });

  // Each hub's legs (in link order) and end; its entry goes where its first leg or end is.
  const hubs = new Map<string, { legs: IstarLink<string>[]; end?: IstarLink<string> }>();
  const partsOf = (hubId: string) => {
    let parts = hubs.get(hubId);
    if (!parts) hubs.set(hubId, (parts = { legs: [] }));
    return parts;
  };
  const hubOf = (link: IstarLink<string>): string | undefined => {
    const role = metamodel.links.get(link.kind)?.role;
    const id = role === 'leg' ? link.target : role === 'end' ? link.source : undefined;
    const hub = id === undefined ? undefined : model.elements.get(id);
    return hub && isHub(hub) ? hub.id : undefined;
  };
  for (const link of model.links.values()) {
    const hubId = hubOf(link);
    if (hubId === undefined) continue;
    const parts = partsOf(hubId);
    if (metamodel.links.get(link.kind)?.role === 'leg') parts.legs.push(link);
    else parts.end ??= link;
  }
  const hubEntry = (hub: IstarElement<string>): PistarHubLinkJson => {
    const parts = hubs.get(hub.id) ?? { legs: [] };
    const { [HUB_ENTRY_KEY]: entryExtra, ...hubExtra } = hub.extra ?? {};
    return sourceOrder(hubEntryLayoutKey(hub.id), {
      hub: sourceOrder(hub.id, {
        id: hub.id,
        type: pistarTypeOf(metamodel.elements.get(hub.kind)?.pistarType, hub.kind, metamodel),
        x: hub.x,
        y: hub.y,
        ...(hub.customProperties ? { customProperties: { ...hub.customProperties } } : {}),
        ...hubExtra,
      }),
      starts: parts.legs.map(linkJson),
      ...(parts.end ? { end: linkJson(parts.end) } : {}),
      ...(isRecord(entryExtra) ? entryExtra : {}),
    });
  };

  const links: (PistarLinkJson | PistarHubLinkJson)[] = [];
  const written = new Set<string>();
  for (const link of model.links.values()) {
    const hubId = hubOf(link);
    const parts = hubId === undefined ? undefined : hubs.get(hubId);
    // A second end of the same hub (an invalid model) is kept as a plain link.
    if (hubId === undefined || !parts || (!parts.legs.includes(link) && parts.end !== link)) {
      links.push(linkJson(link));
    } else if (!written.has(hubId)) {
      written.add(hubId);
      links.push(hubEntry(model.elements.get(hubId)!));
    }
  }
  // Hubs that lost every leg and their end still have an entry, so they aren't lost.
  for (const element of model.elements.values()) {
    if (isHub(element) && !written.has(element.id)) links.push(hubEntry(element));
  }

  const display: Record<string, Record<string, unknown>> = {};
  const displayOf = (id: string): Record<string, unknown> | undefined => {
    const owner = model.elements.get(id) ?? model.links.get(id);
    if (owner) return owner.display as Record<string, unknown> | undefined;
    return model.extraDisplay?.[id] as Record<string, unknown> | undefined;
  };
  for (const id of layout?.display ?? []) {
    const entry = displayOf(id);
    if (entry !== undefined) display[id] = { ...entry };
  }
  for (const owner of [...model.elements.values(), ...model.links.values()]) {
    if (owner.display && !(owner.id in display)) display[owner.id] = { ...owner.display };
  }
  for (const [id, entry] of Object.entries(model.extraDisplay ?? {})) {
    if (!(id in display)) display[id] = entry as Record<string, unknown>;
  }

  // A file that had no saveDate keeps none until a save passes one (an edit, as piStar does).
  let saveDate: string | undefined;
  if (options.saveDate instanceof Date) saveDate = formatDate(options.saveDate);
  else if (options.saveDate !== undefined || model.saveDate !== undefined)
    saveDate = options.saveDate ?? model.saveDate;
  else if (!layout || layout.keys.includes('saveDate')) saveDate = formatDate(new Date());

  const d = model.diagram;
  const diagram: PistarDiagramJson | undefined =
    d &&
    sourceOrder(DIAGRAM_LAYOUT_KEY, {
      ...(d.width !== undefined ? { width: d.width } : {}),
      ...(d.height !== undefined ? { height: d.height } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.customProperties ? { customProperties: { ...d.customProperties } } : {}),
      ...d.extra,
    });

  const values: Record<string, unknown> = {
    ...model.extra,
    actors,
    orphans,
    dependencies,
    links,
    display,
    tool: model.tool,
    istar: model.istar,
    saveDate,
    diagram,
  };

  // Files written by older piStar versions lack some sections (e.g. `orphans`). Keep them
  // absent while they are empty, so such files round-trip unchanged.
  if (layout) {
    for (const key of ['actors', 'orphans', 'dependencies', 'links', 'display'] as const) {
      const value = values[key] as unknown[] | Record<string, unknown>;
      const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
      if (empty && !layout.keys.includes(key)) values[key] = undefined;
    }
  }

  // Emit keys in the order they had in the source file (else the root metamodel's file order),
  // then any new ones in piStar's order.
  const order = [
    ...(layout?.keys ?? metamodel.file.keys ?? []),
    ...TOP_LEVEL_KEYS,
    ...Object.keys(model.extra ?? {}),
  ];
  const file: Record<string, unknown> = {};
  for (const key of order) {
    if (!(key in file) && values[key] !== undefined) file[key] = values[key];
  }
  return file as PistarFile;
}

/** Serializes a model to piStar's JSON text (2-space indentation, no trailing newline). */
export function toPistar<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  options?: ToPistarOptions,
): string {
  return JSON.stringify(toPistarObject(model, options), null, 2);
}

// ---------------------------------------------------------------------------------------------
// A model's own metamodel

/**
 * The constructs the model's file declares in its `"metamodel"` block, when they were applied
 * (read with `fileMetamodel: true`, or set with `withFileMetamodel`); `undefined` otherwise.
 * Kinds the host supplied are never part of it.
 */
export function fileMetamodelOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
): FileMetamodel | undefined {
  if (!hostMetamodelOf(model)) return undefined;
  return model.extra?.[FILE_METAMODEL_KEY] as FileMetamodel | undefined;
}

/**
 * A copy of `model` whose file declares `block` (`null` removes the block): its metamodel is the
 * host's extended by `block`, and `toPistar` writes the block. This is how a tool's "Add new"
 * construct joins a model. Throws `MetamodelError` if the block is malformed, collides with the
 * host's kinds, or leaves out a kind the model still uses.
 */
export function withFileMetamodel<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  block: FileMetamodel | null,
): IstarModel<string, string> {
  const any = model as unknown as AnyIstarModel;
  const host = hostMetamodelOf(any) ?? (metamodelOf(any) as unknown as AnyMetamodel);
  let next: AnyMetamodel = host;
  if (block) {
    validateFileMetamodel(block);
    next = extendMetamodel(host, fileMetamodelExtension(block));
  }
  for (const element of any.elements.values()) {
    if (!next.elements.has(element.kind)) {
      throw new MetamodelError(
        `element "${element.id}" uses kind "${element.kind}", which the new metamodel lacks`,
      );
    }
  }
  for (const link of any.links.values()) {
    if (!next.links.has(link.kind)) {
      throw new MetamodelError(
        `link "${link.id}" uses kind "${link.kind}", which the new metamodel lacks`,
      );
    }
  }
  const { [FILE_METAMODEL_KEY]: _previous, ...others } = any.extra ?? {};
  // Replacing keeps the block's place among the top-level keys.
  const extra = block ? { ...any.extra, [FILE_METAMODEL_KEY]: structuredClone(block) } : others;
  const { extra: _extra, ...rest } = any;
  const result: AnyIstarModel = inheritSourceLayout(any, {
    ...rest,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  });
  setHostMetamodel(result, block ? host : undefined);
  return withMetamodel(result, next);
}
