/**
 * Drives the drawer: opens backend A's live MCP session on first use, runs `@istar-ts/agent`'s
 * loop (Propose by default, Auto on request), and keeps the running chat transcript, the
 * pending change set and the usage/cost readout `AgentDrawer.tsx` renders.
 */
import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type { ModelStore, PropertySchema } from '@istar-ts/core';
import { DEEPSEEK, costPerMillionTokens, createChatClient, runAgent } from '@istar-ts/agent';
import type { AgentEvent, ApprovalMode, ChangeSetEntry, Transcript } from '@istar-ts/agent';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GlspFramework, GlspMcpSession } from './glspMcpBackend';
import { openGlspMcpSession } from './glspMcpBackend';

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
  readonly framework: GlspFramework;
  /** Opens the session on first `true` (the drawer's first open), closes it on `false`. */
  readonly open: boolean;
}

/** An entry of the running chat transcript, built from `onEvent` as a run goes (no streaming of
 * text deltas yet: `createChatClient`'s `stream` option stays off, see the file comment). */
export type ChatLogEntry =
  | { readonly kind: 'assistant'; readonly content: string | null }
  | {
      readonly kind: 'tool';
      readonly name: string;
      readonly ok: boolean;
      readonly summary: string;
    };

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
  readonly transcript: Transcript | undefined;
  readonly changeSet: readonly ChangeSetEntry[] | undefined;
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
  // Read fresh by `glspMcpBackend.ts` on every Propose-mode run, so guards/schemas toggled after
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
      framework: optionsRef.current.framework,
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
    if (event.type === 'step' && event.step.message.content !== null) {
      setLog((prev) => [...prev, { kind: 'assistant', content: event.step.message.content }]);
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
      setLog((prev) => [...prev, { kind: 'assistant', content: `> ${prompt}` }]);
      const controller = new AbortController();
      abortRef.current = controller;
      const client = createChatClient({ baseUrl: DEEPSEEK.baseUrl, model, apiKey });
      const common = {
        client,
        prompt,
        budget: { maxTokens: 200_000, cost: COST, maxCost: 1 },
        signal: controller.signal,
        onEvent,
      };
      const promise =
        approval === 'auto'
          ? runAgent({ ...common, approval: 'auto', tools: session.liveRegistry })
          : runAgent({ ...common, approval: 'propose', changeSet: session.changeSet });
      void promise
        .then((result) => {
          setTranscript(result.transcript);
          if (approval === 'propose' && result.changeSet.length > 0) setChangeSet(result.changeSet);
        })
        .finally(() => {
          abortRef.current = undefined;
          setRunning(false);
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

  return {
    ready,
    error,
    running,
    approval,
    setApproval,
    model,
    setModel,
    log,
    transcript,
    changeSet,
    run,
    stop,
    applyChangeSet,
    applyResult,
    discardChangeSet,
  };
}
