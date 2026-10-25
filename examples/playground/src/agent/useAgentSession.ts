/**
 * Drives the drawer: opens backend A's live MCP session on first use, runs `@istar-ts/agent`'s
 * loop (Propose by default, Auto on request), and keeps the running chat transcript, the
 * pending change set and the usage/cost readout `AgentDrawer.tsx` renders.
 */
import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type {
  AnyIstarModel,
  AnyMetamodel,
  AnyPaletteDescription,
  ModelStore,
  PropertySchema,
} from '@istar-ts/core';
import { DEEPSEEK, costPerMillionTokens, createChatClient, runAgent } from '@istar-ts/agent';
import type {
  AgentEvent,
  ApprovalMode,
  ChangeSetEntry,
  ToolResult,
  Transcript,
} from '@istar-ts/agent';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GlspMcpSession, ProposedStep } from '@istar-ts/agent/glsp';
import { openGlspMcpSession } from '@istar-ts/agent/glsp';

/** DeepSeek's current models that take tool calls (`docs/agent/verification.md` §1). */
export const AGENT_MODELS: readonly string[] = [DEEPSEEK.model, 'deepseek-v4-pro'];

/** `deepseek-flash`'s per-million-token prices (`docs/agent/verification.md` §1, off-peak). */
const COST = costPerMillionTokens({ input: 0.15, cachedInput: 0.003, output: 0.6 });

export interface AgentSessionOptions<EK extends string = string, LK extends string = string> {
  readonly store: ModelStore<EK, LK>;
  /** The "Agent"-tagged dispatcher every applied edit goes through. */
  readonly dispatcher: ActionDispatcher<EK, LK>;
  readonly guards: readonly ActionGuard<EK, LK>[];
  readonly schemas: readonly PropertySchema[];
  /** The active model's own metamodel, whatever its dialect. */
  readonly metamodel: AnyMetamodel;
  /** The active extension's own palette, if it has one; default: one derived from `metamodel`. */
  readonly palette?: AnyPaletteDescription;
  /** Opens the session on first `true` (the drawer's first open), closes it on `false`. */
  readonly open: boolean;
}

/** An entry of the running chat transcript, built from `onEvent` as a run goes. An `assistant`
 * entry grows in place from `delta` events while `streaming` is true, then is finalized (or
 * marked `stopped`, Stop mid-stream) once its step settles (#152). */
export type ChatLogEntry =
  | {
      readonly kind: 'assistant';
      readonly content: string | null;
      readonly streaming?: boolean;
      readonly stopped?: boolean;
    }
  | {
      readonly kind: 'tool';
      readonly name: string;
      readonly ok: boolean;
      readonly summary: string;
    };

/** A live token/cost readout while a run is still streaming, ahead of any step's real `usage`.
 * DeepSeek only sends `usage` in a step's last chunk (`docs/agent/verification.md` §2-3), so the
 * in-flight step's share is a rough estimate (~4 chars/token) until that chunk lands; `estimated`
 * tells the UI to flag it as such. */
export interface LiveUsage {
  readonly totalTokens: number;
  readonly cost: number;
  readonly estimated: boolean;
}

function summarize(entry: { readonly result: { readonly ok: boolean } }): string {
  const result = entry.result as {
    readonly ok: boolean;
    readonly diagnostics?: readonly { message: string }[];
  };
  return result.ok
    ? 'ok'
    : (result.diagnostics ?? []).map((d) => d.message).join('; ') || 'refused';
}

export interface AgentSession {
  readonly ready: boolean;
  readonly error: string | undefined;
  readonly running: boolean;
  readonly approval: ApprovalMode;
  setApproval(mode: ApprovalMode): void;
  readonly model: string;
  setModel(model: string): void;
  readonly log: readonly ChatLogEntry[];
  /** Set while `running`; cleared once the final transcript lands (its own `usage`/`cost` are
   * exact by then, so the drawer reads those instead). */
  readonly liveUsage: LiveUsage | undefined;
  readonly transcript: Transcript | undefined;
  readonly changeSet: readonly ChangeSetEntry[] | undefined;
  /** `entry`'s step of the change set, or `undefined` for a call that isn't one (#156). */
  proposedStep(entry: ChangeSetEntry): ProposedStep | undefined;
  /** For a successful `undo`/`redo` call's result, what it undid/redid, in plain words;
   * `undefined` for every other call (#163). */
  describeUndo(result: ToolResult): string | undefined;
  run(apiKey: string, prompt: string): void;
  stop(): void;
  applyChangeSet(kept: readonly ChangeSetEntry[]): Promise<void>;
  readonly applyResult: { readonly ok: boolean; readonly message?: string } | undefined;
  discardChangeSet(): void;
}

