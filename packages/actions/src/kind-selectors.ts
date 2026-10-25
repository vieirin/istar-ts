/**
 * Internal: which element and link kinds a rule selector matches, the same way `canLink` does.
 * Shared by `hints.ts` (GLSP type hints) and `metamodel-context.ts` (#240), not part of this
 * package's public API — `index.ts` doesn't re-export this module.
 */
import { LINK_SELECTOR, elementBehavesLike, linkBehavesLike } from '@istar-ts/core';
import type { AnyMetamodel, ElementKindDefinition } from '@istar-ts/core';

/** A generated kind (a hub, leg or end) that an n-ary link's declaration adds on its own. */
export function isHub(definition: ElementKindDefinition): boolean {
  return definition.role === 'hub';
}

/** Element kinds a rule selector matches, as `canLink` matches elements against it. */
export function matching(metamodel: AnyMetamodel, selector: string): string[] {
  const kinds: string[] = [];
  for (const definition of metamodel.elements.values()) {
    // A hub is only matched by its own kind's name: categories never include it.
    const matches = isHub(definition)
      ? definition.kind === selector
      : selector === '*' ||
        selector === definition.category ||
        elementBehavesLike(metamodel, definition.kind, selector);
    if (matches) kinds.push(definition.kind);
  }
  // Link targets: `link` matches every link kind, a link kind itself and the kinds behaving like it.
  if (selector === LINK_SELECTOR) kinds.push(...metamodel.links.keys());
  else if (metamodel.links.has(selector)) {
    for (const kind of metamodel.links.keys()) {
      if (linkBehavesLike(metamodel, kind, selector)) kinds.push(kind);
    }
  }
  return kinds;
}

export function union(metamodel: AnyMetamodel, selectors: readonly string[]): string[] {
  return [...new Set(selectors.flatMap((selector) => matching(metamodel, selector)))];
}

/** Kinds of a category, without hubs. */
export function ofCategory(metamodel: AnyMetamodel, category?: 'actor' | 'node'): string[] {
  return [...metamodel.elements.values()]
    .filter((d) => !isHub(d) && (category === undefined || d.category === category))
    .map((d) => d.kind);
}
