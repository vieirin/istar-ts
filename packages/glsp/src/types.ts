/**
 * GModel type strings. One rule, derived from the metamodel:
 *
 * - an element kind `K` (actor, node, dependum or n-ary hub) is `node:K`, e.g. `node:istar.Goal`;
 * - a link kind `K` (n-ary legs and ends included) is `edge:K`, e.g. `edge:istar.DependencyLink`;
 * - a contribution's `types` entry for a kind replaces its type.
 *
 * Besides those, the GModel uses GLSP's built-in `graph` (the root) and `label` (names and link
 * values), and `node:link-anchor` for the point on a link that other links target (NFR's Argument
 * link). This follows GLSP's own `node:<shape>` convention (`DefaultTypes`, framework-notes §2).
 * Kinds are namespaced (`istar.Goal`), so `link-anchor` can't collide with one.
 */
import type { AnyMetamodel, Size } from '@istar-ts/core';

/** Kind → GModel type, replacing the rule's `node:<kind>`/`edge:<kind>` for that kind. */
export type GModelTypeOverrides = Readonly<Record<string, string>>;

/** Kind → size, replacing the metamodel's own default for that kind (#154). */
export type GModelSizeOverrides = Readonly<Record<string, Size>>;

export const GRAPH_TYPE = 'graph';
export const LABEL_TYPE = 'label';
/** The anchor node on the middle of a link that links of the metamodel may target. */
export const LINK_ANCHOR_TYPE = 'node:link-anchor';

/** The GModel types of a metamodel's kinds, and back. */
export interface GModelTypes {
  /** The type of an element or link kind; `undefined` for kinds the metamodel lacks. */
  of(kind: string): string | undefined;
  /** The kind a type stands for; `undefined` for framework types (`graph`, `label`, anchors). */
  kindOf(type: string): string | undefined;
  /** Every type a GModel of this metamodel can contain, framework types included. */
  readonly all: readonly string[];
}

/** The GModel types of `metamodel`'s kinds, with `overrides` applied (see the rule above). */
export function gmodelTypes(
  metamodel: AnyMetamodel,
  overrides: GModelTypeOverrides = {},
): GModelTypes {
  const byKind = new Map<string, string>();
  for (const kind of metamodel.elements.keys()) byKind.set(kind, overrides[kind] ?? `node:${kind}`);
  for (const kind of metamodel.links.keys()) byKind.set(kind, overrides[kind] ?? `edge:${kind}`);
  const byType = new Map<string, string>();
  for (const [kind, type] of byKind) {
    const other = byType.get(type);
    if (
      other !== undefined ||
      type === GRAPH_TYPE ||
      type === LABEL_TYPE ||
      type === LINK_ANCHOR_TYPE
    ) {
      throw new Error(
        `GModel type "${type}" of "${kind}" is already used${other ? ` by "${other}"` : ''}`,
      );
    }
    byType.set(type, kind);
  }
  return {
    of: (kind) => byKind.get(kind),
    kindOf: (type) => byType.get(type),
    all: [GRAPH_TYPE, LABEL_TYPE, LINK_ANCHOR_TYPE, ...byKind.values()],
  };
}
