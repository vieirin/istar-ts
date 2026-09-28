/**
 * iStar 2.0 link constraints, ported from piStar's `tool/language/constraints.js`.
 *
 * Each check runs in the same order as upstream so the reported reason is the one piStar
 * would show. Upstream messages embed HTML and illustrative images; here they are plain text.
 */
import type { LinkKind } from './metamodel';
import { isActorKind } from './metamodel';
import type { IstarElement, IstarLink, IstarModel } from './model';

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

type ElementRef = string | IstarElement;

/**
 * Checks whether a link of `kind` may be added from `source` to `target` in `model`.
 *
 * For `istar.DependencyLink`, `source` is the depender and `target` the dependee (an actor or
 * one of its inner elements); the dependum sits between them and is not part of the check.
 */
export function canLink(
  model: IstarModel,
  source: ElementRef,
  target: ElementRef,
  kind: LinkKind,
): LinkCheck {
  const s = resolve(model, source);
  const t = resolve(model, target);
  if (!s) return fail('unknown-element', `unknown source element "${refId(source)}"`);
  if (!t) return fail('unknown-element', `unknown target element "${refId(target)}"`);
  const check = CHECKS[kind];
  if (!check) return fail('unknown-link-kind', `unknown link kind "${String(kind)}"`);
  return check(new Graph(model), s, t);
}

function refId(ref: ElementRef): string {
  return typeof ref === 'string' ? ref : ref.id;
}

function resolve(model: IstarModel, ref: ElementRef): IstarElement | undefined {
  // Always look the element up so a stale object can't be checked against a newer model.
  return model.elements.get(refId(ref));
}

/** The graph queries used by upstream constraints (`istar.isThereLinkBetween`, etc.). */
class Graph {
  constructor(readonly model: IstarModel) {}

  /**
   * True when a link (optionally of `kind`) already connects the two elements, in either
   * direction. Mirrors `istar.isThereLinkBetween`.
   */
  isThereLinkBetween(a: IstarElement, b: IstarElement, kind?: LinkKind): boolean {
    for (const link of this.model.links.values()) {
      if (kind && link.kind !== kind) continue;
      if (
        (link.source === a.id && link.target === b.id) ||
        (link.source === b.id && link.target === a.id)
      ) {
        return true;
      }
    }
    return false;
  }

  isSourceOfType(element: IstarElement, kind: LinkKind): boolean {
    for (const link of this.model.links.values()) {
      if (link.kind === kind && link.source === element.id) return true;
    }
    return false;
  }

  isTargetOfType(element: IstarElement, kind: LinkKind): boolean {
    for (const link of this.model.links.values()) {
      if (link.kind === kind && link.target === element.id) return true;
    }
    return false;
  }
}

type Check = (graph: Graph, source: IstarElement, target: IstarElement) => LinkCheck;

const is = (element: IstarElement, ...shortNames: string[]): boolean =>
  shortNames.some((name) => element.kind === `istar.${name}`);

const isKindOfActor = (element: IstarElement): boolean => isActorKind(element.kind);
const isDependum = (element: IstarElement): boolean => element.isDependum === true;

const isALink: Check = (graph, source, target) => {
  // Upstream evaluates the source-kind check after the type-equality check without guarding
  // on the previous result, so its message wins when both fail. Reproduced here.
  if (!is(source, 'Actor', 'Role')) {
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
  if (!is(target, 'Actor', 'Role')) {
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
  if (!isKindOfActor(source)) {
    return fail(
      'invalid-source',
      'the source of a Participates-In link must be some kind of actor (iStar 2.0 Guide, Page 6)',
    );
  }
  if (!isKindOfActor(target)) {
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
function owningActorId(element: IstarElement): string | undefined {
  return isKindOfActor(element) ? element.id : element.parent;
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
  if (owningActorId(source) === owningActorId(target)) {
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
    if (!is(source, 'Task', 'Goal')) {
      return fail(
        'invalid-source',
        `the source of an ${label}-refinement link must be a Goal or a Task (iStar 2.0 Guide, Table 1)`,
      );
    }
    if (!is(target, 'Task', 'Goal')) {
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
  if (!is(source, 'Resource')) {
    return fail(
      'invalid-source',
      'the source of a Needed-By link must be a Resource (iStar 2.0 Guide, Table 1)',
    );
  }
  if (!is(target, 'Task')) {
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
  if (!is(source, 'Goal', 'Quality', 'Task', 'Resource')) {
    return fail(
      'invalid-source',
      'the source of a Contribution link must be a Goal, a Quality, a Task or a Resource (iStar 2.0 Guide, Table 1)',
    );
  }
  if (!is(target, 'Quality')) {
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
  if (!is(source, 'Quality')) {
    return fail(
      'invalid-source',
      'the source of a Qualification link must be a Quality (iStar 2.0 Guide, Table 1)',
    );
  }
  if (!is(target, 'Goal', 'Task', 'Resource')) {
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

const CHECKS: Readonly<Record<LinkKind, Check>> = {
  'istar.IsALink': isALink,
  'istar.ParticipatesInLink': participatesInLink,
  'istar.DependencyLink': dependencyLink,
  'istar.AndRefinementLink': refinementLink('AND'),
  'istar.OrRefinementLink': refinementLink('OR'),
  'istar.NeededByLink': neededByLink,
  'istar.ContributionLink': contributionLink,
  'istar.QualificationLink': qualificationLink,
};

export interface ModelIssue {
  readonly linkId: string;
  readonly kind: LinkKind;
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
export function validateModel(model: IstarModel): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const accepted = new Map<string, IstarLink>();
  const view = (): IstarModel => ({ ...model, links: accepted });

  const report = (
    linkId: string,
    kind: LinkKind,
    source: string,
    target: string,
    check: LinkCheck,
  ): void => {
    if (!check.ok) {
      issues.push({ linkId, kind, source, target, code: check.code, message: check.reason });
    }
  };

  const dependencyLinks = [...model.links.values()].filter(
    (l) => l.kind === 'istar.DependencyLink',
  );
  for (const dependum of model.elements.values()) {
    if (!dependum.isDependum) continue;
    const inbound = dependencyLinks.find((l) => l.target === dependum.id);
    const outbound = dependencyLinks.find((l) => l.source === dependum.id);
    const depender = inbound?.source ?? dependum.dependency?.source;
    const dependee = outbound?.target ?? dependum.dependency?.target;
    if (depender !== undefined && dependee !== undefined) {
      report(
        inbound?.id ?? dependum.id,
        'istar.DependencyLink',
        depender,
        dependee,
        canLink(view(), depender, dependee, 'istar.DependencyLink'),
      );
    }
    if (inbound) accepted.set(inbound.id, inbound);
    if (outbound) accepted.set(outbound.id, outbound);
  }

  for (const link of model.links.values()) {
    if (link.kind === 'istar.DependencyLink') continue;
    if (model.elements.has(link.source) && model.elements.has(link.target)) {
      report(
        link.id,
        link.kind,
        link.source,
        link.target,
        canLink(view(), link.source, link.target, link.kind),
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
