import type { IstarExtension } from '@istar-ts/react';
import { LINE_DASHES } from '@istar-ts/react';

/**
 * iStar4RationalAgents, the dialect piStar-ext was demonstrated with (Gonçalves et al.,
 * "piStar-ext: Supporting the Creation of iStar Extensions with the piStar Tool", iStar 2020,
 * Fig. 4): new node constructs Planning ("the creation of a sequence of tasks by an agent") and
 * Plan, each with its own SVG symbol. The two links are illustrative, to show both kinds of
 * link extension: Generates has its own source/target rules and line, Alternative behaves like
 * an OR-refinement.
 *
 * Nothing here is part of @istar-ts/*: it only uses the public extension API, the same way an
 * extension for any other dialect would.
 */

/** Planning's arrow-like symbol (an arrow pointing right, notched at the back). */
const PLANNING_PATH = 'M 0 0 L 80 0 L 100 20 L 80 40 L 0 40 L 14 20 Z';
/** Plan's symbol: a document with a folded corner. */
const PLAN_PATH = 'M 0 0 L 75 0 L 90 15 L 90 50 L 0 50 Z M 75 0 L 75 15 L 90 15';

/**
 * piStar-ext keeps a cell's stereotype and tagged value in its `extension` block (kept here as an
 * unknown key) and draws them above the name or link label: `<<stereotype>>` then `{tag=value}`.
 */
function pistarExtHeader(cell: { readonly extra?: Readonly<Record<string, unknown>> }): string[] {
  const ext = (cell.extra?.extension ?? {}) as {
    stereotype?: string;
    selectedTaggedValue?: string;
    taggedValue?: string;
  };
  return [
    ext.stereotype ? `<<${ext.stereotype}>>` : '',
    ext.selectedTaggedValue
      ? `{${ext.selectedTaggedValue}${ext.taggedValue ? `=${ext.taggedValue}` : ''}}`
      : '',
  ].filter(Boolean);
}

export const rationalAgentsExtension: IstarExtension<string, string> = {
  name: 'rationalAgents',
  // The new kinds (core). piStar-ext saves new constructs as `istar.<Name>`; Planning keeps that
  // type on disk (`pistarType`), so its files open here and in piStar-ext alike.
  metamodel: {
    name: 'rationalAgents',
    elements: [
      {
        kind: 'rationalAgents.Planning',
        behavesLike: 'istar.Task',
        pistarType: 'istar.Planning',
        size: { width: 100, height: 40 },
      },
      {
        // Written as `rationalAgents.Plan`, the namespaced form: plain piStar (and piStar-ext
        // without the construct) can't open such a file. Planning shows the other form.
        kind: 'rationalAgents.Plan',
        category: 'node',
        size: { width: 90, height: 45 },
      },
    ],
    links: [
      {
        kind: 'rationalAgents.GeneratesLink',
        label: 'Generates',
        rules: { sources: ['rationalAgents.Planning'], targets: ['rationalAgents.Plan'] },
      },
      {
        kind: 'rationalAgents.AlternativeLink',
        label: 'Alternative',
        behavesLike: 'istar.OrRefinementLink',
      },
    ],
  },
  // How they look (react): piStar-ext's "Shape" and "Kind of Line" fields.
  elements: {
    'rationalAgents.Planning': { shape: { path: PLANNING_PATH }, labelHeader: pistarExtHeader },
    'rationalAgents.Plan': { shape: { path: PLAN_PATH } },
  },
  links: {
    'rationalAgents.GeneratesLink': {
      labelHeader: pistarExtHeader,
      line: {
        dash: LINE_DASHES.dotted,
        marker: 'm 1,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0',
        markerFilled: true,
      },
    },
  },
};
