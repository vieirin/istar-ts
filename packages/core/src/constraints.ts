/**
 * iStar 2.0 link constraints, ported from piStar's `tool/language/constraints.js`.
 *
 * Each check runs in the same order as upstream so the reported reason is the one piStar
 * would show. Upstream messages embed HTML and illustrative images; here they are plain text.
 */
import type { ElementKind, LinkKind } from './metamodel';
import type { AnyMetamodel, LinkKindDefinition, LinkRules, Metamodel } from './metamodels';
import { effectiveElementKind, effectiveLinkKind, elementBehavesLike } from './metamodels';
import type { AnyIstarModel, IstarElement, IstarLink, IstarModel } from './model';
import { metamodelOf } from './model';

export type ConstraintCode =
  | 'unknown-element'
  | 'unknown-link-kind'
  | 'invalid-source'
  | 'invalid-target'
  | 'actor-types-differ'
  | 'self-link'
  | 'duplicate-link'
  | 'dependum-endpoint'
  | 'same-actor'
  | 'different-actors'
  | 'refined-depender'
  | 'contributed-depender'
  | 'depender-target'
  | 'mixed-refinement'
  | 'contribution-and-qualification';

export type LinkCheck = { ok: true } | { ok: false; reason: string; code: ConstraintCode };

const OK: LinkCheck = { ok: true };

function fail(code: ConstraintCode, reason: string): LinkCheck {
  return { ok: false, code, reason };
}

type ElementRef = string | IstarElement<string>;

export interface CanLinkOptions<EK extends string = ElementKind, LK extends string = LinkKind> {
  /** Default: the model's metamodel, or iStar 2.0. */
  readonly metamodel?: Metamodel<EK, LK>;
}

/**
 * Checks whether a link of `kind` may be added from `source` to `target` in `model`.
 *
 * For dependency links, `source` is the depender and `target` the dependee (an actor or one of
 * its inner elements); the dependum sits between them and is not part of the check.
 *
 * Extended kinds (see `extendMetamodel`) are checked with the rules of the kind they behave
 * like, or with their declarative rules, then with their extra predicate.
 */
export function canLink<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  source: string | IstarElement<EK>,
  target: string | IstarElement<EK>,
  kind: LK,
  options: CanLinkOptions<EK, LK> = {},
): LinkCheck {
  const any = model as unknown as AnyIstarModel;
  const metamodel = (options.metamodel ?? metamodelOf(model)) as unknown as AnyMetamodel;
  const s = resolve(any, source);
  const t = resolve(any, target);
  if (!s) return fail('unknown-element', `unknown source element "${refId(source)}"`);
  if (!t) return fail('unknown-element', `unknown target element "${refId(target)}"`);
  const definition = metamodel.links.get(kind);
  if (!definition) return fail('unknown-link-kind', `unknown link kind "${String(kind)}"`);
  return checkWith(new Graph(any, metamodel), definition, s, t);
}

/** Runs the rule a link kind resolves to, then every extra predicate along its chain. */
function checkWith(
  graph: Graph,
  definition: LinkKindDefinition,
  source: IstarElement<string>,
  target: IstarElement<string>,
): LinkCheck {
  const chain: LinkKindDefinition[] = [];
  for (
    let current: LinkKindDefinition | undefined = definition;
    current && !chain.includes(current);
    current = current.behavesLike ? graph.metamodel.links.get(current.behavesLike) : undefined
  ) {
    chain.push(current);
  }
  const root = chain[chain.length - 1]!;
  const builtIn = CHECKS[root.kind as LinkKind];
  let result: LinkCheck;
  if (root.rules)
    result = declarativeCheck(graph, definition, root.rules, root.kind, source, target);
  else if (builtIn) result = builtIn(graph, source, target);
  else result = fail('unknown-link-kind', `link kind "${definition.kind}" has no rules`);
  if (!result.ok) return result;
  const context = graph.context(definition.kind, source, target);
  for (const step of chain.toReversed()) {
    if (!step.check) continue;
    const extra = step.check(context);
    if (!extra.ok) return extra;
  }
  return OK;
}

function refId(ref: ElementRef): string {
  return typeof ref === 'string' ? ref : ref.id;
}

