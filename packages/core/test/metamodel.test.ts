import { describe, expect, test } from 'vitest';
import {
  ACTOR_KINDS,
  ELEMENT_KINDS,
  LINK_KINDS,
  LINK_KIND_INFO,
  NODE_KINDS,
  NODE_KIND_INFO,
  isActorKind,
  isElementKind,
  isLinkKind,
  isNodeKind,
  shortKindName,
} from '../src';

describe('metamodel', () => {
  test('matches upstream metamodel.js kinds', () => {
    expect(ACTOR_KINDS).toEqual(['istar.Actor', 'istar.Agent', 'istar.Role']);
    expect(NODE_KINDS).toEqual(['istar.Goal', 'istar.Quality', 'istar.Resource', 'istar.Task']);
    expect(LINK_KINDS).toEqual([
      'istar.IsALink',
      'istar.ParticipatesInLink',
      'istar.DependencyLink',
      'istar.AndRefinementLink',
      'istar.OrRefinementLink',
      'istar.NeededByLink',
      'istar.QualificationLink',
      'istar.ContributionLink',
    ]);
  });

  test('link and node metadata', () => {
    expect(LINK_KIND_INFO['istar.IsALink'].label).toBe('is-a');
    expect(LINK_KIND_INFO['istar.ParticipatesInLink'].label).toBe('participates-in');
    expect(LINK_KIND_INFO['istar.ContributionLink'].possibleLabels).toEqual([
      'make',
      'help',
      'hurt',
      'break',
    ]);
    expect(LINK_KIND_INFO['istar.NeededByLink'].tryReversedWhenAdding).toBe(true);
    for (const kind of NODE_KINDS) {
      expect(NODE_KIND_INFO[kind]).toEqual({
        canBeInnerElement: true,
        canBeDependum: true,
        canBeOnPaper: false,
      });
    }
  });

  test('type guards', () => {
    for (const k of ELEMENT_KINDS) expect(isElementKind(k)).toBe(true);
    expect(isActorKind('istar.Agent')).toBe(true);
    expect(isActorKind('istar.Goal')).toBe(false);
    expect(isNodeKind('istar.Task')).toBe(true);
    expect(isLinkKind('istar.DependencyLink')).toBe(true);
    expect(isElementKind('istar.Softgoal')).toBe(false);
    expect(shortKindName('istar.ContributionLink')).toBe('ContributionLink');
  });
});
