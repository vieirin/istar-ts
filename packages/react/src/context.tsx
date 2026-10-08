import type {
  ActorKind,
  AnyMetamodel,
  DependencyLinkKind,
  ElementKind,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkCheck,
  LinkKind,
  Metamodel,
  ModelStore,
  ModelStoreOptions,
} from '@istar-ts/core';
import { canLink, createModelStore, metamodelOf } from '@istar-ts/core';
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
import type { ElementActions, IstarExtension, IstarRegistry, LinkActions } from './registry';
import { applyExtensions, defaultRegistry, registryForMetamodel } from './registry';
import type { ElementIssue } from './issues';
import { groupIssuesById } from './issues';

/** The active toolbar tool. `EK`/`LK` default to iStar 2.0's kinds. */
export type Tool<EK extends string = ElementKind, LK extends string = LinkKind> =
  | {
      type: 'element';
      kind: EK;
      /** customProperties preset on the new element, over the kind's defaults. */
      properties?: Readonly<Record<string, string>>;
    }
  | { type: 'link'; kind: Exclude<LK, DependencyLinkKind>; value?: string }
  | {
      type: 'dependency';
      dependum: Exclude<EK, ActorKind>;
      /** The dependency link kind. Default `istar.DependencyLink`. */
      linkKind?: LK;
    };

export type Selection = { type: 'element'; id: string } | { type: 'link'; id: string } | null;

export interface Notice {
  readonly id: number;
  readonly message: string;
  readonly tone: 'error' | 'info';
}

export interface IstarEditor {
  readonly store: ModelStore;
  readonly model: IstarModel;
  /**
   * The model's metamodel (iStar 2.0 unless the model was read or created with an extended
   * one). Extended kinds are in `registry` too, with default configurations.
   */
  readonly metamodel: AnyMetamodel;
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
  /**
   * Host-owned issues keyed by element/link id (e.g. LSP diagnostics). Empty map when the
   * host did not pass `issues`.
   */
  readonly issuesById: ReadonlyMap<string, readonly ElementIssue[]>;
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
export function useIstarStore<EK extends string = ElementKind, LK extends string = LinkKind>(
  initial?: IstarModel<EK, LK> | (() => IstarModel<EK, LK>),
  options: {
    /** Metamodel of the empty model created when `initial` is omitted. */
    readonly metamodel?: Metamodel<EK, LK>;
  } = {},
): {
  store: ModelStore<EK, LK>;
  model: IstarModel<EK, LK>;
} {
  const [store] = useState(
    () =>
      createModelStore(
        (typeof initial === 'function' ? initial() : initial) as IstarModel | undefined,
        (options.metamodel ? { metamodel: options.metamodel } : {}) as ModelStoreOptions,
      ) as unknown as ModelStore<EK, LK>,
  );
  return {
    store,
    model: useStoreModel(store as unknown as ModelStore) as unknown as IstarModel<EK, LK>,
  };
}

/**
 * Editor props. `EK`/`LK` are the kinds of the model's metamodel; they default to iStar 2.0's
 * and are inferred from `model`/`store` when those use an extended metamodel.
 */
export interface IstarProviderProps<EK extends string = ElementKind, LK extends string = LinkKind> {
  /** Controlled model. Ignored when `store` is given. */
  readonly model?: IstarModel<EK, LK>;
  /** Called with the next model after each edit (controlled mode). */
  readonly onChange?: (model: IstarModel<EK, LK>) => void;
  /** Use an existing store (for undo/redo and change events). Takes precedence over `model`. */
  readonly store?: ModelStore<EK, LK>;
  /**
   * Base registry; the piStar-like `defaultRegistry` when omitted. It is completed with default
   * configurations for kinds the model's metamodel adds (see `registryForMetamodel`).
   */
  readonly registry?: IstarRegistry | IstarRegistry<EK, LK>;
  /**
   * Extensions applied on top of `registry`, in order, to adapt the editor to another modeller.
   * Keep the array stable (memoize it) to avoid rebuilding the registry on every render.
   * (Their `metamodel` part must already be in the model's metamodel: see
   * `metamodelWithExtensions`.)
   */
  readonly extensions?: readonly IstarExtension<EK, LK>[];
  readonly readOnly?: boolean;
  /**
   * Host-owned issues (e.g. LSP diagnostics from a VS Code webview). Keyed by element/link id
   * via {@link IstarEditor.issuesById}; never written to the model.
   */
  readonly issues?: readonly ElementIssue[];
  /** Called whenever the editor selection changes (including clearing it). */
  readonly onSelectionChange?: (selection: Selection) => void;
  readonly children?: ReactNode;
}

/**
 * Supplies the editor state to `<IstarCanvas>`, `<IstarPalette>`, `<IstarInspector>` and custom
 * UI. `<IstarCanvas>` creates one automatically when it isn't wrapped in a provider.
 */
export function IstarProvider<EK extends string = ElementKind, LK extends string = LinkKind>(
  typedProps: IstarProviderProps<EK, LK>,
): ReactElement {
  // Internally kinds are plain strings looked up in the metamodel and registry.
  const props = typedProps as unknown as IstarProviderProps;
  const store = useControlledStore(props.store, props.model, props.onChange);
  const storeModel = useStoreModel(store);
  // In controlled mode render exactly what the parent passed.
  const model = props.store ? storeModel : (props.model ?? storeModel);
  const metamodel = metamodelOf(model) as unknown as AnyMetamodel;
  const baseRegistry = props.registry ?? defaultRegistry;
  const registry = useMemo(() => {
    const complete =
      metamodel.extensions.length > 0
        ? (registryForMetamodel(metamodel, baseRegistry) as unknown as IstarRegistry)
        : baseRegistry;
    return props.extensions?.length ? applyExtensions(complete, props.extensions) : complete;
  }, [metamodel, baseRegistry, props.extensions]);
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

  const onSelectionChangeRef = useRef(props.onSelectionChange);
  useLayoutEffect(() => {
    onSelectionChangeRef.current = props.onSelectionChange;
  });
  useEffect(() => {
    onSelectionChangeRef.current?.(selection);
  }, [selection]);

  const issuesById = useMemo(() => groupIssuesById(props.issues), [props.issues]);

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
      const kind =
        forTool.type === 'dependency' ? (forTool.linkKind ?? 'istar.DependencyLink') : forTool.kind;
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
      metamodel,
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
      issuesById,
    }),
    [
      store,
      model,
      metamodel,
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
      issuesById,
    ],
  );
  return <EditorContext.Provider value={editor}>{props.children}</EditorContext.Provider>;
}

/** True when rendered inside an `IstarProvider`. */
export function useHasIstarProvider(): boolean {
  return useContext(EditorContext) !== null;
}

/** The surrounding editor, or `null` outside a provider (e.g. a component rendered standalone). */
export function useOptionalIstarEditor(): IstarEditor | null {
  return useContext(EditorContext);
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
