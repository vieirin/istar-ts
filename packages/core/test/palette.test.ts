import { describe, expect, test } from 'vitest';
import type { PaletteEntryDescription } from '../src';
import { ACTOR_KINDS, DEFAULT_PALETTE, LINK_KINDS, NODE_KINDS } from '../src';

describe('DEFAULT_PALETTE', () => {
  test('has one entry per actor kind, grouped and ordered as piStar', () => {
    for (const [i, kind] of ACTOR_KINDS.entries()) {
      const entry = DEFAULT_PALETTE.elements[kind];
      expect(entry).toEqual({ label: kind.slice(6), order: i, section: 'actors', group: 'actors' });
    }
  });

  test('has one entry per node kind in the "elements" section', () => {
    for (const kind of NODE_KINDS) {
      const entry = DEFAULT_PALETTE.elements[kind];
      expect(entry).toMatchObject({ label: kind.slice(6), section: 'elements' });
      expect(entry).not.toHaveProperty('group');
    }
  });

  test('the Dependency link has one entry per node kind, each presetting its dependum', () => {
    const entries = DEFAULT_PALETTE.links['istar.DependencyLink'] || [];
    expect(entries).toHaveLength(NODE_KINDS.length);
    expect(entries.map((e) => e.dependum)).toEqual(NODE_KINDS);
    for (const entry of entries) {
      expect(entry.group).toBe('dependencies');
      expect(entry.section).toBe('actors');
    }
  });

  test('the Contribution link has one entry per value', () => {
    const entries = DEFAULT_PALETTE.links['istar.ContributionLink'] || [];
    expect(entries.map((e) => e.value)).toEqual(['make', 'help', 'hurt', 'break']);
  });

  test('every link kind has a palette entry', () => {
    for (const kind of LINK_KINDS) {
      const entries = DEFAULT_PALETTE.links[kind];
      expect(entries).not.toBe(false);
      expect((entries || []).length).toBeGreaterThan(0);
    }
  });

  test('declares a group label for every group an entry uses', () => {
    const groups = new Set<string>();
    for (const entry of Object.values(DEFAULT_PALETTE.elements)) {
      const single = entry as PaletteEntryDescription | false;
      if (single && single.group) groups.add(single.group);
    }
    for (const entries of Object.values(DEFAULT_PALETTE.links)) {
      for (const entry of entries || []) if (entry.group) groups.add(entry.group);
    }
    for (const group of groups) expect(DEFAULT_PALETTE.groups[group]).toBeDefined();
  });
});
