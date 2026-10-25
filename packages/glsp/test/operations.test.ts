/**
 * The write side in a real GLSP server (in process): GLSP operations go through the istar-ts
 * dispatcher, with one undo stack, an `updateModel` after every accepted change (whoever made
 * it), rejections as messages and markers, and the dirty state of the dispatcher.
 */
import { describe, expect, test } from 'vitest';
import type { Action, ActionMessage, GModelRootSchema } from '@eclipse-glsp/server';
import {
  ApplyLabelEditOperation,
  ChangeBoundsOperation,
  ChangeContainerOperation,
  ChangeRoutingPointsOperation,
  CommandStack,
  CompoundOperation,
  CreateEdgeOperation,
  CreateNodeOperation,
  DeleteElementOperation,
  ReconnectEdgeOperation,
  RedoAction,
  RequestCheckEdgeAction,
  RequestContextActions,
  RequestEditValidationAction,
  RequestMarkersAction,
  RequestPopupModelAction,
  SaveModelAction,
  SetEditModeAction,
  UndoAction,
} from '@eclipse-glsp/server';
import type { AnyIstarModel, IstarElement } from '@istar-ts/core';
import { toPistar } from '@istar-ts/core';
import { GLSP_ARGS, GRAPH_ID, ISTAR_GLSP, gmodelBounds, translateOperation } from '../src';
import { KAOS_GLSP } from '../src/kaos';
import type { Session } from './server';
import { open, testFiles } from './server';

// welcome.txt: the agent "piStar tool v2.1.0" and the role "Business Analyst", with their goals,
// tasks and qualities, and top-level dependums.
const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
const ANALYST = 'bda083fe-1fb4-41cf-aea9-449c0d4044b5';
const ANALYST_GOAL = '71c7aeb6-fb99-40a1-bcd1-5a29e5b45252';
const ANALYST_TASK = '8d716a61-1ca4-44f4-934c-26166ea44d11';
const AGENT_TASK = '9250b018-fb16-4b82-b7bf-5f5589b6b259';
const AGENT_QUALITY = '339417b8-0430-4ceb-be12-d6cf7b440a35';
const GOOD_QUALITY = 'e159ce92-b29d-4fdc-a533-ee1e904f9f57';
const MODIFY_TASK = 'ab3313df-175f-4b2b-9486-c0915a3d1cd4';
/** Contribution (help) Use the piStar Tool → Good visual quality. */
const HELP_LINK = '5c3a554c-5988-48ec-b2c7-293b8e1db746';

function rootOf(message: ActionMessage): GModelRootSchema {
  return (message.action as unknown as { newRoot: GModelRootSchema }).newRoot;
}

function added<T extends { id: string }>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
): T[] {
  return [...after.values()].filter((v) => !before.has(v.id));
}

/** Sends a GLSP operation; returns what the model gained and the messages it caused. */
async function edit(s: Session, operation: Action) {
  const before = s.state.model;
  const from = s.sent.length;
  await s.send(operation);
  const after = s.state.model;
  return {
    before,
    after,
    elements: added(before.elements, after.elements),
    links: added(before.links, after.links),
    kinds: s.kinds(from),
    messages: s.sent.slice(from),
  };
}

function element(model: AnyIstarModel, id: string): IstarElement<string> {
  return model.elements.get(id)!;
}

