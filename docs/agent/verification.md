# Agent drawer — D0 verification

Research for [#127](https://github.com/vieirin/istar-ts/issues/127) (D0 of
[#126](https://github.com/vieirin/istar-ts/issues/126), the agent drawer epic). Turns #126 §1's
◐ facts into ✅ or a documented ❌. **No code changes in this document or its PR.** D1–D5 should
read conclusions from here instead of re-deriving them.

Marking convention (same as `docs/glsp/framework-notes.md`):

- ✅ confirmed — the command transcript, doc quote, or file path + line range is given inline.
- ◐ partially confirmed, or confirmed with a caveat spelled out.

Fetched 2026-10-24. DeepSeek's docs and model lineup can change without notice (#126 §7's own
risk table flags this) — re-run before D3/D4 ship if this file is more than a few weeks old.

## 1. DeepSeek's current models and tool-call support

✅ Fetched `https://api-docs.deepseek.com/quick_start/pricing` and
`https://api-docs.deepseek.com/api/create-chat-completion` (2026-10-24). The model lineup named
in #126 §1 (`deepseek-chat` / `deepseek-reasoner`) is **stale** — current models are:

| Model             | Context window | Input, cache hit (off-peak / peak) | Input, cache miss (off-peak / peak) | Output (off-peak / peak) |
| ----------------- | -------------- | ---------------------------------- | ----------------------------------- | ------------------------ |
| `deepseek-flash`  | 1M tokens      | $0.003 / $0.006 per 1M             | $0.15 / $0.3 per 1M                 | $0.6 / $1.2 per 1M       |
| `deepseek-v4-pro` | 1M tokens      | $0.022 / $0.044 per 1M             | $0.66 / $1.32 per 1M                | $1.98 / $3.96 per 1M     |

Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri, excluding Chinese public holidays; all
other times are off-peak.

There is **no separate reasoning model anymore**. Reasoning ("thinking mode") is a per-request
flag on both models, not a model name: the chat-completion request body takes an optional
`thinking: { type: "enabled" | "disabled" }` (default `enabled`), or a `reasoning_effort` of
`"none"` (disables thinking) / `"low"` / `"high"` / `"max"` (all enable it).

Both models accept the OpenAI-style `tools` array (`create-chat-completion` doc, quoted
verbatim): _"A list of tools the model may call. Currently, only functions are supported as a
tool."_ Each entry is `{ type: "function", function: { name, description, parameters,
strict? } }`. Response messages carry `tool_calls: [{ id, type: "function", function: { name,
arguments } }]` (`arguments` is a JSON-encoded string, standard OpenAI shape).

**Tool calls do work in thinking mode**, with one restriction: _"`required` and named tool
choices are not supported in thinking mode; the API returns a `400` error."_ `tool_choice: "auto"`
/ `"none"` are unaffected. So D3's loop can run thinking mode and tools together as long as it
never sets `tool_choice` to `"required"` or a named function while thinking is enabled.

**Implication for #126 §9's last default** ("the DeepSeek model chosen in D0 by which model
actually supports tool calls"): that default no longer applies as stated — both current models
support tool calls, and reasoning is an orthogonal flag rather than a model choice. D3 should
pick `deepseek-flash` (cheaper, same 1M context) as the default model and treat `thinking`/
`reasoning_effort` as a separate, optional setting. Flagging this back to #126 per the issue's
"say so, don't silently change scope" instruction.

## 2. Streaming with tools

✅ `create-chat-completion` doc, quoted: _"If set, partial message deltas will be sent. Tokens
will be sent as data-only server-sent events (SSE) as they become available, with the stream
terminated by a `data: [DONE]` message."_ `stream: true` is documented as an independent request
field from `tools`/`tool_choice`; nothing in the doc excludes using them together, and the same
page specifies how a streamed tool call looks:

_"The first chunk of each tool call carries the `id`, `type` and `function` fields; subsequent
chunks only carry the function `arguments`."_ The `index` field on each `tool_calls` delta entry
gives its position in the array (for parallel tool calls across multiple deltas).

So D3's loop must **buffer, not stream-execute**, a tool call: accumulate `function.arguments`
string fragments across chunks (keyed by `index`, id only present on the first chunk) until the
stream ends or a `finish_reason: "tool_calls"` arrives, then `JSON.parse` once per call id. This
is the same accumulation pattern the OpenAI streaming SDKs use, not a DeepSeek-specific quirk.

## 3. The `usage` block

✅ `create-chat-completion` doc. Fields, quoted/paraphrased from the response schema:

- `prompt_tokens` — total prompt tokens (cache hits + misses).
- `completion_tokens` — generated tokens.
- `total_tokens` — the two combined.
- `prompt_tokens_details: { prompt_cache_hit_tokens, prompt_cache_miss_tokens }` — the cache
  split that the pricing table's hit/miss rates (§1) are billed against.
- `completion_tokens_details: { reasoning_tokens }` — present when thinking mode is enabled;
  the reasoning content's token count, separate from the visible completion.

D3's budget and D5's metrics should read `usage.total_tokens` for the step/run budget and
`usage.prompt_tokens_details.prompt_cache_hit_tokens` plus `completion_tokens_details
.reasoning_tokens` for cost/latency breakdowns, rather than inferring a cache split from pricing
alone.

## 4. CORS from a non-localhost origin

✅ Re-ran #126 §1's preflight, this time with `Origin: https://example-playground.vercel.app`
(a plausible deploy origin, not `localhost`):

