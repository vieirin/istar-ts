/**
 * The element registry: per-kind configuration of how elements look and behave in the editor.
 *
 * For every element kind a consumer can override:
 * - `component`: how the node renders (including inline inputs);
 * - `defaultProperties`: customProperties preset when the element is created;
 * - `inspector`: the form shown in the side panel for that kind;
 * - `palette`: whether and how the kind appears in the "add" toolbar.
 */
import type {
  ActorKind,
  AnyMetamodel,
  CustomProperties,
  ElementKind,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkKind,
  Metamodel,
  MetamodelExtension,
  NodeKind,
  PropertySchema,
  PropertyShape,
  Size,
} from '@istar-ts/core';
import {
  ISTAR_2_0,
  extendMetamodel,
  CONTRIBUTION_LABELS,
  DEFAULT_ELEMENT_SIZE,
  ELEMENT_KINDS,
  LINK_KINDS,
  NODE_KINDS,
  isActorKind,
  shortKindName,
} from '@istar-ts/core';
import type { ComponentType, ReactNode } from 'react';
import { DefaultActorComponent, DefaultElementComponent } from './default-components';
import type { ElementIssue } from './issues';
import { dependencyIcon, elementIcon, linkIcon } from './palette-icons';
import type { ShapeSpec } from './shapes';

// ---------------------------------------------------------------------------------------------
// Props passed to registry components

export interface ElementActions {
  rename(name: string): void;
  /** Merges into customProperties; a key set to `undefined` is removed. */
  setProperties(patch: Readonly<Record<string, string | undefined>>): void;
  setDisplay(patch: Readonly<Record<string, unknown>>): void;
  remove(): void;
}

export interface ElementComponentProps {
  readonly element: IstarElement;
  readonly width: number;
  readonly height: number;
  readonly selected: boolean;
  /** True while inline name editing is active (double-click, or right after creation). */
  readonly editing: boolean;
  setEditing(editing: boolean): void;
  readonly actions: ElementActions;
  readonly readOnly: boolean;
  /**
   * Host-owned issues for this element (e.g. LSP diagnostics). Empty when the host did not
   * pass an `issues` prop, or none apply to this id. Never written to the model.
   */
  readonly issues: readonly ElementIssue[];
}

export interface InspectorProps<T extends IstarElement | IstarLink = IstarElement> {
  readonly target: T;
  readonly model: IstarModel;
  readonly actions: T extends IstarElement ? ElementActions : LinkActions;
  readonly readOnly: boolean;
  /** The kind's property schema, if the registry declares one. */
  readonly schema?: PropertySchema;
  /** Host-owned issues for this target (e.g. LSP diagnostics). */
  readonly issues: readonly ElementIssue[];
}

export interface LinkActions {
  setLabel(label: string | undefined): void;
  setName(name: string | undefined): void;
  setProperties(patch: Readonly<Record<string, string | undefined>>): void;
  remove(): void;
}

// ---------------------------------------------------------------------------------------------
// Configuration

export interface PaletteEntry {
  readonly label: string;
  readonly title?: string;
  /** Small preview of the element or link (the default registry draws piStar-like icons). */
  readonly icon?: ReactNode;
  /** Lower comes first. */
  readonly order?: number;
  /** Entries sharing a group collapse into one dropdown button (e.g. Actor / Agent / Role). */
  readonly group?: string;
  /** Sections are separated by a divider. Default registry: "actors" and "elements". */
  readonly section?: string;
}

export interface PaletteGroup {
  /** Label of the dropdown button, e.g. "Actor links". */
  readonly label: string;
  readonly title?: string;
}

