import { describe, expect, test, vi } from 'vitest';

/**
 * Two copies of the library in one process (a bundle loading the ESM and the CJS builds):
 * a model parsed by one keeps its metamodel and its file's layout for the other.
 */
describe('registries shared across copies of the library', () => {
  test('a second copy sees the first copy’s metamodel and layout', async () => {
    const first = await import('../src');
    vi.resetModules();
    const second = await import('../src');
    expect(second.parsePistar).not.toBe(first.parsePistar); // really two copies

    const kaos = first.defineMetamodel({
      name: 'k',
      prefix: 'k',
      elements: [{ kind: 'k.Goal', category: 'node' }],
      links: [],
    });
    const text = JSON.stringify({
      actors: [],
      orphans: [{ id: 'g', text: 'G', type: 'k.Goal', customProperties: {}, x: 1, y: 2 }],
      links: [],
      tool: 'k',
    });
    const model = first.parsePistar(text, { metamodel: kaos });
    expect(second.metamodelOf(model)).toBe(kaos);
    expect(second.getSourceLayout(model)?.keys).toEqual(['actors', 'orphans', 'links', 'tool']);
    expect(second.toPistar(model)).toBe(first.toPistar(model));
  });
});
