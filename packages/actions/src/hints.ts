/**
 * What a client can know before it asks: type hints from the metamodel, and the palette as
 * GLSP context actions. Both are derived from data (`Metamodel`, `PaletteDescription`), so they
 * work for any root or extension.
 */
import { effectiveLinkKind } from '@istar-ts/core';
import type {
  AnyMetamodel,
  AnyPaletteDescription,
  ElementToolEntryDescription,
  LinkToolEntryDescription,
  Metamodel,
  PaletteEntryDescription,
} from '@istar-ts/core';
import type {
  EdgeTypeHint,
  LabeledAction,
  SetContextActions,
  SetTypeHintsAction,
  ShapeTypeHint,
} from './actions';
import { isHub, ofCategory, union } from './kind-selectors';

/**
 * GLSP type hints of a metamodel. Shapes: every element kind (hubs can't be resized or
 * reparented; actors contain the node kinds that can be inner elements). Edges: every link kind,
 * its sources and targets from its rules, or by category for kinds with built-in rules (iStar
 * 2.0's), plus an n-ary kind's hub (`createEdge` onto a hub adds a leg to that link, #108). Edge
 * hints are `repositionable` (their ends can be reconnected) and `dynamic`: `canLink` checks more
 * than kinds.
 */
export function typeHintsFor<EK extends string, LK extends string>(
  metamodel: Metamodel<EK, LK>,
): Pick<SetTypeHintsAction, 'shapeHints' | 'edgeHints'> {
  const meta = metamodel as unknown as AnyMetamodel;
  const inner = [...meta.elements.values()]
    .filter((d) => d.category === 'node' && !isHub(d) && d.info?.canBeInnerElement !== false)
    .map((d) => d.kind);
  const shapeHints = [...meta.elements.values()].map((d): ShapeTypeHint => {
    const hub = isHub(d);
    return {
      elementTypeId: d.kind,
      repositionable: true,
      deletable: true,
      resizable: !hub,
      reparentable: !hub && d.category === 'node' && d.info?.canBeInnerElement !== false,
      ...(d.category === 'actor' ? { containableElementTypeIds: inner } : {}),
    };
  });
  const edgeHints = [...meta.links.values()].map((d): EdgeTypeHint => {
    const rules = meta.links.get(effectiveLinkKind(meta, d.kind))?.rules;
    const builtIn = d.category === 'dependency' ? ofCategory(meta) : ofCategory(meta, d.category);
    const targets = rules ? union(meta, rules.targets) : builtIn;
    // An n-ary kind's `createEdge` onto its hub adds a leg to that link (#108).
    const hub = d.parts?.hub;
    return {
      elementTypeId: d.kind,
      repositionable: true,
      deletable: true,
      routable: true,
      sourceElementTypeIds: rules ? union(meta, rules.sources) : builtIn,
      targetElementTypeIds: hub === undefined ? targets : [...targets, hub],
      dynamic: true,
    };
  });
  return { shapeHints, edgeHints };
}

function elementEntries(
  kind: string,
  value: PaletteEntryDescription | readonly ElementToolEntryDescription[],
): LabeledAction[] {
  const list: readonly ElementToolEntryDescription[] = Array.isArray(value)
    ? value
    : [value as PaletteEntryDescription];
  return list.map((entry, i) =>
    labeled(Array.isArray(value) ? `${kind}#${i}` : kind, entry, {
      kind: 'triggerNodeCreation',
      elementTypeId: kind,
      ...(entry.properties ? { args: { customProperties: entry.properties } } : {}),
    }),
  );
}

function linkEntries(kind: string, list: readonly LinkToolEntryDescription[]): LabeledAction[] {
  return list.map((entry, i) => {
    const args = {
      ...(entry.value === undefined ? {} : { value: entry.value }),
      ...(entry.dependum === undefined ? {} : { dependum: { kind: entry.dependum } }),
    };
    return labeled(`${kind}#${i}`, entry, {
      kind: 'triggerEdgeCreation',
      elementTypeId: kind,
      ...(Object.keys(args).length > 0 ? { args } : {}),
    });
  });
}

function order(action: LabeledAction): number {
  return action.order ?? Number.POSITIVE_INFINITY;
}

function labeled(
  id: string,
  entry: PaletteEntryDescription,
  action: LabeledAction['actions'][number],
): LabeledAction {
  return {
    id,
    label: entry.label,
    actions: [action],
    ...(entry.group === undefined ? {} : { group: entry.group }),
    ...(entry.section === undefined ? {} : { section: entry.section }),
    ...(entry.order === undefined ? {} : { order: entry.order }),
  };
}

/**
 * A palette as GLSP context actions: one `LabeledAction` per entry, triggering the client's
 * creation tool with the entry's presets, sorted by `order`. Only the metamodel's kinds are
 * offered, in the metamodel's order where orders tie; kinds the palette hides (`false`) or
 * lacks are left out.
 */
export function contextActionsFor<EK extends string, LK extends string>(
  palette: AnyPaletteDescription,
  metamodel: Metamodel<EK, LK>,
): Pick<SetContextActions, 'actions' | 'groups'> {
  const meta = metamodel as unknown as AnyMetamodel;
  const actions: LabeledAction[] = [];
  for (const kind of meta.elements.keys()) {
    const value = palette.elements[kind];
    if (value) actions.push(...elementEntries(kind, value));
  }
  for (const kind of meta.links.keys()) {
    const list = palette.links[kind];
    if (list) actions.push(...linkEntries(kind, list));
  }
  actions.sort((a, b) => (order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1));
  return { actions, groups: palette.groups };
}

/**
 * A minimal palette for a metamodel with none of its own: one toolbar entry per visible kind
 * (declaration order, actors first), labelled from the kind's own `label`. Kinds generated for
 * an n-ary link (a hub, leg or end — `role` set) are hidden, as a hand-written palette would
 * hide them (`KAOS_PALETTE`'s `RefinementLinkHub: false`, for instance). The fallback
 * `createActionDispatcher` and `contributionFor` (`@istar-ts/glsp`) both use when no palette
 * was given.
 */
export function paletteFromMetamodel(metamodel: AnyMetamodel): AnyPaletteDescription {
  const elements: Record<string, PaletteEntryDescription | false> = {};
  let order = 0;
  for (const definition of metamodel.elements.values()) {
    elements[definition.kind] =
      definition.role !== undefined
        ? false
        : {
            label: definition.label,
            order: order++,
            section: definition.category === 'actor' ? 'actors' : 'elements',
            ...(definition.category === 'actor' ? { group: 'actors' } : {}),
          };
  }
  const links: Record<string, readonly LinkToolEntryDescription[] | false> = {};
  order = 0;
  for (const definition of metamodel.links.values()) {
    links[definition.kind] =
      definition.role !== undefined
        ? false
        : [{ label: definition.label, order: order++, section: 'elements' }];
  }
  return { elements, links, groups: { actors: { label: 'Actor' } } };
}
