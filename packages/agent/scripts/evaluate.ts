#!/usr/bin/env node
/**
 * The headless level-7 evaluation runner (#126 D5, #132). Invoked manually, with a real
 * provider key, never in CI:
 *
 *   DEEPSEEK_API_KEY=sk-... pnpm --filter @istar-ts/agent exec tsx scripts/evaluate.ts \
 *     --out report.json
 *
 * The provider stays configurable (`--base-url`, `--model`, `--api-key-env`, #126 §6's note
 * about re-running a baseline against a different model later).
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEEPSEEK, costPerMillionTokens, createChatClient } from '../src';
import { evaluate } from './eval-runner';
import { toMarkdown } from './eval-report';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'eval-report.json' },
    'base-url': { type: 'string', default: DEEPSEEK.baseUrl },
    model: { type: 'string', default: DEEPSEEK.model },
    'api-key-env': { type: 'string', default: 'DEEPSEEK_API_KEY' },
    backend: { type: 'string', default: 'B' },
    runs: { type: 'string', default: '5' },
    'max-steps': { type: 'string' },
    stream: { type: 'boolean', default: false },
  },
});

const apiKey = process.env[values['api-key-env']!];
if (!apiKey) {
  console.error(
    `missing API key: set ${values['api-key-env']} (--api-key-env to use a different one)`,
  );
  process.exit(1);
}
const backend = values.backend === 'A' ? 'A' : values.backend === 'B' ? 'B' : undefined;
if (!backend) {
  console.error(`--backend must be "A" or "B", got ${JSON.stringify(values.backend)}`);
  process.exit(1);
}

const client = createChatClient({
  baseUrl: values['base-url']!,
  model: values.model!,
  apiKey,
  stream: values.stream,
});

// deepseek-flash's off-peak price, from `docs/agent/verification.md` §1; other models run with
// no cost metric unless this script is extended with price flags.
const cost =
  values.model === 'deepseek-flash'
    ? costPerMillionTokens({ input: 0.15, cachedInput: 0.003, output: 0.6 })
    : undefined;

const report = await evaluate({
  client,
  backend,
  runs: Number.parseInt(values.runs!, 10),
  ...(values['max-steps'] ? { maxSteps: Number.parseInt(values['max-steps'], 10) } : {}),
  ...(cost ? { cost } : {}),
  onRun: ({ taskId, condition, run, runs }) =>
    console.error(`${taskId} / ${condition}: run ${run}/${runs}`),
});

writeFileSync(values.out!, JSON.stringify(report, null, 2));
const mdPath = values.out!.replace(/\.json$/, '.md');
writeFileSync(mdPath, toMarkdown(report));
console.error(`wrote ${values.out} and ${mdPath}`);
