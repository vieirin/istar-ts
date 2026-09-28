import type {
  ElementKind,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkCheck,
  LinkKind,
  ModelStore,
  NodeKind,
} from '@istar-ts/core';
import { canLink, createModelStore } from '@istar-ts/core';
import type { ReactElement, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ElementActions, IstarRegistry, LinkActions } from './registry';
import { defaultRegistry } from './registry';

/** The active toolbar tool. */
export type Tool =
  | { type: 'element'; kind: ElementKind }
  | { type: 'link'; kind: Exclude<LinkKind, 'istar.DependencyLink'>; value?: string }
  | { type: 'dependency'; dependum: NodeKind };

export type Selection = { type: 'element'; id: string } | { type: 'link'; id: string } | null;

export interface Notice {
  readonly id: number;
  readonly message: string;
  readonly tone: 'error' | 'info';
}

export interface IstarEditor {
  readonly store: ModelStore;
  readonly model: IstarModel;
  readonly registry: IstarRegistry;
  readonly readOnly: boolean;
  readonly tool: Tool | null;
  setTool(tool: Tool | null): void;
  readonly selection: Selection;
  select(selection: Selection): void;
  readonly editingId: string | null;
  setEditingId(id: string | null): void;
  readonly notice: Notice | null;
  notify(message: string, tone?: Notice['tone']): void;
  dismissNotice(): void;
  /** Checks a connection for the current tool (dependencies check depender → dependee). */
  checkConnection(source: string, target: string, tool?: Tool | null): LinkCheck;
  elementActions(id: string): ElementActions;
  linkActions(id: string): LinkActions;
}

const EditorContext = createContext<IstarEditor | null>(null);

/** Access the surrounding editor (inside `<IstarCanvas>` or `<IstarProvider>`). */
export function useIstarEditor(): IstarEditor {
  const editor = useContext(EditorContext);
  if (!editor)
    throw new Error('useIstarEditor must be used inside <IstarProvider> or <IstarCanvas>');
  return editor;
}

export function useSelectedTarget(): IstarElement | IstarLink | undefined {
  const { model, selection } = useIstarEditor();
  if (!selection) return undefined;
  return selection.type === 'element'
    ? model.elements.get(selection.id)
    : model.links.get(selection.id);
}

/** Subscribes to a store; re-renders on every change. */
export function useStoreModel(store: ModelStore): IstarModel {
  return useSyncExternalStore(store.subscribe, store.getModel, store.getModel);
}

/**
 * Creates a store once and returns it with its current model. Use it to get undo/redo and
 * change events without wiring your own store.
 */
export function useIstarStore(initial?: IstarModel | (() => IstarModel)): {
  store: ModelStore;
  model: IstarModel;
} {
  const [store] = useState(() =>
    createModelStore(typeof initial === 'function' ? initial() : initial),
  );
  return { store, model: useStoreModel(store) };
}

export interface IstarProviderProps {
  /** Controlled model. Ignored when `store` is given. */
  readonly model?: IstarModel;
  /** Called with the next model after each edit (controlled mode). */
  readonly onChange?: (model: IstarModel) => void;
  /** Use an existing store (for undo/redo and change events). Takes precedence over `model`. */
  readonly store?: ModelStore;
  readonly registry?: IstarRegistry;
  readonly readOnly?: boolean;
  readonly children?: ReactNode;
}

/**
 * Supplies the editor state to `<IstarCanvas>`, `<IstarPalette>`, `<IstarInspector>` and custom
 * UI. `<IstarCanvas>` creates one automatically when it isn't wrapped in a provider.
 */
