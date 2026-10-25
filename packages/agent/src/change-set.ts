/**
 * Propose mode's contract: a run's calls go to a scratch copy of the live model, the edits among
 * them are collected into a change set, and the host applies the reviewed set to the live model
 * as one step. `createActionChangeSet` implements it over the `@istar-ts/actions` dispatcher.
 */
import type { JsonValue, ToolRegistry, ToolResult } from './tools';

/** One proposed edit: a tool call and what it did in the dry run. */
export interface ChangeSetEntry {
  readonly toolCallId: string;
  readonly name: string;
  /** The arguments as dispatched (with the ids the backend pinned, if it pins any). */
  readonly args: JsonValue;
  /** The dry run's result; a refused entry changed nothing. */
  readonly result: ToolResult;
}

/** A scratch copy of the live model, and the same tools over it. */
export interface ScratchSession {
  readonly registry: ToolRegistry;
  /** Releases the scratch copy. */
  close?(): void;
}

/** Where Propose mode dry-runs, and where the reviewed change set goes. */
export interface ChangeSetTarget {
  /** A fresh scratch copy of the live model, for one run. Never touches the live model. */
  openScratch(): ScratchSession | Promise<ScratchSession>;
  /** Applies `entries` (reviewed, in order) to the live model as one undo step. */
  apply(entries: readonly ChangeSetEntry[]): Promise<ToolResult>;
}
