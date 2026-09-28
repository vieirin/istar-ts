import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  boolean,
  defineProperties,
  enumOf,
  number,
  prop,
  string,
  validateModelProperties,
  type InferProperties,
} from '../src';
import { parsePistar } from '../src';
import { loadFixtures } from './fixtures';

describe('property types', () => {
  test('string', () => {
    const t = string();
    expect(t.parse('hello')).toEqual({ ok: true, value: 'hello' });
    expect(t.serialize('hello')).toBe('hello');
    expect(t.parse('')).toEqual({ ok: true, value: '' });
  });

  test('number', () => {
    const t = number({ integer: true, min: 0, max: 10 });
    expect(t.parse('3')).toEqual({ ok: true, value: 3 });
    expect(t.serialize(3)).toBe('3');
    expect(t.parse('3.5').ok).toBe(false);
    expect(t.parse('NaN').ok).toBe(false);
    expect(t.parse('-1').ok).toBe(false);
    expect(t.parse('11').ok).toBe(false);
  });

  test('boolean', () => {
    const t = boolean();
    expect(t.parse('true')).toEqual({ ok: true, value: true });
    expect(t.parse('false')).toEqual({ ok: true, value: false });
    expect(t.serialize(true)).toBe('true');
    expect(t.serialize(false)).toBe('false');
    expect(t.parse('yes').ok).toBe(false);
    expect(t.parse('True').ok).toBe(false);
  });

  test('enum', () => {
    const t = enumOf(['a', 'b'] as const);
    expect(t.parse('a')).toEqual({ ok: true, value: 'a' });
    expect(t.serialize('b')).toBe('b');
    expect(t.parse('c').ok).toBe(false);
  });

  test('prop namespace', () => {
    expect(prop.string).toBe(string);
    expect(prop.number).toBe(number);
    expect(prop.boolean).toBe(boolean);
    expect(prop.enum).toBe(enumOf);
  });
});

describe('defineProperties', () => {
  test('defaults applied when key missing', () => {
    const schema = defineProperties('istar.Goal', {
      count: number({ default: 0 }),
    });
    const { values, issues } = schema.read(undefined);
    expect(values).toEqual({ count: 0 });
    expect(issues).toEqual([]);
    expect(schema.defaults()).toEqual({ count: '0' });
  });

  test('required missing key', () => {
    const schema = defineProperties('istar.Task', {
      name: string(),
    });
    const { values, issues } = schema.read({});
    expect(values).toEqual({});
    expect(issues).toEqual([{ key: 'name', message: 'is required' }]);
  });

  test('optional missing key', () => {
    const schema = defineProperties('istar.Task', {
      note: string({ optional: true }),
    });
    expect(schema.read({}).issues).toEqual([]);
    expect(schema.validate({})).toEqual([]);
  });

  test('empty string on number/boolean/enum', () => {
    const schema = defineProperties('istar.Resource', {
      n: number(),
      b: boolean(),
      e: enumOf(['x'] as const),
    });
    expect(schema.read({ n: '', b: '', e: '' }).issues).toHaveLength(3);

    const optional = defineProperties('istar.Resource', {
      n: number({ optional: true }),
      b: boolean({ optional: true }),
      e: enumOf(['x'] as const, { optional: true }),
    });
    expect(optional.read({ n: '', b: '', e: '' }).issues).toEqual([]);
    expect(optional.read({ n: '', b: '', e: '' }).values).toEqual({});
  });

  test('write preserves unknown keys and order', () => {
    const schema = defineProperties('istar.Resource', {
      type: prop.enum(['bool', 'int'] as const),
    });
    const current = { z: '1', type: 'bool', extra: 'keep' };
    expect(schema.write(current, { type: 'int' })).toEqual({
      z: '1',
      type: 'int',
      extra: 'keep',
    });
  });

  test('write deletes keys when patch value is undefined', () => {
    const schema = defineProperties('istar.Resource', {
      type: prop.enum(['bool', 'int'] as const),
      initialValue: prop.string({ optional: true }),
    });
    const current = { type: 'bool', initialValue: 'false', other: 'x' };
    expect(schema.write(current, { initialValue: undefined })).toEqual({
      type: 'bool',
      other: 'x',
    });
  });

  test('write appends new schema keys at end', () => {
    const schema = defineProperties('istar.Resource', {
      type: prop.enum(['bool', 'int'] as const),
      initialValue: prop.string(),
    });
    expect(schema.write({ a: '1' }, { type: 'bool', initialValue: 'x' })).toEqual({
      a: '1',
      type: 'bool',
      initialValue: 'x',
    });
  });

  test('read from wrapper object', () => {
    const schema = defineProperties('istar.Goal', { x: string({ default: 'd' }) });
    expect(schema.read({ customProperties: {} }).values).toEqual({ x: 'd' });
  });

  test('cross-field validate', () => {
    const resourceSchema = defineProperties(
      'istar.Resource',
      {
        type: prop.enum(['bool', 'int'] as const),
        initialValue: prop.string(),
      },
      {
        validate: (v) =>
          v.type === 'bool' &&
          v.initialValue !== undefined &&
          !['true', 'false'].includes(v.initialValue)
            ? [{ key: 'initialValue', message: 'must be true or false' }]
            : v.type === 'int' && v.initialValue !== undefined && !/^-?\d+$/.test(v.initialValue)
              ? [{ key: 'initialValue', message: 'must be an integer' }]
              : [],
      },
    );

    expect(
      resourceSchema.validate({
        type: 'bool',
        initialValue: 'maybe',
      }),
    ).toEqual([{ key: 'initialValue', message: 'must be true or false' }]);

    expect(
      resourceSchema.validate({
        type: 'int',
        initialValue: '3.14',
      }),
    ).toEqual([{ key: 'initialValue', message: 'must be an integer' }]);

    expect(
      resourceSchema.validate({
        type: 'int',
        initialValue: '42',
      }),
    ).toEqual([]);
  });

  test('InferProperties', () => {
    const shape = {
      type: prop.enum(['bool', 'int'] as const),
      initialValue: prop.string(),
      count: number({ optional: true }),
    };
    type Values = InferProperties<typeof shape>;
    expectTypeOf<Values>().toEqualTypeOf<{
      type: 'bool' | 'int';
      initialValue: string;
      count: number;
    }>();
  });
});

describe('validateModelProperties', () => {
  test('multiple schemas for the same kind', () => {
    const a = defineProperties('istar.Goal', { a: string() });
    const b = defineProperties('istar.Goal', { b: string() });
    const model = parsePistar(
      JSON.stringify({
        actors: [],
        orphans: [
          {
            id: 'g1',
            text: 'G',
            type: 'istar.Goal',
            x: 0,
            y: 0,
          },
        ],
        dependencies: [],
        links: [],
        display: {},
      }),
    );
    const issues = validateModelProperties(model, [a, b]);
    expect(issues).toEqual([
      { id: 'g1', key: 'a', message: 'is required' },
      { id: 'g1', key: 'b', message: 'is required' },
    ]);
  });
});

describe('fixture no-op writes', () => {
  test.each(loadFixtures().map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const model = parsePistar(fixture.text);
    for (const owner of model.elements.values()) {
      if (!owner.customProperties) continue;
      const schema = defineProperties(owner.kind, {});
      expect(schema.write(owner.customProperties, {})).toEqual(owner.customProperties);
    }
  });
});
