/**
 * Default-view registrations for a GModel's concrete types. `@istar-ts/glsp`'s `modelToGModel`
 * types every element kind `node:<kind>` and every link kind `edge:<kind>` (`gmodelTypes`,
 * `packages/glsp/src/types.ts`); the stock client's `configureDefaultModelElements` only knows
 * the bare `'node'`/`'edge'` strings, so each concrete type needs its own registration. This
 * reuses the exact view classes the default types already render with
 * (`RoundedCornerNodeView`, `GEdgeView`), so a kind without a custom shape (S3) still renders —
 * "it uses only the framework's default views and configuration" (#83).
 */
import type { interfaces } from 'inversify';
import {
  GEdge,
  GEdgeView,
  GNode,
  RoundedCornerNodeView,
  configureDefaultModelElements,
  configureModelElement,
} from '@eclipse-glsp/client';
import type { AnyMetamodel } from '@istar-ts/core';
import { configureIstarViews } from './istar-views';

/** What `configureModelElement` needs of a module's binding context. */
export interface ModelElementBindingContext {
  readonly bind: interfaces.Bind;
  readonly isBound: interfaces.IsBound;
}

/**
 * Registers the built-ins (`graph`, `label`, plain `node`/`edge`, …) and then every `node:*`/
 * `edge:*` type in `types` with the default node/edge view. `configureDefaultModelElements` is
 * not part of `DEFAULT_MODULES` — every standalone app binds it itself (framework-notes §4).
 *
 * With `metamodel` given, `configureIstarViews` (`istar-views.ts`) then overrides the types it
 * knows how to draw with iStar 2.0 shapes (#84); a type it has nothing for keeps the default view
 * just registered. Without a metamodel (a caller not yet updated for #84), behaviour is
 * unchanged: only the framework's default views.
 */
export function configureIstarModelElements(
  context: ModelElementBindingContext,
  types: readonly string[],
  metamodel?: AnyMetamodel,
): void {
  configureDefaultModelElements(context);
  for (const type of types) {
    if (type.startsWith('node:'))
      configureModelElement(context, type, GNode, RoundedCornerNodeView);
    else if (type.startsWith('edge:')) configureModelElement(context, type, GEdge, GEdgeView);
    // 'label' is already bound by `configureDefaultModelElements`.
  }
  if (metamodel) configureIstarViews(context, metamodel, types);
}
