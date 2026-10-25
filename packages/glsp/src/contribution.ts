/**
 * Feature tiers, after Metin & Bork 2025 (§4.1.1, Fig. 3) and their manifests and contributions
 * (§4.1.2, Fig. 4; bigUML's realization, §5.1.1, Fig. 8):
 *
 * - **core** (language-independent): `IstarDiagramModule`, the manifest that binds the model
 *   state, source model storage, GModel factory and diagram configuration. Every one of them is
 *   generic over the metamodel, so one implementation serves every language (flow similarity,
 *   §4.1.4: the operations already are, in `@istar-ts/actions`).
 * - **tool**: nothing of its own yet (the palette provider and validation come with editing).
 * - **diagram** (language-specific): an `IstarGlspContribution`, the data a dialect provides,
 *   bound into the session's Inversify container by its manifest, `IstarContributionModule`.
 *   The core tier's classes `@inject(IstarGlspContribution)` it, so a dialect never subclasses
 *   them. iStar 2.0 (`ISTAR_GLSP`) is the default; KAOS and NFR are in `@istar-ts/glsp/kaos` and
 *   `@istar-ts/glsp/nfr`.
 *
 * The DI container is the GLSP server's own (Inversify, `@eclipse-glsp/server`); nothing outside
 * this package sees it. Dialect packages keep exporting plain values.
 */
import type {
  AnyMetamodel,
  AnyPaletteDescription,
  PropertySchema,
  PropertyShape,
} from '@istar-ts/core';
import { DEFAULT_PALETTE, ISTAR_2_0 } from '@istar-ts/core';
import { paletteFromMetamodel } from '@istar-ts/actions';
import { GLSPModule } from '@eclipse-glsp/server';
import type { interfaces } from 'inversify';
import type { GModelSizeOverrides, GModelTypeOverrides } from './types';

/** What a dialect contributes to the diagram tier. Plain data: no classes, no container. */
export interface IstarGlspContribution {
  /** The GLSP diagram type a client opens a session for (`initializeClientSession`). */
  readonly diagramType: string;
  /** The language: the GModel's types, the type hints and the parser follow it. */
  readonly metamodel: AnyMetamodel;
  /** What `requestContextActions` offers as the tool palette. Default: iStar 2.0's palette. */
  readonly palette?: AnyPaletteDescription;
  /** Kind → GModel type, for kinds whose type differs from `node:<kind>`/`edge:<kind>`. */
  readonly types?: GModelTypeOverrides;
  /**
   * Kind → size, for kinds whose GModel size differs from the metamodel's own default — a host
   * whose `@istar-ts/react` registry overrides a kind's size (`contributionFor`'s `sizes`) must
   * pass the same sizes here, or `modelToGModelSchema`'s nodes and actor boundaries (`actorBounds`)
   * stop matching what that registry draws (#154).
   */
  readonly sizes?: GModelSizeOverrides;
  /** Property schemas an operation must not break (the dispatcher's `schemas`). */
  readonly schemas?: readonly PropertySchema<PropertyShape, string>[];
  /**
   * Read a file's own `"metamodel"` block, extending `metamodel` with it (`parsePistar`'s
   * `fileMetamodel`). Default true, as the playground opens files.
   */
  readonly fileMetamodel?: boolean;
}

/** Service identifier of the session's `IstarGlspContribution`. */
export const IstarGlspContribution: unique symbol = Symbol('IstarGlspContribution');

/** What a `contributionFor` caller may give beyond the metamodel itself. */
export interface ContributionOptions {
  /** Default: the metamodel's own `framework` (its root's name). */
  readonly diagramType?: string;
  /** Default: a palette derived from the metamodel's kinds (`paletteFromMetamodel`). */
  readonly palette?: AnyPaletteDescription;
  readonly types?: GModelTypeOverrides;
  readonly sizes?: GModelSizeOverrides;
  readonly schemas?: readonly PropertySchema<PropertyShape, string>[];
  readonly fileMetamodel?: boolean;
}

/**
 * Builds an `IstarGlspContribution` from any metamodel at runtime: iStar 2.0, KAOS, NFR, or an
 * `extendMetamodel` result of a host's own. `ISTAR_GLSP`, `KAOS_GLSP` and `NFR_GLSP` are just
 * calls to this with their own palette and schemas; a dialect with none is no special case,
 * it falls back to `paletteFromMetamodel`.
 */
export function contributionFor(
  metamodel: AnyMetamodel,
  options: ContributionOptions = {},
): IstarGlspContribution {
  return {
    diagramType: options.diagramType ?? metamodel.framework,
    metamodel,
    palette: options.palette ?? paletteFromMetamodel(metamodel),
    ...(options.types ? { types: options.types } : {}),
    ...(options.sizes ? { sizes: options.sizes } : {}),
    ...(options.schemas ? { schemas: options.schemas } : {}),
    ...(options.fileMetamodel !== undefined ? { fileMetamodel: options.fileMetamodel } : {}),
  };
}

/** iStar 2.0, the default contribution. */
export const ISTAR_GLSP: IstarGlspContribution = contributionFor(
  ISTAR_2_0 as unknown as AnyMetamodel,
  {
    diagramType: 'istar',
    palette: DEFAULT_PALETTE as unknown as AnyPaletteDescription,
  },
);

/** The palette a contribution offers: its own, or iStar 2.0's. */
export function paletteOf(contribution: IstarGlspContribution): AnyPaletteDescription {
  return contribution.palette ?? (DEFAULT_PALETTE as unknown as AnyPaletteDescription);
}

/** Re-exported for callers that already imported it from `@istar-ts/glsp`; the derivation
 * itself moved to `@istar-ts/actions` (#202) so `createActionDispatcher` can share it without
 * depending on this package. */
export { paletteFromMetamodel } from '@istar-ts/actions';

/**
 * `contribution`'s palette, with an entry for every kind of `metamodel` the contribution's own
 * palette leaves undeclared: a file's own `"metamodel"` block (#97) adds kinds after the
 * contribution's `PaletteDescription` was written, so those fall back to `paletteFromMetamodel`'s
 * derived entry, one per section the contribution's own entries don't already cover for that
 * kind. A kind the contribution's palette hides (`false`) stays hidden.
 */
export function effectivePaletteFor(
  contribution: IstarGlspContribution,
  metamodel: AnyMetamodel,
): AnyPaletteDescription {
  const base = paletteOf(contribution);
  const derived = paletteFromMetamodel(metamodel);
  return {
    elements: { ...derived.elements, ...base.elements },
    links: { ...derived.links, ...base.links },
    groups: { ...derived.groups, ...base.groups },
  };
}

/**
 * A dialect's manifest: binds its `IstarGlspContribution` into the client session's container,
 * where the core tier's classes get it. Install it next to the diagram module
 * (`configureIstarDiagram` does both).
 */
export class IstarContributionModule extends GLSPModule {
  readonly contribution: IstarGlspContribution;

  constructor(contribution: IstarGlspContribution) {
    super();
    this.contribution = contribution;
  }

  protected configure(bind: interfaces.Bind): void {
    bind(IstarGlspContribution).toConstantValue(this.contribution);
  }
}
