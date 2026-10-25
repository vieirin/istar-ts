// Side-effect imports: global styles for the canvas and React Flow. `./BothApp` imports
// `glsp-client`, whose own index module side-effects in the stock client's styles.
import '@istar-ts/react/styles.css';
import '@xyflow/react/dist/style.css';
import type { ComponentType } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BothApp } from './BothApp';
import './both.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

const render = (App: ComponentType): void =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// `?server=worker` (#99): the model in a Web Worker, the canvas on a mirror of it. Loaded only
// then, since importing it starts the worker.
if (new URLSearchParams(location.search).get('server') === 'worker') {
  void import('./WorkerBothApp').then(({ WorkerBothApp }) => render(WorkerBothApp));
} else {
  render(BothApp);
}
