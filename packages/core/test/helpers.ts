import type { ElementKind, IstarElement, IstarLink, IstarModel, LinkKind } from '../src';
import { canLink, createEmptyModel } from '../src';

/** Tiny mutable builder for constraint tests (the real store arrives with the model API). */
export class TestModel {
  private seq = 0;
  model: IstarModel = createEmptyModel();

  add(kind: ElementKind, parent?: IstarElement, extra: Partial<IstarElement> = {}): IstarElement {
    const element: IstarElement = {
      id: `e${++this.seq}`,
      kind,
      name: kind.slice(6),
      x: 0,
      y: 0,
      ...(parent ? { parent: parent.id } : {}),
      ...extra,
    };
    this.model = { ...this.model, elements: new Map(this.model.elements).set(element.id, element) };
    return element;
  }

  /** Adds the link only if `canLink` allows it, like upstream's `istar.addXLink`. */
  link(source: IstarElement, target: IstarElement, kind: LinkKind): IstarLink | undefined {
    if (!canLink(this.model, source, target, kind).ok) return undefined;
    return this.forceLink(source, target, kind);
  }

  forceLink(source: IstarElement, target: IstarElement, kind: LinkKind): IstarLink {
    const link: IstarLink = { id: `l${++this.seq}`, kind, source: source.id, target: target.id };
    this.model = { ...this.model, links: new Map(this.model.links).set(link.id, link) };
    return link;
  }

  /** depender → dependum → dependee, if valid. */
  dependency(depender: IstarElement, kind: ElementKind, dependee: IstarElement) {
    if (!canLink(this.model, depender, dependee, 'istar.DependencyLink').ok) return undefined;
    const dependum = this.add(kind, undefined, { isDependum: true });
    return {
      dependum,
      links: [
        this.forceLink(depender, dependum, 'istar.DependencyLink'),
        this.forceLink(dependum, dependee, 'istar.DependencyLink'),
      ],
    };
  }
}

/** The actor with inner elements used by upstream's `createGoalModel`. */
export function goalModel() {
  const m = new TestModel();
  const actor = m.add('istar.Actor');
  const inner = (kind: ElementKind) => m.add(kind, actor);
  return {
    m,
    actor,
    goal1: inner('istar.Goal'),
    goal2: inner('istar.Goal'),
    goal3: inner('istar.Goal'),
    quality1: inner('istar.Quality'),
    quality2: inner('istar.Quality'),
    task1: inner('istar.Task'),
    task2: inner('istar.Task'),
    resource1: inner('istar.Resource'),
    resource2: inner('istar.Resource'),
  };
}
