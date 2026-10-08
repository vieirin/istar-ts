/**
 * Reading and writing piStar save files, ported from `tool/app/istarcore/fileManager.js`.
 *
 * Output is produced with the same key order and `JSON.stringify(_, null, 2)` formatting as the
 * piStar web tool, so a file saved by piStar round-trips byte for byte. Keys this library does
 * not interpret are kept and written back.
 */
import type { ElementKind, LinkKind } from './metamodel';
import type { AnyMetamodel, Metamodel } from './metamodels';
import { ISTAR_2_0 } from './metamodels';
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
import { dependencyLinksOf, metamodelOf, withMetamodel } from './model';
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
  links?: PistarLinkJson[];
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
}

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
   * The metamodel whose kinds the file may use. Default iStar 2.0: any other `type` throws,
   * as in the piStar tool. The parsed model remembers it (see `metamodelOf`).
   */
  readonly metamodel?: Metamodel<EK, LK>;
}

export function parsePistar(input: string | PistarFile | Record<string, unknown>): IstarModel;
export function parsePistar<EK extends string, LK extends string>(
  input: string | PistarFile | Record<string, unknown>,
  options: ParsePistarOptions<EK, LK>,
): IstarModel<EK, LK>;
export function parsePistar(
  input: string | PistarFile | Record<string, unknown>,
  options: ParsePistarOptions<string, string> = {},
): AnyIstarModel {
  const metamodel: AnyMetamodel = options.metamodel ?? ISTAR_2_0;
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

  asArray(json.links, 'links').forEach((raw, i) => {
    if (!isRecord(raw)) throw new PistarParseError(`links[${i}]: expected an object`);
    const { id, type, source, target } = raw;
    if (typeof id !== 'string' || id === '')
      throw new PistarParseError(`links[${i}]: missing "id"`);
    const kind = typeof type === 'string' ? metamodel.linksByPistarType.get(type) : undefined;
    if (kind === undefined) {
      throw new PistarParseError(`links[${i}] (${id}): unknown link type ${JSON.stringify(type)}`);
    }
    if (typeof source !== 'string' || typeof target !== 'string') {
      throw new PistarParseError(`links[${i}] (${id}): missing "source" or "target"`);
    }
    if (elements.has(id) || links.has(id)) {
      throw new PistarParseError(`links[${i}]: duplicated id "${id}"`);
    }
    links.set(id, {
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
    });
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
  layouts.set(model, { keys: Object.keys(json), display: Object.keys(display) });
  return withMetamodel(model, metamodel);
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
   * lossless), or the current time for models that never had one. Pass `new Date()` when
   * saving an edited model, as piStar does.
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
  const actors: PistarActorJson[] = [];
  const orphans: PistarElementJson[] = [];
  const dependencies: PistarDependencyJson[] = [];
  const children = new Map<string, PistarElementJson[]>();

  for (const element of model.elements.values()) {
    if (element.parent !== undefined && !isActorKind(element.kind)) {
      let list = children.get(element.parent);
      if (!list) children.set(element.parent, (list = []));
      list.push({ ...elementJson(element, metamodel), ...element.extra });
    }
  }

  for (const element of model.elements.values()) {
    if (isActorKind(element.kind)) {
      actors.push({
        ...elementJson(element, metamodel),
        nodes: children.get(element.id) ?? [],
        ...element.extra,
      });
    } else if (element.isDependum) {
      // Like piStar, derive depender/dependee from the dependency links.
      const { inbound, outbound } = dependencyLinksOf(model, element.id);
      dependencies.push({
        ...elementJson(element, metamodel),
        source: inbound?.source ?? element.dependency?.source ?? '',
        target: outbound?.target ?? element.dependency?.target ?? '',
        ...element.extra,
      });
    } else if (element.parent === undefined || !model.elements.has(element.parent)) {
      orphans.push({ ...elementJson(element, metamodel), ...element.extra });
    }
  }

  const links: PistarLinkJson[] = [];
  for (const link of model.links.values()) {
    links.push({
      id: link.id,
      type: pistarTypeOf(metamodel.links.get(link.kind)?.pistarType, link.kind, metamodel),
      source: link.source,
      target: link.target,
      ...(link.name !== undefined ? { name: link.name } : {}),
      ...(link.customProperties ? { customProperties: { ...link.customProperties } } : {}),
      ...(link.label !== undefined ? { label: link.label } : {}),
      ...link.extra,
    });
  }

  const layout = layouts.get(model);
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

  let saveDate: string | undefined;
  if (options.saveDate instanceof Date) saveDate = formatDate(options.saveDate);
  else saveDate = options.saveDate ?? model.saveDate ?? formatDate(new Date());

  const d = model.diagram;
  const diagram: PistarDiagramJson | undefined = d && {
    ...(d.width !== undefined ? { width: d.width } : {}),
    ...(d.height !== undefined ? { height: d.height } : {}),
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.customProperties ? { customProperties: { ...d.customProperties } } : {}),
    ...d.extra,
  };

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

  // Emit keys in the order they had in the source file, then any new ones in piStar's order.
  const order = [...(layout?.keys ?? []), ...TOP_LEVEL_KEYS, ...Object.keys(model.extra ?? {})];
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
