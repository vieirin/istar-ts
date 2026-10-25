# @istar-ts/agent

A framework-free tool-calling loop between an OpenAI-compatible chat model and istar-ts tools
(#126 D3). No React, no GLSP: the same code runs in a browser drawer, headless in an evaluation
runner, or in another app such as goal-controller.

```ts
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import { DEEPSEEK, createActionChangeSet, createChatClient, runAgent } from '@istar-ts/agent';

const store = createModelStore(model);
const dispatcher = createActionDispatcher(store, { guards });
const changeSet = createActionChangeSet({ dispatcher, getModel: store.getModel, guards });

const client = createChatClient({ ...DEEPSEEK, apiKey }); // the key stays inside the client
const { transcript, changeSet: proposed } = await runAgent({
  client,
  prompt: 'Give the model an auditor that reviews requests.',
  changeSet, // Propose mode, the default
  maxSteps: 20,
  budget: { maxTokens: 200_000 },
  signal: controller.signal,
});

// Review `proposed` (each entry: the call, its args, its dry-run result), then:
await changeSet.apply(proposed.filter(keep)); // one `compound`: one undo step
```

## Tools

A `ToolRegistry` lists `ToolSpec`s (OpenAI's `function` object: `name`, `description`, a JSON
Schema `parameters`, and `readOnly`) and calls them, answering a `ToolResult` in
`ActionResult`'s shape: `{ ok: true, content }` or `{ ok: false, diagnostics }`, where the
diagnostics are `GoalDiagnostic`s (code, message, elementId), so the model can repair against a
refusal. Two backends:

- **A, MCP** — `createMcpToolRegistry(client)` over an MCP client's `tools/list` / `tools/call`
  (in istar-ts, `@eclipse-glsp/server-mcp`'s diagram tools). `McpToolClient` is typed
  structurally; a connected `@modelcontextprotocol/sdk` `Client` is one. `isError` results
  become refusals (a result carrying `{ diagnostics }`, structured or as a JSON text block, keeps
  them). A tool is read-only by its `readOnlyHint` when the server gives one, else by name
  (`query-*`, `count-*`, `diagram-model`, `element-types`, `validate-diagram`, `session-info`,
  `check-edge`, `get-selection`; `isReadOnly` to change). The model is offered only the tools the
  server lists, less `MCP_RESOURCE_TOOLS` (`diagram-png`, `diagram-svg`: server-mcp's image
  resources, which it lists as tools but a headless istar session can't serve, #157) and
  `exclude`. `boundArgs` are sent with every call and hidden from the model, e.g.
  `@istar-ts/glsp`'s session:

  ```ts
  const server = serveIstarGlsp({ shared: { store, dispatcher }, mcp: true }); // @istar-ts/glsp/browser
  const client = new Client({ name: 'agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
  );
  const tools = await createMcpToolRegistry(client, {
    boundArgs: { sessionId: server.sessionId! },
    exclude: ['save-model'],
  });
  ```

  A guard's rejection through `@istar-ts/glsp` arrives with its own diagnostics (#136). Propose
  mode over MCP needs a `ChangeSetTarget` with a scratch GLSP session; this package does not
  ship one yet.

- **B, actions** — `createActionToolRegistry(dispatcher, { metamodel })`: one tool per
  `HANDLED_ACTION_KINDS` operation and request, plus `glspUndo`/`glspRedo`, named after the kind
  with `.` as `_` (`istar_setLinkValue`). Element and link kinds in the schemas come from the
  metamodel. `requestModel` answers without layout (actors, elements, dependums, links).

## Host extensions

A host gives the agent what isn't in the metamodel — type definitions, a notation, pooled
values, an external validator — as `@istar-ts/actions`' `HostContextProvider`s and
`HostTool`s (#175): opaque data plus a handler, so nothing here knows the host's domain, and the
same values work on both backends (see `@istar-ts/glsp`'s README, "Host tools and context
providers", for the types and an example).

- **Context**: `runAgent({ ..., context: providers, getModel: store.getModel })` appends one
  section per provider to the system prompt, after `system` (`DEFAULT_SYSTEM_PROMPT` by default,
  never forked): `## title` (default the name), then its text, read at the start of the run
  (from `getModel()` for a provider whose text is a function; without `getModel` such a provider
  throws). `prompt: false` leaves a provider out. `systemPromptWith(system, providers, getModel)`
  builds the same prompt for a host that drives a `ChatClient` itself. On backend A,
  `@istar-ts/glsp`'s launchers also serve the providers as MCP resources (or, in server-mcp's
  default `dataMode`, read-only tools).
- **Tools, backend A**: register them on the launcher (`mcp: { hostTools }`): `tools/list`
  lists them with their `readOnlyHint`, so `createMcpToolRegistry` offers them like any other
  tool, `sessionId` bound.
- **Tools, backend B**: `createActionToolRegistry(dispatcher, { hostTools, getModel })` lists
  them after the action tools (`readOnly` as declared) and calls the handler with the dispatcher
  and `getModel` — read-only tools get one that takes requests only. `createActionChangeSet`
  takes `hostTools` too: the scratch run records what a host tool dispatched and the dispatcher
  accepted (`ToolResult.dispatched`, never shown to the model), and `apply` replays exactly
  that in the one `compound`.

## Approval

- **Propose (default).** `changeSet: ChangeSetTarget`. A run opens a scratch copy of the live
  model and sends every call there; the edits are collected, with their dry-run results, into
  `AgentRun.changeSet`. Read-only calls (a host tool declared `readOnly` included) run straight away (on the scratch copy, so the model
  sees what it has proposed so far) and are not part of the change set. `createActionChangeSet`
  copies the model as `parsePistar(toPistar(model))` (never the live store), keeps the host's
  guards and schemas, and `apply` dispatches the reviewed entries as one `compound`. Refused
  entries are left out (they changed nothing in the dry run); undo/redo in the dry run are played
  out on the list. Backend B pins the ids a create would leave to the store (`prepare`), so the
  ids the model saw in the dry run are the ones the applied set creates. Exception: a
  `createEdge` to an existing n-ary hub (a new leg) gets the store's id.
- **Auto.** `approval: 'auto', tools: registry`: each call applies live as it comes.

## The loop

`runAgent` sends `messages` + `tools`, runs the returned `tool_calls` one after another (a later
call may use what an earlier one created), appends each result and asks again. It stops on a
final answer, after `maxSteps` model calls (default 20), at `budget.maxTokens` / `budget.maxCost`
(with `budget.cost`, e.g. `costPerMillionTokens({ input, cachedInput, output })`), on `signal`, or
after `maxRefusals` refused calls in a row (default 3). It does not throw for API or tool
failures; `transcript.stop` says why it stopped.

## Chat client

`createChatClient({ baseUrl, model, apiKey, stream?, body?, fetch? })` posts to
`{baseUrl}/chat/completions`. Nothing in it is DeepSeek's: `DEEPSEEK` is just a `baseUrl` and the
default model `deepseek-flash` (`docs/agent/verification.md`). `body` adds request fields, e.g.
`{ thinking: { type: 'disabled' } }`. With `stream: true` the response is read as server-sent
events: text deltas reach `onEvent` as they arrive, and tool calls are buffered by `index` until
the stream ends, then run whole (DeepSeek streams tool calls in argument fragments, D0 §2).

## Transcript

`transcript` is plain JSON for a UI to render and an evaluation to score: the messages, each
step's assistant message, `usage` and latency, each tool call's raw and prepared arguments,
disposition (`read` / `applied` / `proposed`), result and latency, the usage totals (including
cache hits and reasoning tokens), the cost, and the stop reason. The API key lives only in
`createChatClient`'s closure; the `ChatClient` object has no field holding it and the loop records
only `client.model`, so a transcript cannot contain the key. An API error's body is redacted of
the key before it reaches `stop.message`.

## Evaluation runner

`scripts/evaluate.ts` (#126 D5, #132) is a headless script, not a vitest suite: it runs the loop
over `fixtures/` under controlled task families (retrieval, modification, large-model against
`smartHome.txt`'s 237 ids, conflict) × conditions (Text, Actions with no guards, Actions with
the shield), 5 fresh runs each, and writes a JSON and markdown report of the level-7 evaluation
metrics (precision/recall, syntactic/semantic errors, rejections caught, a destroyed model,
tokens, wall-clock time, cost). It needs a real provider key and is never run in CI:

```sh
DEEPSEEK_API_KEY=sk-... pnpm --filter @istar-ts/agent evaluate -- --out report.json
```

`--base-url`, `--model`, `--api-key-env`, `--backend` (`A` or `B`, default `B`) and `--runs`
(default 5) are configurable (#126 §6's note about re-running a baseline against a different
model). Both backends run every condition, including the shield, now that #136 (#129, D2) lands
a guard's typed diagnostics over MCP too. `evaluate.ts`'s modules (`eval-tasks.ts`,
`eval-conditions.ts`, `eval-metrics.ts`, `eval-runner.ts`, `eval-report.ts`) have a vitest suite
(`test/evaluate.test.ts`) covering the harness plumbing — task definitions, metric aggregation,
the Text condition's parse check — with a mock chat server, no key.
