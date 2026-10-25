import {
  ISTAR_2_0,
  MetamodelError,
  canLink,
  createModelStore,
  detectFramework,
  extendMetamodel,
  hubLinkOf,
  parsePistar,
  toPistar,
  validateModel,
  validateModelProperties,
} from '@istar-ts/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NFR } from '../../dsm3-nfr/src';
import {
  KAOS,
  KAOS_OBSTACLES,
  KAOS_OBSTACLE_PROPERTY_SCHEMAS,
  KAOS_PROPERTY_SCHEMAS,
  domainPropertyProperties,
  kaosObstacleAnalysis,
  obstacleProperties,
  resolutionProperties,
} from '../src';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '../../../fixtures/dsm3', name), 'utf8');

describe('the obstacle analysis extension', () => {
  it('adds obstacles and their links to KAOS, saved as kaos.* types', () => {
    const types = (kinds: ReadonlyMap<string, { pistarType: string }>, prefix: string) =>
      [...kinds.values()].filter((d) => d.pistarType.startsWith(prefix)).map((d) => d.pistarType);
    expect(KAOS_OBSTACLES.framework).toBe(KAOS.framework);
    expect(KAOS_OBSTACLES.extensions).toEqual(['kaosObstacles']);
    expect(types(KAOS_OBSTACLES.elements, 'kaos.Obstacle')).toEqual([
      'kaos.Obstacle',
      'kaos.ObstacleRefinementLinkHub',
    ]);
    expect(types(KAOS_OBSTACLES.links, 'kaos.Obst')).toEqual([
      'kaos.ObstacleRefinementLink',
      'kaos.ObstacleRefinementLinkStart',
      'kaos.ObstacleRefinementLinkEnd',
      'kaos.ObstructionLink',
    ]);
    expect(KAOS_OBSTACLES.links.get('kaosObstacles.ResolutionLink')?.pistarType).toBe(
      'kaos.ResolutionLink',
    );
    expect(KAOS_OBSTACLES.links.get('kaosObstacles.ObstacleRefinementLink')?.arity).toBe('n');
  });

  it('gives every KAOS_OBSTACLES element and link kind a non-empty description', () => {
    for (const definition of KAOS_OBSTACLES.elements.values()) {
      expect(definition.description).toMatch(/\S/);
    }
    for (const definition of KAOS_OBSTACLES.links.values()) {
      expect(definition.description).toMatch(/\S/);
    }
  });

  it('cannot name its kinds under the root’s kaos. prefix', () => {
    expect(() =>
      extendMetamodel(KAOS, {
        name: 'x',
        elements: [{ kind: 'kaos.Obstacle', category: 'node' }],
      }),
    ).toThrow(MetamodelError);
    expect(extendMetamodel(KAOS, kaosObstacleAnalysis).elements.size).toBe(
      KAOS_OBSTACLES.elements.size,
    );
  });

  it('declares text keys only, as DSM3 does', () => {
    expect(obstacleProperties.defaults()).toEqual({
      Description: '',
      FormalSpec: '',
      Category: '',
    });
    expect(resolutionProperties.defaults()).toEqual({ ResolutionType: '', Anchor: '' });
    for (const schema of KAOS_OBSTACLE_PROPERTY_SCHEMAS) {
      for (const field of Object.values(schema.shape)) expect(field.type).toBe('string');
    }
  });

  it('gives Domain property an optional Kind and FormalSpec with no default, so DSM3 files are unchanged', () => {
    expect(domainPropertyProperties.defaults()).toEqual({});
    expect(domainPropertyProperties.validate({ Description: '' })).toEqual([]);
    expect(domainPropertyProperties.read({ Kind: 'hypothesis' }).values).toEqual({
      Kind: 'hypothesis',
    });
    expect(domainPropertyProperties.read({ FormalSpec: 'always (p => q)' }).values).toEqual({
      FormalSpec: 'always (p => q)',
    });
  });
});

