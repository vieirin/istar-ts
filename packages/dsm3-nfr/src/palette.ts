/**
 * The NFR Framework's palette data (label, grouping, ordering) as a `PaletteDescription`
 * (`@istar-ts/core`), React-free so a headless host can answer "what can I add here"
 * (`contextActionsFor`, `@istar-ts/actions`) without `@istar-ts/react`. `nfrExtension`
 * (`extension.ts`) derives its And/Or/Argument palette entries from it, adding titles and
 * line styles; Contribution and Correlation get one entry per label here too, as react's
 * `registryForMetamodel` generates them from the metamodel's `possibleLabels`.
 */
import type {
  LinkToolEntryDescription,
  PaletteDescription,
  PaletteEntryDescription,
} from '@istar-ts/core';
import { NFR_CONTRIBUTION_LABELS } from './kinds';
import type { NfrElementKind, NfrLinkKind } from './kinds';

const ELEMENTS: Readonly<Record<NfrElementKind, PaletteEntryDescription>> = {
  'nfr.NFR': { label: 'NFR', order: 10, section: 'elements' },
  'nfr.Operationalization': { label: 'Operationalization', order: 11, section: 'elements' },
  'nfr.Claim': { label: 'Claim', order: 12, section: 'elements' },
};

function labelEntries(kind: string, order: number): readonly LinkToolEntryDescription[] {
  return NFR_CONTRIBUTION_LABELS.map((value, i) => ({
    label: value,
    value,
    order: order + i / 1000,
    group: kind,
    section: 'elements',
  }));
}

const LINKS: Readonly<Record<NfrLinkKind, readonly LinkToolEntryDescription[]>> = {
  'nfr.AndRefinementLink': [{ label: 'And', order: 40, section: 'elements' }],
  'nfr.OrRefinementLink': [{ label: 'Or', order: 41, section: 'elements' }],
  'nfr.ContributionLink': labelEntries('nfr.ContributionLink', 44.03),
  'nfr.CorrelationLink': labelEntries('nfr.CorrelationLink', 44.04),
  'nfr.ArgumentLink': [{ label: 'Argument', order: 52, section: 'elements' }],
};

/** The NFR Framework's palette data, as DSM3-goals' toolbar presents it. */
export const NFR_PALETTE: PaletteDescription<NfrElementKind, NfrLinkKind> = {
  elements: ELEMENTS,
  links: LINKS,
  groups: {
    'nfr.ContributionLink': { label: 'Contribution' },
    'nfr.CorrelationLink': { label: 'Correlation' },
  },
};
