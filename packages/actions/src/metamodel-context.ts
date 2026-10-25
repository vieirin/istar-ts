/**
 * A built-in context provider (#240): what an agent needs to know about a model's own
 * vocabulary — its element and link kinds, containment, link rules and value sets — derived
 * only from the `Metamodel`, so it works unchanged for iStar 2.0, KAOS, NFR, an
 * `extendMetamodel` result or a file metamodel (pistarExt). No dialect names in this file.
 *
 * `metamodelContextProvider` is the `HostContextProvider` every launcher and agent session
 * includes by default (opt-out: `metamodelContext: false`); a host's own providers are appended
 * after it.
 */
import { effectiveLinkKind } from '@istar-ts/core';
import type { AnyIstarModel, AnyMetamodel, PropertySchema, PropertyShape } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import { isHub, ofCategory, union } from './hints';
import type { HostContextProvider } from './host';

export interface MetamodelPropertyContext {
  readonly key: string;
  readonly type: string;
  readonly values?: readonly string[];
  readonly optional?: boolean;
  readonly description?: string;
}

export interface MetamodelElementContext {
  readonly kind: string;
  readonly label: string;
  readonly description?: string;
  readonly category: 'actor' | 'node';
  readonly canBeOnPaper?: boolean;
  readonly canBeInnerElement?: boolean;
  readonly properties?: readonly MetamodelPropertyContext[];
}

export interface MetamodelLinkContext {
  readonly kind: string;
  readonly label: string;
  readonly description?: string;
  readonly category: 'actor' | 'node' | 'dependency';
  readonly sources: readonly string[];
  readonly targets: readonly string[];
  /** `'n'` for a link joining several sources at a hub (see `Metamodel`'s `arity`). */
  readonly arity?: 'n';
  /** The link's declared value set (e.g. a Contribution link's make/help/hurt/break). */
  readonly values?: readonly string[];
  readonly properties?: readonly MetamodelPropertyContext[];
}

/** A `Metamodel`, described for an LLM: JSON-serializable, derived only from the metamodel. */
export interface MetamodelContext {
  readonly framework: string;
  readonly elements: readonly MetamodelElementContext[];
  readonly links: readonly MetamodelLinkContext[];
}

export interface MetamodelContextOptions {
  /**
   * Typed custom-property schemas (`@istar-ts/core`'s `defineProperties`), keyed by kind, e.g.
   * a dialect's own or a contribution's (`IstarGlspContribution.schemas`). Properties a kind has
   * no schema for are left out: `customProperties` values stay strings the metamodel itself
   * knows nothing about.
   */
  readonly schemas?: readonly PropertySchema<PropertyShape, string>[];
}

function propertiesOf(
  kind: string,
  byKind: ReadonlyMap<string, readonly PropertySchema<PropertyShape, string>[]>,
): readonly MetamodelPropertyContext[] | undefined {
  const schemas = byKind.get(kind);
  if (!schemas || schemas.length === 0) return undefined;
  const properties: MetamodelPropertyContext[] = [];
  for (const schema of schemas) {
    for (const [key, field] of Object.entries(schema.shape)) {
      properties.push({
        key,
        type: field.type,
        ...(field.values ? { values: field.values } : {}),
        ...(field.options.optional ? { optional: true } : {}),
        ...(field.options.description ? { description: field.options.description } : {}),
      });
    }
  }
  return properties;
}

/**
 * `metamodel`, as a typed, JSON-serializable description: every element and link kind a
 * modeller declares directly (kinds generated for an n-ary link's hub, leg or end are left out,
 * as a hand-written palette hides them too), its containment, and each link kind's source and
 * target kinds in words, resolved the same way `canLink` does (`union`/`ofCategory`).
 */
