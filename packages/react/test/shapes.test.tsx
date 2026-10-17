import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { PathShape, elementIcon, pathBounds, polygonPath } from '../src';

// DSM3-goals' KAOS goal: a parallelogram on a 130×36 drawing.
const GOAL_POINTS = '0,36 15,0 130,0 115,36';

describe('polygonPath', () => {
  test('turns polygon points into a closed path through them', () => {
    expect(polygonPath(GOAL_POINTS)).toBe('M 0 36 L 15 0 L 130 0 L 115 36 Z');
    expect(pathBounds(polygonPath(GOAL_POINTS))).toEqual({ x: 0, y: 0, width: 130, height: 36 });
  });

  test('accepts any whitespace and comma separation', () => {
    expect(polygonPath(' 0 0,10 0  10,10 ')).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  test('rejects malformed points', () => {
    expect(() => polygonPath('0,0 10')).toThrow('Invalid polygon points');
    expect(() => polygonPath('0,0 a,b')).toThrow('Invalid polygon points');
    expect(() => polygonPath('')).toThrow('Invalid polygon points');
  });
});

function outline(element: ReturnType<typeof render>['container']): SVGPathElement {
  return element.querySelector('.istar-shape path') as SVGPathElement;
}

describe('PathShape', () => {
  const path = polygonPath(GOAL_POINTS);

  test('draws the default outline when the spec gives no dash or width', () => {
    const { container } = render(<PathShape path={path} width={135} height={36} />);
    const style = outline(container).style;
    expect(style.strokeDasharray).toBe('');
    expect(style.strokeWidth).toBe('var(--istar-stroke-width)');
  });

  test('draws the dash and stroke width the spec gives', () => {
    const { container } = render(
      <PathShape path={path} dash="8,4" strokeWidth={5} width={135} height={36} />,
    );
    const style = outline(container).style;
    expect(style.strokeDasharray).toBe('8,4');
    expect(style.strokeWidth).toBe('5');
  });

  test('palette icons shrink the dash and width with the shape', () => {
    const { container } = render(
      elementIcon('kaos.Softgoal', { shape: { path, dash: '10,5', strokeWidth: 5 } }),
    );
    const style = (container.querySelector('path') as SVGPathElement).style;
    expect(style.strokeDasharray).toBe('4,2');
    expect(style.strokeWidth).toBe('3');
  });
});
