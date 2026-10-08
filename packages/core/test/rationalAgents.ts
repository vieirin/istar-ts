import type { LinkCheck } from '../src';
import { ISTAR_2_0, defineMetamodelExtension, extendMetamodel } from '../src';

/**
 * iStar4RationalAgents, as piStar-ext's paper shows it (Gonçalves et al., iStar 2020, Fig. 4):
 * new node constructs Planning (the creation of a sequence of tasks by an agent) and Plan.
 * The links are illustrative: Generates (Planning → Plan) and Alternative (an OR-refinement).
 */
export const rationalAgents = defineMetamodelExtension({
  name: 'rationalAgents',
  elements: [
    // piStar-ext saves new constructs as `istar.<Name>`; reading its files needs that type.
    { kind: 'rationalAgents.Planning', behavesLike: 'istar.Task', pistarType: 'istar.Planning' },
    { kind: 'rationalAgents.Plan', category: 'node', size: { width: 90, height: 40 } },
  ],
  links: [
    {
      kind: 'rationalAgents.GeneratesLink',
      label: 'Generates',
      rules: { sources: ['rationalAgents.Planning'], targets: ['rationalAgents.Plan'] },
      check: ({ source, target }): LinkCheck =>
        source.name === target.name
          ? {
              ok: false,
              code: 'invalid-target',
              reason: 'a Planning cannot generate a Plan of the same name',
            }
          : { ok: true },
    },
    {
      kind: 'rationalAgents.AlternativeLink',
      label: 'Alternative',
      behavesLike: 'istar.OrRefinementLink',
    },
  ],
});

export const RATIONAL_AGENTS = extendMetamodel(ISTAR_2_0, rationalAgents);
