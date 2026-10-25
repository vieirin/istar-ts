// Side-effect imports: global styles for the canvas and React Flow. `./BothApp` imports
// `glsp-client`, whose own index module side-effects in the stock client's styles.
import '@istar-ts/react/styles.css';
import '@xyflow/react/dist/style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BothApp } from './BothApp';
import './both.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <BothApp />
  </StrictMode>,
);