export function metamodelContext(
  metamodel: AnyMetamodel,
  options: MetamodelContextOptions = {},
): MetamodelContext {
  const schemasByKind = new Map<string, PropertySchema<PropertyShape, string>[]>();
  for (const schema of options.schemas ?? []) {
    const list = schemasByKind.get(schema.kind) ?? [];
    list.push(schema);
    schemasByKind.set(schema.kind, list);
  }

  const elements: MetamodelElementContext[] = [];
  for (const definition of metamodel.elements.values()) {
    if (isHub(definition)) continue;
    elements.push({
      kind: definition.kind,
      label: definition.label,
      ...(definition.description !== undefined ? { description: definition.description } : {}),
      category: definition.category,
      ...(definition.info
        ? {
            canBeOnPaper: definition.info.canBeOnPaper,
            canBeInnerElement: definition.info.canBeInnerElement,
          }
        : {}),
      ...(propertiesOf(definition.kind, schemasByKind)
        ? { properties: propertiesOf(definition.kind, schemasByKind) }
        : {}),
    });
  }

  const links: MetamodelLinkContext[] = [];
  for (const definition of metamodel.links.values()) {
    if (definition.role !== undefined) continue;
    const rules = metamodel.links.get(effectiveLinkKind(metamodel, definition.kind))?.rules;
    const builtIn =
      definition.category === 'dependency'
        ? ofCategory(metamodel)
        : ofCategory(metamodel, definition.category as 'actor' | 'node');
    links.push({
      kind: definition.kind,
      label: definition.label,
      ...(definition.description !== undefined ? { description: definition.description } : {}),
      category: definition.category,
      sources: rules ? union(metamodel, rules.sources) : builtIn,
      targets: rules ? union(metamodel, rules.targets) : builtIn,
      ...(definition.arity === 'n' ? { arity: definition.arity } : {}),
      ...(definition.info.possibleLabels ? { values: definition.info.possibleLabels } : {}),
      ...(propertiesOf(definition.kind, schemasByKind)
        ? { properties: propertiesOf(definition.kind, schemasByKind) }
        : {}),
    });
  }

  return { framework: metamodel.framework, elements, links };
}

function propertiesLine(properties: readonly MetamodelPropertyContext[] | undefined): string[] {
  if (!properties || properties.length === 0) return [];
  const parts = properties.map((p) => {
    const bits = [p.type, ...(p.values ? [`values: ${p.values.join('/')}`] : [])];
    return `${p.key} (${bits.join(', ')})${p.optional ? '?' : ''}`;
  });
  return [`  properties: ${parts.join(', ')}`];
}

function flags(element: MetamodelElementContext): string {
  const bits: string[] = [];
  if (element.canBeOnPaper) bits.push('on paper');
  if (element.canBeInnerElement) bits.push('inner');
  return bits.length > 0 ? ` [${bits.join(', ')}]` : '';
}

function elementLine(element: MetamodelElementContext): string[] {
  const description = element.description ? ` — ${element.description}` : '';
  return [
    `- ${element.kind} (${element.label})${flags(element)}${description}`,
    ...propertiesLine(element.properties),
  ];
}

function linkLine(link: MetamodelLinkContext): string[] {
  const arity = link.arity === 'n' ? ' [n-ary, via a hub]' : '';
  const values = link.values ? `; values: ${link.values.join(', ')}` : '';
  const description = link.description ? ` — ${link.description}` : '';
  return [
    `- ${link.kind} (${link.label})${arity}: ${link.category} link, ` +
      `${link.sources.join(', ')} → ${link.targets.join(', ')}${values}${description}`,
    ...propertiesLine(link.properties),
  ];
}

/**
 * `context`, rendered as compact, deterministic markdown for an LLM: one section each for actor
 * kinds, node kinds and link kinds, in the metamodel's own declaration order.
 */
export function metamodelContextText(context: MetamodelContext): string {
  const actors = context.elements.filter((e) => e.category === 'actor');
  const nodes = context.elements.filter((e) => e.category === 'node');
  const sections = [`# ${context.framework} metamodel`];
  if (actors.length > 0) {
    sections.push(['## Actor kinds', ...actors.flatMap(elementLine)].join('\n'));
  }
  if (nodes.length > 0) {
    sections.push(['## Node kinds', ...nodes.flatMap(elementLine)].join('\n'));
  }
  if (context.links.length > 0) {
    sections.push(['## Link kinds', ...context.links.flatMap(linkLine)].join('\n'));
  }
  return sections.join('\n\n');
}

/**
 * The built-in `HostContextProvider` (#240): its text is always read from the model at hand
 * (`metamodelOf(model)`), so one instance works for every dialect a host serves. `options`
 * (`schemas`, mainly from a dialect's `IstarGlspContribution`) are fixed at creation time.
 */
export function metamodelContextProvider(
  options: MetamodelContextOptions = {},
): HostContextProvider {
  return {
    name: 'metamodel',
    title: "This model's language",
    text: (model: AnyIstarModel) =>
      metamodelContextText(metamodelContext(metamodelOf(model) as AnyMetamodel, options)),
  };
}