export interface ElementKindConfig<K extends string = ElementKind> {
  readonly kind: K;
  readonly label: string;
  /** Default size (actors: initial boundary size). `display.width/height` override per element. */
  readonly size: Size;
  readonly component: ComponentType<ElementComponentProps>;
  readonly defaultProperties?:
    | CustomProperties
    | ((ctx: { model: IstarModel }) => CustomProperties);
  readonly inspector?: ComponentType<InspectorProps<IstarElement>> | false;
  /**
   * Toolbar entry for this kind, or a list of them (each creating the kind, optionally with
   * preset `properties`, like the contribution values of link kinds); `false` hides the kind.
   */
  readonly palette: PaletteEntry | readonly ElementToolEntry[] | false;
  /**
   * Actor kinds only: draw the actor as a boundary around its inner elements (default, as in
   * piStar). With `false` the actor is just its `component`, drawn at the kind's `size` (a
   * saved `display` size is ignored, as for framed actors); its
   * elements stay nested in the model and move with it, but lie outside it on the canvas, and
   * nodes added on empty canvas space join the nearest such actor.
   */
  readonly boundary?: boolean;
  /**
   * Whether the element shows resize handles when selected. Default: true for intentional
   * elements; actors are sized by their contents, as in piStar.
   */
  readonly resizable?: boolean;
  /** Typed customProperties; the default inspector renders fields from it. */
  readonly properties?: PropertySchema<PropertyShape, string>;
  /**
   * The kind's shape as SVG path data (piStar-ext's "Shape" field), drawn by the default
   * component scaled to the element. Without one, built-in kinds use their piStar shape and
   * extended kinds piStar's default node: a dashed box labelled with their «stereotype».
   */
  readonly shape?: ShapeSpec;
  /**
   * Text drawn above the name, without the guillemets (`Planning` → «Planning»). Default: the
   * label, for extended kinds without a `shape`; none otherwise.
   */
  readonly stereotype?: string | false;
  /**
   * Name assigned when the palette creates an element of this kind. Defaults to `label`
   * (e.g. "Goal"). Use for modeller-specific numbering such as MutRoSe's `G1: …` / `AT1: …`.
   */
  readonly defaultName?: string | ((ctx: { model: IstarModel }) => string);
}

export interface ElementToolEntry extends PaletteEntry {
  /** customProperties preset on the element this entry creates, over `defaultProperties`. */
  readonly properties?: CustomProperties;
}

export interface LinkPaletteEntry extends PaletteEntry {
  /** Contribution value preset by this entry. */
  readonly label: string;
}

/**
 * How a link kind is drawn. piStar-ext's "Kind of Line" values are `dashed` ('10,5'),
 * `dotted` ('1,3') and `continuous` (no dash); see `LINE_DASHES`.
 */
export interface LinkLineStyle {
  /** SVG dash array, e.g. '10,5'. Default: continuous. */
  readonly dash?: string;
  /**
   * Target marker as path data in JointJS's convention (as piStar-ext stores it): (0,0) is the
   * link end and +x points back towards the source. Default: an open arrow. `false`: none.
   */
  readonly marker?: string | false;
  /** Fill the marker (a solid arrowhead or dot). Default false. */
  readonly markerFilled?: boolean;
}

/** piStar-ext's line kinds, as dash arrays. */
export const LINE_DASHES: Readonly<Record<'continuous' | 'dashed' | 'dotted', string | undefined>> =
  {
    continuous: undefined,
    dashed: '10,5',
    dotted: '1,3',
  };

export interface LinkKindConfig<K extends string = LinkKind, DK extends string = NodeKind> {
  readonly kind: K;
  readonly label: string;
  readonly inspector?: ComponentType<InspectorProps<IstarLink>> | false;
  /**
   * Toolbar entries for this link kind. Contribution has one per value (make/help/hurt/break);
   * Dependency has one per dependum kind. `false` hides the kind.
   */
  readonly palette: readonly LinkToolEntry<DK>[] | false;
  readonly properties?: PropertySchema<PropertyShape, string>;
  /**
   * Line, dash and marker. Default: built-in kinds draw as in piStar; an extended kind draws
   * like the kind it behaves like, or as a continuous line with an open arrow.
   */
  readonly line?: LinkLineStyle;
  /**
   * Draws the link's label: an HTML component placed at the link's middle (React Flow's edge
   * label layer), e.g. for piStar-ext's `<<stereotype>> {tag = value}`. It replaces the default
   * labels (the fixed "is-a", the contribution value and, with `linkNames`, the name), which it
   * receives in `labels` to draw as it likes. Default: none, the built-in labels as in piStar.
   */
  readonly labelComponent?: ComponentType<LinkLabelProps>;
}

