/**
 * Metamodels as values: iStar 2.0 (`ISTAR_2_0`) plus dialects built with `extendMetamodel`,
 * which add element kinds (e.g. iStar4RationalAgents' Planning and Plan) and link kinds.
 *
 * The constants in `metamodel.ts` (`ELEMENT_KINDS`, `NODE_KIND_INFO`, …) describe iStar 2.0 and
 * stay as they are; this module builds `ISTAR_2_0` from them. Everything that accepts a
 * metamodel defaults to `ISTAR_2_0`, so code that never mentions one behaves exactly as before.
 *
 * Extensions follow piStar-ext (Gonçalves et al., iStar 2020): a new construct has a name, a
 * node-or-link category and, for links, the kinds it may connect. Two additions make them
 * usable as a library: `behavesLike` lets a new kind reuse an existing kind's link rules
 * (Planning behaves like a Task, so it can be refined and be a dependum), and kinds are
 * namespaced (`rationalAgents.Planning`), with `istar.` reserved for iStar 2.0.
 */
import type { LinkCheck, LinkRuleContext } from './constraints';
import type { ElementKind, LinkKind, LinkKindInfo, NodeKindInfo, Size } from './metamodel';
import {
  ACTOR_KINDS,
  ACTOR_LINK_KINDS,
  DEFAULT_ELEMENT_SIZE,
  DEPENDENCY_LINK_KINDS,
  ISTAR_PREFIX,
  LINK_KIND_INFO,
  NODE_KINDS,
  NODE_KIND_INFO,
  NODE_LINK_KINDS,
} from './metamodel';

export type ElementCategory = 'actor' | 'node';

/**
 * Presentation hints a kind may carry, as data (core never draws). `@istar-ts/react` uses them as
 * the defaults for the kind: a shape as SVG path data, the label's text box, a link's line.
 */
