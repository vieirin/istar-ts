/**
 * The agent drawer (#126 D4, #131): a BYOK chat panel over `@istar-ts/agent`'s loop and backend
 * A (`glspMcpBackend.ts`). Lazy-loaded from `App.tsx`/`BothApp.tsx` (dynamic `import()`) so
 * `/react.html`'s first load never pays for this file, `@istar-ts/agent`, `@istar-ts/glsp`'s MCP
 * path, `@eclipse-glsp/server-mcp` or the MCP SDK.
 */
import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type {
  AnyMetamodel,
  AnyPaletteDescription,
  ModelStore,
  PropertySchema,
} from '@istar-ts/core';
import type { ChangeSetEntry } from '@istar-ts/agent';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { ChangeSetPanel, resultText } from '../lab/ChangeSetPanel';
import type { ChangeSetContextView, ChangeSetPreview } from '../lab/ChangeSetPanel';
import { useApiKey } from './apiKey';
import { AGENT_MODELS, useAgentSession } from './useAgentSession';
import type { ChatLogEntry } from './useAgentSession';

/** A tool call as the model made it, for the review's JSON disclosure. */
function callJson(call: { readonly name: string; readonly args: unknown }): string {
  return JSON.stringify({ tool: call.name, arguments: call.args }, null, 2);
}

function logLine(entry: ChatLogEntry, index: number): ReactElement {
  if (entry.kind === 'assistant') {
    return (
      <p key={index} className="pg-agent-log-assistant">
        {entry.content}
        {entry.streaming ? ' ▌' : ''}
        {entry.stopped ? ' (stopped)' : ''}
      </p>
    );
  }
  return (
    <p key={index} className={entry.ok ? 'pg-lab-accept' : 'pg-lab-reject'}>
      {entry.name}: {entry.summary}
    </p>
  );
}

