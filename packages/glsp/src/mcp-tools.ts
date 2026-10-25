/**
 * The three istar-specific MCP diagram tools server-mcp has no equivalent for (#126 §4's gap
 * row): `set-properties`, `set-link-value` and `check-edge`. Type imports only, like `mcp.ts` —
 * the launchers load the optional `@eclipse-glsp/server-mcp` (and its `zod` dependency)
 * themselves and hand both namespaces in, so a host that never asks for MCP never needs either
 * installed.
 */
import type { GoalDiagnostic } from '@istar-ts/core';
import { ActionDispatcher, GNode, ModelState, RequestCheckEdgeAction } from '@eclipse-glsp/server';
import type {
  BindingTarget,
  CheckEdgeResultAction,
  InstanceMultiBinding,
} from '@eclipse-glsp/server';
import type {
  AbstractMcpDiagramModule,
  AbstractMcpDiagramToolHandler,
  ElementIdentitySchema,
  MarkdownMcpModelSerializer,
  McpDiagramScopedInputSchema,
  McpDiagramToolHandlerConstructor,
  McpModelSerializer,
  McpToolResult,
  ModifyNodesInput,
  ModifyNodesMcpToolHandler,
  OperationMcpDiagramToolHandler,
  elementId,
  requestActionOrFail,
} from '@eclipse-glsp/server-mcp/browser.js';
import type * as ZodV4 from 'zod/v4';
import { decorate, inject, injectable } from 'inversify';
import type { interfaces } from 'inversify';
import type { IstarModelState } from './model-state';
import { modelIdOf } from './translate';
import { rejectedToolResult } from './mcp';

/** `ModelState` is `IstarModelState` in every session the diagram module's classes run in. */
function istarStateOf(state: ModelState): IstarModelState {
  return state as unknown as IstarModelState;
}

function propertyCount(properties: Readonly<Record<string, unknown>>): string {
  return Object.keys(properties).length === 1 ? 'y' : 'ies';
}

/** The `@eclipse-glsp/server-mcp` and `zod` pieces these tools build on, held loosely like `mcp.ts`'s. */
export interface IstarMcpToolsBase {
  readonly AbstractMcpDiagramModule: typeof AbstractMcpDiagramModule;
  readonly AbstractMcpDiagramToolHandler: typeof AbstractMcpDiagramToolHandler;
  readonly OperationMcpDiagramToolHandler: typeof OperationMcpDiagramToolHandler;
  readonly McpDiagramScopedInputSchema: typeof McpDiagramScopedInputSchema;
  readonly ElementIdentitySchema: typeof ElementIdentitySchema;
  readonly elementId: typeof elementId;
  readonly McpElementsNotFoundError: new (missingIds: readonly string[]) => Error;
  readonly requestActionOrFail: typeof requestActionOrFail;
  readonly MarkdownMcpModelSerializer: typeof MarkdownMcpModelSerializer;
  readonly ModifyNodesMcpToolHandler: typeof ModifyNodesMcpToolHandler;
}

/**
 * `istarMcpDiagramModule(mcp, z)`'s diagram module class, with `set-properties`, `set-link-value`
 * and `check-edge` added to server-mcp's default tool set — the same `configureToolHandlers`
 * extension point `docs/glsp/framework-notes.md` §5 describes for every adopter tool.
 */