/** Props of a link kind's `labelComponent`. */
export interface LinkLabelProps {
  readonly link: IstarLink<string>;
  readonly model: IstarModel<string, string>;
  readonly metamodel: AnyMetamodel;
  readonly selected: boolean;
  /** The texts the default label would draw. */
  readonly labels: {
    /** The kind's fixed label ("is-a", "participates-in"). */
    readonly fixed?: string;
    /** The selectable value (a contribution's make/help/hurt/break). */
    readonly value?: string;
    /** The link's `name`, if set. */
    readonly name?: string;
  };
}

export interface LinkToolEntry<DK extends string = NodeKind> extends PaletteEntry {
  /** Contribution value to set on the new link. */
  readonly value?: string;
  /** For dependencies: the kind of dependum to create. */
  readonly dependum?: DK;
}

/**
 * Per-kind configuration of the editor. `EK`/`LK` are the element and link kinds; they default
 * to iStar 2.0's. `registryForMetamodel` builds one covering an extended metamodel.
 */
export interface IstarRegistry<EK extends string = ElementKind, LK extends string = LinkKind> {
  readonly elements: Readonly<Record<EK, ElementKindConfig<EK>>>;
  readonly links: Readonly<Record<LK, LinkKindConfig<LK, Exclude<EK, ActorKind>>>>;
  /** Labels for palette groups, keyed by `PaletteEntry.group`. */
  readonly paletteGroups: Readonly<Record<string, PaletteGroup>>;
}

/** A registry of any dialect, for code that handles every kind generically. */
export type AnyIstarRegistry = IstarRegistry<string, string>;

export type ElementKindOverride = Partial<Omit<ElementKindConfig<string>, 'kind' | 'palette'>> & {
  /**
   * A partial entry is merged into the kind's entry (into each one, if it has a list); a list
   * replaces them, each item inheriting the kind's icon, section and order unless it sets its
   * own; `false` hides the kind.
   */
  readonly palette?: Partial<PaletteEntry> | readonly ElementToolEntry[] | false;
};
export type LinkKindOverride = Partial<Omit<LinkKindConfig<string, string>, 'kind'>>;

export interface RegistryOverrides<EK extends string = ElementKind, LK extends string = LinkKind> {
  readonly elements?: Partial<Record<EK, ElementKindOverride>>;
  readonly links?: Partial<Record<LK, LinkKindOverride>>;
  readonly paletteGroups?: Readonly<Record<string, PaletteGroup>>;
}

// ---------------------------------------------------------------------------------------------
// Defaults

const ELEMENT_TITLES: Partial<Record<ElementKind, string>> = {
  'istar.Actor': 'Add an Actor: click on an empty spot of the diagram',
  'istar.Agent': 'Add an Agent: click on an empty spot of the diagram',
  'istar.Role': 'Add a Role: click on an empty spot of the diagram',
  // From piStar's ui.metamodel.js buttonStatusText.
  'istar.Goal': 'Adding Goal: click on an actor/role/agent to add a Goal',
  'istar.Quality': 'Adding Quality: click on an actor/role/agent to add a Quality',
  'istar.Task': 'Adding Task: click on an actor/role/agent to add a Task',
  'istar.Resource': 'Adding Resource: click on an actor/role/agent to add a Resource',
};