describe('GLSP operations through the dispatcher', () => {
  test('create, connect, move, nest, reconnect, rename and delete, then undo it all', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const start = toPistar(s.state.model);

    // Create a goal inside the agent: absolute location, the actor as container.
    const goal = await edit(
      s,
      CreateNodeOperation.create('node:istar.Goal', {
        containerId: AGENT,
        location: { x: 640.4, y: 160 },
      }),
    );
    expect(goal.elements).toHaveLength(1);
    const goalElement = goal.elements[0]!;
    expect(goalElement).toMatchObject({ kind: 'istar.Goal', parent: AGENT, x: 640, y: 160 });
    expect(goal.kinds.filter((k) => k === 'updateModel')).toHaveLength(1);
    expect(
      JSON.stringify(rootOf(goal.messages.find((m) => m.action.kind === 'updateModel')!)),
    ).toContain(goalElement.id);

    // A resource in the analyst, named by the client.
    const resource = await edit(
      s,
      CreateNodeOperation.create('node:istar.Resource', {
        containerId: ANALYST,
        location: { x: 150, y: 400 },
        args: { [GLSP_ARGS.name]: 'Paper' },
      }),
    );
    expect(resource.elements[0]).toMatchObject({
      kind: 'istar.Resource',
      name: 'Paper',
      parent: ANALYST,
      x: 150,
    });
    // iStar 2.0 elements live in actors: on the root, the dispatcher refuses one.
    const onPaper = await edit(
      s,
      CreateNodeOperation.create('node:istar.Goal', {
        containerId: GRAPH_ID,
        location: { x: 0, y: 0 },
      }),
    );
    expect(onPaper.after).toBe(onPaper.before);
    expect(onPaper.kinds).toContain('message');

    // A plain link with the palette's value.
    const help = await edit(
      s,
      CreateEdgeOperation.create({
        elementTypeId: 'edge:istar.ContributionLink',
        sourceElementId: AGENT_TASK,
        targetElementId: AGENT_QUALITY,
        args: { [GLSP_ARGS.value]: 'hurt' },
      }),
    );
    expect(help.links).toMatchObject([
      { kind: 'istar.ContributionLink', source: AGENT_TASK, target: AGENT_QUALITY, label: 'hurt' },
    ]);

    // A dependency: its dependum (named after its kind, as the React canvas names it) and links.
    const dependency = await edit(
      s,
      CreateEdgeOperation.create({
        elementTypeId: 'edge:istar.DependencyLink',
        sourceElementId: ANALYST_GOAL,
        targetElementId: AGENT_TASK,
        args: { [GLSP_ARGS.dependumKind]: 'istar.Resource' },
      }),
    );
    expect(dependency.elements).toMatchObject([
      { kind: 'istar.Resource', name: 'Resource', isDependum: true },
    ]);
    expect(dependency.links).toHaveLength(2);

    // Move an inner element: GLSP sends its position relative to the actor's boundary, and its
    // unchanged size, which is not written to `display`.
    const bounds = gmodelBounds(s.state.model, ISTAR_GLSP);
    const analyst = bounds.get(ANALYST)!;
    const task = element(s.state.model, ANALYST_TASK);
    const taskBox = bounds.get(ANALYST_TASK)!;
    await edit(
      s,
      ChangeBoundsOperation.create([
        {
          elementId: ANALYST_TASK,
          newPosition: { x: task.x - analyst.x + 15, y: task.y - analyst.y },
          newSize: { width: taskBox.width, height: taskBox.height },
        },
      ]),
    );
    expect(element(s.state.model, ANALYST_TASK)).toMatchObject({ x: task.x + 15, y: task.y });
    expect(element(s.state.model, ANALYST_TASK).display).toBeUndefined();

    // Move an actor by its boundary's corner, as a compound (the move tool's shape): its
    // elements move with it, in one undo step.
    const boundsNow = gmodelBounds(s.state.model, ISTAR_GLSP);
    const agentBox = boundsNow.get(AGENT)!;
    const agent = element(s.state.model, AGENT);
    const agentTask = element(s.state.model, AGENT_TASK);
    const beforeMove = s.state.model;
    await edit(
      s,
      CompoundOperation.create([
        ChangeBoundsOperation.create([
          {
            elementId: AGENT,
            newPosition: { x: agentBox.x + 20, y: agentBox.y },
            newSize: { width: agentBox.width, height: agentBox.height },
          },
        ]),
        ChangeRoutingPointsOperation.create([]),
      ]),
    );
    expect(element(s.state.model, AGENT)).toMatchObject({ x: agent.x + 20, y: agent.y });
    expect(element(s.state.model, AGENT_TASK)).toMatchObject({ x: agentTask.x + 20 });
    s.state.store.undo();
    expect(s.state.model).toBe(beforeMove);
    s.state.store.redo();

    // Nest the new resource in the agent, at a position in the agent's boundary.
    const resourceId = resource.elements[0]!.id;
    const agentNow = gmodelBounds(s.state.model, ISTAR_GLSP).get(AGENT)!;
    await edit(
      s,
      ChangeContainerOperation.create({
        elementId: resourceId,
        targetContainerId: AGENT,
        location: { x: 30, y: 40 },
      }),
    );
    expect(element(s.state.model, resourceId)).toMatchObject({
      parent: AGENT,
      x: agentNow.x + 30,
      y: agentNow.y + 40,
    });

    // Reconnect the help link to another task.
    await edit(
      s,
      ReconnectEdgeOperation.create({
        edgeElementId: HELP_LINK,
        sourceElementId: MODIFY_TASK,
        targetElementId: GOOD_QUALITY,
      }),
    );
    expect(s.state.model.links.get(HELP_LINK)).toMatchObject({
      source: MODIFY_TASK,
      target: GOOD_QUALITY,
    });

    // Set a link's bend points through changeRoutingPoints, then clear them.
    await edit(
      s,
      ChangeRoutingPointsOperation.create([
        { elementId: HELP_LINK, newRoutingPoints: [{ x: 100, y: 200 }] },
      ]),
    );
    expect(s.state.model.links.get(HELP_LINK)!.display).toEqual({
      vertices: [{ x: 100, y: 200 }],
    });
    await edit(
      s,
      ChangeRoutingPointsOperation.create([{ elementId: HELP_LINK, newRoutingPoints: [] }]),
    );
    expect(s.state.model.links.get(HELP_LINK)!.display).toBeUndefined();

    // Rename an element, and change a link's value through its value label.
    await edit(
      s,
      ApplyLabelEditOperation.create({ labelId: `${ANALYST_GOAL}_label`, text: 'Renamed' }),
    );
    expect(element(s.state.model, ANALYST_GOAL).name).toBe('Renamed');
    await edit(s, ApplyLabelEditOperation.create({ labelId: `${HELP_LINK}_value`, text: 'make' }));
    expect(s.state.model.links.get(HELP_LINK)!.label).toBe('make');

    // Delete the new goal, with its label selected too.
    await edit(s, DeleteElementOperation.create([goalElement.id, `${goalElement.id}_label`]));
    expect(s.state.model.elements.has(goalElement.id)).toBe(false);

    // Undo everything through GLSP: the file is byte-identical to the one opened.
    const commandStack = s.session.container.get<CommandStack>(CommandStack);
    let undos = 0;
    while (commandStack.canUndo()) {
      const from = s.sent.length;
      await s.send(UndoAction.create());
      expect(s.kinds(from)).toContain('updateModel');
      undos++;
    }
    expect(undos).toBe(13);
    expect(toPistar(s.state.model)).toBe(start);
    expect(commandStack.isDirty).toBe(false);

    // And redo is the store's too.
    await s.send(RedoAction.create());
    expect(s.state.model.elements.size).toBe(s.state.store.getModel().elements.size);
    expect(commandStack.canUndo()).toBe(true);
  });

  test('an n-ary link adds a hub, then a leg to it', async () => {
    const s = await open(KAOS_GLSP, 'kaos.txt');
    const goals = [...s.state.model.elements.values()].filter(
      (e) => e.kind === 'kaos.BehavioralGoal',
    );
    const [a, b, c] = goals;
    const first = await edit(
      s,
      CreateEdgeOperation.create({
        elementTypeId: 'edge:kaos.RefinementLink',
        sourceElementId: a!.id,
        targetElementId: b!.id,
      }),
    );
    const hub = first.elements.find((e) => e.kind === 'kaos.RefinementLinkHub');
    expect(hub).toBeDefined();
    expect(first.links.map((l) => l.kind).toSorted()).toEqual([
      'kaos.RefinementLinkEnd',
      'kaos.RefinementLinkStart',
    ]);
    const leg = await edit(
      s,
      CreateEdgeOperation.create({
        elementTypeId: 'edge:kaos.RefinementLink',
        sourceElementId: c!.id,
        targetElementId: hub!.id,
      }),
    );
    expect(leg.elements).toHaveLength(0);
    expect(leg.links).toMatchObject([
      { kind: 'kaos.RefinementLinkStart', source: c!.id, target: hub!.id },
    ]);
  });

  test('a rejected operation leaves the model, with a message and a marker', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    // A refinement from a goal to an actor: canLink refuses it.
    const result = await edit(
      s,
      CreateEdgeOperation.create({
        elementTypeId: 'edge:istar.AndRefinementLink',
        sourceElementId: ANALYST_GOAL,
        targetElementId: AGENT,
      }),
    );
    expect(result.after).toBe(result.before);
    const message = result.messages.find((m) => m.action.kind === 'message')!.action as unknown as {
      severity: string;
      message: string;
    };
    expect(message.severity).toBe('ERROR');
    expect(message.message).toMatch(/^Rejected: /);
    // The unchanged model again, so the client drops its feedback; then the message.
    expect(result.kinds.indexOf('updateModel')).toBeLessThan(result.kinds.indexOf('message'));
    expect(s.state.store.canUndo()).toBe(false);

    // A type no create handler is registered for: GLSP finds no handler and does nothing.
    const unknown = await edit(s, CreateNodeOperation.create('node:istar.Nothing'));
    expect(unknown.after).toBe(unknown.before);
    expect(unknown.kinds).toEqual([]);

    // A rejection that names an element marks it; the next accepted edit clears the marks.
    const marked = await edit(
      s,
      ApplyLabelEditOperation.create({ labelId: `${HELP_LINK}_value`, text: 'awful' }),
    );
    const markers = marked.messages.find((m) => m.action.kind === 'setMarkers')!
      .action as unknown as {
      markers: { elementId: string; kind: string }[];
      reason: string;
    };
    expect(markers.reason).toBe('istar.rejection');
    expect(markers.markers).toMatchObject([{ elementId: HELP_LINK, kind: 'error' }]);
    const cleared = await edit(
      s,
      ApplyLabelEditOperation.create({ labelId: `${HELP_LINK}_value`, text: 'hurt' }),
    );
    const clear = cleared.messages.find(
      (m) =>
        m.action.kind === 'setMarkers' &&
        (m.action as { reason?: string }).reason === 'istar.rejection',
    )!.action as unknown as { markers: unknown[] };
    expect(clear.markers).toEqual([]);
  });

  test('a change made directly on the store is pushed as updateModel', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const from = s.sent.length;
    const { id } = s.state.store.addElement({
      kind: 'istar.Goal',
      parent: AGENT,
      x: 900,
      y: 900,
      name: 'Elsewhere',
    });
    s.state.store.updateElement(id, { name: 'Elsewhere, renamed' });
    const update = await (async () => {
      for (let i = 0; i < 100; i++) {
        const found = s.sent.slice(from).find((m) => m.action.kind === 'updateModel');
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('no updateModel');
    })();
    expect(JSON.stringify(rootOf(update))).toContain('Elsewhere, renamed');
    // Two store changes before the session got to them: one update.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.kinds(from).filter((k) => k === 'updateModel')).toHaveLength(1);
    const dirty = s.sent.slice(from).find((m) => m.action.kind === 'setDirtyState')!.action as {
      isDirty?: boolean;
    };
    expect(dirty.isDirty).toBe(true);
  });

  test('one undo stack: a GLSP edit undone through the dispatcher is gone', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const created = await edit(
      s,
      CreateNodeOperation.create('node:istar.Task', {
        containerId: AGENT,
        location: { x: 600, y: 450 },
      }),
    );
    const id = created.elements[0]!.id;
    const from = s.sent.length;
    const result = await s.state.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(result.ok).toBe(true);
    expect(s.state.model.elements.has(id)).toBe(false);
    for (let i = 0; i < 50 && !s.kinds(from).includes('updateModel'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const update = s.sent.slice(from).find((m) => m.action.kind === 'updateModel')!;
    expect(JSON.stringify(rootOf(update))).not.toContain(id);
    // GLSP has nothing left to undo either.
    expect(s.session.container.get<CommandStack>(CommandStack).canUndo()).toBe(false);
  });

  test('dirty state is the dispatcher’s, whichever client saves', async () => {
    const fileMap = testFiles();
    const s = await open(ISTAR_GLSP, 'welcome.txt', { files: fileMap });
    const commandStack = s.session.container.get<CommandStack>(CommandStack);
    const edited = await edit(
      s,
      CreateNodeOperation.create('node:istar.Goal', {
        containerId: AGENT,
        location: { x: 600, y: 450 },
      }),
    );
    const dirty = edited.messages.find((m) => m.action.kind === 'setDirtyState')!
      .action as unknown as {
      isDirty: boolean;
    };
    expect(dirty.isDirty).toBe(true);
    expect(commandStack.isDirty).toBe(true);

    // Saved through GLSP: written by the dispatcher, clean for both.
    let from = s.sent.length;
    await s.send(SaveModelAction.create());
    expect(s.state.dispatcher.isDirty()).toBe(false);
    expect(commandStack.isDirty).toBe(false);
    expect(fileMap.get('welcome.txt')).toContain(edited.elements[0]!.id);
    expect(s.kinds(from).filter((k) => k === 'setDirtyState')).toHaveLength(1);

    // Edited and saved by another client of the dispatcher: the GLSP client hears it's clean.
    s.state.store.updateElement(ANALYST_GOAL, { name: 'Changed elsewhere' });
    from = s.sent.length;
    await s.state.dispatcher.dispatch({ kind: 'saveModel', fileUri: 'other.txt' });
    expect(fileMap.get('other.txt')).toContain('Changed elsewhere');
    for (let i = 0; i < 50 && !s.kinds(from).includes('setDirtyState'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const clean = s.sent
      .slice(from)
      .filter((m) => m.action.kind === 'setDirtyState')
      .at(-1)!.action as unknown as { isDirty: boolean };
    expect(clean.isDirty).toBe(false);
    expect(commandStack.isDirty).toBe(false);
  });
});

describe('the tool tier', () => {
  test('the palette is the contribution’s, in GModel types with flat args', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const from = s.sent.length;
    await s.send(
      RequestContextActions.create({
        contextId: 'tool-palette',
        editorContext: { selectedElementIds: [] },
      }),
    );
    const { actions } = s.sent.slice(from).find((m) => m.action.kind === 'setContextActions')!
      .action as unknown as {
      actions: { label: string; children: { label: string; actions: Action[] }[] }[];
    };
    expect(actions.map((a) => a.label)).toEqual(['Actors', 'Elements']);
    const entries = actions.flatMap((a) => a.children);
    expect(entries.find((e) => e.label === 'Goal')!.actions).toEqual([
      { kind: 'triggerNodeCreation', elementTypeId: 'node:istar.Goal' },
    ]);
    expect(entries.find((e) => e.label === 'Resource dependency')!.actions).toEqual([
      {
        kind: 'triggerEdgeCreation',
        elementTypeId: 'edge:istar.DependencyLink',
        args: { dependumKind: 'istar.Resource' },
      },
    ]);
    expect(entries.find((e) => e.label === 'Help (+)')!.actions[0]).toMatchObject({
      args: { value: 'help' },
    });
  });

  test('requestCheckEdge answers with canLink, and why not', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const check = async (target: string) => {
      const from = s.sent.length;
      await s.send(
        RequestCheckEdgeAction.create({
          edgeType: 'edge:istar.ContributionLink',
          sourceElement: MODIFY_TASK,
          targetElement: target,
        }),
      );
      return s.sent.slice(from).find((m) => m.action.kind === 'checkEdgeTargetResult')!
        .action as unknown as { isValid: boolean; reason?: string; code?: string };
    };
    const accepted = await check(GOOD_QUALITY);
    expect(accepted).toMatchObject({ isValid: true });
    const refused = await check(AGENT_QUALITY);
    expect(refused.isValid).toBe(false);
    expect(refused.reason).toBeTruthy();
    expect(refused.code).toBeTruthy();
  });

  test('requestMarkers reports the model’s link issues', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const from = s.sent.length;
    await s.send(RequestMarkersAction.create([GRAPH_ID]));
    expect(s.kinds(from)).toContain('setMarkers');
  });

  test('a value label only takes its kind’s values', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const validate = async (text: string) => {
      const from = s.sent.length;
      await s.send(
        RequestEditValidationAction.create({
          contextId: 'label-edit',
          modelElementId: `${HELP_LINK}_value`,
          text,
        }),
      );
      return s.sent.slice(from).find((m) => m.action.kind === 'setEditValidationResult')!
        .action as unknown as { status: { severity: number } };
    };
    expect((await validate('make')).status.severity).toBeGreaterThan(2);
    expect((await validate('awful')).status.severity).toBe(1);
  });

  test('client-only actions, and actions for a client that lists none, do not fail', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt', {
      clientActionKinds: ['setModel', 'updateModel'],
    });
    await s.send(
      RequestPopupModelAction.create({
        elementId: ANALYST_GOAL,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      }),
    );
    await s.send(SetEditModeAction.create('readonly'));
    await s.send(SetEditModeAction.create('editable'));
    // A rejection's message and markers, and the dirty state, go to a client that shows none.
    await s.send(CreateNodeOperation.create('node:istar.Goal', { location: { x: 5, y: 600 } }));
    await s.send(
      CreateNodeOperation.create('node:istar.Goal', {
        containerId: AGENT,
        location: { x: 600, y: 450 },
      }),
    );
    // Live validation's status and markers, 100ms later.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(s.kinds(0)).not.toContain('message');
    expect(s.kinds(0)).toContain('updateModel');
  });
});