function resolve(model: AnyIstarModel, ref: ElementRef): IstarElement<string> | undefined {
  // Always look the element up so a stale object can't be checked against a newer model.
  return model.elements.get(refId(ref));
}

/**
 * What an extension's `check` predicate receives: the model, the endpoints, and the graph
 * queries the iStar 2.0 rules use.
 */
export interface LinkRuleContext {
  readonly model: AnyIstarModel;
  readonly metamodel: AnyMetamodel;
  /** The link kind being added. */
  readonly kind: string;
  readonly source: IstarElement<string>;
  readonly target: IstarElement<string>;
  /** A link (optionally of `kind`, or a kind behaving like it) joins `a` and `b`, either way. */
  isThereLinkBetween(a: IstarElement<string>, b: IstarElement<string>, kind?: string): boolean;
  /** `element` is the source of a link of `kind` (or a kind behaving like it). */
  isSourceOfType(element: IstarElement<string>, kind: string): boolean;
  /** `element` is the target of a link of `kind` (or a kind behaving like it). */
  isTargetOfType(element: IstarElement<string>, kind: string): boolean;
}

/**
 * The graph queries used by upstream constraints (`istar.isThereLinkBetween`, etc.). Link kinds
 * are compared by what they behave like, so an extension link behaving like an OR-refinement
 * counts as one for the iStar 2.0 rules (no mixing with AND, no refining a depender…).
 */
class Graph {
  constructor(
    readonly model: AnyIstarModel,
    readonly metamodel: AnyMetamodel,
  ) {}

  private matches(link: IstarLink<string>, kind: string): boolean {
    return link.kind === kind || effectiveLinkKind(this.metamodel, link.kind) === kind;
  }

