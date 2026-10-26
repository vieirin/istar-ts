/**
 * Metamodels as values. A root metamodel (`defineMetamodel`) is a whole modelling language:
 * iStar 2.0 (`ISTAR_2_0`) is one, and other goal languages (KAOS, NFR, …) can be others.
 * Dialects of a root are built with `extendMetamodel`, which adds element kinds (e.g.
 * iStar4RationalAgents' Planning and Plan) and link kinds.
 *
 * The constants in `metamodel.ts` (`ELEMENT_KINDS`, `NODE_KIND_INFO`, …) describe iStar 2.0 and
 * stay as they are; this module declares `ISTAR_2_0` from them. Everything that accepts a
 * metamodel defaults to `ISTAR_2_0`, so code that never mentions one behaves exactly as before.
 *
 * Extensions follow piStar-ext (Gonçalves et al., iStar 2020): a new construct has a name, a
 * node-or-link category and, for links, the kinds it may connect. Two additions make them
 * usable as a library: `behavesLike` lets a new kind reuse an existing kind's link rules
 * (Planning behaves like a Task, so it can be refined and be a dependum), and kinds are
 * namespaced (`rationalAgents.Planning`), with the root's prefix (`istar.` for iStar 2.0)
 * reserved for the root.
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
  /** SVG `stroke-dasharray` of the outline, e.g. `'8,4'` for a dashed shape. */
  readonly dash?: string;
  /** Outline width, when it differs from the renderer's default. */
  readonly strokeWidth?: number;
  /**
   * Default fill (any CSS colour) of the kind's elements and palette icon, when the element has
   * no `display.backgroundColor`; absent: the renderer's node fill (DSM3's KAOS is grey, its
   * NFR white).
   */
  readonly fill?: string;
}
export interface KindTextBox {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
/** piStar-ext's line kinds. */
export type LineDashKind = 'continuous' | 'dashed' | 'dotted';

/** piStar-ext's line kinds, as SVG dash arrays (`KindLine.dash`); `continuous` has none. */
export const LINE_DASHES: Readonly<Record<LineDashKind, string | undefined>> = {
  continuous: undefined,
  dashed: '10,5',
  dotted: '1,3',
};

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
  /** `hub` for the kind generated for an n-ary link kind's hubs (see `LinkKindDeclaration.arity`). */
  readonly role?: 'hub';
  /** For a hub kind: the n-ary link kind it was generated for. */
  readonly of?: string;
  /**
   * What the kind means and when to use it, in 1-3 sentences: its definition, a hint for
   * choosing it over a neighbouring kind, and (for built-in kinds) a cited source. Rendered by
   * `@istar-ts/actions`' `metamodelContext` when present; optional so existing declarations and
   * extensions keep compiling.
   */
  readonly description?: string;
}

/** The kinds generated for an n-ary link kind: its hub element kind, leg and end link kinds. */
export interface HubLinkParts {
  readonly hub: string;
  readonly leg: string;
  readonly end: string;
}

/**
 * The kinds an n-ary link kind `K` generates under the default names: its hub element kind
 * (`<K>Hub`), its leg (`<K>Start`) and its end (`<K>End`). A schema for one of them is declared
 * like any other: `defineProperties('kaos.RefinementLinkStart', { … })`.
 */
export type HubPartKind<K extends string> = `${K}Hub` | `${K}Start` | `${K}End`;

/**
 * Declarative link rules, as piStar-ext's "Create a new Construct" dialog collects them:
 * which kinds may be the source and target. Entries are kind names (`istar.Goal`,
 * `rationalAgents.Plan`) or categories (`node`, `actor`, `*`). A kind name also matches kinds
 * that behave like it, so `istar.Task` accepts a Planning that behaves like a Task.
 *
 * A link may also target another link (NFR's Argument link points at a Contribution): `targets`
 * then holds `link` (any link) or link kind names. Sources are always elements.
 */
