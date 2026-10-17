import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  defineProperties,
  parsePistar,
  prop,
  toPistar,
  validateModelProperties,
  type HubPartKind,
  type PropertySchema,
} from '../src';
import { KAOS } from './dsm3-roots';
import { loadDsm3Fixtures } from './fixtures';

describe('prop.number with max 1 (probabilities)', () => {
  const p = prop.number({ min: 0, max: 1 });

  test('reads 0.2, .2 and 20.00% as the same value', () => {
    expect(p.percent).toBe(true);
    expect(p.parse('0.2')).toEqual({ ok: true, value: 0.2 });
    expect(p.parse('.2')).toEqual({ ok: true, value: 0.2 });
    expect(p.parse('20.00%')).toEqual({ ok: true, value: 0.2 });
    expect(p.parse('20 %')).toEqual({ ok: true, value: 0.2 });
  });

  test('checks the range after reading a percentage', () => {
    expect(p.parse('120%').ok).toBe(false);
    expect(p.parse('%').ok).toBe(false);
    expect(p.parse('x%').ok).toBe(false);
  });

  test('other numbers take no percentage', () => {
    const n = prop.number({ min: 0, max: 100 });
    expect(n.percent).toBeUndefined();
    expect(n.parse('20%').ok).toBe(false);
    expect(prop.number().parse('.5')).toEqual({ ok: true, value: 0.5 });
  });

  test('a new value is written in the form the old one was read in', () => {
    expect(p.serialize(0.35, '20.00%')).toBe('35.00%');
    expect(p.serialize(0.3333, '20%')).toBe('33.33%');
    expect(p.serialize(0.35, '.2')).toBe('.35');
    expect(p.serialize(0.35, '0.2')).toBe('0.35');
    expect(p.serialize(0.35)).toBe('0.35');
    expect(p.serialize(1, '.2')).toBe('1');
  });

  test('write keeps the string when the value is unchanged, and the form when it changes', () => {
    const schema = defineProperties('kaos.RefinementLinkStart', {
      Probability: prop.number({ min: 0, max: 1 }),
    });
    expect(schema.write({ Probability: '.2' }, { Probability: 0.2 })).toEqual({
      Probability: '.2',
    });
    expect(schema.write({ Probability: '20.00%' }, { Probability: 0.2 })).toEqual({
      Probability: '20.00%',
    });
    expect(schema.write({ Probability: '20.00%' }, { Probability: 0.8 })).toEqual({
      Probability: '80.00%',
    });
    expect(schema.write({}, { Probability: 0.8 })).toEqual({ Probability: '0.8' });
  });
});

describe('prop.reference', () => {
  const resolution = defineProperties('kaos.Conflict', {
    Anchor: prop.reference({ kinds: ['kaos.BehavioralGoal'], optional: true }),
  });
  const model = parsePistar(
    JSON.stringify({
      actors: [],
      orphans: [
        { id: 'g1', text: 'G1', type: 'kaos.BehavioralGoal', x: 0, y: 0 },
        { id: 'g2', text: 'G2', type: 'kaos.BehavioralGoal', x: 0, y: 0 },
        { id: 'a1', text: 'A1', type: 'kaos.Agent', x: 0, y: 0 },
      ],
      dependencies: [],
      links: [
        {
          id: 'ok',
          type: 'kaos.Conflict',
          source: 'g1',
          target: 'g2',
          customProperties: { Anchor: 'g2' },
        },
        {
          id: 'gone',
          type: 'kaos.Conflict',
          source: 'g2',
          target: 'g1',
          customProperties: { Anchor: 'g9' },
        },
        {
          id: 'kind',
          type: 'kaos.Conflict',
          source: 'g1',
          target: 'a1',
          customProperties: { Anchor: 'a1' },
        },
        {
          id: 'empty',
          type: 'kaos.Conflict',
          source: 'a1',
          target: 'g2',
          customProperties: { Anchor: '' },
        },
      ],
      display: {},
      tool: 'dsm3-goals',
    }),
    { metamodel: KAOS },
  );

  test('a schema reads the id as a string', () => {
    expect(resolution.shape.Anchor.type).toBe('reference');
    expect(resolution.shape.Anchor.kinds).toEqual(['kaos.BehavioralGoal']);
    expect(resolution.read({ Anchor: 'g2' }).values).toEqual({ Anchor: 'g2' });
    expectTypeOf(resolution.read({}).values.Anchor).toEqualTypeOf<string | undefined>();
  });

  test('validateModelProperties reports a dangling id and a wrong kind', () => {
    expect(validateModelProperties(model, [resolution])).toEqual([
      { id: 'gone', key: 'Anchor', message: 'refers to "g9", which is not in the model' },
      { id: 'kind', key: 'Anchor', message: 'must refer to a kaos.BehavioralGoal' },
    ]);
  });

  test('a required reference must not be empty', () => {
    const required = defineProperties('kaos.Conflict', { Anchor: prop.reference() });
    expect(required.validate({ Anchor: '' })).toEqual([
      { key: 'Anchor', message: 'must be an element or link id' },
    ]);
  });
});

describe("properties on an n-ary link's legs", () => {
  test('a DSM3 leg keeps its customProperties through a round trip', () => {
    const welcome = loadDsm3Fixtures().find((f) => f.name === 'dsm3/kaos-welcome.txt')!.text;
    const legId = 'f8b1586c-e17e-4435-84be-3e08d02f2195';
    const json = JSON.parse(welcome);
    const leg = json.links[0].starts[0];
    expect(leg.id).toBe(legId);
    leg.customProperties = { Probability: '.8' };
    const text = JSON.stringify(json, null, 2);

    const model = parsePistar(text, { metamodel: KAOS });
    expect(model.links.get(legId)?.kind).toBe('kaos.RefinementLinkStart');
    expect(model.links.get(legId)?.customProperties).toEqual({ Probability: '.8' });
    expect(toPistar(model)).toBe(text);

    const legs = defineProperties('kaos.RefinementLinkStart', {
      Probability: prop.number({ min: 0, max: 1 }),
    });
    expect(legs.read(model.links.get(legId)!).values).toEqual({ Probability: 0.8 });
    expect(validateModelProperties(model, [legs])).toEqual(
      [...model.links.values()]
        .filter((l) => l.kind === 'kaos.RefinementLinkStart' && l.id !== legId)
        .map((l) => ({ id: l.id, key: 'Probability', message: 'is required' })),
    );
  });

  test('generated kind names type like any kind', () => {
    expectTypeOf<HubPartKind<'kaos.RefinementLink'>>().toEqualTypeOf<
      'kaos.RefinementLinkHub' | 'kaos.RefinementLinkStart' | 'kaos.RefinementLinkEnd'
    >();
    const legs = defineProperties(
      'kaos.RefinementLinkStart' satisfies HubPartKind<'kaos.RefinementLink'>,
      {
        Probability: prop.number(),
      },
    );
    expectTypeOf(legs).toExtend<
      PropertySchema<{ Probability: ReturnType<typeof prop.number> }, 'kaos.RefinementLinkStart'>
    >();
  });
});
