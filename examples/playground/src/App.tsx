import type { AnyIstarModel, AnyMetamodel, PropertySchema } from '@istar-ts/core';
import {
  createEmptyModel,
  inheritSourceLayout,
  parsePistar,
  PistarParseError,
  toPistar,
  withMetamodel,
} from '@istar-ts/core';
import type { IstarExtension } from '@istar-ts/react';
import { IstarCanvas, metamodelWithExtensions, useIstarStore } from '@istar-ts/react';
import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goalControllerExtension, goalControllerSchemas } from './extensions/goal-controller';
import { demoIssuesFor, mutroseExtension, mutroseSchemas } from './extensions/mutrose';
import { rationalAgentsExtension } from './extensions/rationalAgents';
import { Sidebar } from './Sidebar';

const fixtureModules = import.meta.glob('../../../fixtures/**/*.txt', {
  query: '?raw',
  import: 'default',
});

const fixturePaths = Object.keys(fixtureModules).toSorted((a, b) => a.localeCompare(b));

function fixtureLabel(path: string): string {
  return path.replace(/^\.\.\/\.\.\/\.\.\/fixtures\//, '');
}

function defaultFixturePath(): string | undefined {
  return fixturePaths.find((path) => path.includes('labSamples'));
}

const initialFixturePath = defaultFixturePath() ?? fixturePaths[0] ?? '';

/**
 * Optional extensions. The default is a plain piStar editor; an extension adapts it to another
 * modeller without changing the libraries.
 */
interface ExtensionSet {
  readonly extensions: readonly IstarExtension<string, string>[];
  readonly schemas: readonly PropertySchema[];
  /** The metamodel models are read and created with: iStar 2.0 plus the extensions' kinds. */
  readonly metamodel: AnyMetamodel;
}

function extensionSet(
  extensions: readonly IstarExtension<string, string>[],
  schemas: readonly PropertySchema[],
): ExtensionSet {
  return { extensions, schemas, metamodel: metamodelWithExtensions(extensions) };
}

const EXTENSIONS: Record<string, ExtensionSet> = {
  none: extensionSet([], []),
  'goal-controller': extensionSet(
    [goalControllerExtension as IstarExtension<string, string>],
    goalControllerSchemas,
  ),
  mutrose: extensionSet([mutroseExtension as IstarExtension<string, string>], mutroseSchemas),
  // A metamodel extension: new element and link kinds, not just new presentation.
  rationalAgents: extensionSet([rationalAgentsExtension], []),
};

/** Examples under fixtures/extensions/<name>.txt need the extension of that name. */
function extensionForPath(path: string): string | undefined {
  const match = /\/extensions\/([^/]+)\.txt$/.exec(path);
  return match && match[1] && EXTENSIONS[match[1]] ? match[1] : undefined;
}

/** Kinds of `model` that `metamodel` doesn't know. */
function unknownKinds(model: AnyIstarModel, metamodel: AnyMetamodel): string[] {
  const unknown = new Set<string>();
  for (const e of model.elements.values()) if (!metamodel.elements.has(e.kind)) unknown.add(e.kind);
  for (const l of model.links.values()) if (!metamodel.links.has(l.kind)) unknown.add(l.kind);
  return [...unknown];
}

export default function App(): ReactElement {
  const topChromeRef = useRef<HTMLDivElement>(null);
  const { store, model } = useIstarStore<string, string>(() => createEmptyModel());
  const [selectedPath, setSelectedPath] = useState(initialFixturePath);
  const [parseError, setParseError] = useState<string | null>(null);
  const [extensionId, setExtensionIdState] = useState(
    () => extensionForPath(initialFixturePath) ?? 'none',
  );
  const [bar, setBar] = useState<'left' | 'top' | 'bottom'>('left');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [links, setLinks] = useState<'straight' | 'curved'>('straight');
  const active = EXTENSIONS[extensionId] ?? EXTENSIONS.none!;

  /**
   * Switching extensions keeps the current model, under the new metamodel, unless it uses
   * kinds the new one doesn't have.
   */
  const setExtensionId = (id: string): void => {
    const next = EXTENSIONS[id] ?? EXTENSIONS.none!;
    const current = store.getModel();
    const missing = unknownKinds(current, next.metamodel);
    if (missing.length > 0) {
      setParseError(`The current model uses ${missing.join(', ')}, which this extension lacks.`);
      return;
    }
    setParseError(null);
    // A new model object (the store only re-renders on a new snapshot), keeping key order.
    store.load(withMetamodel(inheritSourceLayout(current, { ...current }), next.metamodel));
    setExtensionIdState(id);
  };

  /** Parses with the extension a path needs (switching to it), or the active one. */
  const parseFor = useCallback(
    (text: string, path?: string): AnyIstarModel => {
      const id = (path && extensionForPath(path)) || extensionId;
      if (id !== extensionId) setExtensionIdState(id);
      const metamodel = (EXTENSIONS[id] ?? EXTENSIONS.none!).metamodel;
      return parsePistar(text, { metamodel });
    },
    [extensionId],
  );

  const loadFixture = useCallback(
    async (path: string): Promise<void> => {
      const load = fixtureModules[path];
      if (!load) return;
      setParseError(null);
      try {
        const text = (await load()) as string;
        store.load(parseFor(text, path));
        setSelectedPath(path);
      } catch (error) {
        if (error instanceof PistarParseError) {
          setParseError(error.message);
        } else {
          throw error;
        }
      }
    },
    [parseFor, store],
  );

  useEffect(() => {
    if (!initialFixturePath) return;
    let cancelled = false;
    void (async () => {
      const load = fixtureModules[initialFixturePath];
      if (!load) return;
      try {
        const text = (await load()) as string;
        // The initial extension state already matches this path (see useState above).
        const id = extensionForPath(initialFixturePath) ?? 'none';
        const metamodel = (EXTENSIONS[id] ?? EXTENSIONS.none!).metamodel;
        if (!cancelled) store.load(parsePistar(text, { metamodel }));
      } catch (error) {
        if (cancelled) return;
        if (error instanceof PistarParseError) {
          setParseError(error.message);
        } else {
          throw error;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(() => {
    const el = topChromeRef.current;
    if (!el) return;
    const sync = (): void => {
      document.documentElement.style.setProperty(
        '--pg-header-height',
        `${el.getBoundingClientRect().height}px`,
      );
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const exampleOptions = useMemo(
    () =>
      fixturePaths.map((path) => ({
        path,
        label: fixtureLabel(path),
      })),
    [],
  );

  const onExampleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    void loadFixture(event.target.value);
  };

  const onOpenFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setParseError(null);
    try {
      store.load(parseFor(await file.text()));
      setSelectedPath('');
    } catch (error) {
      if (error instanceof PistarParseError) {
        setParseError(error.message);
      } else {
        throw error;
      }
    }
  };

  const onSave = (): void => {
    const text = toPistar(model, { saveDate: new Date() });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'goalModel.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onNew = (): void => {
    store.load(createEmptyModel(undefined, { metamodel: active.metamodel }));
    setSelectedPath('');
    setParseError(null);
  };

  return (
    <div className="pg-app">
      <div ref={topChromeRef} className="pg-top-chrome">
        <header className="pg-header">
          <h1 className="pg-title">istar-ts playground</h1>
          <div className="pg-toolbar">
            <label>
              Example
              <select value={selectedPath} onChange={onExampleChange}>
                {selectedPath === '' && <option value="">— custom —</option>}
                {exampleOptions.map(({ path, label }) => (
                  <option key={path} value={path}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Extension
              <select value={extensionId} onChange={(e) => setExtensionId(e.target.value)}>
                <option value="none">None (piStar)</option>
                <option value="goal-controller">goal-controller</option>
                <option value="mutrose">MutRoSe-shaped</option>
                <option value="rationalAgents">iStar4RationalAgents (new kinds)</option>
              </select>
            </label>
            <label>
              Bar
              <select value={bar} onChange={(e) => setBar(e.target.value as typeof bar)}>
                <option value="left">Left</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label>
              Theme
              <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Links
              <select value={links} onChange={(e) => setLinks(e.target.value as typeof links)}>
                <option value="straight">Straight</option>
                <option value="curved">Curved</option>
              </select>
            </label>
            <label className="pg-file-label">
              Open…
              <input type="file" accept=".txt,.pistar,application/json" onChange={onOpenFile} />
            </label>
            <button type="button" onClick={onSave}>
              Save
            </button>
            <button type="button" onClick={onNew}>
              New
            </button>
          </div>
        </header>
        {parseError !== null && (
          <div className="pg-banner" role="alert">
            <span>{parseError}</span>
            <button type="button" className="pg-banner-dismiss" onClick={() => setParseError(null)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
      <div className="pg-canvas-wrap">
        <IstarCanvas
          store={store}
          extensions={active.extensions}
          palette={bar}
          colorMode={theme}
          linkShape={links}
          issues={extensionId === 'mutrose' ? demoIssuesFor(model) : undefined}
          aside={<Sidebar model={model} schemas={active.schemas} />}
        />
      </div>
    </div>
  );
}