export interface LinkRules {
  readonly sources: readonly string[];
  /** Element selectors as for `sources`, plus `link` and link kind names. */
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
  /** `'n'` for an n-ary link kind (several sources joined at a hub); absent means 1. */
  readonly arity?: 1 | 'n';
  /** For an n-ary kind: the kinds generated for it. */
  readonly parts?: HubLinkParts;
  /** For a generated kind: `leg` (a source → the hub) or `end` (the hub → the target). */
  readonly role?: 'leg' | 'end';
  /** For a generated kind: the n-ary link kind it was generated for. */
  readonly of?: string;
  /** See `ElementKindDefinition.description`. */
  readonly description?: string;
}

/**
 * How a root metamodel's files look, for models that don't come from a file (`createEmptyModel`)
 * and for writing them (`toPistar`). Files that were read keep their own layout.
 */
export interface MetamodelFileHints {
  /** The `tool` a new model records. Default: piStar's `pistar.2.1.0`. */
  readonly tool?: string;
  /** The `istar` version a new model records; only iStar 2.0 sets it (`'2.0'`). */
  readonly istar?: string;
  /** Extra top-level keys of a new model (its `extra`), e.g. `{ metamodelVersion: '1.0' }`. */
  readonly extra?: Readonly<Record<string, unknown>>;
  /** Top-level key order for models without a source layout. Default: piStar's. */
  readonly keys?: readonly string[];
}

