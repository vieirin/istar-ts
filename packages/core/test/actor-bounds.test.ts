import { describe, expect, test } from 'vitest';
import { actorBounds, metamodelOf } from '../src';
import { TestModel } from './helpers';

describe('actorBounds', () => {
  test('a stored display size is the floor, used as-is when children fit inside it', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor', undefined, { display: { width: 500, height: 400 } });
    m.add('istar.Goal', actor, { x: 50, y: 50 });

    const box = actorBounds(m.model, actor.id, metamodelOf(m.model));
    expect(box).toEqual({ x: actor.x, y: actor.y, width: 500, height: 400 });
  });

  test('a child outside the stored size grows the box past it', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor', undefined, { display: { width: 500, height: 400 } });
    m.add('istar.Goal', actor, { x: 3000, y: 3000 });

    const box = actorBounds(m.model, actor.id, metamodelOf(m.model));
    expect(box.width).toBeGreaterThan(500);
    expect(box.height).toBeGreaterThan(400);
  });

  test('moving the child back shrinks the box to the stored size, not the kind default', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor', undefined, { display: { width: 500, height: 400 } });
    const child = m.add('istar.Goal', actor, { x: 3000, y: 3000 });

    m.model = {
      ...m.model,
      elements: new Map(m.model.elements).set(child.id, { ...child, x: 50, y: 50 }),
    };

    const box = actorBounds(m.model, actor.id, metamodelOf(m.model));
    expect(box).toEqual({ x: actor.x, y: actor.y, width: 500, height: 400 });
    const defaultSize = metamodelOf(m.model).elements.get('istar.Actor')!.size;
    expect(box.width).not.toBe(defaultSize.width);
  });

  test('with no stored display size, floors on the kind default size', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    m.add('istar.Goal', actor, { x: 10, y: 10 });

    const box = actorBounds(m.model, actor.id, metamodelOf(m.model));
    const defaultSize = metamodelOf(m.model).elements.get('istar.Actor')!.size;
    expect(box.width).toBeGreaterThanOrEqual(defaultSize.width);
    expect(box.height).toBeGreaterThanOrEqual(defaultSize.height);
  });
});