describe('translateOperation', () => {
  test('a link’s anchor stands for the link; labels and anchors are not deleted', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const model = s.state.model;
    expect(
      translateOperation(
        DeleteElementOperation.create([`${HELP_LINK}_anchor`, `${HELP_LINK}_label`]),
        model,
        ISTAR_GLSP,
      ),
    ).toEqual({ ok: true });
    expect(
      translateOperation(
        CreateEdgeOperation.create({
          elementTypeId: 'edge:istar.ContributionLink',
          sourceElementId: MODIFY_TASK,
          targetElementId: `${HELP_LINK}_anchor`,
        }),
        model,
        ISTAR_GLSP,
      ),
    ).toMatchObject({ ok: true, operation: { targetElementId: HELP_LINK } });
    expect(
      translateOperation(
        ApplyLabelEditOperation.create({ labelId: 'nope', text: '' }),
        model,
        ISTAR_GLSP,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ elementId: 'nope', severity: 'error' }] });
  });

  test('changeRoutingPoints maps each element to istar.updateLinkDisplay, and rejects an unknown one', async () => {
    const s = await open(ISTAR_GLSP, 'welcome.txt');
    const model = s.state.model;
    expect(
      translateOperation(
        ChangeRoutingPointsOperation.create([
          { elementId: HELP_LINK, newRoutingPoints: [{ x: 1, y: 2 }] },
        ]),
        model,
        ISTAR_GLSP,
      ),
    ).toEqual({
      ok: true,
      operation: {
        kind: 'istar.updateLinkDisplay',
        linkId: HELP_LINK,
        patch: { vertices: [{ x: 1, y: 2 }] },
      },
    });
    expect(translateOperation(ChangeRoutingPointsOperation.create([]), model, ISTAR_GLSP)).toEqual({
      ok: true,
    });
    expect(
      translateOperation(
        ChangeRoutingPointsOperation.create([{ elementId: 'nope', newRoutingPoints: [] }]),
        model,
        ISTAR_GLSP,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ elementId: 'nope', severity: 'error' }] });
  });
});