export function istarMcpDiagramModule(
  mcp: IstarMcpToolsBase,
  z: typeof ZodV4,
): interfaces.Newable<AbstractMcpDiagramModule> {
  const SetPropertiesInputSchema = mcp.McpDiagramScopedInputSchema.extend({
    elementId: mcp.elementId.describe('Id of the element or link to set properties on.'),
    properties: z
      .record(z.string(), z.string().nullable())
      .describe(
        'Custom property values to set, keyed by property name. A value of `null` removes ' +
          'that property; properties not named here are left as they are. Values are strings, ' +
          'as piStar stores them.',
      ),
  });
  type SetPropertiesInput = ZodV4.infer<typeof SetPropertiesInputSchema>;
  const SetPropertiesOutputSchema = z.object({
    element: mcp.ElementIdentitySchema.optional(),
    properties: z
      .record(z.string(), z.string())
      .describe("The element's or link's custom properties after the update."),
  });
  type SetPropertiesOutput = ZodV4.infer<typeof SetPropertiesOutputSchema>;

  class SetPropertiesMcpToolHandler extends mcp.OperationMcpDiagramToolHandler<
    SetPropertiesInput,
    SetPropertiesOutput
  > {
    static readonly NAME = 'set-properties';
    readonly name = SetPropertiesMcpToolHandler.NAME;
    override readonly title = 'Set Element Properties';
    readonly description =
      'Set one or more custom property values on an element or link. Values are strings; ' +
      'pass `null` for a property to remove it. Use `element-types` or `diagram-model` first ' +
      "to discover an element's id and which custom properties its kind defines. This " +
      'operation modifies the diagram state and requires user approval.';
    readonly inputSchema = SetPropertiesInputSchema;
    override readonly outputSchema = SetPropertiesOutputSchema;

    protected async createResult({
      elementId,
      properties,
    }: SetPropertiesInput): Promise<McpToolResult> {
      const state = istarStateOf(this.modelState);
      const realId = this.aliasService.lookup(elementId);
      const modelId = modelIdOf(state.model, realId);
      if (modelId === undefined) throw new mcp.McpElementsNotFoundError([elementId]);
      const result = await state.dispatcher.dispatch({
        kind: 'istar.updateProperties',
        elementId: modelId,
        properties,
      });
      if (!result.ok) return rejectedToolResult(result.diagnostics as readonly GoalDiagnostic[]);
      const owner = state.model.elements.get(modelId) ?? state.model.links.get(modelId);
      const element = this.describeElement(elementId);
      return this.success(`Set propert${propertyCount(properties)} on '${elementId}'.`, {
        ...(element ? { element } : {}),
        properties: { ...owner?.customProperties },
      });
    }
  }
  decorate(injectable(), SetPropertiesMcpToolHandler);

  const SetLinkValueInputSchema = mcp.McpDiagramScopedInputSchema.extend({
    linkId: mcp.elementId.describe('Id of the link to set the value of.'),
    value: z
      .string()
      .nullable()
      .describe(
        "The link's new value — one of its kind's declared value set (e.g. a Contribution " +
          "link's make/help/hurt/break). `null` clears it. Rejected when the link's kind " +
          'declares no values, or `value` is not one of them.',
      ),
  });
  type SetLinkValueInput = ZodV4.infer<typeof SetLinkValueInputSchema>;
  const SetLinkValueOutputSchema = z.object({
    link: mcp.ElementIdentitySchema.optional(),
    value: z.string().nullable(),
  });
  type SetLinkValueOutput = ZodV4.infer<typeof SetLinkValueOutputSchema>;

  class SetLinkValueMcpToolHandler extends mcp.OperationMcpDiagramToolHandler<
    SetLinkValueInput,
    SetLinkValueOutput
  > {
    static readonly NAME = 'set-link-value';
    readonly name = SetLinkValueMcpToolHandler.NAME;
    override readonly title = 'Set Link Value';
    readonly description =
      "Set an existing link's declared value (a Contribution link's make/help/hurt/break, or " +
      "another link kind's value set), or clear it with `value: null`. Use `diagram-model` or " +
      "`query-elements` first to find the link's id and current value. This operation modifies " +
      'the diagram state and requires user approval.';
    readonly inputSchema = SetLinkValueInputSchema;
    override readonly outputSchema = SetLinkValueOutputSchema;

    protected async createResult({ linkId, value }: SetLinkValueInput): Promise<McpToolResult> {
      const state = istarStateOf(this.modelState);
      const realId = this.aliasService.lookup(linkId);
      const modelId = modelIdOf(state.model, realId);
      if (modelId === undefined) throw new mcp.McpElementsNotFoundError([linkId]);
      const result = await state.dispatcher.dispatch({
        kind: 'istar.setLinkValue',
        linkId: modelId,
        value,
      });
      if (!result.ok) return rejectedToolResult(result.diagnostics as readonly GoalDiagnostic[]);
      const link = this.describeElement(linkId);
      return this.success(
        `Set '${linkId}'’s value to ${value === null ? '(cleared)' : `'${value}'`}.`,
        { ...(link ? { link } : {}), value },
      );
    }
  }
  decorate(injectable(), SetLinkValueMcpToolHandler);

  const CheckEdgeInputSchema = mcp.McpDiagramScopedInputSchema.extend({
    edgeType: z
      .string()
      .describe(
        'Edge type id to check (e.g. `edge:dependency`). Use `element-types` to discover valid ids.',
      ),
    sourceElementId: mcp.elementId.describe('Id of the candidate edge source element.'),
    targetElementId: mcp.elementId
      .optional()
      .describe(
        'Id of the candidate edge target element. Omit to check only whether the source may ' +
          'start this edge type at all.',
      ),
  });
  type CheckEdgeInput = ZodV4.infer<typeof CheckEdgeInputSchema>;
  const CheckEdgeOutputSchema = z.object({
    isValid: z.boolean().describe('Whether the dispatcher would accept this edge.'),
    reason: z
      .string()
      .optional()
      .describe('Why the edge would be refused. Present when `isValid` is `false`.'),
  });
  type CheckEdgeOutput = ZodV4.infer<typeof CheckEdgeOutputSchema>;

  class CheckEdgeMcpToolHandler extends mcp.AbstractMcpDiagramToolHandler<
    CheckEdgeInput,
    CheckEdgeOutput
  > {
    static readonly NAME = 'check-edge';
    readonly name = CheckEdgeMcpToolHandler.NAME;
    override readonly title = 'Check Edge Validity';
    readonly description =
      'Ask whether a candidate edge (type, source, and optionally target) would be accepted, ' +
      'without creating anything — cheaper than a refused `create-edges` call, and the only ' +
      'way to explore what a source allows before a target is chosen. Use `element-types` or ' +
      '`diagram-model` first to discover ids and edge type ids.';
    readonly inputSchema = CheckEdgeInputSchema;
    override readonly outputSchema = CheckEdgeOutputSchema;

    @inject(ActionDispatcher) protected actionDispatcher!: ActionDispatcher;
    protected readonly timeoutMs: number = 5000;

    protected async createResult({
      edgeType,
      sourceElementId,
      targetElementId,
    }: CheckEdgeInput): Promise<McpToolResult> {
      const sourceElement = this.aliasService.lookup(sourceElementId);
      const targetElement =
        targetElementId === undefined ? undefined : this.aliasService.lookup(targetElementId);
      const response = await mcp.requestActionOrFail(
        this.actionDispatcher,
        RequestCheckEdgeAction.create({
          edgeType,
          sourceElement,
          ...(targetElement === undefined ? {} : { targetElement }),
        }),
        this.timeoutMs,
        this.name,
      );
      const { isValid, reason } = response as CheckEdgeResultAction & { reason?: string };
      const target = targetElementId === undefined ? '' : ` to '${targetElementId}'`;
      return this.success(
        isValid
          ? `Valid: '${edgeType}' from '${sourceElementId}'${target} would be accepted.`
          : `Invalid: ${reason ?? 'rejected'}`,
        { isValid, ...(reason === undefined ? {} : { reason }) },
      );
    }
  }
  decorate(injectable(), CheckEdgeMcpToolHandler);

  /**
   * Every agent-facing coordinate is absolute model coordinates (#158): `create-nodes`' own
   * `position` already is, but the default `MarkdownMcpModelSerializer` reports a `GNode`'s
   * `position` straight from the GModel tree — which `gmodel.ts` builds relative to an actor's
   * boundary for its children, for rendering. An element's model `x`/`y` (what `createNode`
   * actually writes) is absolute regardless of nesting, so reading it back here, instead of the
   * GModel position, is both simpler and exact. Ids not in the model (a label's `_label`/
   * `_value` suffix, a link's `_anchor`) are left as the base class reports them: a label's
   * position is relative to its owning node by design, not a diagram coordinate.
   */
  class IstarMcpModelSerializer extends mcp.MarkdownMcpModelSerializer {
    @inject(ModelState) protected istarModelState!: ModelState;

    protected override combinePositionAndSize(element: Record<string, unknown>): void {
      const id = typeof element.id === 'string' ? element.id : undefined;
      const modelElement =
        id === undefined ? undefined : istarStateOf(this.istarModelState).model.elements.get(id);
      if (modelElement) element.position = { x: modelElement.x, y: modelElement.y };
      super.combinePositionAndSize(element);
    }
  }
  decorate(injectable(), IstarMcpModelSerializer);

  /**
   * `modify-nodes` documents `position` as parent-relative (matching `query-elements`' own
   * convention and plain `ChangeBoundsOperation`), but #158 makes every agent-facing coordinate
   * absolute instead — so a position is converted to parent-relative here, before building the
   * operation `translateOperation`'s `changeBounds` still expects relative-to-parent (the stock
   * client's drag-move genuinely sends that). An actor is always a direct child of the root, so
   * its own GModel position is already absolute; that's the only origin a node's position is
   * ever relative to.
   */
  class IstarModifyNodesMcpToolHandler extends mcp.ModifyNodesMcpToolHandler {
    protected override createResult(input: ModifyNodesInput): Promise<McpToolResult> {
      const nodes = input.nodes.map((node) => {
        if (!node.position) return node;
        const realId = this.aliasService.lookup(node.elementId);
        const element = this.modelState.index.find(realId);
        const origin = element?.parent instanceof GNode ? element.parent.position : { x: 0, y: 0 };
        return {
          ...node,
          position: { x: node.position.x - origin.x, y: node.position.y - origin.y },
        };
      });
      return super.createResult({ ...input, nodes });
    }
  }
  decorate(injectable(), IstarModifyNodesMcpToolHandler);

  class IstarMcpDiagramModule extends mcp.AbstractMcpDiagramModule {
    protected override bindModelSerializer(): BindingTarget<McpModelSerializer> {
      return IstarMcpModelSerializer;
    }

    protected override configureToolHandlers(
      binding: InstanceMultiBinding<McpDiagramToolHandlerConstructor>,
    ): void {
      super.configureToolHandlers(binding);
      binding.add(SetPropertiesMcpToolHandler);
      binding.add(SetLinkValueMcpToolHandler);
      binding.add(CheckEdgeMcpToolHandler);
      binding.rebind(mcp.ModifyNodesMcpToolHandler, IstarModifyNodesMcpToolHandler);
    }
  }
  return IstarMcpDiagramModule;
}