export default function AgentDrawer({
  store,
  dispatcher,
  guards,
  schemas,
  metamodel,
  palette,
}: {
  readonly store: ModelStore<string, string>;
  /** The "Agent"-tagged dispatcher every applied edit goes through. */
  readonly dispatcher: ActionDispatcher<string, string>;
  readonly guards: readonly ActionGuard<string, string>[];
  readonly schemas: readonly PropertySchema[];
  readonly metamodel: AnyMetamodel;
  readonly palette?: AnyPaletteDescription;
}): ReactElement {
  const { apiKey, remember, setApiKey, setRemember } = useApiKey();
  const [prompt, setPrompt] = useState('');
  const [included, setIncluded] = useState<readonly boolean[]>([]);
  const session = useAgentSession({
    store,
    dispatcher,
    guards,
    schemas,
    metamodel,
    palette,
    open: true,
  });
  // Re-synced once a run's change set actually arrives (`session.changeSet` is still the
  // previous run's, or undefined, at the moment `run` is called): derived during render from the
  // last change set object seen, the pattern React's docs recommend over an effect for this.
  const [seenChangeSet, setSeenChangeSet] = useState<readonly ChangeSetEntry[] | undefined>(
    undefined,
  );
  const { proposedStep } = session;
  // The change set's steps: its successful mutating calls only (#156). The run's other calls go
  // in the review's collapsed context section.
  const proposed = useMemo(
    () =>
      (session.changeSet ?? []).flatMap((entry) => {
        const step = proposedStep(entry);
        return step ? [{ entry, step }] : [];
      }),
    [session.changeSet, proposedStep],
  );
  if (session.changeSet !== seenChangeSet) {
    setSeenChangeSet(session.changeSet);
    setIncluded(proposed.map(() => true));
  }

  const steps = useMemo(
    () =>
      proposed.map(({ entry, step }) => ({
        key: entry.toolCallId,
        label: step.description.join('; '),
        detail: callJson(entry),
      })),
    [proposed],
  );
  const preview = useMemo(() => {
    if (!session.changeSet) return null;
    const map = new Map<string, ChangeSetPreview>();
    for (const { entry, step } of proposed) {
      map.set(entry.toolCallId, { ok: true, text: resultText({ ok: true, ...step }) });
    }
    return map;
  }, [session.changeSet, proposed]);
  const context = useMemo((): readonly ChangeSetContextView[] => {
    const stepIds = new Set(proposed.map(({ entry }) => entry.toolCallId));
    return (session.transcript?.steps ?? [])
      .flatMap((s) => s.toolCalls)
      .filter((call) => !stepIds.has(call.id))
      .map((call) => ({
        key: call.id,
        label: call.name,
        detail: callJson(call),
        outcome: {
          ok: call.result.ok,
          text: call.result.ok ? 'ok' : resultText(call.result),
        },
      }));
  }, [session.transcript, proposed]);

  const onRun = (): void => {
    session.run(apiKey, prompt);
  };

  const onToggleStep = (index: number): void => {
    setIncluded((prev) => prev.map((value, i) => (i === index ? !value : value)));
  };

  const onApply = (): void => {
    const kept = proposed.filter((_, index) => included[index]).map(({ entry }) => entry);
    void session.applyChangeSet(kept);
  };

  const canRun = session.ready && !session.running && apiKey.trim() !== '' && prompt.trim() !== '';

  return (
    <div className="pg-agent-drawer">
      <p className="pg-lab-hint">
        Bring your own DeepSeek API key: the agent edits this model only through the same guarded
        tools a human client uses, so a refusal reaches it as a diagnostic it can repair against.
      </p>
      <label className="pg-agent-field">
        DeepSeek API key
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
        />
      </label>
      <label className="pg-lab-guards-toggle">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this key on this device (localStorage)
      </label>
      <label className="pg-agent-field">
        Model
        <select value={session.model} onChange={(e) => session.setModel(e.target.value)}>
          {AGENT_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="pg-agent-approval">
        <label>
          <input
            type="radio"
            name="pg-agent-approval"
            checked={session.approval === 'propose'}
            onChange={() => session.setApproval('propose')}
          />
          Propose (review before applying)
        </label>
        <label>
          <input
            type="radio"
            name="pg-agent-approval"
            checked={session.approval === 'auto'}
            onChange={() => session.setApproval('auto')}
          />
          Auto (apply as it goes)
        </label>
      </div>
      <label className="pg-agent-field">
        Task
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Give the model an auditor that reviews requests."
        />
      </label>
      <div className="pg-lab-agent-actions">
        <button type="button" onClick={onRun} disabled={!canRun}>
          {session.running ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={session.stop} disabled={!session.running}>
          Stop
        </button>
      </div>
      {session.error !== undefined && <p className="pg-lab-reject">{session.error}</p>}
      {session.liveUsage && (
        <p className="pg-lab-hint">
          Tokens: {session.liveUsage.totalTokens}
          {`, cost ≈ $${session.liveUsage.cost.toFixed(4)}`}
          {session.liveUsage.estimated ? ' (estimate)' : ''}
        </p>
      )}
      {session.transcript && (
        <p className="pg-lab-hint">
          Stopped: {session.transcript.stop.reason}
          {session.transcript.stop.message ? ` — ${session.transcript.stop.message}` : ''}. Tokens:{' '}
          {session.transcript.usage.totalTokens}
          {session.transcript.cost !== undefined
            ? `, cost ≈ $${session.transcript.cost.toFixed(4)}`
            : ''}
          .
        </p>
      )}
      <div className="pg-agent-log">{session.log.map(logLine)}</div>
      {session.changeSet && preview && (
        <ChangeSetPanel
          goal="Review the proposed change set"
          hint={`Applied as one compound: one undo step, refused as a whole if any of its ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} is.`}
          steps={steps}
          included={included}
          onToggleStep={onToggleStep}
          preview={preview}
          onApply={onApply}
          canApply={included.some(Boolean)}
          context={context}
          applied={
            session.applyResult
              ? {
                  ok: session.applyResult.ok,
                  text: session.applyResult.ok
                    ? 'Applied.'
                    : `Rejected — ${session.applyResult.message}`,
                }
              : null
          }
        />
      )}
    </div>
  );
}