describe('obstacle analysis rules', () => {
  function setup() {
    const store = createModelStore(undefined, { metamodel: KAOS_OBSTACLES });
    const add = (kind: Parameters<typeof store.addElement>[0]['kind']) =>
      store.addElement({ kind, x: 0, y: 0 }).id;
    return {
      store,
      goal: add('kaos.BehavioralGoal'),
      softgoal: add('kaos.Softgoal'),
      agent: add('kaos.Agent'),
      domain: add('kaos.DomainProperty'),
      obstacle: add('kaosObstacles.Obstacle'),
      sub: add('kaosObstacles.Obstacle'),
    };
  }
  const ok = (check: { ok: boolean }) => check.ok;

  it('an obstacle obstructs a goal or a domain property, once per pair', () => {
    const { store, goal, softgoal, domain, agent, obstacle } = setup();
    const can = (s: string, t: string) =>
      ok(canLink(store.getModel(), s, t, 'kaosObstacles.ObstructionLink'));
    expect(can(obstacle, goal)).toBe(true);
    expect(can(obstacle, softgoal)).toBe(true);
    expect(can(obstacle, domain)).toBe(true);
    expect(can(obstacle, agent)).toBe(false);
    expect(can(goal, obstacle)).toBe(false);
    store.connect({ kind: 'kaosObstacles.ObstructionLink', source: obstacle, target: goal });
    expect(can(obstacle, goal)).toBe(false);
  });

  it('a goal resolves an obstacle', () => {
    const { store, goal, agent, obstacle } = setup();
    const can = (s: string, t: string) =>
      ok(canLink(store.getModel(), s, t, 'kaosObstacles.ResolutionLink'));
    expect(can(goal, obstacle)).toBe(true);
    expect(can(obstacle, goal)).toBe(false);
    expect(can(agent, obstacle)).toBe(false);
  });

  it('sub-obstacles and domain properties refine an obstacle through a hub', () => {
    const { store, obstacle, sub, domain, goal } = setup();
    const first = store.connect({
      kind: 'kaosObstacles.ObstacleRefinementLink',
      source: sub,
      target: obstacle,
    });
    if (!first.ok) throw new Error(first.reason);
    const hub = first.hub!.hub.id;
    // Connecting to the hub adds a leg.
    const leg = store.connect({
      kind: 'kaosObstacles.ObstacleRefinementLink',
      source: domain,
      target: hub,
    });
    expect(leg.ok).toBe(true);
    expect(hubLinkOf(store.getModel(), hub)?.legs).toHaveLength(2);
    expect(
      ok(canLink(store.getModel(), goal, obstacle, 'kaosObstacles.ObstacleRefinementLink')),
    ).toBe(false);
    expect(validateModel(store.getModel())).toEqual([]);
  });
});

describe('kaos-las.txt (KAOSTools’ LAS with obstacle analysis)', () => {
  const text = fixture('kaos-las.txt');
  const model = parsePistar(text, { metamodel: KAOS_OBSTACLES });
  const count = (kind: string) =>
    [...model.elements.values(), ...model.links.values()].filter((x) => x.kind === kind).length;

  it('round-trips byte for byte', () => {
    expect(toPistar(model)).toBe(text);
  });

  it('is a valid KAOS file, detected as KAOS', () => {
    expect(detectFramework(text, [ISTAR_2_0, KAOS, NFR])).toBe(KAOS);
    expect(validateModel(model)).toEqual([]);
    expect(
      validateModelProperties(model, [...KAOS_PROPERTY_SCHEMAS, ...KAOS_OBSTACLE_PROPERTY_SCHEMAS]),
    ).toEqual([]);
  });

  it('needs the extension: plain KAOS rejects its obstacle types', () => {
    expect(() => parsePistar(text, { metamodel: KAOS })).toThrow(/kaos\.Obstacle/);
  });

  it('holds las.kaos’s goals, obstacles, domain properties and agents', () => {
    expect(count('kaos.BehavioralGoal')).toBe(10);
    expect(count('kaosObstacles.Obstacle')).toBe(6);
    expect(count('kaos.DomainProperty')).toBe(5);
    expect(count('kaos.Agent') + count('kaos.EnvironmentAgent')).toBe(3);
    expect(count('kaos.RefinementLinkHub')).toBe(4);
    // Three OR alternatives of the top obstacle, and the AND refinement of Ambulance Lost.
    expect(count('kaosObstacles.ObstacleRefinementLinkHub')).toBe(4);
    expect(count('kaosObstacles.ObstructionLink')).toBe(1);
    expect(count('kaosObstacles.ResolutionLink')).toBe(1);
  });

  it('carries an engine’s quantities as plain strings: leg probabilities, RSR, ESR', () => {
    const hub = model.elements.get('case-mobilized')!;
    expect(hub.customProperties?.Tactic).toBe('case');
    const legs = hubLinkOf(model, hub.id)!.legs.map((leg) => leg.customProperties);
    expect(legs).toEqual([{ Probability: '.8' }, { Probability: '.2' }]);
    const root = model.elements.get('achieve_ambulance_on_scene_when_incident_reported')!;
    expect(root.customProperties).toMatchObject({ RSR: '0.95', ESR: '0.9277' });
    expect(model.elements.get('milestone-root')?.customProperties?.Tactic).toBe('milestone');
  });

  it('keeps a resolution’s type and anchor', () => {
    const resolution = model.links.get('resolution-familiar-area')!;
    expect(resolutionProperties.read(resolution).values).toEqual({
      ResolutionType: 'mitigation',
      Anchor: 'achieve_ambulance_on_scene_when_ambulance_mobilized',
    });
    expect(model.elements.has(resolution.customProperties!.Anchor!)).toBe(true);
  });
});

describe('DSM3 welcome model with the extension', () => {
  it('still round-trips byte for byte', () => {
    const text = fixture('kaos-welcome.txt');
    expect(toPistar(parsePistar(text, { metamodel: KAOS_OBSTACLES }))).toBe(text);
  });
});