function defaultElementConfig(kind: ElementKind, index: number): ElementKindConfig {
  const label = shortKindName(kind);
  const actor = isActorKind(kind);
  return {
    kind,
    label,
    size: DEFAULT_ELEMENT_SIZE[kind],
    component: actor ? DefaultActorComponent : DefaultElementComponent,
    resizable: !actor,
    palette: {
      label,
      title: ELEMENT_TITLES[kind],
      icon: elementIcon(kind),
      // piStar order: Actor… | Actor links… | Dependency… ‖ Goal Quality Resource Task | links
      order: actor ? index : 30 + index,
      section: actor ? 'actors' : 'elements',
      ...(actor ? { group: 'actors' } : {}),
    },
  };
}

// Link toolbar labels and hints from piStar's ui.metamodel.js.
const LINK_DEFAULTS: Record<LinkKind, Omit<LinkKindConfig, 'kind'>> = {
  'istar.IsALink': {
    label: 'Is-A',
    palette: [
      {
        label: 'Is A',
        order: 10,
        group: 'actor-links',
        section: 'actors',
        icon: linkIcon('istar.IsALink', 'is a'),
        title:
          'Add an Is-A link between an Actor and another Actor, or between a Role and another Role: drag from the sub-actor to the super-actor',
      },
    ],
  },
  'istar.ParticipatesInLink': {
    label: 'Participates-In',
    palette: [
      {
        label: 'Participates-In',
        order: 11,
        group: 'actor-links',
        section: 'actors',
        icon: linkIcon('istar.ParticipatesInLink', 'part. in'),
        title: 'Add a Participates-In link between any Actors, Roles, or Agents',
      },
    ],
  },
  'istar.DependencyLink': {
    label: 'Dependency',
    palette: NODE_KINDS.map((dependum, i) => ({
      label: `${shortKindName(dependum)} dependency`,
      dependum,
      order: 20 + i,
      group: 'dependencies',
      section: 'actors',
      icon: dependencyIcon(dependum),
      title: `Add a dependency with a ${shortKindName(dependum)} dependum: drag from the depender to the dependee`,
    })),
  },
  'istar.AndRefinementLink': {
    label: 'And-Refinement',
    palette: [
      {
        label: 'And',
        order: 40,
        section: 'elements',
        icon: linkIcon('istar.AndRefinementLink'),
        title:
          'Add And-Refinement link: drag from the child to the parent. It can only be applied to goals or tasks.',
      },
    ],
  },
  'istar.OrRefinementLink': {
    label: 'Or-Refinement',
    palette: [
      {
        label: 'Or',
        order: 41,
        section: 'elements',
        icon: linkIcon('istar.OrRefinementLink'),
        title:
          'Add Or-Refinement link: drag from the child to the parent. It can only be applied to goals or tasks.',
      },
    ],
  },
  'istar.NeededByLink': {
    label: 'Needed-By',
    palette: [
      {
        label: 'Needed-By',
        order: 42,
        section: 'elements',
        icon: linkIcon('istar.NeededByLink'),
        title:
          'Add Needed-By link: drag from the Resource that is needed to the Task that needs it.',
      },
    ],
  },
  'istar.QualificationLink': {
    label: 'Qualification',
    palette: [
      {
        label: 'Qualification',
        order: 43,
        section: 'elements',
        icon: linkIcon('istar.QualificationLink'),
        title:
          'Add Qualification link: drag from the Quality to the element it qualifies (Goal, Task or Resource).',
      },
    ],
  },
  'istar.ContributionLink': {
    label: 'Contribution',
    palette: CONTRIBUTION_LABELS.map((value, i) => ({
      label: { make: 'Make (++)', help: 'Help (+)', hurt: 'Hurt (-)', break: 'Break (--)' }[value],
      value,
      order: 50 + i,
      group: 'contributions',
      section: 'elements',
      icon: linkIcon('istar.ContributionLink', value),
      title: `Add a ${value} contribution: drag from an element to the Quality it contributes to`,
    })),
  },
};

