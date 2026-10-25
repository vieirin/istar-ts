/**
 * An example host context provider (`@istar-ts/actions`' `HostContextProvider`, #175): the
 * active model's element and link kinds, read from its own metamodel at run time, as a section
 * of the drawer's system prompt. Prompt-only (`resource: false`), so backend A's tool list is
 * unchanged.
 */
import type { HostContextProvider } from '@istar-ts/actions';
import { metamodelOf } from '@istar-ts/core';

export const KINDS_SUMMARY: HostContextProvider = {
  name: 'kinds-summary',
  title: "Kinds in this model's language",
  resource: false,
  text: (model) => {
    const metamodel = metamodelOf(model);
    // Kinds generated for an n-ary link (a hub, leg or end) are not the model's to pick.
    const elements = [...metamodel.elements.values()].filter((d) => d.role === undefined);
    const links = [...metamodel.links.values()].filter((d) => d.role === undefined);
    return [
      `Language: ${metamodel.framework}.`,
      `Element kinds: ${elements.map((d) => `${d.kind} (${d.label})`).join(', ')}.`,
      `Link kinds: ${links.map((d) => `${d.kind} (${d.label})`).join(', ')}.`,
    ].join('\n');
  },
};
