import { describe, expect, test } from 'vitest';
import { ISTAR_2_0, parsePistar, toPistar } from '../src';
import { loadDsm3Fixtures } from './fixtures';

const dsm3 = new Map(loadDsm3Fixtures().map((f) => [f.name.replace(/^dsm3\//, ''), f.text]));
const fixture = (name: string): string => {
  const text = dsm3.get(name);
  if (text === undefined) throw new Error(`missing fixture dsm3/${name}`);
  return text;
};

describe('DSM3-goals fixtures', () => {
  test('are the three welcome models', () => {
    expect([...dsm3.keys()]).toEqual(['istar2-welcome.txt', 'kaos-welcome.txt', 'nfr-welcome.txt']);
  });

  test("DSM3's iStar 2.0 example round-trips byte for byte with ISTAR_2_0", () => {
    const text = fixture('istar2-welcome.txt');
    const model = parsePistar(text, { metamodel: ISTAR_2_0 });
    expect(model.tool).toBe('dsm3-goals');
    expect(model.extra).toEqual({ metamodelVersion: '1.0' });
    expect(toPistar(model)).toBe(text);
  });
});
