import type { ElementKind, LinkKind } from './metamodel';
import type { CustomProperties, IstarModel } from './model';

export type PropertyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PropertyOptions<T> {
  default?: T;
  optional?: boolean;
  label?: string;
  description?: string;
}

export interface PropertyType<T> {
  readonly type: 'string' | 'number' | 'boolean' | 'enum';
  readonly options: PropertyOptions<T>;
  readonly values?: readonly string[];
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
  parse(raw: string): PropertyResult<T>;
  serialize(value: T): string;
}

export function string(options?: PropertyOptions<string>): PropertyType<string> {
  const opts: PropertyOptions<string> = options ?? {};
  return {
    type: 'string',
    options: opts,
    parse(raw: string): PropertyResult<string> {
      return { ok: true, value: raw };
    },
    serialize(value: string): string {
      return value;
    },
  };
}

export function number(
  options?: PropertyOptions<number> & { integer?: boolean; min?: number; max?: number },
): PropertyType<number> {
  const opts: PropertyOptions<number> = options ?? {};
  const integer = options?.integer;
  const min = options?.min;
  const max = options?.max;
  return {
    type: 'number',
    options: opts,
    integer,
    min,
    max,
    parse(raw: string): PropertyResult<number> {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, error: 'must be a finite number' };
      }
      if (integer && !Number.isInteger(value)) {
        return { ok: false, error: 'must be an integer' };
      }
      if (min !== undefined && value < min) {
        return { ok: false, error: `must be at least ${min}` };
      }
      if (max !== undefined && value > max) {
        return { ok: false, error: `must be at most ${max}` };
      }
      return { ok: true, value };
    },
    serialize(value: number): string {
      return String(value);
    },
  };
}

export function boolean(options?: PropertyOptions<boolean>): PropertyType<boolean> {
  const opts: PropertyOptions<boolean> = options ?? {};
  return {
    type: 'boolean',
    options: opts,
    parse(raw: string): PropertyResult<boolean> {
      if (raw === 'true') return { ok: true, value: true };
      if (raw === 'false') return { ok: true, value: false };
      return { ok: false, error: 'must be true or false' };
    },
    serialize(value: boolean): string {
      return value ? 'true' : 'false';
    },
  };
}

export function enumOf<const V extends readonly string[]>(
  values: V,
  options?: PropertyOptions<V[number]>,
): PropertyType<V[number]> {
  const opts: PropertyOptions<V[number]> = options ?? {};
  return {
    type: 'enum',
    options: opts,
    values,
    parse(raw: string): PropertyResult<V[number]> {
      if ((values as readonly string[]).includes(raw)) {
        return { ok: true, value: raw as V[number] };
      }
      return { ok: false, error: `must be one of: ${values.join(', ')}` };
    },
    serialize(value: V[number]): string {
      return value;
    },
  };
}

export const prop: {
  string: typeof string;
  number: typeof number;
  boolean: typeof boolean;
  enum: typeof enumOf;
} = {
  string,
  number,
  boolean,
  enum: enumOf,
};

export type PropertyShape = Record<string, PropertyType<unknown>>;

export type InferProperties<S extends PropertyShape> = {
  [K in keyof S]: S[K] extends PropertyType<infer T> ? T : never;
};

export interface PropertyIssue {
  key: string;
  message: string;
}

/**
 * Typed custom properties of one element or link kind. `K` is the kind: iStar 2.0's kinds by
 * default; any extension kind (see `extendMetamodel`) is accepted too.
 */
export interface PropertySchema<
  S extends PropertyShape = PropertyShape,
  K extends string = ElementKind | LinkKind,
> {
  readonly kind: K;
  readonly shape: S;
  read(source: CustomProperties | undefined | PropertyOwner): {
    values: Partial<InferProperties<S>>;
    issues: PropertyIssue[];
  };
  validate(source: CustomProperties | undefined | PropertyOwner): PropertyIssue[];
  write(
    current: CustomProperties | undefined,
    patch: { [K in keyof S]?: InferProperties<S>[K] | undefined },
  ): CustomProperties;
  defaults(): CustomProperties;
}

/** An element or link, read through its `customProperties`. */
export interface PropertyOwner {
  readonly kind: string;
  readonly customProperties?: CustomProperties;
}

export interface ModelPropertyIssue extends PropertyIssue {
  id: string;
}

type PropertySource = CustomProperties | undefined | PropertyOwner;

function isCustomPropertiesRecord(source: NonNullable<PropertySource>): source is CustomProperties {
  // Elements and links are passed whole, possibly without `customProperties`; recognize them by
  // their `istar.*` kind and numeric/structural fields a bag of strings can't have.
  if ('customProperties' in source) return false;
  const owner = source as { kind?: unknown; x?: unknown; source?: unknown; target?: unknown };
  const isModelObject =
    typeof owner.kind === 'string' &&
    owner.kind.startsWith('istar.') &&
    (typeof owner.x === 'number' || (owner.source !== undefined && owner.target !== undefined));
  return !isModelObject;
}