function buildDefaultRegistry(): IstarRegistry {
  const elements = {} as Record<ElementKind, ElementKindConfig>;
  ELEMENT_KINDS.forEach((kind, i) => {
    elements[kind] = defaultElementConfig(kind, i);
  });
  const links = {} as Record<LinkKind, LinkKindConfig>;
  for (const kind of LINK_KINDS) links[kind] = { kind, ...LINK_DEFAULTS[kind] };
  return { elements, links, paletteGroups: DEFAULT_PALETTE_GROUPS };
}

/** piStar's dropdown buttons. */
const DEFAULT_PALETTE_GROUPS: Readonly<Record<string, PaletteGroup>> = {
  actors: { label: 'Actor', title: 'Add an Actor, Agent or Role' },
  'actor-links': { label: 'Actor links', title: 'Add an Is-A or Participates-In link' },
  dependencies: { label: 'Dependency', title: 'Add a dependency' },
  contributions: { label: 'Contribution', title: 'Add a Make, Help, Hurt or Break contribution' },
};

/** A registry that looks and behaves like the piStar tool. */
export const defaultRegistry: IstarRegistry = buildDefaultRegistry();

function mergeElementPalette(
  current: ElementKindConfig,
  palette: ElementKindOverride['palette'],
): ElementKindConfig['palette'] {
  if (palette === undefined) return current.palette;
  if (palette === false) return false;
  // What list items inherit: the kind's own entry (its first, if it already has a list).
  const base: PaletteEntry = Array.isArray(current.palette)
    ? (current.palette[0] ?? { label: current.label })
    : (current.palette as PaletteEntry | false) || { label: current.label };
  const inherited = {
    ...(base.icon !== undefined && { icon: base.icon }),
    ...(base.section !== undefined && { section: base.section }),
    ...(base.order !== undefined && { order: base.order }),
  };
  if (Array.isArray(palette)) {
    return (palette as readonly ElementToolEntry[]).map((entry) => ({ ...inherited, ...entry }));
  }
  const partial = palette as Partial<PaletteEntry>;
  if (Array.isArray(current.palette)) {
    return current.palette.map((entry) => ({ ...entry, ...partial }));
  }
  return { ...((current.palette as PaletteEntry | false) || { label: current.label }), ...partial };
}

/**
 * Builds a registry from `base` (the default registry unless given) with per-kind overrides.
 * Palette overrides are merged into the base entry; `false` removes the kind from the palette.
 * Overrides for kinds the base doesn't know are ignored (complete it first with
 * `registryForMetamodel`).
 */
// The iStar 2.0 overload comes last, so function references type as before.
export function createRegistry<EK extends string, LK extends string>(
  overrides: RegistryOverrides<EK, LK>,
  base: IstarRegistry<EK, LK>,
): IstarRegistry<EK, LK>;
export function createRegistry(overrides?: RegistryOverrides, base?: IstarRegistry): IstarRegistry;
export function createRegistry(
  overrides: RegistryOverrides<string, string> = {},
  base: AnyIstarRegistry = defaultRegistry as unknown as AnyIstarRegistry,
): AnyIstarRegistry {
  const elements: Record<string, ElementKindConfig<string>> = { ...base.elements };
  for (const [kind, override] of Object.entries(overrides.elements ?? {})) {
    const current = elements[kind];
    if (!current || !override) continue;
    const { palette, ...rest } = override;
    elements[kind] = {
      ...current,
      ...rest,
      palette: mergeElementPalette(current as ElementKindConfig, palette),
    } as ElementKindConfig<string>;
  }
  const links: Record<string, LinkKindConfig<string, string>> = { ...base.links };
  for (const [kind, override] of Object.entries(overrides.links ?? {})) {
    const current = links[kind];
    if (!current || !override) continue;
    links[kind] = { ...current, ...override };
  }
  return { elements, links, paletteGroups: { ...base.paletteGroups, ...overrides.paletteGroups } };
}