```
$ curl -s -i -X OPTIONS https://api.deepseek.com/chat/completions \
    -H "Origin: https://example-playground.vercel.app" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type"
HTTP/2 200
access-control-allow-credentials: true
vary: origin, access-control-request-method, access-control-request-headers
access-control-allow-methods: POST
access-control-allow-headers: authorization,content-type
access-control-allow-origin: https://example-playground.vercel.app
```

```
$ curl -s -i -X POST https://api.deepseek.com/chat/completions \
    -H "Origin: https://example-playground.vercel.app" \
    -H "Content-Type: application/json" \
    -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
HTTP/2 401
access-control-allow-credentials: true
vary: origin, access-control-request-method, access-control-request-headers
access-control-allow-origin: https://example-playground.vercel.app

Authentication Fails (governor)
```

**DeepSeek's CORS policy echoes whatever `Origin` header it receives, unconditionally** — it is
not an allowlist of `localhost`/`127.0.0.1`. The deployed playground origin works exactly like
`http://localhost:5173` did in #126 §1: `200` on preflight, `401` (not CORS-blocked) on an
unauthenticated POST, same ACAO-echo behaviour on both. No proxy is needed for a deployed
origin either. `access-control-allow-credentials: true` is also present but irrelevant here,
since the drawer sends the key as an `Authorization` header, not cookies.

## 5. How a page client connects through server-mcp 2.8.0's bridge

✅ Read from the npm tarball (`npm pack @eclipse-glsp/server-mcp@2.8.0`, unpacked to
`/tmp/server-mcp-2.8.0/package`; both `src/*.ts` and compiled `lib/*.js` are shipped, read the
`.ts`). `shasum`/`integrity` from `npm pack`'s own output:
`sha512-uQmlnT2pb3JRv[...]9lMON6ZduUpkw==`.

**`src/browser/server/web-mcp-server-launcher.ts:34-39`** — `WebMcpServerLauncher extends
AbstractMcpServerLauncher`. Its `bindTransport` is a **no-op returning `{}`**; the class doc
comment explains why: _"Web targets (Cloudflare Worker, Deno Deploy, Bun, Service Worker,
in-page Worker) have no socket to bind; the adopter plugs the inherited
`AbstractMcpServerLauncher.getRequestHandler` into their own listener."_ So the launcher itself
does not speak `postMessage` — it only exposes `handleRequest(request: Request): Promise<Response>`
(standard Fetch API shapes), same as every other launcher target.

**`src/browser/server/mcp-worker-bridge.ts`** is the piece that _does_ speak `postMessage`, and
it sits **between** that fetch-shaped launcher and the page, inside a Worker:

