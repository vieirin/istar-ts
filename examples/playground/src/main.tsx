// Side-effect imports: global styles for the canvas and React Flow.
import '@istar-ts/react/styles.css';
import '@xyflow/react/dist/style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