/**
 * Adapts the piStar defaults to another modeller: per-kind element and link overrides
 * (`component`, `defaultProperties`, `inspector`, `palette`, `properties`, `shape`, `line`, …)
 * and palette groups. The editor itself knows nothing about any particular modeller;
 * extensions carry that.
 *
 * An extension may also bring new kinds (`metamodel`, see `extendMetamodel` in
 * `@istar-ts/core`): `metamodelWithExtensions` applies them, and the editor then offers the
 * new kinds in its palette and draws them with their `shape` / `line`.
 *
 * @example
 * const variables: IstarExtension = {
 *   name: 'typed-resources',
 *   elements: { 'istar.Resource': { properties: resourceSchema, inspector: ResourceInspector } },
 * };
 * <IstarCanvas store={store} extensions={[variables]} />
 */
export interface IstarExtension<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> extends RegistryOverrides<EK, LK> {
  readonly name: string;
  /** New element and link kinds this extension adds to the metamodel. */
  readonly metamodel?: MetamodelExtension<string, string>;
}

/**
 * The metamodel an editor needs for `extensions`: `base` (iStar 2.0 by default) extended with
 * each extension's `metamodel` part, in order. Parse files with it (`parsePistar(text, {
 * metamodel })`) or create stores with it, then pass the same `extensions` to the canvas.
 */
export function metamodelWithExtensions(
  extensions: readonly { readonly metamodel?: MetamodelExtension<string, string> }[],
  base: Metamodel<string, string> = ISTAR_2_0 as unknown as Metamodel<string, string>,
): Metamodel<string, string> {
  return extensions.reduce<Metamodel<string, string>>(
    (metamodel, extension) =>
      extension.metamodel && !metamodel.extensions.includes(extension.metamodel.name)
        ? extendMetamodel(metamodel, extension.metamodel)
        : metamodel,
    base,
  );
}