- `McpRequestMessage { type: 'mcp-request', id, url, method, headers, body? }` (lines 26-33) and
  `McpResponseMessage { type: 'mcp-response', id, status, statusText, headers, body:
ReadableStream<Uint8Array> | ArrayBuffer | null }` (lines 35-43) are the wire messages.
- `McpInitPortMessage { type: 'mcp-init-port' }` (lines 46-48) carries **no payload itself** —
  its purpose is the `MessagePort` riding along in `event.ports[0]` (`onMessage`, lines 117-136):
  receiving `mcp-init-port` makes the bridge adopt that port as a dedicated, ordered channel and
  start listening to `mcp-request` messages _on the port_ instead of the broad `scope` listener.
  **The bridge is the receiver of `mcp-init-port`, not the sender** — whoever owns the Worker
  scope (the adopter's Service-Worker-side code) sends it once, transferring one end of a
  `MessageChannel`, then talks `mcp-request`/`mcp-response` over that port from then on.
- `dispatch()` (lines 144-175) turns a received `McpRequestMessage` into a real `Request`,
  calls `launcher.handleRequest(...)`, and replies with `McpResponseMessage`, streaming the body
  (`ReadableStream`, transferable) on Chromium or buffering to `ArrayBuffer` elsewhere
  (`canTransferReadableStream()`, lines 58-67, probes via `structuredClone(..., {transfer})`).

**Does an MCP client in the page need a `fetch` shim, or talk `postMessage` directly?** A
`fetch` shim — confirmed both by what's _absent_ from the tarball and by the README. The
tarball has no page-side client code at all (`find … -iname '*.ts' | xargs grep -l
'mcp-init-port\|postMessage'` only matches the two browser/server files read above — nothing
under a `client` or `page` path). The published `README.md:52-63` states it directly:

> For browser, Bun, Deno, Cloudflare Workers, or any Fetch-shaped runtime, use the `browser`
> subpath. `McpWorkerBridge` wires `postMessage` traffic into the launcher for the common
> Service-Worker → Web-Worker setup: … **The page-side proxy — a Service Worker that intercepts
> `fetch('/mcp', …)` and forwards each `Request` to the bridge over a `MessageChannel` — is
> host-side scaffolding that adopters own.** See `examples/workflow-server-mcp-demo/mcp-service-
worker.js` for a working reference implementation.

That reference Service Worker is not in the published package (only `src/`, `lib/`, `README.md`,
`package.json`, licence files ship — `examples/` is repo-only), so it was not read. **D1
implements this adapter itself**: a page-side MCP SDK client that calls `fetch('/mcp', …)`, a
Service Worker registered by the page that intercepts that fetch and forwards the `Request`
(serialized to `McpRequestMessage`) over a `MessageChannel` to a Web Worker hosting
`McpWorkerBridge` + `WebMcpServerLauncher` + `@istar-ts/glsp`'s diagram module, and sends the one
`mcp-init-port` message to hand the bridge its end of that channel. An MCP client talking
directly to the launcher over bare `postMessage`, with no `fetch`/Service-Worker shim, is not an
option this package supports — `AbstractMcpServerLauncher.getRequestHandler`/`handleRequest`
only understand `Request`/`Response`.

◐ **Not verified**: whether a same-realm shortcut (skip the Service Worker, run `McpWorkerBridge`
and the MCP client in the same page/Worker with a plain `fetch` override instead of a real
Service Worker) is viable — `AbstractMcpServerLauncher`'s constructor/DI requirements weren't
read in this pass (out of scope: #127 names only `web-mcp-server-launcher.js` and
`mcp-worker-bridge.js`). D1 should check `src/common/server/abstract-mcp-server-launcher.ts`
before deciding between "real Service Worker" and "same-realm `fetch` monkey-patch."

## 6. Whether every server-mcp tool goes only through GLSP operations

✅ Read `src/common/tools/handlers/{create-nodes,create-edges,modify-nodes,modify-edges,
delete-elements,save-model}-mcp-tool-handler.ts` and the base classes in
`src/common/server/mcp-tool-handler.ts`.

Every handler in #126 §1's list extends either `OperationMcpDiagramToolHandler` or (for
`save-model`) `AbstractMcpDiagramToolHandler`, both of which `@inject(ActionDispatcher)
protected actionDispatcher` (`mcp-tool-handler.ts:421`, doc comment at :401 explicitly: _"Every
adopter extending this base dispatches, so the … injects `ActionDispatcher`"_). This is the
**same per-session `ActionDispatcher`** a GLSP client's own actions go through (`ClientId`,
`ModelState` are injected alongside it from the live session container, per the class doc at
:245-249).

Confirmed per handler, by what each one constructs and dispatches:

- `create-edges-mcp-tool-handler.ts:142-143` — `CreateEdgeOperation.create({ elementTypeId,
sourceElementId, targetElementId, args })`, then `this.actionDispatcher.dispatch(operation)`.
- `modify-nodes-mcp-tool-handler.ts:139-147` — `ChangeBoundsOperation.create(...)` and
  `ApplyLabelEditOperation.create(...)`, both dispatched the same way.
- `modify-edges-mcp-tool-handler.ts:115-123` — `ReconnectEdgeOperation.create(...)` and
  `ChangeRoutingPointsOperation.create(...)`.
- `save-model-mcp-tool-handler.ts:73` — `this.actionDispatcher.dispatch(SaveModelAction.create({
fileUri }))`. This one dispatches an **Action**, not an `Operation` (there is no "save"
  operation handler in the GLSP operation sense), but it is still the same dispatcher a normal
  GLSP client uses for `SaveModelAction` — it reaches the registered `SaveModelActionHandler` →
  `SourceModelStorage.saveSourceModel`, not a side-channel file write. No operation/handler
  registry is bypassed.