function resolveCustomProperties(source: PropertySource): CustomProperties | undefined {
  if (source === undefined) return undefined;
  if (isCustomPropertiesRecord(source)) return source;
  return source.customProperties;
}

function isRequired(options: PropertyOptions<unknown>): boolean {
  return options.optional !== true && options.default === undefined;
}

function emptyMeansAbsent(
  type: PropertyType<unknown>['type'],
  optional: boolean | undefined,
): boolean {
  return type !== 'string' && optional === true;
}

function readShape<S extends PropertyShape>(
  shape: S,
  source: PropertySource,
): { values: Partial<InferProperties<S>>; issues: PropertyIssue[] } {
  const custom = resolveCustomProperties(source);
  const values: Partial<InferProperties<S>> = {};
  const issues: PropertyIssue[] = [];

  for (const key of Object.keys(shape) as (keyof S & string)[]) {
    const field = shape[key];
    if (!field) continue;
    const opts = field.options;
    const hasKey = custom !== undefined && Object.prototype.hasOwnProperty.call(custom, key);
    const raw = hasKey ? custom[key] : undefined;

    if (raw === undefined) {
      if (opts.default !== undefined) {
        (values as Record<string, unknown>)[key] = opts.default;
      } else if (isRequired(opts)) {
        issues.push({ key, message: 'is required' });
      }
      continue;
    }

    if (raw === '' && field.type !== 'string') {
      if (emptyMeansAbsent(field.type, opts.optional)) {
        if (opts.default !== undefined) {
          (values as Record<string, unknown>)[key] = opts.default;
        }
        continue;
      }
      issues.push({
        key,
        message:
          field.type === 'boolean'
            ? 'must be true or false'
            : field.type === 'enum'
              ? `must be one of: ${field.values?.join(', ') ?? ''}`
              : 'must be a finite number',
      });
      continue;
    }

    const parsed = field.parse(raw);
    if (!parsed.ok) {
      issues.push({ key, message: parsed.error });
      continue;
    }
    (values as Record<string, unknown>)[key] = parsed.value;
  }

  return { values, issues };
}

export function defineProperties<
  const S extends PropertyShape,
  const Kind extends string = ElementKind | LinkKind,
>(
  kind: Kind,
  shape: S,
  options?: { validate?: (values: Partial<InferProperties<S>>) => PropertyIssue[] },
): PropertySchema<S, Kind> {
  const crossValidate = options?.validate;

  return {
    kind,
    shape,
    read(source: PropertySource): { values: Partial<InferProperties<S>>; issues: PropertyIssue[] } {
      return readShape(shape, source);
    },
    validate(source: PropertySource): PropertyIssue[] {
      const { values, issues } = readShape(shape, source);
      const cross = crossValidate ? crossValidate(values) : [];
      return [...issues, ...cross];
    },
    write(
      current: CustomProperties | undefined,
      patch: { [K in keyof S]?: InferProperties<S>[K] | undefined },
    ): CustomProperties {
      const result: Record<string, string> = {};
      const seen = new Set<string>();

      if (current) {
        for (const [key, value] of Object.entries(current)) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) {
            const patched = patch[key as keyof S];
            if (patched === undefined) {
              continue;
            }
            const field = shape[key];
            if (field) {
              result[key] = field.serialize(patched as never);
            }
          } else {
            result[key] = value;
          }
          seen.add(key);
        }
      }

      for (const key of Object.keys(shape) as (keyof S & string)[]) {
        if (seen.has(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        const patched = patch[key];
        if (patched === undefined) continue;
        const field = shape[key];
        if (field) {
          result[key] = field.serialize(patched as never);
        }
      }

      return result;
    },
    defaults(): CustomProperties {
      const result: Record<string, string> = {};
      for (const key of Object.keys(shape) as (keyof S & string)[]) {
        const field = shape[key];
        if (!field) continue;
        const def = field.options.default;
        if (def !== undefined) {
          result[key] = field.serialize(def as never);
        }
      }
      return result;
    },
  };
}

export function validateModelProperties<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  schemas: readonly PropertySchema<PropertyShape, string>[],
): ModelPropertyIssue[] {
  const byKind = new Map<string, PropertySchema<PropertyShape, string>[]>();
  for (const schema of schemas) {
    const list = byKind.get(schema.kind) ?? [];
    list.push(schema);
    byKind.set(schema.kind, list);
  }

  const issues: ModelPropertyIssue[] = [];

  for (const element of model.elements.values()) {
    const kindSchemas = byKind.get(element.kind);
    if (!kindSchemas) continue;
    for (const schema of kindSchemas) {
      for (const issue of schema.validate(element)) {
        issues.push({ ...issue, id: element.id });
      }
    }
  }

  for (const link of model.links.values()) {
    const kindSchemas = byKind.get(link.kind);
    if (!kindSchemas) continue;
    for (const schema of kindSchemas) {
      for (const issue of schema.validate(link)) {
        issues.push({ ...issue, id: link.id });
      }
    }
  }

  return issues;
}