/** Applies extensions in order on top of `base` (later extensions win). */
export function applyExtensions<EK extends string = ElementKind, LK extends string = LinkKind>(
  base: IstarRegistry<EK, LK>,
  extensions: readonly RegistryOverrides<EK, LK>[],
): IstarRegistry<EK, LK> {
  return extensions.reduce<IstarRegistry<EK, LK>>(
    (registry, ext) => createRegistry(ext, registry),
    base,
  );
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Completes `base` with default configurations for the kinds of `metamodel` it lacks (those
 * an extension added): the kind's label and size, the default components, and a palette entry
 * after the built-in ones, as piStar-ext adds new constructs to its toolbar. Extended node
 * kinds that can be dependums also get an entry in the dependency menu.
 */
export function registryForMetamodel<EK extends string, LK extends string>(
  metamodel: Metamodel<EK, LK>,
  base: IstarRegistry = defaultRegistry,
): IstarRegistry<EK, LK> {
  const meta = metamodel as unknown as AnyMetamodel;
  const from = base as unknown as AnyIstarRegistry;
  const elements: Record<string, ElementKindConfig<string>> = { ...from.elements };
  const links: Record<string, LinkKindConfig<string, string>> = { ...from.links };
  let extraNode = 0;
  let extraActor = 0;
  const newDependums: string[] = [];
  for (const definition of meta.elements.values()) {
    if (elements[definition.kind]) continue;
    const actor = definition.category === 'actor';
    const order = actor ? 2 + ++extraActor / 100 : 36 + ++extraNode / 100;
    elements[definition.kind] = {
      kind: definition.kind,
      label: definition.label,
      size: definition.size,
      component: actor ? DefaultActorComponent : DefaultElementComponent,
      resizable: !actor,
      palette: {
        label: definition.label,
        title: actor
          ? `Add ${article(definition.label)} ${definition.label}: click on an empty spot of the diagram`
          : `Adding ${definition.label}: click on an actor/role/agent to add ${article(definition.label)} ${definition.label}`,
        order,
        section: actor ? 'actors' : 'elements',
        ...(actor ? { group: 'actors' } : {}),
      },
    };
    if (!actor && definition.info?.canBeDependum) newDependums.push(definition.kind);
  }
  let extraLink = 0;
  for (const definition of meta.links.values()) {
    if (links[definition.kind]) continue;
    const order = 44 + ++extraLink / 100;
    const entry: LinkToolEntry<string> = {
      label: definition.label,
      title: `Add ${article(definition.label)} ${definition.label} link: drag from the source to the target`,
      order,
      section: definition.category === 'actor' ? 'actors' : 'elements',
      ...(definition.category === 'actor' ? { group: 'actor-links' } : {}),
    };
    links[definition.kind] = {
      kind: definition.kind,
      label: definition.label,
      palette:
        definition.category === 'dependency'
          ? [...meta.elements.values()]
              .filter((e) => e.category === 'node' && e.info?.canBeDependum)
              .map((e, i) => ({
                label: `${e.label} ${definition.label.toLowerCase()}`,
                dependum: e.kind,
                order: order + i / 1000,
                section: 'actors',
                group: 'dependencies',
                title: `Add ${article(definition.label)} ${definition.label} with ${article(e.label)} ${e.label} dependum: drag from the depender to the dependee`,
              }))
          : [entry],
    };
  }
  // Extended node kinds can be dependums of the built-in dependency too.
  const dependency = links['istar.DependencyLink'];
  if (dependency && Array.isArray(dependency.palette) && newDependums.length > 0) {
    const palette = dependency.palette as readonly LinkToolEntry<string>[];
    const last = palette[palette.length - 1];
    links['istar.DependencyLink'] = {
      ...dependency,
      palette: [
        ...palette,
        ...newDependums.map((kind, i) => {
          const label = meta.elements.get(kind)!.label;
          return {
            label: `${label} dependency`,
            dependum: kind,
            order: (last?.order ?? 20) + (i + 1) / 100,
            section: last?.section ?? 'actors',
            group: last?.group ?? 'dependencies',
            title: `Add a dependency with ${article(label)} ${label} dependum: drag from the depender to the dependee`,
          };
        }),
      ],
    };
  }
  return {
    elements,
    links,
    paletteGroups: from.paletteGroups,
  } as unknown as IstarRegistry<EK, LK>;
}

/** Resolves `defaultProperties` for a new element of `kind`. */
export function defaultPropertiesFor<EK extends string = ElementKind, LK extends string = LinkKind>(
  registry: IstarRegistry<EK, LK>,
  kind: string,
  model: IstarModel<EK, LK>,
): CustomProperties | undefined {
  const config = (registry as unknown as AnyIstarRegistry).elements[kind];
  if (!config) return undefined;
  const preset = config.defaultProperties;
  const fromPreset =
    typeof preset === 'function' ? preset({ model: model as unknown as IstarModel }) : preset;
  const fromSchema = config.properties?.defaults();
  if (!fromPreset && !fromSchema) return undefined;
  return { ...fromSchema, ...fromPreset };
}

/** Resolves the name for a newly created element of `kind`. */
export function defaultNameFor<EK extends string = ElementKind, LK extends string = LinkKind>(
  registry: IstarRegistry<EK, LK>,
  kind: string,
  model: IstarModel<EK, LK>,
): string {
  const config = (registry as unknown as AnyIstarRegistry).elements[kind];
  if (!config) return kind;
  const factory = config.defaultName;
  if (typeof factory === 'function') return factory({ model: model as unknown as IstarModel });
  if (typeof factory === 'string') return factory;
  return config.label;
}

/** The rendered size of an element: its display override or the registry size. */
export function elementSize<EK extends string = ElementKind, LK extends string = LinkKind>(
  registry: IstarRegistry<EK, LK>,
  element: IstarElement<string>,
): Size {
  const base = (registry as unknown as AnyIstarRegistry).elements[element.kind]?.size ?? {
    width: 90,
    height: 35,
  };
  return {
    width: typeof element.display?.width === 'number' ? element.display.width : base.width,
    height: typeof element.display?.height === 'number' ? element.display.height : base.height,
  };
}