export interface KindShape {
  readonly path: string;
  readonly viewBox?: string;
}
export interface KindTextBox {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
export interface KindLine {
  readonly dash?: string;
  readonly marker?: string | false;
  readonly markerFilled?: boolean;
}
export type LinkCategory = 'actor' | 'node' | 'dependency';

/** A resolved element kind of a metamodel. */
export interface ElementKindDefinition<K extends string = string> {
  readonly kind: K;
  readonly category: ElementCategory;
  /** Human-readable name, e.g. "Goal" or "Planning". */
  readonly label: string;
  /** Default size; for actors the initial boundary size. */
  readonly size: Size;
  /** Containment rules (nodes only; actors have none). */
  readonly info?: NodeKindInfo;
  /** The kind whose link rules this kind follows (built-in kinds have none). */
  readonly behavesLike?: string;
  /** The `type` written in piStar files. Equal to `kind` unless declared otherwise. */
  readonly pistarType: string;
  /** Name of the extension that declared it; absent for iStar 2.0 kinds. */
  readonly extension?: string;
  /** Presentation hints (drawn by `@istar-ts/react`). */
  readonly shape?: KindShape;
  readonly textBox?: KindTextBox;
}

/**
 * Declarative link rules, as piStar-ext's "Create a new Construct" dialog collects them:
 * which kinds may be the source and target. Entries are kind names (`istar.Goal`,
 * `rationalAgents.Plan`) or categories (`node`, `actor`, `*`). A kind name also matches kinds
 * that behave like it, so `istar.Task` accepts a Planning that behaves like a Task.
 */
export interface LinkRules {
  readonly sources: readonly string[];
  readonly targets: readonly string[];
  /**
   * Source and target must belong to the same actor (iStar 2.0 Guide, page 14). Default true
   * for node links, ignored for actor links.
   */
  readonly sameActor?: boolean;
  /** Allow a dependum as source or target. Default false. */
  readonly allowDependum?: boolean;
  /** Allow a link from an element onto itself. Default false. */
  readonly allowSelf?: boolean;
  /**
   * At most one link `'kind'` of this kind, or `'any'` link at all, between the same two
   * elements (in either direction); `false` for no limit. Default `'kind'`.
   */
  readonly unique?: 'kind' | 'any' | false;
}

/** A resolved link kind of a metamodel. */
export interface LinkKindDefinition<K extends string = string> {
  readonly kind: K;
  readonly category: LinkCategory;
  readonly label: string;
  readonly info: LinkKindInfo;
  /** The link kind whose rules (and meaning, for other rules) this kind takes on. */
  readonly behavesLike?: string;
  /** Declarative rules, for link kinds that don't behave like another kind. */
  readonly rules?: LinkRules;
  /** An extra predicate, checked after the inherited or declarative rules pass. */
  readonly check?: (context: LinkRuleContext) => LinkCheck;
  readonly pistarType: string;
  readonly extension?: string;
  /** Presentation hint (drawn by `@istar-ts/react`). */
  readonly line?: KindLine;
}

/** A metamodel: the element and link kinds a model may use, and their rules. */
export interface Metamodel<EK extends string = ElementKind, LK extends string = LinkKind> {
  /** `istar-2.0`, followed by the names of the extensions applied, e.g. `istar-2.0+rationalAgents`. */
  readonly name: string;
  readonly extensions: readonly string[];
  /** In declaration order: iStar 2.0 kinds first, then each extension's. */
  readonly elements: ReadonlyMap<EK, ElementKindDefinition<EK>>;
  readonly links: ReadonlyMap<LK, LinkKindDefinition<LK>>;
  /** `type` in piStar files → kind. */
  readonly elementsByPistarType: ReadonlyMap<string, EK>;
  readonly linksByPistarType: ReadonlyMap<string, LK>;
}

/** The kinds of a metamodel, as type-level unions. */
export type ElementKindOf<M> = M extends Metamodel<infer EK, string> ? EK : never;
export type LinkKindOf<M> = M extends Metamodel<string, infer LK> ? LK : never;

/** A metamodel of any dialect, for code that handles every kind generically. */
export type AnyMetamodel = Metamodel<string, string>;

// ---------------------------------------------------------------------------------------------
// iStar 2.0

function shortName(kind: string): string {
  const dot = kind.indexOf('.');
  return dot === -1 ? kind : kind.slice(dot + 1);
}

function buildIstar(): Metamodel {
  const elements = new Map<ElementKind, ElementKindDefinition<ElementKind>>();
  for (const kind of ACTOR_KINDS) {
    elements.set(kind, {
      kind,
      category: 'actor',
      label: shortName(kind),
      size: DEFAULT_ELEMENT_SIZE[kind],
      pistarType: kind,
    });
  }
  for (const kind of NODE_KINDS) {
    elements.set(kind, {
      kind,
      category: 'node',
      label: shortName(kind),
      size: DEFAULT_ELEMENT_SIZE[kind],
      info: NODE_KIND_INFO[kind],
      pistarType: kind,
    });
  }
  const links = new Map<LinkKind, LinkKindDefinition<LinkKind>>();
  const labels: Record<LinkKind, string> = {
    'istar.IsALink': 'Is-A',
    'istar.ParticipatesInLink': 'Participates-In',
    'istar.DependencyLink': 'Dependency',
    'istar.AndRefinementLink': 'And-Refinement',
    'istar.OrRefinementLink': 'Or-Refinement',
    'istar.NeededByLink': 'Needed-By',
    'istar.QualificationLink': 'Qualification',
    'istar.ContributionLink': 'Contribution',
  };
  const add = (kinds: readonly LinkKind[], category: LinkCategory): void => {
    for (const kind of kinds) {
      links.set(kind, {
        kind,
        category,
        label: labels[kind],
        info: LINK_KIND_INFO[kind],
        pistarType: kind,
      });
    }
  };
  add(ACTOR_LINK_KINDS, 'actor');
  add(DEPENDENCY_LINK_KINDS, 'dependency');
  add(NODE_LINK_KINDS, 'node');
  return {
    name: 'istar-2.0',
    extensions: [],
    elements,
    links,
    elementsByPistarType: new Map([...elements.keys()].map((k) => [k, k])),
    linksByPistarType: new Map([...links.keys()].map((k) => [k, k])),
  };
}

/** iStar 2.0, as the piStar tool implements it. The default metamodel everywhere. */
export const ISTAR_2_0: Metamodel = buildIstar();

// ---------------------------------------------------------------------------------------------
// Extensions

export interface ElementKindDeclaration<K extends string = string> {
  /** Namespaced kind name, e.g. `rationalAgents.Planning`. */
  readonly kind: K;
  /** Default: the part after the namespace ("Planning"). */
  readonly label?: string;
  /** Required unless `behavesLike` is given (then it is the same category). */
  readonly category?: ElementCategory;
  /** An existing element kind whose link rules this kind follows, e.g. `istar.Task`. */
  readonly behavesLike?: string;
  /** Containment rules for nodes. Default: those of `behavesLike`, else piStar-ext's (inner, dependum). */
  readonly info?: Partial<NodeKindInfo>;
  /** Default: that of `behavesLike`, else piStar-ext's 90×55 for nodes and 200×120 for actors. */
  readonly size?: Size;
  /**
   * The `type` used in piStar files, when it differs from `kind`. piStar-ext saves its new
   * constructs as `istar.<Name>`, so `pistarType: 'istar.Planning'` reads its files.
   */
  readonly pistarType?: string;
  /** Presentation hints, kept as data for renderers (`@istar-ts/react` draws them). */
  readonly shape?: KindShape;
  readonly textBox?: KindTextBox;
}

export interface LinkKindDeclaration<K extends string = string> {
  readonly kind: K;
  readonly label?: string;
  /** Default: that of `behavesLike`, else `node`. */
  readonly category?: LinkCategory;
  /** An existing link kind whose rules this kind takes on, e.g. `istar.OrRefinementLink`. */
  readonly behavesLike?: string;
  /** Declarative rules; give these or `behavesLike`, not both. */
  readonly rules?: LinkRules;
  /** An extra predicate, checked after the other rules pass. */
  readonly check?: (context: LinkRuleContext) => LinkCheck;
  /** Default: that of `behavesLike`, else none (no fixed label, no changeable value). */
  readonly info?: LinkKindInfo;
  readonly pistarType?: string;
  /** Presentation hint, kept as data for renderers (`@istar-ts/react` draws it). */
  readonly line?: KindLine;
}

/** A named set of new kinds, applied to a metamodel with `extendMetamodel`. */
export interface MetamodelExtension<NEK extends string = string, NLK extends string = string> {
  /** Identifies the extension, e.g. `rationalAgents`. */
  readonly name: string;
  readonly elements?: readonly ElementKindDeclaration<NEK>[];
  readonly links?: readonly LinkKindDeclaration<NLK>[];
}

export class MetamodelError extends Error {
  override name = 'MetamodelError';
}

/**
 * Declares an extension, keeping its kind names as literal types (so `extendMetamodel` can
 * type the result). Identity at runtime.
 */
export function defineMetamodelExtension<
  const NEK extends string = never,
  const NLK extends string = never,
>(extension: MetamodelExtension<NEK, NLK>): MetamodelExtension<NEK, NLK> {
  return extension;
}

const KIND_NAME = /^[A-Za-z_][\w-]*\.[A-Za-z_][\w-]*$/;
const CATEGORY_SELECTORS: ReadonlySet<string> = new Set(['node', 'actor', '*']);

/**
 * Returns a new metamodel with the extension's kinds added. `base` is not modified.
 *
 * Throws `MetamodelError` when a kind name isn't namespaced, uses the reserved `istar.`
 * prefix, collides with an existing kind or piStar type, or refers to an unknown kind.
 */
export function extendMetamodel<
  EK extends string,
  LK extends string,
  const NEK extends string = never,
  const NLK extends string = never,
>(base: Metamodel<EK, LK>, extension: MetamodelExtension<NEK, NLK>): Metamodel<EK | NEK, LK | NLK> {
  const where = `extension "${extension.name}"`;
  if (!extension.name || typeof extension.name !== 'string') {
    throw new MetamodelError('an extension needs a name');
  }
  if (base.extensions.includes(extension.name)) {
    throw new MetamodelError(`${where} is already applied`);
  }

  const elements = new Map<string, ElementKindDefinition<string>>(base.elements);
  const links = new Map<string, LinkKindDefinition<string>>(base.links);
  const elementsByType = new Map<string, string>(base.elementsByPistarType);
  const linksByType = new Map<string, string>(base.linksByPistarType);

  const claimName = (kind: string, what: string): void => {
    if (typeof kind !== 'string' || !KIND_NAME.test(kind)) {
      throw new MetamodelError(
        `${where}: ${what} kind ${JSON.stringify(kind)} must be namespaced, e.g. "${extension.name}.Name"`,
      );
    }
    if (kind.startsWith(`${ISTAR_PREFIX}.`)) {
      throw new MetamodelError(
        `${where}: ${what} kind "${kind}" uses the reserved "${ISTAR_PREFIX}." prefix; ` +
          `name it "${extension.name}.${shortName(kind)}" and set pistarType: "${kind}" to read files that use it`,
      );
    }
    if (elements.has(kind) || links.has(kind)) {
      throw new MetamodelError(`${where}: kind "${kind}" already exists`);
    }
  };
  const claimType = (type: string, kind: string): void => {
    if (typeof type !== 'string' || type === '') {
      throw new MetamodelError(`${where}: kind "${kind}" has an empty pistarType`);
    }
    if (
      elementsByType.has(type) ||
      linksByType.has(type) ||
      elements.has(type) ||
      links.has(type)
    ) {
      throw new MetamodelError(
        `${where}: pistarType "${type}" of kind "${kind}" is already used by another kind`,
      );
    }
  };

  for (const declaration of extension.elements ?? []) {
    const { kind } = declaration;
    claimName(kind, 'element');
    let parent: ElementKindDefinition<string> | undefined;
    if (declaration.behavesLike !== undefined) {
      parent = elements.get(declaration.behavesLike);
      if (!parent) {
        throw new MetamodelError(
          `${where}: "${kind}" behaves like unknown element kind "${declaration.behavesLike}"`,
        );
      }
    }
    const category = declaration.category ?? parent?.category;
    if (category !== 'actor' && category !== 'node') {
      throw new MetamodelError(
        `${where}: element kind "${kind}" needs a category ("node" or "actor") or behavesLike`,
      );
    }
    if (parent && parent.category !== category) {
      throw new MetamodelError(
        `${where}: "${kind}" is a ${category} but behaves like "${parent.kind}", a ${parent.category}`,
      );
    }
    const type = declaration.pistarType ?? kind;
    claimType(type, kind);
    const baseInfo: NodeKindInfo = parent?.info ?? {
      // piStar-ext's defaults for new nodes (tool/language/metamodel.js).
      canBeInnerElement: true,
      canBeDependum: true,
      canBeOnPaper: false,
    };
    const definition: ElementKindDefinition<string> = {
      kind,
      category,
      label: declaration.label ?? shortName(kind),
      size:
        declaration.size ??
        parent?.size ??
        (category === 'actor' ? { width: 200, height: 120 } : { width: 90, height: 55 }),
      ...(category === 'node' ? { info: { ...baseInfo, ...declaration.info } } : {}),
      ...(parent ? { behavesLike: parent.kind } : {}),
      pistarType: type,
      extension: extension.name,
      ...(declaration.shape ? { shape: declaration.shape } : {}),
      ...(declaration.textBox ? { textBox: declaration.textBox } : {}),
    };
    elements.set(kind, definition);
    elementsByType.set(type, kind);
  }

  for (const declaration of extension.links ?? []) {
    const { kind } = declaration;
    claimName(kind, 'link');
    if ((declaration.behavesLike === undefined) === (declaration.rules === undefined)) {
      throw new MetamodelError(
        `${where}: link kind "${kind}" needs exactly one of behavesLike or rules`,
      );
    }
    let parent: LinkKindDefinition<string> | undefined;
    if (declaration.behavesLike !== undefined) {
      parent = links.get(declaration.behavesLike);
      if (!parent) {
        throw new MetamodelError(
          `${where}: "${kind}" behaves like unknown link kind "${declaration.behavesLike}"`,
        );
      }
    }
    const category = declaration.category ?? parent?.category ?? 'node';
    if (category !== 'node' && category !== 'actor' && category !== 'dependency') {
      throw new MetamodelError(
        `${where}: link kind "${kind}" has an unknown category "${category}"`,
      );
    }
    if (parent && parent.category !== category) {
      throw new MetamodelError(
        `${where}: "${kind}" is a ${category} link but behaves like "${parent.kind}", a ${parent.category} link`,
      );
    }
    if (category === 'dependency' && !parent) {
      throw new MetamodelError(
        `${where}: dependency link kind "${kind}" must behave like a dependency link (its dependum makes declarative rules ambiguous)`,
      );
    }
    if (declaration.rules) {
      for (const [side, selectors] of [
        ['sources', declaration.rules.sources],
        ['targets', declaration.rules.targets],
      ] as const) {
        if (!Array.isArray(selectors) || selectors.length === 0) {
          throw new MetamodelError(`${where}: link kind "${kind}" needs at least one of ${side}`);
        }
        for (const selector of selectors) {
          if (!CATEGORY_SELECTORS.has(selector) && !elements.has(selector)) {
            throw new MetamodelError(
              `${where}: ${side} of "${kind}" names unknown element kind "${selector}"`,
            );
          }
        }
      }
    }
    const type = declaration.pistarType ?? kind;
    claimType(type, kind);
    const definition: LinkKindDefinition<string> = {
      kind,
      category,
      label: declaration.label ?? shortName(kind),
      info: declaration.info ?? parent?.info ?? {},
      ...(parent ? { behavesLike: parent.kind } : {}),
      ...(declaration.rules ? { rules: declaration.rules } : {}),
      ...(declaration.check ? { check: declaration.check } : {}),
      pistarType: type,
      extension: extension.name,
      ...(declaration.line ? { line: declaration.line } : {}),
    };
    links.set(kind, definition);
    linksByType.set(type, kind);
  }

  return {
    name: `${base.name}+${extension.name}`,
    extensions: [...base.extensions, extension.name],
    elements,
    links,
    elementsByPistarType: elementsByType,
    linksByPistarType: linksByType,
  } as unknown as Metamodel<EK | NEK, LK | NLK>;
}

// ---------------------------------------------------------------------------------------------
// Queries. They accept any string so code handling models of unknown dialects can ask.

export function elementKindDefinition(
  metamodel: AnyMetamodel,
  kind: string,
): ElementKindDefinition | undefined {
  return metamodel.elements.get(kind);
}

export function linkKindDefinition(
  metamodel: AnyMetamodel,
  kind: string,
): LinkKindDefinition | undefined {
  return metamodel.links.get(kind);
}

/** True for actor-category kinds (Actor, Agent, Role and extensions behaving like them). */
export function isActorKindIn(metamodel: AnyMetamodel, kind: string): boolean {
  return metamodel.elements.get(kind)?.category === 'actor';
}

/** True for node-category kinds (intentional elements, built-in or extended). */
export function isNodeKindIn(metamodel: AnyMetamodel, kind: string): boolean {
  return metamodel.elements.get(kind)?.category === 'node';
}

/**
 * The built-in (or rule-carrying) kind an element kind ultimately behaves like: `istar.Task`
 * for a Planning that behaves like a Task; the kind itself when it behaves like nothing.
 */
export function effectiveElementKind(metamodel: AnyMetamodel, kind: string): string {
  let current = metamodel.elements.get(kind);
  const seen = new Set<string>();
  while (current?.behavesLike !== undefined && !seen.has(current.kind)) {
    seen.add(current.kind);
    const next = metamodel.elements.get(current.behavesLike);
    if (!next) break;
    current = next;
  }
  return current?.kind ?? kind;
}

/** Like `effectiveElementKind`, for link kinds. */
export function effectiveLinkKind(metamodel: AnyMetamodel, kind: string): string {
  let current = metamodel.links.get(kind);
  const seen = new Set<string>();
  while (current?.behavesLike !== undefined && !seen.has(current.kind)) {
    seen.add(current.kind);
    const next = metamodel.links.get(current.behavesLike);
    if (!next) break;
    current = next;
  }
  return current?.kind ?? kind;
}

/** True when `kind` is `ancestor` or (transitively) behaves like it. */
export function elementBehavesLike(
  metamodel: AnyMetamodel,
  kind: string,
  ancestor: string,
): boolean {
  let current: string | undefined = kind;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = metamodel.elements.get(current)?.behavesLike;
  }
  return false;
}