export function useAgentSession<EK extends string = string, LK extends string = string>(
  options: AgentSessionOptions<EK, LK>,
): AgentSession {
  const { open } = options;
  const sessionRef = useRef<GlspMcpSession | undefined>(undefined);
  // Read fresh by `@istar-ts/agent/glsp` on every Propose-mode run, so guards/schemas toggled after
  // the drawer's first open (the session itself opens once, below) still reach the next run.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const abortRef = useRef<AbortController | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<ApprovalMode>('propose');
  const [model, setModel] = useState<string>(DEEPSEEK.model);
  const [log, setLog] = useState<readonly ChatLogEntry[]>([]);
  const [liveUsage, setLiveUsage] = useState<LiveUsage | undefined>(undefined);
  // Index into `log` of the assistant entry currently growing from `delta` events, or null
  // between steps. A ref: read/written only inside `onEvent`, never needs a render of its own.
  const streamingIndexRef = useRef<number | null>(null);
  // Characters streamed for the in-flight step, reset once that step's `usage` (real or none)
  // settles; backs the live token estimate.
  const streamCharsRef = useRef(0);
  const liveUsageRef = useRef({ totalTokens: 0, cost: 0 });
  const [transcript, setTranscript] = useState<Transcript | undefined>(undefined);
  const [changeSet, setChangeSet] = useState<readonly ChangeSetEntry[] | undefined>(undefined);
  const [applyResult, setApplyResult] = useState<
    { readonly ok: boolean; readonly message?: string } | undefined
  >(undefined);

  useEffect(() => {
    if (!open || sessionRef.current || ready) return;
    let cancelled = false;
    void openGlspMcpSession(() => ({
      store: optionsRef.current.store as unknown as ModelStore<string, string>,
      dispatcher: optionsRef.current.dispatcher as unknown as ActionDispatcher<string, string>,
      guards: optionsRef.current.guards as readonly ActionGuard<string, string>[],
      schemas: optionsRef.current.schemas,
      metamodel: optionsRef.current.metamodel,
      palette: optionsRef.current.palette,
    }))
      .then((session) => {
        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;
        setReady(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // Opens once per mount (the drawer stays mounted once opened, #131 item 7); `store` and
    // `dispatcher` never change identity for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(
    () => () => {
      sessionRef.current?.close();
      sessionRef.current = undefined;
    },
    [],
  );

  const onEvent = useCallback((event: AgentEvent) => {
    if (event.type === 'delta') {
      const content = event.delta.content;
      if (!content) return;
      setLog((prev) => {
        const index = streamingIndexRef.current;
        if (index !== null && prev[index]?.kind === 'assistant') {
          const next = prev.slice();
          const entry = next[index] as {
            readonly kind: 'assistant';
            readonly content: string | null;
          };
          next[index] = {
            kind: 'assistant',
            content: (entry.content ?? '') + content,
            streaming: true,
          };
          return next;
        }
        streamingIndexRef.current = prev.length;
        return [...prev, { kind: 'assistant', content, streaming: true }];
      });
      streamCharsRef.current += content.length;
      const estimatedTokens =
        liveUsageRef.current.totalTokens + Math.ceil(streamCharsRef.current / 4);
      const estimatedCost =
        liveUsageRef.current.cost +
        COST({
          prompt_tokens: 0,
          completion_tokens: Math.ceil(streamCharsRef.current / 4),
          total_tokens: Math.ceil(streamCharsRef.current / 4),
        });
      setLiveUsage({ totalTokens: estimatedTokens, cost: estimatedCost, estimated: true });
    } else if (event.type === 'step') {
      streamCharsRef.current = 0;
      if (event.step.usage) {
        liveUsageRef.current = {
          totalTokens: liveUsageRef.current.totalTokens + (event.step.usage.total_tokens ?? 0),
          cost: liveUsageRef.current.cost + COST(event.step.usage),
        };
      }
      setLiveUsage({ ...liveUsageRef.current, estimated: false });
      const index = streamingIndexRef.current;
      const content = event.step.message.content;
      if (index !== null) {
        setLog((prev) => {
          const next = prev.slice();
          next[index] = { kind: 'assistant', content, streaming: false };
          return next;
        });
        streamingIndexRef.current = null;
      } else if (content !== null) {
        setLog((prev) => [...prev, { kind: 'assistant', content, streaming: false }]);
      }
    } else if (event.type === 'tool-call') {
      setLog((prev) => [
        ...prev,
        {
          kind: 'tool',
          name: event.call.name,
          ok: event.call.result.ok,
          summary: summarize(event.call),
        },
      ]);
    }
  }, []);

  const run = useCallback(
    (apiKey: string, prompt: string) => {
      const session = sessionRef.current;
      if (!session || running || !apiKey || !prompt.trim()) return;
      setRunning(true);
      setTranscript(undefined);
      setChangeSet(undefined);
      setApplyResult(undefined);
      setLiveUsage(undefined);
      streamingIndexRef.current = null;
      streamCharsRef.current = 0;
      liveUsageRef.current = { totalTokens: 0, cost: 0 };
      setLog((prev) => [...prev, { kind: 'assistant', content: `> ${prompt}` }]);
      const controller = new AbortController();
      abortRef.current = controller;
      const client = createChatClient({ baseUrl: DEEPSEEK.baseUrl, model, apiKey, stream: true });
      const common = {
        client,
        prompt,
        budget: { maxTokens: 200_000, cost: COST, maxCost: 1 },
        signal: controller.signal,
        onEvent,
        // The built-in metamodel context provider (#240) covers this model's kinds by default.
        getModel: () => optionsRef.current.store.getModel() as unknown as AnyIstarModel,
      };
      const promise =
        approval === 'auto'
          ? runAgent({ ...common, approval: 'auto', tools: session.liveRegistry })
          : runAgent({ ...common, approval: 'propose', changeSet: session.changeSet });
      void promise
        .then((result) => {
          setTranscript(result.transcript);
          if (approval === 'propose' && result.changeSet.length > 0) setChangeSet(result.changeSet);
          if (result.transcript.stop.reason === 'aborted') {
            const index = streamingIndexRef.current;
            if (index !== null) {
              setLog((prev) => {
                const next = prev.slice();
                const entry = next[index];
                if (entry?.kind === 'assistant')
                  next[index] = { ...entry, streaming: false, stopped: true };
                return next;
              });
              streamingIndexRef.current = null;
            }
          }
        })
        .finally(() => {
          abortRef.current = undefined;
          setRunning(false);
          setLiveUsage(undefined);
        });
    },
    [approval, model, onEvent, running],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const applyChangeSet = useCallback(async (kept: readonly ChangeSetEntry[]) => {
    const session = sessionRef.current;
    if (!session) return;
    const result = await session.changeSet.apply(kept);
    setApplyResult(
      result.ok
        ? { ok: true }
        : { ok: false, message: result.diagnostics.map((d) => d.message).join('; ') },
    );
    // The review (steps, preview) stays visible with the "Applied."/rejected line, the same way
    // the pseudo-agent's own change set keeps its steps after applying — the next `run` clears it.
  }, []);

  const discardChangeSet = useCallback(() => setChangeSet(undefined), []);
  const proposedStep = useCallback(
    (entry: ChangeSetEntry) => sessionRef.current?.changeSet.step(entry),
    [],
  );
  const describeUndo = useCallback(
    (result: ToolResult) => sessionRef.current?.changeSet.describeUndo(result),
    [],
  );

  return {
    ready,
    error,
    running,
    approval,
    setApproval,
    model,
    setModel,
    log,
    liveUsage,
    transcript,
    changeSet,
    proposedStep,
    describeUndo,
    run,
    stop,
    applyChangeSet,
    applyResult,
    discardChangeSet,
  };
}
