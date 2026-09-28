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
  CustomProperties,
  ElementKind,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkKind,
  NodeKind,
  PropertySchema,
  Size,
} from '@istar-ts/core';
import {
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
}

export interface InspectorProps<T extends IstarElement | IstarLink = IstarElement> {
  readonly target: T;
  readonly model: IstarModel;
  readonly actions: T extends IstarElement ? ElementActions : LinkActions;
  readonly readOnly: boolean;
  /** The kind's property schema, if the registry declares one. */
  readonly schema?: PropertySchema;
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
  readonly icon?: ReactNode;
  /** Lower comes first. */
  readonly order?: number;
}

export interface ElementKindConfig {
  readonly kind: ElementKind;
  readonly label: string;
  /** Default size (actors: initial boundary size). `display.width/height` override per element. */
  readonly size: Size;
  readonly component: ComponentType<ElementComponentProps>;
  readonly defaultProperties?:
    | CustomProperties
    | ((ctx: { model: IstarModel }) => CustomProperties);
  readonly inspector?: ComponentType<InspectorProps<IstarElement>> | false;
  readonly palette: PaletteEntry | false;
  /** Typed customProperties; the default inspector renders fields from it. */
  readonly properties?: PropertySchema;
}

export interface LinkPaletteEntry extends PaletteEntry {
  /** Contribution value preset by this entry. */
  readonly label: string;
}

export interface LinkKindConfig {
  readonly kind: LinkKind;
  readonly label: string;
  readonly inspector?: ComponentType<InspectorProps<IstarLink>> | false;
  /**
   * Toolbar entries for this link kind. Contribution has one per value (make/help/hurt/break);
   * Dependency has one per dependum kind. `false` hides the kind.
   */
  readonly palette: readonly LinkToolEntry[] | false;
  readonly properties?: PropertySchema;
}

export interface LinkToolEntry extends PaletteEntry {
  /** Contribution value to set on the new link. */
  readonly value?: string;
  /** For dependencies: the kind of dependum to create. */
  readonly dependum?: NodeKind;
}

export interface IstarRegistry {
  readonly elements: Readonly<Record<ElementKind, ElementKindConfig>>;
  readonly links: Readonly<Record<LinkKind, LinkKindConfig>>;
}

export type ElementKindOverride = Partial<Omit<ElementKindConfig, 'kind' | 'palette'>> & {
  readonly palette?: Partial<PaletteEntry> | false;
};
export type LinkKindOverride = Partial<Omit<LinkKindConfig, 'kind'>>;

export interface RegistryOverrides {
  readonly elements?: Partial<Record<ElementKind, ElementKindOverride>>;
  readonly links?: Partial<Record<LinkKind, LinkKindOverride>>;
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

function defaultElementConfig(kind: ElementKind, order: number): ElementKindConfig {
  const label = shortKindName(kind);
  return {
    kind,
    label,
    size: DEFAULT_ELEMENT_SIZE[kind],
    component: isActorKind(kind) ? DefaultActorComponent : DefaultElementComponent,
    palette: { label, title: ELEMENT_TITLES[kind], order },
  };
}

// Link toolbar labels and hints from piStar's ui.metamodel.js.
const LINK_DEFAULTS: Record<LinkKind, Omit<LinkKindConfig, 'kind'>> = {
  'istar.IsALink': {
    label: 'Is-A',
    palette: [
      {
        label: 'Is A',
        order: 100,
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
        order: 110,
        title: 'Add a Participates-In link between any Actors, Roles, or Agents',
      },
    ],
  },
  'istar.DependencyLink': {
    label: 'Dependency',
    palette: NODE_KINDS.map((dependum, i) => ({
      label: `${shortKindName(dependum)} dependency`,
      dependum,
      order: 120 + i,
      title: `Add a dependency with a ${shortKindName(dependum)} dependum: drag from the depender to the dependee`,
    })),
  },
  'istar.AndRefinementLink': {
    label: 'And-Refinement',
    palette: [
      {
        label: 'And',
        order: 200,
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
        order: 210,
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
        order: 220,
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
        order: 230,
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
      order: 240 + i,
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
  return { elements, links };
}

/** A registry that looks and behaves like the piStar tool. */
export const defaultRegistry: IstarRegistry = buildDefaultRegistry();

/**
 * Builds a registry from `base` (the default registry unless given) with per-kind overrides.
 * Palette overrides are merged into the base entry; `false` removes the kind from the palette.
 */
export function createRegistry(
  overrides: RegistryOverrides = {},
  base: IstarRegistry = defaultRegistry,
): IstarRegistry {
  const elements = { ...base.elements };
  for (const [kind, override] of Object.entries(overrides.elements ?? {}) as [
    ElementKind,
    ElementKindOverride,
  ][]) {
    const current = elements[kind];
    const { palette, ...rest } = override;
    elements[kind] = {
      ...current,
      ...rest,
      palette:
        palette === undefined
          ? current.palette
          : palette === false
            ? false
            : { ...(current.palette || { label: current.label }), ...palette },
    };
  }
  const links = { ...base.links };
  for (const [kind, override] of Object.entries(overrides.links ?? {}) as [
    LinkKind,
    LinkKindOverride,
  ][]) {
    links[kind] = { ...links[kind], ...override };
  }
  return { elements, links };
}

/** Resolves `defaultProperties` for a new element of `kind`. */
export function defaultPropertiesFor(
  registry: IstarRegistry,
  kind: ElementKind,
  model: IstarModel,
): CustomProperties | undefined {
  const config = registry.elements[kind];
  const preset = config.defaultProperties;
  const fromPreset = typeof preset === 'function' ? preset({ model }) : preset;
  const fromSchema = config.properties?.defaults();
  if (!fromPreset && !fromSchema) return undefined;
  return { ...fromSchema, ...fromPreset };
}

/** The rendered size of an element: its display override or the registry size. */
export function elementSize(registry: IstarRegistry, element: IstarElement): Size {
  const base = registry.elements[element.kind].size;
  return {
    width: typeof element.display?.width === 'number' ? element.display.width : base.width,
    height: typeof element.display?.height === 'number' ? element.display.height : base.height,
  };
}