export function IstarProvider(props: IstarProviderProps): ReactElement {
  const store = useControlledStore(props.store, props.model, props.onChange);
  const storeModel = useStoreModel(store);
  // In controlled mode render exactly what the parent passed.
  const model = props.store ? storeModel : (props.model ?? storeModel);
  const registry = props.registry ?? defaultRegistry;
  const readOnly = props.readOnly ?? false;
  const [tool, setTool] = useState<Tool | null>(null);
  const [rawSelection, setRawSelection] = useState<Selection>(null);
  // Stable and idempotent: re-selecting the same target keeps the same state object, so
  // listeners that report selection (like React Flow's) can't loop.
  const select = useCallback((next: Selection) => {
    setRawSelection((prev) =>
      prev === next || (prev && next && prev.type === next.type && prev.id === next.id)
        ? prev
        : next,
    );
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeSeq = useRef(0);

  // A selection whose target no longer exists (e.g. after undo) reads as no selection.
  const selection =
    rawSelection &&
    (rawSelection.type === 'element'
      ? model.elements.has(rawSelection.id)
      : model.links.has(rawSelection.id))
      ? rawSelection
      : null;

  const notify = useCallback((message: string, tone: Notice['tone'] = 'error') => {
    setNotice({ id: ++noticeSeq.current, message, tone });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const checkConnection = useCallback(
    (source: string, target: string, forTool: Tool | null = tool): LinkCheck => {
      const current = store.getModel();
      if (!forTool || forTool.type === 'element') {
        return { ok: false, code: 'unknown-link-kind', reason: 'select a link type first' };
      }
      const kind = forTool.type === 'dependency' ? 'istar.DependencyLink' : forTool.kind;
      return canLink(current, source, target, kind);
    },
    [store, tool],
  );

  const elementActions = useCallback(
    (id: string): ElementActions => ({
      rename: (name) => store.updateElement(id, { name }),
      setProperties(patch) {
        const current = store.getModel().elements.get(id)?.customProperties ?? {};
        const next: Record<string, string> = { ...current };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        store.updateElement(id, { customProperties: next });
      },
      setDisplay: (patch) => store.updateElement(id, { display: patch }),
      remove: () => store.removeElement(id),
    }),
    [store],
  );

  const linkActions = useCallback(
    (id: string): LinkActions => ({
      setLabel: (label) => store.updateLink(id, { label: label ?? null }),
      setName: (name) => store.updateLink(id, { name: name ?? null }),
      setProperties(patch) {
        const current = store.getModel().links.get(id)?.customProperties ?? {};
        const next: Record<string, string> = { ...current };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        store.updateLink(id, { customProperties: next });
      },
      remove: () => store.disconnect(id),
    }),
    [store],
  );

  const editor = useMemo<IstarEditor>(
    () => ({
      store,
      model,
      registry,
      readOnly,
      tool,
      setTool,
      selection,
      select,
      editingId,
      setEditingId,
      notice,
      notify,
      dismissNotice: () => setNotice(null),
      checkConnection,
      elementActions,
      linkActions,
    }),
    [
      store,
      model,
      registry,
      readOnly,
      tool,
      selection,
      editingId,
      notice,
      notify,
      select,
      checkConnection,
      elementActions,
      linkActions,
    ],
  );
  return <EditorContext.Provider value={editor}>{props.children}</EditorContext.Provider>;
}

/** True when rendered inside an `IstarProvider`. */
export function useHasIstarProvider(): boolean {
  return useContext(EditorContext) !== null;
}

/**
 * In controlled mode (`model` + `onChange`), keeps a private store in sync with the prop: edits
 * go through the store (so constraint checks and cascades apply) and are reported via
 * `onChange`.
 */
function useControlledStore(
  external: ModelStore | undefined,
  model: IstarModel | undefined,
  onChange: ((model: IstarModel) => void) | undefined,
): ModelStore {
  const [internal] = useState(() => createModelStore(model));
  const store = external ?? internal;
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (external) return;
    return internal.subscribe((event) => {
      if (event.source !== 'load') onChangeRef.current?.(event.model);
    });
  }, [external, internal]);

  useLayoutEffect(() => {
    // Adopt the parent's model. When the parent echoes back what onChange gave it this is a
    // no-op, so undo history survives; any other model replaces the store's content.
    if (!external && model && model !== internal.getModel()) internal.load(model);
  });
  return store;
}
