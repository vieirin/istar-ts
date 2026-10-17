import { describe, expect, test } from 'vitest';
import type { LinkCheck } from '../src';
import {
  ISTAR_2_0,
  createModelStore,
  hubLinkOf,
  parsePistar,
  toPistar,
  validateModel,
} from '../src';
import { KAOS, NFR, NFR_CONTRIBUTION_LABELS } from './dsm3-roots';
import { loadDsm3Fixtures } from './fixtures';

const dsm3 = new Map(loadDsm3Fixtures().map((f) => [f.name.replace(/^dsm3\//, ''), f.text]));
const fixture = (name: string): string => {
  const text = dsm3.get(name);
  if (text === undefined) throw new Error(`missing fixture dsm3/${name}`);
  return text;
};

describe('DSM3-goals fixtures', () => {
  test('are the three welcome models', () => {
    expect([...dsm3.keys()]).toEqual(['istar2-welcome.txt', 'kaos-welcome.txt', 'nfr-welcome.txt']);
  });

  test("DSM3's iStar 2.0 example round-trips byte for byte with ISTAR_2_0", () => {
    const text = fixture('istar2-welcome.txt');
    const model = parsePistar(text, { metamodel: ISTAR_2_0 });
    expect(model.tool).toBe('dsm3-goals');
    expect(model.extra).toEqual({ metamodelVersion: '1.0' });
    expect(toPistar(model)).toBe(text);
  });
});

/** An NFR model: two NFRs, an Operationalization contributing to the first, a Claim. */
function nfrSetup() {
  const store = createModelStore(undefined, { metamodel: NFR });
  const add = (kind: 'nfr.NFR' | 'nfr.Operationalization' | 'nfr.Claim') =>
    store.addElement({ kind, x: 0, y: 0 }).id;
  const n1 = add('nfr.NFR');
  const n2 = add('nfr.NFR');
  const op = add('nfr.Operationalization');
  const claim = add('nfr.Claim');
  const contribution = store.connect({
    kind: 'nfr.ContributionLink',
    source: op,
    target: n1,
    label: '+',
  });
  if (!contribution.ok) throw new Error(contribution.reason);
  return { store, n1, n2, op, claim, link: contribution.link.id };
}

function code(check: LinkCheck): string | undefined {
  return check.ok ? undefined : check.code;
}

describe('NFR', () => {
  test('the welcome model round-trips byte for byte', () => {
    const text = fixture('nfr-welcome.txt');
    const model = parsePistar(text, { metamodel: NFR });
    expect(toPistar(model)).toBe(text);
    expect(validateModel(model)).toEqual([]);
    // The Argument link targets a Contribution link.
    const argument = model.links.get('fb3215c7-154c-41ab-bcf8-f2145aa8af1c');
    expect(argument?.target).toBe('3a57f4d9-a905-4b55-9d17-82e951a79558');
    expect(model.links.has(argument!.target)).toBe(true);
  });

  test("the fixture's labels are NFR's", () => {
    const model = parsePistar(fixture('nfr-welcome.txt'), { metamodel: NFR });
    const labels = [...model.links.values()].flatMap((l) => (l.label ? [l.label] : []));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(NFR_CONTRIBUTION_LABELS).toContain(label);
  });

  /**
   * One test per `isValid` branch of DSM3-goals' `language_nfr_constraints.js`. Its messages
   * differ from the generic ones; what matters is that the same links are refused.
   */
  describe('constraints (language_nfr_constraints.js)', () => {
    const refinements = [
      ['AndRefinementLink', 'you cannot refine an Operationalization with a NFR'],
      ['OrRefinementLink', 'you cannot refine an Operationalization with a NFR'],
      ['ContributionLink', 'you cannot have a NFR contributing to an Operationalization'],
      ['CorrelationLink', 'you cannot have an Operationalization as the target of a Correlation'],
    ] as const;

    describe.each(refinements)('%s.isValid', (name, nfrToOperationalization) => {
      const kind = `nfr.${name}` as const;
      test('source === target', () => {
        const { store, n1 } = nfrSetup();
        expect(code(store.canLink(n1, n1, kind))).toBe('self-link');
      });
      test('source.isNFR() && target.isOperationalization()', () => {
        const { store, n1, n2, op } = nfrSetup();
        expect(store.canLink(n2, op, kind)).toEqual({
          ok: false,
          code: 'invalid-target',
          reason: nfrToOperationalization,
        });
        expect(store.canLink(op, n2, kind)).toEqual({ ok: true });
        expect(store.canLink(n1, n2, kind)).toEqual({ ok: true });
      });
      test('source.isClaim() || target.isClaim()', () => {
        const { store, n1, claim } = nfrSetup();
        expect(code(store.canLink(claim, n1, kind))).toBe('invalid-source');
        expect(code(store.canLink(n1, claim, kind))).toBe('invalid-target');
      });
      test('!source.isElement()', () => {
        const { store, n1, link } = nfrSetup();
        expect(code(store.canLink(link, n1, kind))).toBe('unknown-element');
      });
      test('!target.isElement()', () => {
        const { store, n1, link } = nfrSetup();
        expect(code(store.canLink(n1, link, kind))).toBe('invalid-target');
      });
    });

    test.each(refinements.slice(0, 3))('%s.isValid: isThereLinkBetween(source, target)', (name) => {
      const kind = `nfr.${name}` as const;
      const { store, n1, n2 } = nfrSetup();
      expect(store.connect({ kind, source: n2, target: n1 }).ok).toBe(true);
      expect(code(store.canLink(n2, n1, kind))).toBe('duplicate-link');
    });

    test('CorrelationLink.isValid has no limit of one per pair', () => {
      const kind = 'nfr.CorrelationLink';
      const { store, n1, n2 } = nfrSetup();
      expect(store.connect({ kind, source: n2, target: n1 }).ok).toBe(true);
      expect(store.canLink(n2, n1, kind)).toEqual({ ok: true });
    });

    describe('ArgumentLink.isValid', () => {
      const kind = 'nfr.ArgumentLink';
      test('source === target', () => {
        const { store, claim } = nfrSetup();
        expect(code(store.canLink(claim, claim, kind))).toBe('invalid-target');
      });
      test('!source.isClaim()', () => {
        const { store, n2, link } = nfrSetup();
        expect(code(store.canLink(n2, link, kind))).toBe('invalid-source');
      });
      test('isThereLinkBetween(source, target)', () => {
        // DSM3 asks for a ContributionLink here, which never joins a Claim and a link; the
        // intent, one Argument per pair, is what the rules implement.
        const { store, claim, link } = nfrSetup();
        expect(store.connect({ kind, source: claim, target: link }).ok).toBe(true);
        expect(code(store.canLink(claim, link, kind))).toBe('duplicate-link');
      });
      test('!target.isLink()', () => {
        const { store, claim, n1 } = nfrSetup();
        expect(code(store.canLink(claim, n1, kind))).toBe('invalid-target');
      });
    });
  });
});

describe('KAOS', () => {
  test('the welcome model round-trips byte for byte', () => {
    const text = fixture('kaos-welcome.txt');
    const model = parsePistar(text, { metamodel: KAOS });
    expect(toPistar(model)).toBe(text);
    expect(validateModel(model)).toEqual([]);
  });

  test('its refinements are 4 hubs with 5 legs and 4 ends, beside 2 plain links', () => {
    const model = parsePistar(fixture('kaos-welcome.txt'), { metamodel: KAOS });
    const count = (kind: string): number =>
      [...model.elements.values(), ...model.links.values()].filter((x) => x.kind === kind).length;
    expect(count('kaos.RefinementLinkHub')).toBe(4);
    expect(count('kaos.RefinementLinkStart')).toBe(5);
    expect(count('kaos.RefinementLinkEnd')).toBe(4);
    expect(count('kaos.Conflict') + count('kaos.ResponsibilityAssignment')).toBe(2);
    const hub = model.elements.get('23e5218f-ff13-4cdd-9ee6-6aed9ed698eb');
    expect(hub).toMatchObject({ name: '', display: { width: 20, height: 20 } });
    expect(hubLinkOf(model, hub!.id)?.legs.map((l) => l.source)).toEqual([
      'f0a633b9-cead-4961-9764-eeb6c3a6c41c',
      'ae2aae6a-0d36-4c83-b0f6-9d227792e1e6',
    ]);
  });

  test('a refinement made in the editor saves and reads back the same', () => {
    const model = parsePistar(fixture('kaos-welcome.txt'), { metamodel: KAOS });
    const store = createModelStore(model);
    const goal = store.addElement({ kind: 'kaos.BehavioralGoal', x: 600, y: 600 });
    const made = store.connect({
      kind: 'kaos.RefinementLink',
      source: goal.id,
      target: '7857cb00-05ce-4bd0-aa89-3c7a63b54b31',
    });
    expect(made.ok).toBe(true);
    const leg = store.addLeg('23e5218f-ff13-4cdd-9ee6-6aed9ed698eb', goal.id);
    expect(leg.ok).toBe(true);
    const text = toPistar(store.getModel());
    expect(toPistar(parsePistar(text, { metamodel: KAOS }))).toBe(text);
    const entries = (JSON.parse(text) as { links: { hub?: unknown; starts?: unknown[] }[] }).links;
    expect(entries.filter((e) => e.hub)).toHaveLength(5);
    expect(entries.find((e) => e.starts?.length === 3)).toBeDefined();
  });
});

/** A KAOS model: goals, a domain property, an agent, a refinement of `parent` by `child`. */
function kaosSetup() {
  const store = createModelStore(undefined, { metamodel: KAOS });
  const add = (kind: 'kaos.BehavioralGoal' | 'kaos.DomainProperty' | 'kaos.Agent') =>
    store.addElement({ kind, x: 0, y: 0 }).id;
  const parent = add('kaos.BehavioralGoal');
  const child = add('kaos.BehavioralGoal');
  const other = add('kaos.BehavioralGoal');
  const property = add('kaos.DomainProperty');
  const agent = add('kaos.Agent');
  const refinement = store.connect({ kind: 'kaos.RefinementLink', source: child, target: parent });
  if (!refinement.ok) throw new Error(refinement.reason);
  const hub = refinement.hub!.hub.id;
  return { store, parent, child, other, property, agent, hub, link: refinement.link.id };
}

/**
 * One test per `isValid` branch of DSM3-goals' `language_kaos_constraints.js`. Its messages
 * differ from the generic ones; what matters is that the same links are refused.
 */
describe('KAOS constraints (language_kaos_constraints.js)', () => {
  describe('RefinementLink.isValid', () => {
    const kind = 'kaos.RefinementLink';
    test('source === target', () => {
      const { store, other } = kaosSetup();
      expect(code(store.canLink(other, other, kind))).toBe('self-link');
    });
    test('source.isAgent() || source.isEnvironmentAgent()', () => {
      const { store, agent, parent } = kaosSetup();
      expect(code(store.canLink(agent, parent, kind))).toBe('invalid-source');
    });
    test('target.isRefinementLinkHub(): here, a new leg of that refinement', () => {
      // DSM3 refuses and asks for a leg instead; connect adds the leg directly.
      const { store, property, hub } = kaosSetup();
      expect(store.canLink(property, hub, kind)).toEqual({ ok: true });
      const leg = store.connect({ kind, source: property, target: hub });
      expect(leg.ok && leg.link.kind).toBe('kaos.RefinementLinkStart');
    });
    test('several refinements may join the same two elements (its uniqueness is commented out)', () => {
      const { store, child, parent } = kaosSetup();
      expect(store.canLink(child, parent, kind)).toEqual({ ok: true });
    });
    test('!source.isElement()', () => {
      const { store, link, parent } = kaosSetup();
      expect(code(store.canLink(link, parent, kind))).toBe('unknown-element');
    });
    test('!target.isElement()', () => {
      const { store, other, link } = kaosSetup();
      expect(code(store.canLink(other, link, kind))).toBe('invalid-target');
    });
  });

  describe('ResponsibilityAssignment.isValid', () => {
    const kind = 'kaos.ResponsibilityAssignment';
    test('source === target', () => {
      const { store, agent } = kaosSetup();
      expect(code(store.canLink(agent, agent, kind))).toBe('self-link');
    });
    test('!(source.isAgent() || source.isEnvironmentAgent())', () => {
      const { store, other, parent } = kaosSetup();
      expect(code(store.canLink(other, parent, kind))).toBe('invalid-source');
    });
    test('target.isRefinementLinkHub()', () => {
      const { store, agent, hub } = kaosSetup();
      expect(code(store.canLink(agent, hub, kind))).toBe('hub-target');
    });
    test('isThereLinkBetween(source, target)', () => {
      const { store, agent, parent } = kaosSetup();
      expect(store.connect({ kind, source: agent, target: parent }).ok).toBe(true);
      expect(code(store.canLink(agent, parent, kind))).toBe('duplicate-link');
    });
    test('!source.isElement()', () => {
      const { store, link, parent } = kaosSetup();
      expect(code(store.canLink(link, parent, kind))).toBe('unknown-element');
    });
    test('!target.isElement()', () => {
      const { store, agent, link } = kaosSetup();
      expect(code(store.canLink(agent, link, kind))).toBe('invalid-target');
    });
  });

  describe('Conflict.isValid', () => {
    const kind = 'kaos.Conflict';
    test('source === target', () => {
      const { store, other } = kaosSetup();
      expect(code(store.canLink(other, other, kind))).toBe('self-link');
    });
    test('target.isRefinementLinkHub()', () => {
      const { store, other, hub } = kaosSetup();
      expect(code(store.canLink(other, hub, kind))).toBe('hub-target');
    });
    test('isThereLinkBetween(source, target)', () => {
      const { store, other, parent } = kaosSetup();
      expect(store.connect({ kind, source: other, target: parent }).ok).toBe(true);
      expect(code(store.canLink(parent, other, kind))).toBe('duplicate-link');
    });
    test('!source.isElement()', () => {
      const { store, link, parent } = kaosSetup();
      expect(code(store.canLink(link, parent, kind))).toBe('unknown-element');
    });
    test('!target.isElement()', () => {
      const { store, other, link } = kaosSetup();
      expect(code(store.canLink(other, link, kind))).toBe('invalid-target');
    });
  });

  describe('RefinementLinkStart.isValid', () => {
    const kind = 'kaos.RefinementLinkStart';
    test('source === target', () => {
      const { store, hub } = kaosSetup();
      expect(code(store.canLink(hub, hub, kind))).toBe('invalid-source');
    });
    test('source.isAgent() || source.isEnvironmentAgent()', () => {
      const { store, agent, hub } = kaosSetup();
      expect(code(store.canLink(agent, hub, kind))).toBe('invalid-source');
    });
    test('!target.isRefinementLinkHub()', () => {
      const { store, other, parent } = kaosSetup();
      expect(code(store.canLink(other, parent, kind))).toBe('invalid-target');
    });
    test('isThereLinkBetween(source, target)', () => {
      const { store, child, other, hub } = kaosSetup();
      expect(code(store.canLink(child, hub, kind))).toBe('duplicate-link');
      expect(store.canLink(other, hub, kind)).toEqual({ ok: true });
    });
    test('!source.isElement()', () => {
      const { store, link, hub } = kaosSetup();
      expect(code(store.canLink(link, hub, kind))).toBe('unknown-element');
    });
    test('!target.isElement()', () => {
      const { store, other, link } = kaosSetup();
      expect(code(store.canLink(other, link, kind))).toBe('invalid-target');
    });
  });
});