**No tool in the list calls into `ModelState`'s mutable store directly, or any other path around
`actionDispatcher.dispatch`.** None found. In `@istar-ts/glsp` specifically, `IstarModelState`
(per `docs/glsp/framework-notes.md` §5/§1 and this repo's `packages/glsp`) wires the same
operation-handler registry as the human-edit path, so every server-mcp tool call reaches our
#81 guards exactly like a React or stock-GLSP-client edit — confirming #126 §1's ◐ row as ✅.

## 7. Whether `create-edges`' `args` can express dependency and n-ary edges

✅ with a caveat. `create-edges-mcp-tool-handler.ts:38-45`, `CreateEdgeSpecSchema`:

```ts
export const CreateEdgeSpecSchema = z.strictObject({
  elementTypeId: z.string()...,
  sourceElementId: z.string()...,
  targetElementId: z.string()...,
  routingPoints: z.array(position).optional()...,
  // `args` stays open (`record(...)`) — adopter-specific extension surface for per-edge-type creation hints.
  args: z.record(z.string(), z.any()).optional().describe('Additional type-specific arguments for edge creation (varies by edge type)')
});
```

`args` is an **unconstrained `Record<string, any>`** — zod puts no shape on it beyond "an
object." The handler forwards it verbatim: `CreateEdgeOperation.create({ elementTypeId,
sourceElementId, targetElementId, args })` (line 142), with no inspection of `args`' keys at all.

Compare `packages/actions/src/actions.ts:92-107`, `CreateEdgeArgs`: `{ value?, name?,
customProperties?, id?, dependum?: DependumArgs, linkIds?, legId?, endId? }`. And
`packages/react/src/IstarCanvas.tsx:684-735` (`onConnect`): a dependency edge sends `args: {
dependum: { kind, id, name } }` (lines 693-699); an n-ary edge sends `args: { id?, value,
customProperties? }` and leaves `legId`/`endId` to the operation's defaults
(`packages/core/src/operations.ts:501-502`, `createId()` when absent).

**So yes — the schema today can carry both shapes as written, because it carries anything.**
`CreateEdgeOperation.create({ ..., args: { dependum: {...} } })` from an MCP call would reach
`packages/actions/src/dispatcher.ts` the same way `onConnect`'s dispatch does (dispatcher.ts
reads `args.dependum`, `args.legId`, `args.endId`, `args.linkIds` off whatever `args` object it's
given — it does not care whether the caller was React or MCP). There is **no schema gap**.

◐ The caveat: `CreateEdgeSpecSchema`'s `args.describe()` text — _"Additional type-specific
arguments for edge creation (varies by edge type)"_ — gives an LLM calling `create-edges` **no
information about `dependum`/`legId`/`endId`/`linkIds`'s existence or shape**. A model would
have to be told the istar-ts-specific args shape some other way (a system prompt section, or an
`IstarExtension`-style tool description override) to construct a correct dependency or n-ary
`createEdge` call; nothing in server-mcp surfaces it. This is a **documentation/prompt gap, not
a schema gap** — D2's gap list (#126 §4, "Gap in (A)" rows) should add it as a row distinct from
the `set-properties`/`set-link-value`/`check-edge` gaps, since those are missing tools while
this is a missing description on an existing tool. Flagging this back to #126 per the issue's
scope-change instruction; no code change made here.

## Summary for D1–D5

| #   | Question                                                 | Verdict                                                                                                                |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | DeepSeek models, tool-call support, context, pricing     | ✅ — but model names changed from #126's assumption; see §1                                                            |
| 2   | Streaming + tools                                        | ✅ supported; buffer deltas by `index`, see §2                                                                         |
| 3   | `usage` block field names                                | ✅ see §3                                                                                                              |
| 4   | CORS from a non-localhost origin                         | ✅ echoes any origin, see §4                                                                                           |
| 5   | Page client ↔ server-mcp bridge handshake                | ✅ for the wire shapes and that a `fetch` shim (Service Worker) is required; ◐ same-realm shortcut not checked, see §5 |
| 6   | Every server-mcp tool goes through GLSP operations       | ✅ see §6                                                                                                              |
| 7   | `create-edges`' `args` can carry dependency/n-ary shapes | ✅ (unconstrained schema); ◐ model needs separate guidance, see §7                                                     |

Two findings imply changes outside this issue's scope, both already flagged inline above and
repeated here per #127's "Out of scope" instruction:

- §1: #126 §9's last default ("the model chosen in D0 by which model supports tool calls") no
  longer applies as worded; recommend `deepseek-flash` as D3's default model, `thinking` as a
  separate setting.
- §7: #126 §4's gap table should grow a row for `create-edges`' args description gap, separate
  from the `set-properties`/`set-link-value`/`check-edge` tool gaps.
