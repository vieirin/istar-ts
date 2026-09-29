import type { PropertySchema } from '@istar-ts/core';
import { createEmptyModel, parsePistar, PistarParseError, toPistar } from '@istar-ts/core';
import type { IstarExtension } from '@istar-ts/react';
import { IstarCanvas, useIstarStore } from '@istar-ts/react';
import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goalControllerExtension, goalControllerSchemas } from './extensions/goal-controller';
import { demoIssuesFor, mutroseExtension, mutroseSchemas } from './extensions/mutrose';
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
const EXTENSIONS: Record<string, { extensions: IstarExtension[]; schemas: PropertySchema[] }> = {
  none: { extensions: [], schemas: [] },
  'goal-controller': { extensions: [goalControllerExtension], schemas: goalControllerSchemas },
  mutrose: { extensions: [mutroseExtension], schemas: mutroseSchemas },
};

export default function App(): ReactElement {
  const topChromeRef = useRef<HTMLDivElement>(null);
  const { store, model } = useIstarStore(createEmptyModel);
  const [selectedPath, setSelectedPath] = useState(initialFixturePath);
  const [parseError, setParseError] = useState<string | null>(null);
  const [extensionId, setExtensionId] = useState('none');
  const [bar, setBar] = useState<'left' | 'top' | 'bottom'>('left');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [links, setLinks] = useState<'straight' | 'curved'>('straight');
  const active = EXTENSIONS[extensionId] ?? EXTENSIONS.none!;

  const loadFixture = useCallback(
    async (path: string): Promise<void> => {
      const load = fixtureModules[path];
      if (!load) return;
      setParseError(null);
      try {
        const text = (await load()) as string;
        store.load(parsePistar(text));
        setSelectedPath(path);
      } catch (error) {
        if (error instanceof PistarParseError) {
          setParseError(error.message);
        } else {
          throw error;
        }
      }
    },
    [store],
  );

  useEffect(() => {
    if (!initialFixturePath) return;
    let cancelled = false;
    void (async () => {
      const load = fixtureModules[initialFixturePath];
      if (!load) return;
      try {
        const text = (await load()) as string;
        if (!cancelled) store.load(parsePistar(text));
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
      store.load(parsePistar(await file.text()));
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
    store.load(createEmptyModel());
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
