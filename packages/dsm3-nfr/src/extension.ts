/**
 * How the NFR Framework looks and what its palette offers, as a react registry extension.
 * Labels and titles come from DSM3-goals' `language_nfr_ui.metamodel.js`, shapes and markers
 * from `language_nfr_shapes.js`.
 */
import type { LinkToolEntryDescription, PaletteEntryDescription } from '@istar-ts/core';
import { LINE_DASHES } from '@istar-ts/react';
import type { IstarExtension } from '@istar-ts/react';
import type { NfrElementKind, NfrLinkKind } from './kinds';
import { NFR_PALETTE } from './palette';
import { NFR_AND_MARKER, NFR_OR_MARKER, NFR_SHAPES } from './shapes';

/** An element's palette entry (`NFR_PALETTE`), with the title piStar-ext shows for it. */
function addNode(kind: NfrElementKind, title: string) {
  return { ...(NFR_PALETTE.elements[kind] as PaletteEntryDescription), title };
}

/** A link kind's single palette entry (`NFR_PALETTE`), with its title. */
function addLink(
  kind: 'nfr.AndRefinementLink' | 'nfr.OrRefinementLink' | 'nfr.ArgumentLink',
  title: string,
) {
  const entry = (NFR_PALETTE.links[kind] as readonly LinkToolEntryDescription[])[0]!;
  return [{ ...entry, title }];
}

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
      palette: addNode(
        'nfr.NFR',
        'Adding NFR softgoal: click on the diagram to add a NFR softgoal',
      ),
    },
    'nfr.Operationalization': {
      shape: NFR_SHAPES['nfr.Operationalization'],
      palette: addNode(
        'nfr.Operationalization',
        'Adding Operationalization: click on the diagram to add an Operationalization',
      ),
    },
    'nfr.Claim': {
      shape: NFR_SHAPES['nfr.Claim'],
      palette: addNode('nfr.Claim', 'Adding Claim: click on the diagram to add a Claim'),
    },
  },
  links: {
    'nfr.AndRefinementLink': {
      line: { marker: NFR_AND_MARKER },
      palette: addLink(
        'nfr.AndRefinementLink',
        'Add And-Refinement link: drag from the child to the parent',
      ),
    },
    'nfr.OrRefinementLink': {
      line: { marker: NFR_OR_MARKER, markerFilled: true },
      palette: addLink(
        'nfr.OrRefinementLink',
        'Add Or-Refinement link: drag from the child to the parent',
      ),
    },
    // Contribution, Correlation and Argument draw DSM3's open arrow, the default marker.
    // Contribution and Correlation get one palette entry per label from react's defaults.
    'nfr.CorrelationLink': { line: { dash: LINE_DASHES.dashed } },
    'nfr.ArgumentLink': {
      palette: addLink(
        'nfr.ArgumentLink',
        'Add Argument link: drag from the Claim to the link it justifies',
      ),
    },
  },
};
