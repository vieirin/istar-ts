import { describe, expect, test } from 'vitest';
import { ModelOperationError, connect, connectResultToDiagnostic, updateElement } from '../src';
import { TestModel } from './helpers';

describe('ModelOperationError.toDiagnostic', () => {
  test('anchors on the id the error names', () => {
    const m = new TestModel();
    let caught: unknown;
    try {
      updateElement(m.model, 'missing', { name: 'x' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelOperationError);
    const diagnostic = (caught as ModelOperationError).toDiagnostic();
    expect(diagnostic).toEqual({
      elementId: 'missing',
      severity: 'error',
      message: 'unknown element "missing"',
    });
  });

  test('anchors on an empty elementId when the error names none', () => {
    const error = new ModelOperationError('use addDependency to create dependencies');
    expect(error.toDiagnostic()).toEqual({
      elementId: '',
      severity: 'error',
      message: 'use addDependency to create dependencies',
    });
  });
});

describe('connectResultToDiagnostic', () => {
  test('undefined for a successful connect', () => {
    const m = new TestModel();
    const actor1 = m.add('istar.Actor');
    const actor2 = m.add('istar.Actor');
    const result = connect(m.model, {
      kind: 'istar.IsALink',
      source: actor1.id,
      target: actor2.id,
    });
    expect(
      connectResultToDiagnostic(result, { source: actor1.id, target: actor2.id }),
    ).toBeUndefined();
  });

  test('anchors on the target for a target-side failure', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    const goal = m.add('istar.Goal', actor);
    const result = connect(m.model, {
      kind: 'istar.ParticipatesInLink',
      source: actor.id,
      target: goal.id,
    });
    expect(result.ok).toBe(false);
    const diagnostic = connectResultToDiagnostic(result, { source: actor.id, target: goal.id });
    expect(diagnostic).toEqual({
      elementId: goal.id,
      severity: 'error',
      message: (result as { reason: string }).reason,
      code: 'invalid-target',
    });
  });

  test('anchors on the source for a source-side failure', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    const goal = m.add('istar.Goal', actor);
    const result = connect(m.model, {
      kind: 'istar.ParticipatesInLink',
      source: goal.id,
      target: actor.id,
    });
    expect(result.ok).toBe(false);
    const diagnostic = connectResultToDiagnostic(result, { source: goal.id, target: actor.id });
    expect(diagnostic).toEqual({
      elementId: goal.id,
      severity: 'error',
      message: (result as { reason: string }).reason,
      code: 'invalid-source',
    });
  });

  test('anchors on the source for an unknown source element', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    const result = connect(m.model, {
      kind: 'istar.ParticipatesInLink',
      source: 'missing-source',
      target: actor.id,
    });
    expect(result.ok).toBe(false);
    const diagnostic = connectResultToDiagnostic(result, {
      source: 'missing-source',
      target: actor.id,
    });
    expect(diagnostic).toEqual({
      elementId: 'missing-source',
      severity: 'error',
      message: (result as { reason: string }).reason,
      code: 'unknown-element',
    });
  });

  test('anchors on the target for an unknown target element', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    const result = connect(m.model, {
      kind: 'istar.ParticipatesInLink',
      source: actor.id,
      target: 'missing-target',
    });
    expect(result.ok).toBe(false);
    const diagnostic = connectResultToDiagnostic(result, {
      source: actor.id,
      target: 'missing-target',
    });
    expect(diagnostic).toEqual({
      elementId: 'missing-target',
      severity: 'error',
      message: (result as { reason: string }).reason,
      code: 'unknown-element',
    });
  });

  test('an id containing the word "source" is not misattributed', () => {
    const m = new TestModel();
    const actor = m.add('istar.Actor');
    const result = connect(m.model, {
      kind: 'istar.ParticipatesInLink',
      source: actor.id,
      target: 'resource-1',
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('resource-1');
    const diagnostic = connectResultToDiagnostic(result, {
      source: actor.id,
      target: 'resource-1',
    });
    expect(diagnostic).toEqual({
      elementId: 'resource-1',
      severity: 'error',
      message: (result as { reason: string }).reason,
      code: 'unknown-element',
    });
  });
});
