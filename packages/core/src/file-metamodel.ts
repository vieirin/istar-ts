/**
 * A model file's own metamodel: the top-level `"metamodel"` block, in which a file declares the
 * constructs it adds to iStar (as piStar-ext's "Add new" creates them), so they travel with the
 * model instead of living only in a tool's localStorage.
 *
 * The block has the shape `extendMetamodel` takes (`MetamodelExtension`), as JSON: no `check`
 * predicates, and presentation hints (`shape`, `textBox`, `line`) kept as data. Keys this
 * library doesn't know, in the block or in any entry, are left alone (hosts keep dialect data,
 * such as stereotypes, beside it) and are written back unchanged.
 */
import type { ElementKindDeclaration, LinkKindDeclaration, MetamodelExtension } from './metamodels';
import { MetamodelError } from './metamodels';

/** The top-level key of the block in piStar JSON. */
export const FILE_METAMODEL_KEY = 'metamodel';

export interface FileElementKind extends Omit<ElementKindDeclaration<string>, 'info'> {
  readonly info?: {
    readonly canBeInnerElement?: boolean;
    readonly canBeDependum?: boolean;
    readonly canBeOnPaper?: boolean;
  };
  readonly [key: string]: unknown;
}

export interface FileLinkKind extends Omit<LinkKindDeclaration<string>, 'check'> {
  readonly [key: string]: unknown;
}

/** The `"metamodel"` block of a model file. */
export interface FileMetamodel {
  /** Identifies the constructs' dialect, e.g. `iStar4RationalAgents`. */
  readonly name: string;
  readonly elements?: readonly FileElementKind[];
  readonly links?: readonly FileLinkKind[];
  readonly [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new MetamodelError(`${path} ${message}`);
}

function optionalString(entry: Record<string, unknown>, key: string, path: string): void {
  if (entry[key] !== undefined && typeof entry[key] !== 'string') {
    fail(`${path}.${key}`, 'must be a string');
  }
}

function optionalBoolean(entry: Record<string, unknown>, key: string, path: string): void {
  if (entry[key] !== undefined && typeof entry[key] !== 'boolean') {
    fail(`${path}.${key}`, 'must be true or false');
  }
}

function checkSize(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, 'must be an object { width, height }');
  for (const key of ['width', 'height']) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      fail(`${path}.${key}`, 'must be a positive number');
    }
  }
}

function checkShape(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, 'must be an object { path, viewBox? }');
  if (typeof value.path !== 'string' || value.path.trim() === '') {
    fail(`${path}.path`, 'must be SVG path data');
  }
  optionalString(value, 'viewBox', path);
}

function checkTextBox(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, 'must be an object { top, right, bottom, left }');
  for (const key of ['top', 'right', 'bottom', 'left']) {
    const n = value[key];
    if (typeof n !== 'number' || n < 0 || n >= 1) {
      fail(`${path}.${key}`, 'must be a fraction from 0 (inclusive) to 1 (exclusive)');
    }
  }
}

function checkLine(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, 'must be an object { dash?, marker?, markerFilled? }');
  optionalString(value, 'dash', path);
  if (value.marker !== undefined && value.marker !== false && typeof value.marker !== 'string') {
    fail(`${path}.marker`, 'must be SVG path data or false');
  }
  optionalBoolean(value, 'markerFilled', path);
}

function checkStringList(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string')) {
    fail(path, 'must be a non-empty list of kind names or categories');
  }
}

function checkRules(value: unknown, path: string): void {
  if (!isObject(value)) fail(path, 'must be an object { sources, targets, … }');
  checkStringList(value.sources, `${path}.sources`);
  checkStringList(value.targets, `${path}.targets`);
  for (const key of ['sameActor', 'allowDependum', 'allowSelf']) optionalBoolean(value, key, path);
  if (value.unique !== undefined && !['kind', 'any', false].includes(value.unique as never)) {
    fail(`${path}.unique`, 'must be "kind", "any" or false');
  }
}

/**
 * Checks that `value` is a well-formed `"metamodel"` block and returns it typed. Throws
 * `MetamodelError` naming the offending path (`metamodel.elements[1].kind must be a string`).
 * Whether its kinds fit a given metamodel (namespacing, collisions, `behavesLike` targets) is
 * checked when it is applied, by `extendMetamodel`.
 */
export function validateFileMetamodel(
  value: unknown,
  path: string = FILE_METAMODEL_KEY,
): FileMetamodel {
  if (!isObject(value)) fail(path, 'must be an object { name, elements?, links? }');
  if (typeof value.name !== 'string' || value.name === '')
    fail(`${path}.name`, 'must be a non-empty string');
  for (const [listKey, kind] of [
    ['elements', 'element'],
    ['links', 'link'],
  ] as const) {
    const list = value[listKey];
    if (list === undefined) continue;
    if (!Array.isArray(list)) fail(`${path}.${listKey}`, 'must be a list');
    list.forEach((entry: unknown, i) => {
      const at = `${path}.${listKey}[${i}]`;
      if (!isObject(entry)) fail(at, `must be an object describing a ${kind} kind`);
      if (typeof entry.kind !== 'string' || entry.kind === '')
        fail(`${at}.kind`, 'must be a string');
      optionalString(entry, 'label', at);
      optionalString(entry, 'behavesLike', at);
      optionalString(entry, 'pistarType', at);
      if (kind === 'element') {
        if (
          entry.category !== undefined &&
          entry.category !== 'node' &&
          entry.category !== 'actor'
        ) {
          fail(`${at}.category`, 'must be "node" or "actor"');
        }
        checkSize(entry.size, `${at}.size`);
        if (entry.info !== undefined) {
          if (!isObject(entry.info)) fail(`${at}.info`, 'must be an object');
          for (const key of ['canBeInnerElement', 'canBeDependum', 'canBeOnPaper']) {
            optionalBoolean(entry.info, key, `${at}.info`);
          }
        }
        checkShape(entry.shape, `${at}.shape`);
        checkTextBox(entry.textBox, `${at}.textBox`);
      } else {
        if (
          entry.category !== undefined &&
          !['node', 'actor', 'dependency'].includes(entry.category as string)
        ) {
          fail(`${at}.category`, 'must be "node", "actor" or "dependency"');
        }
        if (entry.rules !== undefined) checkRules(entry.rules, `${at}.rules`);
        if ('check' in entry) fail(`${at}.check`, 'cannot be stored in a file (it is code)');
        if (entry.info !== undefined && !isObject(entry.info))
          fail(`${at}.info`, 'must be an object');
        checkLine(entry.line, `${at}.line`);
      }
    });
  }
  return value as FileMetamodel;
}

/** The block as an extension `extendMetamodel` applies (it ignores the extra keys). */
export function fileMetamodelExtension(block: FileMetamodel): MetamodelExtension<string, string> {
  return block as unknown as MetamodelExtension<string, string>;
}
