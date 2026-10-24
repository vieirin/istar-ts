/**
 * The data part of each kind's palette entry: label, grouping, ordering, and the presets a
 * toolbar entry creates with (a link's `value`, a dependency's `dependum`, an element's
 * `properties`). React-free so a host can answer "what can I add here" (GLSP's
 * `RequestContextActions`) without the react package. Icons, titles and components are
 * presentation and stay in `packages/react/src/registry`, which derives its default entries
 * from `DEFAULT_PALETTE`.
 */
import {
  CONTRIBUTION_LABELS,
  ELEMENT_KINDS,
  LINK_KINDS,
  NODE_KINDS,
  isActorKind,
  shortKindName,
} from './metamodel';
import type { ElementKind, LinkKind, NodeKind } from './metamodel';
import type { CustomProperties } from './model';

export interface PaletteEntryDescription {
  readonly label: string;
  /** Lower comes first. */
  readonly order?: number;
  /** Entries sharing a group collapse into one dropdown button (e.g. Actor / Agent / Role). */
  readonly group?: string;
  /** Sections are separated by a divider. Default palette: "actors" and "elements". */
  readonly section?: string;
}

export interface ElementToolEntryDescription extends PaletteEntryDescription {
  /** customProperties preset on the element this entry creates, over `defaultProperties`. */
  readonly properties?: CustomProperties;
}

export interface LinkToolEntryDescription<
  DK extends string = NodeKind,
> extends PaletteEntryDescription {
  /** Contribution value to set on the new link. */
  readonly value?: string;
  /** For dependencies: the kind of dependum to create. */
  readonly dependum?: DK;
}

export interface PaletteGroupDescription {
  readonly label: string;
}

/**
 * Per-kind palette data. `elements`/`links` entries are `false` for kinds hidden from the
 * palette, one entry for most element kinds, or several for a kind with more than one toolbar
 * button (a link's values, a dependency's dependum kinds).
 */
export interface PaletteDescription<EK extends string = ElementKind, LK extends string = LinkKind> {
  readonly elements: Readonly<
    Record<EK, PaletteEntryDescription | readonly ElementToolEntryDescription[] | false>
  >;
  readonly links: Readonly<Record<LK, readonly LinkToolEntryDescription[] | false>>;
  /** Labels for palette groups, keyed by `PaletteEntryDescription.group`. */
  readonly groups: Readonly<Record<string, PaletteGroupDescription>>;
}

/** A palette description of any dialect, for code that handles every kind generically. */
export type AnyPaletteDescription = PaletteDescription<string, string>;

function defaultElementEntry(kind: ElementKind, index: number): PaletteEntryDescription {
  const actor = isActorKind(kind);
  return {
    label: shortKindName(kind),
    // piStar order: Actor… | Actor links… | Dependency… ‖ Goal Quality Resource Task | links
    order: actor ? index : 30 + index,
    section: actor ? 'actors' : 'elements',
    ...(actor ? { group: 'actors' } : {}),
  };
}

const CONTRIBUTION_ENTRY_LABELS: Readonly<Record<string, string>> = {
  make: 'Make (++)',
  help: 'Help (+)',
  hurt: 'Hurt (-)',
  break: 'Break (--)',
};

const LINK_ENTRIES: Readonly<Record<LinkKind, readonly LinkToolEntryDescription[]>> = {
  'istar.IsALink': [{ label: 'Is A', order: 10, group: 'actor-links', section: 'actors' }],
  'istar.ParticipatesInLink': [
    { label: 'Participates-In', order: 11, group: 'actor-links', section: 'actors' },
  ],
  'istar.DependencyLink': NODE_KINDS.map((dependum, i) => ({
    label: `${shortKindName(dependum)} dependency`,
    dependum,
    order: 20 + i,
    group: 'dependencies',
    section: 'actors',
  })),
  'istar.AndRefinementLink': [{ label: 'And', order: 40, section: 'elements' }],
  'istar.OrRefinementLink': [{ label: 'Or', order: 41, section: 'elements' }],
  'istar.NeededByLink': [{ label: 'Needed-By', order: 42, section: 'elements' }],
  'istar.QualificationLink': [{ label: 'Qualification', order: 43, section: 'elements' }],
  'istar.ContributionLink': CONTRIBUTION_LABELS.map((value, i) => ({
    label: CONTRIBUTION_ENTRY_LABELS[value]!,
    value,
    order: 50 + i,
    group: 'contributions',
    section: 'elements',
  })),
};

/** piStar's dropdown buttons. */
const DEFAULT_PALETTE_GROUPS: Readonly<Record<string, PaletteGroupDescription>> = {
  actors: { label: 'Actor' },
  'actor-links': { label: 'Actor links' },
  dependencies: { label: 'Dependency' },
  contributions: { label: 'Contribution' },
};

function buildDefaultPalette(): PaletteDescription {
  const elements = {} as Record<ElementKind, PaletteEntryDescription>;
  ELEMENT_KINDS.forEach((kind, i) => {
    elements[kind] = defaultElementEntry(kind, i);
  });
  const links = {} as Record<LinkKind, readonly LinkToolEntryDescription[]>;
  for (const kind of LINK_KINDS) links[kind] = LINK_ENTRIES[kind];
  return { elements, links, groups: DEFAULT_PALETTE_GROUPS };
}

/** The palette data of iStar 2.0, as piStar's toolbar presents it. */
export const DEFAULT_PALETTE: PaletteDescription = buildDefaultPalette();
