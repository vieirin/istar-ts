/**
 * The tool tier (Metin & Bork 2025 §4.1.1): the palette, edge checks, markers and label checks,
 * each derived from the contribution and answered by the dispatcher where it has an answer, so
 * a GLSP client and the React Flow canvas offer and refuse the same things.
 */
import type { AnyMetamodel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import type { CheckEdgeResultAction as IstarCheckEdgeResult } from '@istar-ts/actions';
import { contextActionsFor } from '@istar-ts/actions';
import {
  CheckEdgeResultAction,
  GModelRoot,
  ModelState,
  RequestCheckEdgeAction,
  RequestTypeHintsAction,
  SetTypeHintsAction,
  ToolPaletteItemProvider,
  TriggerEdgeCreationAction,
  TriggerNodeCreationAction,
  ValidationStatus,
} from '@eclipse-glsp/server';
import type {
  Action,
  ActionHandler,
  Args,
  GModelElement,
  LabelEditValidator,
  Marker,
  ModelValidator,
  PaletteItem,
} from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { IstarGlspContribution, effectivePaletteFor } from './contribution';
import { liveTypeHints } from './diagram-configuration';
import type { IstarModelState } from './model-state';
import { GLSP_ARGS, modelIdOf } from './translate';
import { gmodelTypes } from './types';

/**
 * The tool palette from the contribution's `PaletteDescription`: `contextActionsFor`'s entries,
 * in its order, under one group per palette `section` ("Actors", "Elements"; entries without a
 * section go under "Nodes" or "Edges", as GLSP's default palette groups them). Each entry
 * triggers its GModel type, with the entry's presets as GLSP's flat args (`GLSP_ARGS`).
 *
 * Built from the session's loaded model's metamodel, not the contribution's own: a file's own
 * `"metamodel"` block (#97) adds kinds the contribution's `PaletteDescription` never declared,
 * which `effectivePaletteFor` falls back to deriving from the metamodel itself.
 */
@injectable()
export class IstarToolPaletteItemProvider extends ToolPaletteItemProvider {
  protected readonly contribution: IstarGlspContribution;
  protected readonly state: IstarModelState;

  constructor(
    @inject(IstarGlspContribution) contribution: IstarGlspContribution,
    @inject(ModelState) state: IstarModelState,
  ) {
    super();
    this.contribution = contribution;
    this.state = state;
  }

  getItems(_args?: Args): PaletteItem[] {
    const metamodel = metamodelOf(this.state.model) as unknown as AnyMetamodel;
    const types = gmodelTypes(metamodel, this.contribution.types);
    const { actions } = contextActionsFor(
      effectivePaletteFor(this.contribution, metamodel),
      metamodel,
    );
    const groups = new Map<string, PaletteItem[]>();
    actions.forEach((entry, i) => {
      const [trigger] = entry.actions;
      let action: PaletteItem.TriggerElementCreationAction;
      if (trigger?.kind === 'triggerNodeCreation') {
        const args: Record<string, string> = {};
        for (const [key, value] of Object.entries(trigger.args?.customProperties ?? {})) {
          args[GLSP_ARGS.propertyPrefix + key] = value;
        }
        action = TriggerNodeCreationAction.create(
          types.of(trigger.elementTypeId)!,
          Object.keys(args).length > 0 ? { args } : {},
        );
      } else if (trigger?.kind === 'triggerEdgeCreation') {
        const args: Record<string, string> = {
          ...(trigger.args?.value === undefined ? {} : { [GLSP_ARGS.value]: trigger.args.value }),
          ...(trigger.args?.dependum === undefined
            ? {}
            : { [GLSP_ARGS.dependumKind]: trigger.args.dependum.kind }),
        };
        action = TriggerEdgeCreationAction.create(
          types.of(trigger.elementTypeId)!,
          Object.keys(args).length > 0 ? { args } : {},
        );
      } else return;
      const section =
        entry.section ?? (action.kind === TriggerNodeCreationAction.KIND ? 'nodes' : 'edges');
      const items = groups.get(section) ?? [];
      items.push({
        id: entry.id ?? `${action.elementTypeId}#${i}`,
        label: entry.label,
        sortString: String(i).padStart(4, '0'),
        actions: [action],
      });
      groups.set(section, items);
    });
    return [...groups].map(([section, children], i) => ({
      id: `istar-palette-${section}`,
      label: section.charAt(0).toUpperCase() + section.slice(1),
      sortString: String(i).padStart(4, '0'),
      actions: [],
      children,
    }));
  }
}

/** Kind → GModel type, and back, of the session's model (the contribution's, plus the file's). */
function typesOf(state: IstarModelState) {
  return gmodelTypes(metamodelOf(state.model) as unknown as AnyMetamodel, state.contribution.types);
}

/**
 * `requestTypeHints` answered from the session's loaded model's metamodel, not the contribution's
 * fixed one: replaces GLSP's own handler (`RequestTypeHintsActionHandler`), which reads
 * `DiagramConfiguration`'s hints — computed once, before any file is loaded, and so blind to a
 * file's own `"metamodel"` block (#97). `IstarStoreChangedHandler` resends the same hints
 * (`setTypeHints`) when another client's load changes the metamodel mid-session.
 */
@injectable()
export class IstarRequestTypeHintsActionHandler implements ActionHandler {
  readonly actionKinds: string[] = [RequestTypeHintsAction.KIND];
  protected readonly state: IstarModelState;

  constructor(@inject(ModelState) state: IstarModelState) {
    this.state = state;
  }

  execute(_action: Action): Action[] {
    const { shapeTypeHints, edgeTypeHints } = liveTypeHints(
      this.state.contribution,
      this.state.model,
    );
    return [SetTypeHintsAction.create({ shapeHints: shapeTypeHints, edgeHints: edgeTypeHints })];
  }
}

/**
 * `requestCheckEdge` answered by the dispatcher (`canLink`, retrying reversed where piStar does),
 * as the React canvas checks a connection. Replaces GLSP's handler, whose `EdgeCreationChecker`
 * can only say yes or no: a refusal here carries `canLink`'s `reason` and `code` (iStar extras on
 * `checkEdgeTargetResult`, as in `@istar-ts/actions`).
 */
@injectable()
export class IstarRequestCheckEdgeActionHandler implements ActionHandler {
  readonly actionKinds: string[] = [RequestCheckEdgeAction.KIND];
  protected readonly state: IstarModelState;

  constructor(@inject(ModelState) state: IstarModelState) {
    this.state = state;
  }

  async execute(action: Action): Promise<Action[]> {
    if (!RequestCheckEdgeAction.is(action)) return [];
    const { edgeType, sourceElementId, targetElementId } = action;
    const model = this.state.model;
    const kind = typesOf(this.state).kindOf(edgeType) ?? edgeType;
    const source = modelIdOf(model, sourceElementId) ?? sourceElementId;
    const target =
      targetElementId === undefined
        ? undefined
        : (modelIdOf(model, targetElementId) ?? targetElementId);
    const result = await this.state.dispatcher.dispatch({
      kind: 'requestCheckEdge',
      requestId: '',
      edgeType: kind,
      sourceElementId: source,
      ...(target === undefined ? {} : { targetElementId: target }),
    });
    const answer = result.ok ? (result.response as IstarCheckEdgeResult | undefined) : undefined;
    const isValid = answer?.isValid ?? false;
    return [
      {
        ...CheckEdgeResultAction.create({ edgeType, isValid, sourceElementId, targetElementId }),
        ...(answer?.reason === undefined ? {} : { reason: answer.reason }),
        ...(answer?.code === undefined ? {} : { code: answer.code }),
      },
    ];
  }
}

/**
 * Markers from the dispatcher's `requestMarkers`: the model's link constraint violations and,
 * with the contribution's `schemas`, its property issues. GLSP runs it after every update (live)
 * and on `requestMarkers`. Asked about the root, it reports the whole model; about other
 * elements, those and their children.
 */
@injectable()
export class IstarModelValidator implements ModelValidator {
  protected readonly state: IstarModelState;

  constructor(@inject(ModelState) state: IstarModelState) {
    this.state = state;
  }

  async validate(elements: GModelElement[], reason?: string): Promise<Marker[]> {
    const model = this.state.model;
    const ids = new Set<string>();
    let whole = false;
    const walk = (element: GModelElement): void => {
      if (element instanceof GModelRoot) whole = true;
      const id = modelIdOf(model, element.id);
      if (id !== undefined) ids.add(id);
      for (const child of element.children) walk(child);
    };
    for (const element of elements) walk(element);
    const result = await this.state.dispatcher.dispatch({
      kind: 'requestMarkers',
      requestId: '',
      elementsIDs: whole ? [] : [...ids],
      ...(reason === undefined ? {} : { reason }),
    });
    const markers = result.ok ? (result.response?.markers ?? []) : [];
    return markers.map(({ label, description, elementId, kind }) => ({
      label,
      description,
      elementId,
      kind: kind === 'hint' ? 'info' : kind,
    }));
  }
}

/**
 * Checks a label edit before the client applies it: a link's value label (`<id>_value`) takes
 * only the values of its kind (`possibleLabels`), as `istar.setLinkValue` would reject others.
 * Names take any text.
 */
@injectable()
export class IstarLabelEditValidator implements LabelEditValidator {
  protected readonly state: IstarModelState;

  constructor(@inject(ModelState) state: IstarModelState) {
    this.state = state;
  }

  validate(label: string, element: GModelElement): ValidationStatus {
    const id = element.id.endsWith('_value') ? element.id.slice(0, -'_value'.length) : undefined;
    const link = id === undefined ? undefined : this.state.model.links.get(id);
    if (!link || label === '') return ValidationStatus.NONE;
    const metamodel = metamodelOf(this.state.model) as unknown as AnyMetamodel;
    const definition = metamodel.links.get(link.kind);
    const values = definition?.info.possibleLabels;
    if (!values || values.includes(label)) return ValidationStatus.NONE;
    return {
      severity: ValidationStatus.Severity.ERROR,
      message: `"${label}" is not a value of a ${definition.label} link (${values.join(', ')})`,
    };
  }
}
