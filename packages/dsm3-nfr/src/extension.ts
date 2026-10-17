/**
 * How the NFR Framework looks and what its palette offers, as a react registry extension.
 * Labels and titles come from DSM3-goals' `language_nfr_ui.metamodel.js`, shapes and markers
 * from `language_nfr_shapes.js`.
 */
import { LINE_DASHES } from '@istar-ts/react';
import type { IstarExtension } from '@istar-ts/react';
import type { NfrElementKind, NfrLinkKind } from './kinds';
import { NFR_AND_MARKER, NFR_OR_MARKER, NFR_SHAPES } from './shapes';

/**
 * The NFR registry parts. Apply them after the registry is completed for the NFR metamodel
 * (`applyExtensions(registryForMetamodel(NFR), [nfrExtension])`), or pass the extension to the
 * canvas.
 */
export const nfrExtension: IstarExtension<NfrElementKind, NfrLinkKind> = {
  name: 'dsm3-nfr',
  elements: {
    'nfr.NFR': {
      shape: NFR_SHAPES['nfr.NFR'],
      palette: {
        label: 'NFR',
        title: 'Adding NFR softgoal: click on the diagram to add a NFR softgoal',
        order: 10,
        section: 'elements',
      },
    },
    'nfr.Operationalization': {
      shape: NFR_SHAPES['nfr.Operationalization'],
      palette: {
        label: 'Operationalization',
        title: 'Adding Operationalization: click on the diagram to add an Operationalization',
        order: 11,
        section: 'elements',
      },
    },
    'nfr.Claim': {
      shape: NFR_SHAPES['nfr.Claim'],
      palette: {
        label: 'Claim',
        title: 'Adding Claim: click on the diagram to add a Claim',
        order: 12,
        section: 'elements',
      },
    },
  },
  links: {
    'nfr.AndRefinementLink': {
      line: { marker: NFR_AND_MARKER },
      palette: [
        {
          label: 'And',
          title: 'Add And-Refinement link: drag from the child to the parent',
          order: 40,
          section: 'elements',
        },
      ],
    },
    'nfr.OrRefinementLink': {
      line: { marker: NFR_OR_MARKER, markerFilled: true },
      palette: [
        {
          label: 'Or',
          title: 'Add Or-Refinement link: drag from the child to the parent',
          order: 41,
          section: 'elements',
        },
      ],
    },
    // Contribution, Correlation and Argument draw DSM3's open arrow, the default marker.
    // Contribution and Correlation get one palette entry per label from react's defaults.
    'nfr.CorrelationLink': { line: { dash: LINE_DASHES.dashed } },
    'nfr.ArgumentLink': {
      palette: [
        {
          label: 'Argument',
          title: 'Add Argument link: drag from the Claim to the link it justifies',
          order: 52,
          section: 'elements',
        },
      ],
    },
  },
};