  /**
   * True when a link (optionally of `kind`) already connects the two elements, in either
   * direction. Mirrors `istar.isThereLinkBetween`.
   */
  isThereLinkBetween(a: IstarElement<string>, b: IstarElement<string>, kind?: string): boolean {
    for (const link of this.model.links.values()) {
      if (kind && !this.matches(link, kind)) continue;
      if (
        (link.source === a.id && link.target === b.id) ||
        (link.source === b.id && link.target === a.id)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Like `isThereLinkBetween`, counting only links of exactly `kind`. */
  isThereLinkOfKindBetween(
    a: IstarElement<string>,
    b: IstarElement<string>,
    kind: string,
  ): boolean {
    for (const link of this.model.links.values()) {
      if (link.kind !== kind) continue;
      if (
        (link.source === a.id && link.target === b.id) ||
        (link.source === b.id && link.target === a.id)
      ) {
        return true;
      }
    }
    return false;
  }

  isSourceOfType(element: IstarElement<string>, kind: string): boolean {
    for (const link of this.model.links.values()) {
      if (link.source === element.id && this.matches(link, kind)) return true;
    }
    return false;
  }

  isTargetOfType(element: IstarElement<string>, kind: string): boolean {
    for (const link of this.model.links.values()) {
      if (link.target === element.id && this.matches(link, kind)) return true;
    }
    return false;
  }

  /** The kind the iStar 2.0 rules see: built-in kinds as they are, extensions as what they behave like. */
  kindOf(element: IstarElement<string>): string {
    return effectiveElementKind(this.metamodel, element.kind);
  }

  isActor(element: IstarElement<string>): boolean {
    return this.metamodel.elements.get(element.kind)?.category === 'actor';
  }

  context(
    kind: string,
    source: IstarElement<string>,
    target: IstarElement<string>,
  ): LinkRuleContext {
    return {
      model: this.model,
      metamodel: this.metamodel,
      kind,
      source,
      target,
      isThereLinkBetween: (a, b, k) => this.isThereLinkBetween(a, b, k),
      isSourceOfType: (e, k) => this.isSourceOfType(e, k),
      isTargetOfType: (e, k) => this.isTargetOfType(e, k),
    };
  }
}

type Check = (
  graph: Graph,
  source: IstarElement<string>,
  target: IstarElement<string>,
) => LinkCheck;

const is = (graph: Graph, element: IstarElement<string>, ...shortNames: string[]): boolean => {
  const kind = graph.kindOf(element);
  return shortNames.some((name) => kind === `istar.${name}`);
};

const isDependum = (element: IstarElement<string>): boolean => element.isDependum === true;

const isALink: Check = (graph, source, target) => {
  // Upstream evaluates the source-kind check after the type-equality check without guarding
  // on the previous result, so its message wins when both fail. Reproduced here.
  if (!is(graph, source, 'Actor', 'Role')) {
    return fail(
      'invalid-source',
      'the source of Is-A links must be a Role or a general Actor (iStar 2.0 Guide, Page 6).',
    );
  }
  if (source.kind !== target.kind) {
    return fail(
      'actor-types-differ',
      'the source and target of Is-A links must be of the same type - Actor and Actor, or Role and Role (iStar 2.0 Guide, Page 6).',
    );
  }
  if (!is(graph, target, 'Actor', 'Role')) {
    return fail(
      'invalid-target',
      'the target of Is-A links must be a Role or a general Actor (iStar 2.0 Guide, Page 6).',
    );
  }
  if (source.id === target.id) {
    return fail('self-link', 'you cannot make Is-A links from an actor onto itself.');
  }
  if (graph.isThereLinkBetween(source, target)) {
    return fail(
      'duplicate-link',
      'there can only be one Actor link between the same two actors (iStar 2.0 Guide, Page 14).',
    );
  }
  return OK;
};

const participatesInLink: Check = (graph, source, target) => {
  if (!graph.isActor(source)) {
    return fail(
      'invalid-source',
      'the source of a Participates-In link must be some kind of actor (iStar 2.0 Guide, Page 6)',
    );
  }
  if (!graph.isActor(target)) {
    return fail(
      'invalid-target',
      'the target of a Participates-In link must be some kind of actor (iStar 2.0 Guide, Page 6)',
    );
  }
  if (source.id === target.id) {
    return fail('self-link', 'you cannot make a Participates-In link from an actor onto itself.');
  }
  if (graph.isThereLinkBetween(source, target)) {
    return fail(
      'duplicate-link',
      'there can only be one Actor link between the same two actors (iStar 2.0 Guide, Page 14).',
    );
  }
  return OK;
};

/** The actor an element belongs to: itself for actors, its parent for inner elements. */
function owningActorId(graph: Graph, element: IstarElement<string>): string | undefined {
  return graph.isActor(element) ? element.id : element.parent;
}

const dependencyLink: Check = (graph, source, target) => {
  if (source.id === target.id) {
    return fail('self-link', 'a Dependency link cannot link an element onto itself');
  }
  if (isDependum(source)) {
    return fail('dependum-endpoint', 'a Dependency link cannot start from a dependum');
  }
  if (isDependum(target)) {
    return fail('dependum-endpoint', 'a Dependency link cannot end in a dependum');
  }
  if (owningActorId(graph, source) === owningActorId(graph, target)) {
    return fail(
      'same-actor',
      'a Dependency link must involve two different actors (iStar 2.0 Guide, Page 14)',
    );
  }
  if (
    graph.isTargetOfType(source, 'istar.OrRefinementLink') ||
    graph.isTargetOfType(source, 'istar.AndRefinementLink')
  ) {
    return fail(
      'refined-depender',
      'a refined element cannot be the Depender Element in a Dependency link (iStar 2.0 Guide, Page 14). ' +
        'Instead, you can try to add the Dependency originating from a child.',
    );
  }
  if (graph.isTargetOfType(source, 'istar.ContributionLink')) {
    return fail(
      'contributed-depender',
      'a contributed element cannot be the Depender Element in a Dependency link (iStar 2.0 Guide, Page 14). ' +
        'Instead, you can try to add the Dependency originating from a child.',
    );
  }
  return OK;
};

function refinementLink(label: 'AND' | 'OR'): Check {
  const other = label === 'AND' ? 'istar.OrRefinementLink' : 'istar.AndRefinementLink';
  return (graph, source, target) => {
    if (!is(graph, source, 'Task', 'Goal')) {
      return fail(
        'invalid-source',
        `the source of an ${label}-refinement link must be a Goal or a Task (iStar 2.0 Guide, Table 1)`,
      );
    }
    if (!is(graph, target, 'Task', 'Goal')) {
      return fail(
        'invalid-target',
        `the target of an ${label}-refinement link must be a Goal or a Task (iStar 2.0 Guide, Table 1)`,
      );
    }
    if (source.id === target.id) {
      return fail(
        'self-link',
        `you cannot make an ${label}-refinement link from an element onto itself`,
      );
    }
    if (isDependum(source) || isDependum(target)) {
      return fail(
        'dependum-endpoint',
        `you cannot make an ${label}-refinement link with a dependum (iStar 2.0 Guide, Page 14)`,
      );
    }
    if (source.parent !== target.parent) {
      return fail(
        'different-actors',
        `the source and target of an ${label}-refinement link must pertain to the same actor (iStar 2.0 Guide, Page 14)`,
      );
    }
    if (graph.isThereLinkBetween(source, target)) {
      return fail(
        'duplicate-link',
        'there can only be one refinement link between the same two elements',
      );
    }
    if (graph.isSourceOfType(target, 'istar.DependencyLink')) {
      return fail(
        'depender-target',
        'you cannot refine a Depender Element; that is, an element that is the source of a Dependency (iStar 2.0 Guide, Page 14). ' +
          'Instead, you can try to move the dependency to the sub-element.',
      );
    }
    if (graph.isTargetOfType(target, other)) {
      const mix =
        label === 'AND'
          ? 'you cannot mix AND-refinements with OR-refinements targeting the same element (iStar 2.0 Guide, Page 10).'
          : 'you cannot mix OR-refinements with AND-refinements targeting the same element (iStar 2.0 Guide, Page 10).';
      return fail('mixed-refinement', mix);
    }
    return OK;
  };
}

const neededByLink: Check = (graph, source, target) => {
  if (!is(graph, source, 'Resource')) {
    return fail(
      'invalid-source',
      'the source of a Needed-By link must be a Resource (iStar 2.0 Guide, Table 1)',
    );
  }
  if (!is(graph, target, 'Task')) {
    return fail(
      'invalid-target',
      'the target of a Needed-By link must be a Task (iStar 2.0 Guide, Table 1)',
    );
  }
  if (source.id === target.id) {
    return fail('self-link', 'you cannot make a Needed-By link from an element onto itself');
  }
  if (isDependum(source) || isDependum(target)) {
    return fail(
      'dependum-endpoint',
      'you cannot make a Needed-By link with a dependum (iStar 2.0 Guide, Page 14)',
    );
  }
  if (source.parent !== target.parent) {
    return fail(
      'different-actors',
      'the source and target of a Needed-By link must pertain to the same actor (iStar 2.0 Guide, Page 14)',
    );
  }
  if (graph.isThereLinkBetween(source, target)) {
    return fail(
      'duplicate-link',
      'there can only be one Needed-By link between the same two elements',
    );
  }
  return OK;
};

const contributionLink: Check = (graph, source, target) => {
  if (!is(graph, source, 'Goal', 'Quality', 'Task', 'Resource')) {
    return fail(
      'invalid-source',
      'the source of a Contribution link must be a Goal, a Quality, a Task or a Resource (iStar 2.0 Guide, Table 1)',
    );
  }
  if (!is(graph, target, 'Quality')) {
    return fail(
      'invalid-target',
      'the target of a Contribution link must be a Quality (iStar 2.0 Guide, Table 1)',
    );
  }
  if (source.id === target.id) {
    return fail(
      'self-link',
      'you cannot make a Contribution link from an element onto itself (iStar 2.0 Guide, Page 15)',
    );
  }
  if (isDependum(source) || isDependum(target)) {
    return fail(
      'dependum-endpoint',
      'you cannot make a Contribution link with a dependum (iStar 2.0 Guide, Page 14)',
    );
  }
  if (source.parent !== target.parent) {
    return fail(
      'different-actors',
      'the source and target of a Contribution link must pertain to the same actor (iStar 2.0 Guide, Page 14)',
    );
  }
  if (graph.isThereLinkBetween(source, target, 'istar.ContributionLink')) {
    return fail(
      'duplicate-link',
      'there can only be one Contribution link between the same two elements',
    );
  }
  if (graph.isThereLinkBetween(source, target, 'istar.QualificationLink')) {
    return fail(
      'contribution-and-qualification',
      'you cannot have Contribution and Qualification links between the same two elements (iStar 2.0 Guide, Page 15)',
    );
  }
  if (graph.isSourceOfType(target, 'istar.DependencyLink')) {
    return fail(
      'depender-target',
      'you cannot contribute to a Depender Element; that is, an element that is the source of a Dependency (iStar 2.0 Guide, Page 14). ' +
        'Instead, you can try to move the dependency to the sub-quality.',
    );
  }
  return OK;
};

const qualificationLink: Check = (graph, source, target) => {
  if (!is(graph, source, 'Quality')) {
    return fail(
      'invalid-source',
      'the source of a Qualification link must be a Quality (iStar 2.0 Guide, Table 1)',
    );
  }
  if (!is(graph, target, 'Goal', 'Task', 'Resource')) {
    return fail(
      'invalid-target',
      'the target of a Qualification link must be a Goal, a Task or a Resource (iStar 2.0 Guide, Table 1)',
    );
  }
  if (source.id === target.id) {
    return fail('self-link', 'you cannot make a Qualification link from an element onto itself');
  }
  if (isDependum(source) || isDependum(target)) {
    return fail(
      'dependum-endpoint',
      'you cannot make a Qualification link with a dependum (iStar 2.0 Guide, Page 14)',
    );
  }
  if (source.parent !== target.parent) {
    return fail(
      'different-actors',
      'the source and target of a Qualification link must pertain to the same actor (iStar 2.0 Guide, Page 14)',
    );
  }
  if (graph.isThereLinkBetween(source, target, 'istar.QualificationLink')) {
    return fail(
      'duplicate-link',
      'there can only be one Qualification link between the same two elements',
    );
  }
  if (graph.isThereLinkBetween(source, target, 'istar.ContributionLink')) {
    return fail(
      'contribution-and-qualification',
      'you cannot have Qualification and Contribution links between the same two elements (iStar 2.0 Guide, Page 15)',
    );
  }
  return OK;
};

/** The words used for a list of kind selectors in messages: "a Goal or a Task". */
function describe(graph: Graph, selectors: readonly string[]): string {
  const names = selectors.map((selector) => {
    if (selector === '*') return 'any element';
    if (selector === 'node') return 'an intentional element';
    if (selector === 'actor') return 'an actor';
    const label = graph.metamodel.elements.get(selector)?.label ?? selector;
    return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
  });
  return names.length <= 2
    ? names.join(' or ')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function matchesSelector(graph: Graph, element: IstarElement<string>, selector: string): boolean {
  if (selector === '*') return true;
  const category = graph.metamodel.elements.get(element.kind)?.category;
  if (selector === 'node' || selector === 'actor') return category === selector;
  return elementBehavesLike(graph.metamodel, element.kind, selector);
}

/**
 * Declarative rules of an extension link kind, checked in the order of the iStar 2.0 node-link
 * rules (and of piStar-ext's generated `isValid`): source kind, target kind, self link,
 * dependum, same actor, duplicates.
 */
function declarativeCheck(
  graph: Graph,
  definition: LinkKindDefinition,
  rules: LinkRules,
  rulesKind: string,
  source: IstarElement<string>,
  target: IstarElement<string>,
): LinkCheck {
  const name = definition.label;
  const article = /^[aeiou]/i.test(name) ? 'an' : 'a';
  if (!rules.sources.some((selector) => matchesSelector(graph, source, selector))) {
    return fail(
      'invalid-source',
      `the source of ${article} ${name} link must be ${describe(graph, rules.sources)}`,
    );
  }
  if (!rules.targets.some((selector) => matchesSelector(graph, target, selector))) {
    return fail(
      'invalid-target',
      `the target of ${article} ${name} link must be ${describe(graph, rules.targets)}`,
    );
  }
  if (!rules.allowSelf && source.id === target.id) {
    return fail('self-link', `you cannot make ${article} ${name} link from an element onto itself`);
  }
  if (definition.category === 'node') {
    if (!rules.allowDependum && (isDependum(source) || isDependum(target))) {
      return fail('dependum-endpoint', `you cannot make ${article} ${name} link with a dependum`);
    }
    if (rules.sameActor !== false && source.parent !== target.parent) {
      return fail(
        'different-actors',
        `the source and target of ${article} ${name} link must pertain to the same actor (iStar 2.0 Guide, Page 14)`,
      );
    }
  }
  const unique = rules.unique ?? 'kind';
  if (
    (unique === 'any' && graph.isThereLinkBetween(source, target)) ||
    (unique === 'kind' && graph.isThereLinkOfKindBetween(source, target, definition.kind)) ||
    // A kind inheriting these rules shares the limit with the kind that declares them.
    (unique === 'kind' &&
      rulesKind !== definition.kind &&
      graph.isThereLinkOfKindBetween(source, target, rulesKind))
  ) {
    return fail(
      'duplicate-link',
      `there can only be one ${name} link between the same two elements`,
    );
  }
  return OK;
}

const CHECKS: Partial<Readonly<Record<string, Check>>> = {
  'istar.IsALink': isALink,
  'istar.ParticipatesInLink': participatesInLink,
  'istar.DependencyLink': dependencyLink,
  'istar.AndRefinementLink': refinementLink('AND'),
  'istar.OrRefinementLink': refinementLink('OR'),
  'istar.NeededByLink': neededByLink,
  'istar.ContributionLink': contributionLink,
  'istar.QualificationLink': qualificationLink,
};

export interface ModelIssue<LK extends string = LinkKind> {
  readonly linkId: string;
  readonly kind: LK;
  readonly source: string;
  readonly target: string;
  readonly code: ConstraintCode;
  readonly message: string;
}

/**
 * Re-validates every link of a model, the way piStar does when loading a file: dependencies
 * first (each checked before its own links are added), then the remaining links in file
 * order, each against the graph built so far. Invalid links are reported, not removed.
 */
export function validateModel<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  options: CanLinkOptions<EK, LK>,
): ModelIssue<LK>[];
export function validateModel<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
): ModelIssue<LK>[];
// 0.7.0's exact signature comes last, so `models.map(validateModel)` types as before.
export function validateModel(model: IstarModel): ModelIssue[];
export function validateModel<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  options?: CanLinkOptions<EK, LK>,
): ModelIssue<LK>[] {
  // As an array callback the second argument is an index: ignore anything but options.
  const given = typeof options === 'object' && options !== null ? options.metamodel : undefined;
  const metamodel = (given ?? metamodelOf(model)) as unknown as AnyMetamodel;
  const any = model as unknown as AnyIstarModel;
  const issues: ModelIssue<LK>[] = [];
  const accepted = new Map<string, IstarLink<string>>();
  const view = (): AnyIstarModel => ({ ...any, links: accepted });
  const check = (source: string, target: string, kind: string): LinkCheck =>
    canLink(view(), source, target, kind, { metamodel });
  const isDependency = (link: IstarLink<string>): boolean =>
    metamodel.links.get(link.kind)?.category === 'dependency';

  const report = (
    linkId: string,
    kind: string,
    source: string,
    target: string,
    result: LinkCheck,
  ): void => {
    if (!result.ok) {
      issues.push({
        linkId,
        kind: kind as LK,
        source,
        target,
        code: result.code,
        message: result.reason,
      });
    }
  };

  const dependencyLinks = [...any.links.values()].filter(isDependency);
  for (const dependum of any.elements.values()) {
    if (!dependum.isDependum) continue;
    const inbound = dependencyLinks.find((l) => l.target === dependum.id);
    const outbound = dependencyLinks.find((l) => l.source === dependum.id);
    const depender = inbound?.source ?? dependum.dependency?.source;
    const dependee = outbound?.target ?? dependum.dependency?.target;
    const kind = inbound?.kind ?? outbound?.kind ?? 'istar.DependencyLink';
    if (depender !== undefined && dependee !== undefined) {
      report(inbound?.id ?? dependum.id, kind, depender, dependee, check(depender, dependee, kind));
    }
    if (inbound) accepted.set(inbound.id, inbound);
    if (outbound) accepted.set(outbound.id, outbound);
  }

  for (const link of any.links.values()) {
    if (isDependency(link)) continue;
    if (any.elements.has(link.source) && any.elements.has(link.target)) {
      report(
        link.id,
        link.kind,
        link.source,
        link.target,
        check(link.source, link.target, link.kind),
      );
    } else {
      report(link.id, link.kind, link.source, link.target, {
        ok: false,
        code: 'unknown-element',
        reason: 'the link refers to an element that does not exist',
      });
    }
    accepted.set(link.id, link);
  }
  return issues;
}
