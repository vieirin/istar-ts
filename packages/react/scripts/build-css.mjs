// Bundles React Flow's stylesheet with ours into dist/styles.css, so consumers import one file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const reactFlowCss = readFileSync(require.resolve('@xyflow/react/dist/style.css'), 'utf8');
const ours = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../dist/styles.css', import.meta.url),
  `/* @xyflow/react (MIT) */\n${reactFlowCss}\n/* @istar-ts/react */\n${ours}`,
);