/** A metamodel: the element and link kinds a model may use, and their rules. */
export interface Metamodel<EK extends string = ElementKind, LK extends string = LinkKind> {
  /**
   * The root's name (`istar-2.0`), followed by the names of the extensions applied, e.g.
   * `istar-2.0+rationalAgents`.
   */
  readonly name: string;
  /** The root metamodel's name, e.g. `istar-2.0`; extensions keep it. */
  readonly framework: string;
  /** The root's namespace (`istar`). Extensions may not declare kinds in it. */
  readonly prefix: string;
  /** How the root's files look (see `MetamodelFileHints`); extensions keep it. */
  readonly file: MetamodelFileHints;
  readonly extensions: readonly string[];
  /** In declaration order: the root's kinds first, then each extension's. */
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
// Declarations

export interface ElementKindDeclaration<K extends string = string> {
  /** Namespaced kind name, e.g. `rationalAgents.Planning`. */
  readonly kind: K;
  /** Default: the part after the namespace ("Planning"). */
  readonly label?: string;
  /** Required unless `behavesLike` is given (then it is the same category). */
  readonly category?: ElementCategory;
  /** An existing element kind whose link rules this kind follows, e.g. `istar.Task`. */
  readonly behavesLike?: string;
  /**
   * Containment rules for nodes. Default: those of `behavesLike`, else piStar-ext's (inner,
   * dependum) in an extension and DSM3's (inner, dependum, on paper) in a root.
   */
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
  /** See `ElementKindDefinition.description`. */
  readonly description?: string;
}

export interface LinkKindDeclaration<K extends string = string> {
  readonly kind: K;
  readonly label?: string;
  /** Default: that of `behavesLike`, else `node`. */
  readonly category?: LinkCategory;
  /** An existing link kind whose rules this kind takes on, e.g. `istar.OrRefinementLink`. */
  readonly behavesLike?: string;
  /**
   * Declarative rules; give these or `behavesLike`, not both. A root's link kind may give
   * neither when the library has built-in rules for it (iStar 2.0's links).
   */
  readonly rules?: LinkRules;
  /** An extra predicate, checked after the other rules pass. */
  readonly check?: (context: LinkRuleContext) => LinkCheck;
  /** Default: that of `behavesLike`, else none (no fixed label, no changeable value). */
  readonly info?: LinkKindInfo;
  readonly pistarType?: string;
  /** Presentation hint, kept as data for renderers (`@istar-ts/react` draws it). */
  readonly line?: KindLine;
  /**
   * `'n'` for a link with several sources, like KAOS's AND-refinement: in a model it is a hub
   * element joined to each source by a leg link and to the target by an end link, as DSM3-goals
   * draws and saves it. Declaring it generates three kinds, named after this one (`parts`):
   * `<kind>Hub`, `<kind>Start` and `<kind>End`, written as `<pistarType>Hub` etc. Needs `rules`
   * and the `node` category.
   */
  readonly arity?: 'n';
  /** Names of the generated kinds, when the defaults don't suit. */
  readonly parts?: Partial<HubLinkParts>;
  /** The hub's size. Default 20×20, as in DSM3-goals. */
  readonly hubSize?: Size;
  /** See `ElementKindDefinition.description`. */
  readonly description?: string;
}

/** A whole modelling language, turned into a `Metamodel` by `defineMetamodel`. */
export interface RootMetamodelDeclaration<EK extends string = string, LK extends string = string> {
  /** Identifies the language; the metamodel's `name` and `framework`, e.g. `istar-2.0`. */
  readonly name: string;
  /** The language's namespace, e.g. `istar`. Extensions may not declare kinds in it. */
  readonly prefix: string;
  readonly elements: readonly ElementKindDeclaration<EK>[];
  readonly links: readonly LinkKindDeclaration<LK>[];
  readonly file?: MetamodelFileHints;
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

// ---------------------------------------------------------------------------------------------
// Building kinds. `defineMetamodel` and `extendMetamodel` add kinds to a mutable table, one
// declaration at a time, so `behavesLike` and rule selectors resolve against the kinds the
// table already holds: the base metamodel's, then those declared earlier.

const KIND_NAME = /^[A-Za-z_][\w-]*\.[A-Za-z_][\w-]*$/;
const PREFIX_NAME = /^[A-Za-z_][\w-]*$/;
const CATEGORY_SELECTORS: ReadonlySet<string> = new Set(['node', 'actor', '*']);
/** The `targets` selector for any link (see `LinkRules`). */
export const LINK_SELECTOR = 'link';

/** piStar-ext's defaults for an extension's new nodes (tool/language/metamodel.js). */
const EXTENSION_NODE_INFO: NodeKindInfo = {
  canBeInnerElement: true,
  canBeDependum: true,
  canBeOnPaper: false,
};

/** DSM3-goals' defaults for a root's nodes (istarcore metamodelManager). */
/** A hub sits on the paper, outside any actor, and is never a dependum. */
const HUB_INFO: NodeKindInfo = {
  canBeInnerElement: false,
  canBeDependum: false,
  canBeOnPaper: true,
};

/** A circle filling the hub's box (DSM3-goals draws a circle of radius 10 in 20×20). */
const HUB_SHAPE: KindShape = {
  path: 'M 0 10 A 10 10 0 1 0 20 10 A 10 10 0 1 0 0 10 Z',
  viewBox: '0 0 20 20',
};

const ROOT_NODE_INFO: NodeKindInfo = {
  canBeInnerElement: true,
  canBeDependum: true,
  canBeOnPaper: true,
};

interface KindTable {
  /** `extension "x"` or `metamodel "x"`, opening every error message. */
  readonly where: string;
  /** The namespace suggested in errors: the extension's name, or the root's prefix. */
  readonly namespace: string;
  /** The root's prefix, when the table builds an extension (a root may use any namespace). */
  readonly reserved?: string;
  /** Name of the extension being built; absent for a root. */
  readonly extension?: string;
  readonly elements: Map<string, ElementKindDefinition<string>>;
  readonly links: Map<string, LinkKindDefinition<string>>;
  readonly elementsByType: Map<string, string>;
  readonly linksByType: Map<string, string>;
}

function shortName(kind: string): string {
  const dot = kind.indexOf('.');
  return dot === -1 ? kind : kind.slice(dot + 1);
}

function claimName(table: KindTable, kind: string, what: string): void {
  const { where } = table;
  if (typeof kind !== 'string' || !KIND_NAME.test(kind)) {
    throw new MetamodelError(
      `${where}: ${what} kind ${JSON.stringify(kind)} must be namespaced, e.g. "${table.namespace}.Name"`,
    );
  }
  if (table.reserved !== undefined && kind.startsWith(`${table.reserved}.`)) {
    throw new MetamodelError(
      `${where}: ${what} kind "${kind}" uses the reserved "${table.reserved}." prefix; ` +
        `name it "${table.namespace}.${shortName(kind)}" and set pistarType: "${kind}" to read files that use it`,
    );
  }
  if (table.elements.has(kind) || table.links.has(kind)) {
    throw new MetamodelError(`${where}: kind "${kind}" already exists`);
  }
}

function claimType(table: KindTable, type: string, kind: string): void {
  const { where } = table;
  if (typeof type !== 'string' || type === '') {
    throw new MetamodelError(`${where}: kind "${kind}" has an empty pistarType`);
  }
  if (
    table.elementsByType.has(type) ||
    table.linksByType.has(type) ||
    table.elements.has(type) ||
    table.links.has(type)
  ) {
    throw new MetamodelError(
      `${where}: pistarType "${type}" of kind "${kind}" is already used by another kind`,
    );
  }
}

function isCompleteNodeInfo(info: Partial<NodeKindInfo> | undefined): info is NodeKindInfo {
  return (
    info !== undefined &&
    typeof info.canBeInnerElement === 'boolean' &&
    typeof info.canBeDependum === 'boolean' &&
    typeof info.canBeOnPaper === 'boolean'
  );
}

function addElementKind(table: KindTable, declaration: ElementKindDeclaration<string>): void {
  const { where } = table;
  const { kind } = declaration;
  claimName(table, kind, 'element');
  let parent: ElementKindDefinition<string> | undefined;
  if (declaration.behavesLike !== undefined) {
    parent = table.elements.get(declaration.behavesLike);
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
  claimType(table, type, kind);
  // A complete `info` is kept as given (iStar 2.0's `NODE_KIND_INFO` objects keep their identity).
  const info: NodeKindInfo = isCompleteNodeInfo(declaration.info)
    ? declaration.info
    : {
        ...(parent?.info ?? (table.extension === undefined ? ROOT_NODE_INFO : EXTENSION_NODE_INFO)),
        ...declaration.info,
      };
  const definition: ElementKindDefinition<string> = {
    kind,
    category,
    label: declaration.label ?? shortName(kind),
    size:
      declaration.size ??
      parent?.size ??
      (category === 'actor' ? { width: 200, height: 120 } : { width: 90, height: 55 }),
    ...(category === 'node' ? { info } : {}),
    ...(parent ? { behavesLike: parent.kind } : {}),
    pistarType: type,
    ...(table.extension !== undefined ? { extension: table.extension } : {}),
    ...(declaration.shape ? { shape: declaration.shape } : {}),
    ...(declaration.textBox ? { textBox: declaration.textBox } : {}),
    ...(declaration.description !== undefined ? { description: declaration.description } : {}),
  };
  table.elements.set(kind, definition);
  table.elementsByType.set(type, kind);
}

function addLinkKind(table: KindTable, declaration: LinkKindDeclaration<string>): void {
  const { where } = table;
  const { kind } = declaration;
  claimName(table, kind, 'link');
  const isRoot = table.extension === undefined;
  if (declaration.behavesLike !== undefined && declaration.rules !== undefined) {
    throw new MetamodelError(
      isRoot
        ? `${where}: link kind "${kind}" needs at most one of behavesLike or rules`
        : `${where}: link kind "${kind}" needs exactly one of behavesLike or rules`,
    );
  }
  // A root's link kind may give neither: its rules are then built in (iStar 2.0's links).
  if (!isRoot && declaration.behavesLike === undefined && declaration.rules === undefined) {
    throw new MetamodelError(
      `${where}: link kind "${kind}" needs exactly one of behavesLike or rules`,
    );
  }
  let parent: LinkKindDefinition<string> | undefined;
  if (declaration.behavesLike !== undefined) {
    parent = table.links.get(declaration.behavesLike);
    if (!parent) {
      throw new MetamodelError(
        `${where}: "${kind}" behaves like unknown link kind "${declaration.behavesLike}"`,
      );
    }
  }
  const category = declaration.category ?? parent?.category ?? 'node';
  if (category !== 'node' && category !== 'actor' && category !== 'dependency') {
    throw new MetamodelError(`${where}: link kind "${kind}" has an unknown category "${category}"`);
  }
  if (declaration.arity !== undefined) {
    if (declaration.arity !== 'n') {
      throw new MetamodelError(
        `${where}: link kind "${kind}" has an unknown arity ${JSON.stringify(declaration.arity)}`,
      );
    }
    if (!declaration.rules || category !== 'node') {
      throw new MetamodelError(
        `${where}: n-ary link kind "${kind}" needs rules and the "node" category`,
      );
    }
  }
  if (parent && parent.category !== category) {
    throw new MetamodelError(
      `${where}: "${kind}" is a ${category} link but behaves like "${parent.kind}", a ${parent.category} link`,
    );
  }
  if (category === 'dependency' && !parent && (!isRoot || declaration.rules !== undefined)) {
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
        const known =
          CATEGORY_SELECTORS.has(selector) ||
          table.elements.has(selector) ||
          // Targets may also name links: any, an earlier kind, or this kind itself.
          (side === 'targets' &&
            (selector === LINK_SELECTOR || table.links.has(selector) || selector === kind));
        if (!known) {
          throw new MetamodelError(
            `${where}: ${side} of "${kind}" names unknown element kind "${selector}"`,
          );
        }
      }
    }
  }
  const type = declaration.pistarType ?? kind;
  claimType(table, type, kind);
  const definition: LinkKindDefinition<string> = {
    kind,
    category,
    label: declaration.label ?? shortName(kind),
    info: declaration.info ?? parent?.info ?? {},
    ...(parent ? { behavesLike: parent.kind } : {}),
    ...(declaration.rules ? { rules: declaration.rules } : {}),
    ...(declaration.check ? { check: declaration.check } : {}),
    pistarType: type,
    ...(table.extension !== undefined ? { extension: table.extension } : {}),
    ...(declaration.line ? { line: declaration.line } : {}),
    ...(declaration.description !== undefined ? { description: declaration.description } : {}),
  };
  if (declaration.arity !== 'n') {
    table.links.set(kind, definition);
    table.linksByType.set(type, kind);
    return;
  }
  const parts: HubLinkParts = {
    hub: declaration.parts?.hub ?? `${kind}Hub`,
    leg: declaration.parts?.leg ?? `${kind}Start`,
    end: declaration.parts?.end ?? `${kind}End`,
  };
  table.links.set(kind, { ...definition, arity: 'n', parts });
  table.linksByType.set(type, kind);
  addHubKinds(table, table.links.get(kind)!, parts, declaration.hubSize);
}

/**
 * Adds the kinds an n-ary link kind is made of, as DSM3-goals' `setupSplitLinks` generates them:
 * the hub (an element), the legs (each source → the hub, at most one per source) and the end
 * (the hub → the target).
 */
function addHubKinds(
  table: KindTable,
  base: LinkKindDefinition<string>,
  parts: HubLinkParts,
  hubSize: Size | undefined,
): void {
  const rules = base.rules!;
  // Generated kinds go through the usual checks; their errors name the kind they come from.
  const claim = (kind: string, type: string, what: string): void => {
    try {
      claimName(table, kind, what);
      claimType(table, type, kind);
    } catch (error) {
      if (!(error instanceof MetamodelError)) throw error;
      throw new MetamodelError(`${error.message} (generated for n-ary link kind "${base.kind}")`);
    }
  };
  const owner = table.extension !== undefined ? { extension: table.extension } : {};
  claim(parts.hub, `${base.pistarType}Hub`, 'element');
  table.elements.set(parts.hub, {
    kind: parts.hub,
    category: 'node',
    label: `${base.label} hub`,
    size: hubSize ?? { width: 20, height: 20 },
    info: HUB_INFO,
    pistarType: `${base.pistarType}Hub`,
    ...owner,
    shape: HUB_SHAPE,
    role: 'hub',
    of: base.kind,
    description: `The point where ${base.label}'s sources join on their way to its target, drawn as a small circle; not an intentional element in its own right.`,
  });
  table.elementsByType.set(`${base.pistarType}Hub`, parts.hub);
  // The base kind's same-actor rule is checked between a leg's source and the end's target
  // (`canLink`): the hub itself belongs to no actor.
  const common = {
    category: 'node' as const,
    ...owner,
    of: base.kind,
  };
  claim(parts.leg, `${base.pistarType}Start`, 'link');
  table.links.set(parts.leg, {
    ...common,
    kind: parts.leg,
    label: `${base.label} leg`,
    info: {},
    rules: {
      sources: rules.sources,
      targets: [parts.hub],
      sameActor: false,
      ...(rules.allowDependum !== undefined ? { allowDependum: rules.allowDependum } : {}),
      unique: 'kind',
    },
    pistarType: `${base.pistarType}Start`,
    role: 'leg',
    description: `One source's leg of a ${base.label} link, drawn from the source to the shared hub.`,
  });
  table.linksByType.set(`${base.pistarType}Start`, parts.leg);
  claim(parts.end, `${base.pistarType}End`, 'link');
  table.links.set(parts.end, {
    ...common,
    kind: parts.end,
    label: `${base.label} end`,
    info: base.info,
    rules: {
      sources: [parts.hub],
      targets: rules.targets,
      sameActor: false,
      ...(rules.allowDependum !== undefined ? { allowDependum: rules.allowDependum } : {}),
      unique: 'kind',
    },
    pistarType: `${base.pistarType}End`,
    ...(base.line ? { line: base.line } : {}),
    role: 'end',
    description: `The ${base.label} link's hub-to-target leg, carrying the link's own meaning.`,
  });
  table.linksByType.set(`${base.pistarType}End`, parts.end);
}

// ---------------------------------------------------------------------------------------------
// Root metamodels

/**
 * Builds a root metamodel: a modelling language of its own, such as iStar 2.0, KAOS or NFR.
 * Kinds are namespaced (any namespace; usually `prefix`), declared in order: `behavesLike` and
 * link rules refer to kinds declared before them. Extensions of the result may not use `prefix`.
 *
 * Throws `MetamodelError` on the same declaration errors as `extendMetamodel`.
 */
export function defineMetamodel<const EK extends string, const LK extends string>(
  declaration: RootMetamodelDeclaration<EK, LK>,
): Metamodel<EK, LK> {
  const { name, prefix } = declaration;
  if (!name || typeof name !== 'string') {
    throw new MetamodelError('a root metamodel needs a name');
  }
  const where = `metamodel "${name}"`;
  if (typeof prefix !== 'string' || !PREFIX_NAME.test(prefix)) {
    throw new MetamodelError(
      `${where}: prefix ${JSON.stringify(prefix)} must be a name without dots, e.g. "istar"`,
    );
  }
  const table: KindTable = {
    where,
    namespace: prefix,
    elements: new Map(),
    links: new Map(),
    elementsByType: new Map(),
    linksByType: new Map(),
  };
  for (const element of declaration.elements) addElementKind(table, element);
  for (const link of declaration.links) addLinkKind(table, link);
  return {
    name,
    framework: name,
    prefix,
    file: declaration.file ?? {},
    extensions: [],
    elements: table.elements,
    links: table.links,
    elementsByPistarType: table.elementsByType,
    linksByPistarType: table.linksByType,
  } as unknown as Metamodel<EK, LK>;
}

const ISTAR_LINK_LABELS: Readonly<Record<LinkKind, string>> = {
  'istar.IsALink': 'Is-A',
  'istar.ParticipatesInLink': 'Participates-In',
  'istar.DependencyLink': 'Dependency',
  'istar.AndRefinementLink': 'And-Refinement',
  'istar.OrRefinementLink': 'Or-Refinement',
  'istar.NeededByLink': 'Needed-By',
  'istar.QualificationLink': 'Qualification',
  'istar.ContributionLink': 'Contribution',
};

/**
 * Base descriptions of iStar 2.0's kinds, written in our own words from the **iStar 2.0 Language
 * Guide** (Dalpiaz, Franch & Horkoff, arXiv:1605.07767, 2016, CC BY 4.0): actors and intentional
 * elements (§§2 and 4), actor links (§3), dependencies (§5) and intentional-element links (§6).
 */
const ISTAR_ELEMENT_DESCRIPTIONS: Readonly<Record<ElementKind, string>> = {
  'istar.Actor':
    'An intentional, autonomous entity that has strategic goals and exercises know-how to ' +
    'pursue them, alone or with other actors (iStar 2.0 Language Guide §2). Use plain Actor ' +
    'when neither Agent nor Role fits better.',
  'istar.Agent':
    'An actor with a concrete, physical manifestation — a specific person, organisation or ' +
    'software system (iStar 2.0 Language Guide §2). Use it instead of Role for a named, ' +
    'identifiable participant rather than an abstract part anyone could play.',
  'istar.Role':
    "An abstract characterisation of an actor's behaviour within some context, independent of " +
    'who plays it (iStar 2.0 Language Guide §2). Use it instead of Agent when several concrete ' +
    'actors could fill the same part.',
  'istar.Goal':
    'A state of affairs an actor wants achieved, with a clear-cut criterion for whether it is ' +
    'met (iStar 2.0 Language Guide §4). Unlike a Quality, a Goal is either achieved or not; ' +
    'unlike a Task, it says what to achieve, not how.',
  'istar.Quality':
    'An attribute an actor wants some degree of, with no binary success criterion — it is ' +
    'satisficed rather than achieved outright (iStar 2.0 Language Guide §4). Use it instead of ' +
    'Goal for non-functional concerns (e.g. performance, usability) that admit degrees.',
  'istar.Task':
    'A course of action an actor wants carried out, usually to achieve a Goal, satisfice a ' +
    'Quality, or produce or consume a Resource (iStar 2.0 Language Guide §4). Unlike a Goal, it ' +
    'specifies how, not just what.',
  'istar.Resource':
    'A physical or informational entity an actor needs available to perform a Task (iStar 2.0 ' +
    'Language Guide §4). Its mere availability, not its satisfaction, is what matters — it has ' +
    'no intentional content of its own.',
};

/**
 * Base descriptions of iStar 2.0's link kinds (see `ISTAR_ELEMENT_DESCRIPTIONS` for the source).
 */
const ISTAR_LINK_DESCRIPTIONS: Readonly<Record<LinkKind, string>> = {
  'istar.IsALink':
    'Generalisation/specialisation between two actors of the same category — two Roles, or two ' +
    'general Actors (iStar 2.0 Language Guide §3): the specific actor inherits the general ' +
    "one's properties.",
  'istar.ParticipatesInLink':
    'Any association between two actors other than generalisation/specialisation, e.g. an ' +
    'Agent playing a Role (iStar 2.0 Language Guide §3). Unlike Is-A, it places no restriction ' +
    "on the actors' categories.",
  'istar.DependencyLink':
    'A social relationship in which a depender actor relies on a dependee actor for a dependum ' +
    '(a Goal, Quality, Task or Resource) it cannot, or prefers not to, provide for itself ' +
    '(iStar 2.0 Language Guide §5).',
  'istar.AndRefinementLink':
    'Decomposes an intentional element into sub-elements that must *all* be satisfied for the ' +
    'parent to be satisfied (iStar 2.0 Language Guide §6.1). Contrast with Or-Refinement, where ' +
    'any one alternative suffices.',
  'istar.OrRefinementLink':
    'Decomposes an intentional element into alternative sub-elements, any *one* of which ' +
    'satisfies the parent (iStar 2.0 Language Guide §6.1). Contrast with And-Refinement, which ' +
    'needs every child.',
  'istar.NeededByLink':
    'Links a Task to the Resource it requires in order to be performed (iStar 2.0 Language ' +
    'Guide §6.2).',
  'istar.QualificationLink':
    'Links a Quality to the Goal, Task or Resource it qualifies, expressing a desired attribute ' +
    "of that element's achievement, execution or provision (iStar 2.0 Language Guide §6.4).",
  'istar.ContributionLink':
    'Expresses how satisfying one intentional element affects another, with a strength from ' +
    "'make' (sufficient positive evidence) through 'help' (partial positive) and 'hurt' " +
    "(partial negative) to 'break' (sufficient negative evidence) (iStar 2.0 Language Guide " +
    '§6.3). Unlike a Refinement, it is a weaker, quantifiable influence rather than a ' +
    'decomposition.',
};

function istarLinks(
  kinds: readonly LinkKind[],
  category: LinkCategory,
): LinkKindDeclaration<LinkKind>[] {
  // No rules: iStar 2.0's link rules are built in (`constraints.ts`).
  return kinds.map((kind) => ({
    kind,
    category,
    label: ISTAR_LINK_LABELS[kind],
    info: LINK_KIND_INFO[kind],
    description: ISTAR_LINK_DESCRIPTIONS[kind],
  }));
}

/** iStar 2.0's declaration, built from the constants in `metamodel.ts`. */
export const ISTAR_2_0_DECLARATION: RootMetamodelDeclaration<ElementKind, LinkKind> = {
  name: 'istar-2.0',
  prefix: ISTAR_PREFIX,
  elements: [
    ...ACTOR_KINDS.map((kind): ElementKindDeclaration<ElementKind> => ({
      kind,
      category: 'actor',
      size: DEFAULT_ELEMENT_SIZE[kind],
      description: ISTAR_ELEMENT_DESCRIPTIONS[kind],
    })),
    ...NODE_KINDS.map((kind): ElementKindDeclaration<ElementKind> => ({
      kind,
      category: 'node',
      size: DEFAULT_ELEMENT_SIZE[kind],
      info: NODE_KIND_INFO[kind],
      description: ISTAR_ELEMENT_DESCRIPTIONS[kind],
    })),
  ],
  links: [
    ...istarLinks(ACTOR_LINK_KINDS, 'actor'),
    ...istarLinks(DEPENDENCY_LINK_KINDS, 'dependency'),
    ...istarLinks(NODE_LINK_KINDS, 'node'),
  ],
  // `PISTAR_TOOL` and `ISTAR_VERSION` (model.ts), which can't be imported here without a cycle.
  file: { tool: 'pistar.2.1.0', istar: '2.0' },
};

/** iStar 2.0, as the piStar tool implements it. The default metamodel everywhere. */
export const ISTAR_2_0: Metamodel = defineMetamodel(ISTAR_2_0_DECLARATION);

// ---------------------------------------------------------------------------------------------
// Extensions

/**
 * Returns a new metamodel with the extension's kinds added. `base` is not modified. The result
 * keeps `base`'s `framework`, `prefix` and `file`.
 *
 * Throws `MetamodelError` when a kind name isn't namespaced, uses the root's reserved prefix
 * (`istar.` for iStar 2.0), collides with an existing kind or piStar type, or refers to an
 * unknown kind.
 */
export function extendMetamodel<
  EK extends string,
  LK extends string,
  const NEK extends string = never,
  const NLK extends string = never,
>(base: Metamodel<EK, LK>, extension: MetamodelExtension<NEK, NLK>): Metamodel<EK | NEK, LK | NLK> {
  if (!extension.name || typeof extension.name !== 'string') {
    throw new MetamodelError('an extension needs a name');
  }
  const where = `extension "${extension.name}"`;
  if (base.extensions.includes(extension.name)) {
    throw new MetamodelError(`${where} is already applied`);
  }
  const table: KindTable = {
    where,
    namespace: extension.name,
    reserved: base.prefix,
    extension: extension.name,
    elements: new Map<string, ElementKindDefinition<string>>(base.elements),
    links: new Map<string, LinkKindDefinition<string>>(base.links),
    elementsByType: new Map<string, string>(base.elementsByPistarType),
    linksByType: new Map<string, string>(base.linksByPistarType),
  };
  for (const element of extension.elements ?? []) addElementKind(table, element);
  for (const link of extension.links ?? []) addLinkKind(table, link);
  return {
    name: `${base.name}+${extension.name}`,
    framework: base.framework,
    prefix: base.prefix,
    file: base.file,
    extensions: [...base.extensions, extension.name],
    elements: table.elements,
    links: table.links,
    elementsByPistarType: table.elementsByType,
    linksByPistarType: table.linksByType,
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

/** True when link `kind` is `ancestor` or (transitively) behaves like it. */
export function linkBehavesLike(metamodel: AnyMetamodel, kind: string, ancestor: string): boolean {
  let current: string | undefined = kind;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = metamodel.links.get(current)?.behavesLike;
  }
  return false;
}

/** True when a link kind's rules let it target links (`link` or a link kind in `targets`). */
export function targetsLinks(metamodel: AnyMetamodel, kind: string): boolean {
  const root = metamodel.links.get(effectiveLinkKind(metamodel, kind));
  return (
    root?.rules?.targets.some(
      (selector) => selector === LINK_SELECTOR || metamodel.links.has(selector),
    ) ?? false
  );
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
