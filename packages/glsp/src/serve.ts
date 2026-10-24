/**
 * Serves one piStar file to GLSP clients over a WebSocket:
 *
 *   pnpm --filter @istar-ts/glsp serve <file.txt> [--port 8081] [--host 127.0.0.1]
 *     [--diagram istar|kaos|nfr] [--mcp]
 *
 * Every client edits the same model (a shared store); `saveModel` writes it back to the file, or
 * to its `fileUri` in the same directory. A relative path is read from where pnpm was run.
 */
// Inversify reads decorator metadata through `Reflect`: load the polyfill before any class.
import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { IstarGlspContribution } from './contribution';
import { ISTAR_GLSP } from './contribution';
import { createIstarSharedModel } from './host';
import { diskPistarFiles, startIstarGlspServer } from './node';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '8081' },
    host: { type: 'string', default: '127.0.0.1' },
    diagram: { type: 'string', default: 'istar' },
    mcp: { type: 'boolean', default: false },
  },
});

const path = positionals[0] ?? '';
if (path === '') {
  console.error(
    'usage: serve <file.txt> [--port 8081] [--host 127.0.0.1] [--diagram istar|kaos|nfr] [--mcp]',
  );
  process.exit(2);
}

/** KAOS and NFR need their optional peer packages, so they load only when asked for. */
async function contributionFor(diagram: string): Promise<IstarGlspContribution> {
  if (diagram === 'istar') return ISTAR_GLSP;
  if (diagram === 'kaos') return (await import('./kaos')).KAOS_GLSP;
  if (diagram === 'nfr') return (await import('./nfr')).NFR_GLSP;
  throw new Error(`unknown diagram type "${diagram}" (istar, kaos or nfr)`);
}

async function main(): Promise<void> {
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), path);
  const name = basename(file);
  const files = diskPistarFiles(dirname(file));
  const contribution = await contributionFor(values.diagram);
  const shared = createIstarSharedModel(contribution, {
    model: await readFile(file, 'utf8'),
    sourceModelName: name,
    save: async (pistar, action) => {
      await files.write(action.fileUri ?? name, JSON.stringify(pistar, null, 2));
    },
  });
  const server = await startIstarGlspServer({
    contributions: [contribution],
    shared,
    files,
    port: Number(values.port),
    host: values.host,
    mcp: values.mcp,
  });
  console.log(`istar-ts GLSP server: ${file} as "${contribution.diagramType}" on ${server.url}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
