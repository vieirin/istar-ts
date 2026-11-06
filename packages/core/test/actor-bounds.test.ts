import { describe, expect, test } from 'vitest';
import { actorBounds, actorContentBox, metamodelOf } from '../src';
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

describe('actorContentBox', () => {
  test('with no children, is the kind default size at the actor position', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor', undefined, { x: 5, y: 7 });

    const box = actorContentBox(m.model, actor.id, metamodelOf(m.model));
    const defaultSize = metamodelOf(m.model).elements.get('istar.Actor')!.size;
    expect(box).toEqual({ x: 5, y: 7, ...defaultSize });
  });

  test('a stored display size is never a floor: it is ignored even when bigger than the content', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor', undefined, { display: { width: 5000, height: 5000 } });
    m.add('istar.Goal', actor, { x: 10, y: 10 });

    const box = actorContentBox(m.model, actor.id, metamodelOf(m.model));
    expect(box.width).toBeLessThan(5000);
    expect(box.height).toBeLessThan(5000);
  });

  test('grows past the default size for a child outside it, and shifts left/up for one before it', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor', undefined, { x: 100, y: 100 });
    m.add('istar.Goal', actor, { x: 50, y: 60 });

    const box = actorContentBox(m.model, actor.id, metamodelOf(m.model));
    expect(box.x).toBe(50);
    expect(box.y).toBe(60);
  });

  test('two calls on the same model agree (no hidden state, no ratchet)', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    m.add('istar.Goal', actor, { x: 3000, y: 3000 });

    const first = actorContentBox(m.model, actor.id, metamodelOf(m.model));
    const second = actorContentBox(m.model, actor.id, metamodelOf(m.model));
    expect(second).toEqual(first);
  });
});
