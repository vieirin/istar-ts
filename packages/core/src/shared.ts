/**
 * Registries the library keeps beside models (their metamodel, their file's layout) are
 * shared across every copy of `@istar-ts/core` loaded in a process. A bundle may load the
 * package twice, once as ESM and once as CommonJS (an application parsing with the ESM build
 * while a CommonJS dependency reads the model with the CJS build): a module-level WeakMap in
 * each copy would make a model parsed by one copy unknown to the other, so `metamodelOf`
 * would fall back to iStar 2.0 there. The registries live on `globalThis` under one symbol
 * instead, keyed by name, and every copy finds the same ones.
 */
const REGISTRIES: unique symbol = Symbol.for('@istar-ts/core/registries');

type Registries = Map<string, WeakMap<object, unknown>>;

/** The WeakMap named `name`, the same object in every copy of the library in this process. */
export function sharedWeakMap<V>(name: string): WeakMap<object, V> {
  const host = globalThis as { [REGISTRIES]?: Registries };
  const registries = (host[REGISTRIES] ??= new Map());
  let map = registries.get(name);
  if (!map) registries.set(name, (map = new WeakMap()));
  return map as WeakMap<object, V>;
}
