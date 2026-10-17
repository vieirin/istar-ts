import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { IstarRegistry } from '../src';
import { createRegistry, linkIcon, paletteSections } from '../src';

const BOLT = 'm 10,-7 l 0,20 -5,-15 -15,15 0,-25 5,15 15,-15 0,5';

describe('link palette icons', () => {
  test('linkIcon draws a glyph at the middle of the line, without a marker', () => {
    const { container } = render(linkIcon('x.Conflict', undefined, { marker: null, glyph: BOLT }));
    const glyph = container.querySelector('.istar-palette-glyph')!;
    expect(glyph.getAttribute('d')).toBe(BOLT);
    expect(glyph.getAttribute('transform')).toMatch(/^translate\(20 12\)/);
    // The line, the glyph, and nothing else drawn.
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  test('a link kind’s icon is used for its entries that have none, not over their own', () => {
    const icon = <svg data-testid="custom" />;
    const own = <svg data-testid="own" />;
    const registry = createRegistry({
      links: {
        'istar.AndRefinementLink': { icon, palette: [{ label: 'And' }] },
        'istar.OrRefinementLink': { icon, palette: [{ label: 'Or', icon: own }] },
      },
    }) as IstarRegistry;
    const items = paletteSections(registry)
      .flat()
      .flatMap((slot) => (slot.type === 'item' ? [slot.item] : slot.items));
    expect(items.find((i) => i.entry.label === 'And')?.entry.icon).toBe(icon);
    expect(items.find((i) => i.entry.label === 'Or')?.entry.icon).toBe(own);
  });
});
