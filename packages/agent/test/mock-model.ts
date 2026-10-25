/**
 * An in-process OpenAI-compatible chat server for the tests: no network beyond 127.0.0.1, no
 * real key. Each request is answered by `reply`, which sees the request body and its index.
 */
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatMessage, ToolMessage } from '../src';

export interface RecordedRequest {
  readonly headers: IncomingHttpHeaders;
  readonly body: {
    readonly model: string;
    readonly messages: readonly ChatMessage[];
    readonly tools?: readonly { function: { name: string } }[];
    readonly stream?: boolean;
    readonly [key: string]: unknown;
  };
}

export type Reply =
  | { readonly status?: number; readonly json: unknown }
  | { readonly status?: number; readonly text: string }
  | { readonly sse: readonly unknown[] }
  /** Never answers (until the client gives up). */
  | { readonly hang: true };

export interface MockModel {
  readonly baseUrl: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

const USAGE = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

/** A completion with tool calls (`[name, args]` pairs). */
export function toolCalls(...calls: readonly (readonly [string, unknown])[]): { json: unknown } {
  return {
    json: {
      id: 'cmpl',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: calls.map(([name, args], i) => ({
              id: `call-${name}-${i}-${Math.random().toString(36).slice(2, 8)}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            })),
          },
        },
      ],
      usage: USAGE,
    },
  };
}

/** A final answer. */
export function answer(text: string): { json: unknown } {
  return {
    json: {
      id: 'cmpl',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
      usage: USAGE,
    },
  };
}

/** The tool messages of a request, their content parsed. */
export function toolResults(request: RecordedRequest): { id: string; content: any }[] {
  return request.body.messages
    .filter((m): m is ToolMessage => m.role === 'tool')
    .map((m) => ({ id: m.tool_call_id, content: JSON.parse(m.content) }));
}

/** The last tool message's parsed content. */
export function lastToolResult(request: RecordedRequest): any {
  return toolResults(request).at(-1)?.content;
}

export async function startMockModel(
  reply: (request: RecordedRequest, index: number) => Reply,
): Promise<MockModel> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => {
      const request: RecordedRequest = { headers: req.headers, body: JSON.parse(data) };
      requests.push(request);
      const r = reply(request, requests.length - 1);
      if ('hang' in r) return;
      if ('sse' in r) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of r.sse) res.write(`data: ${JSON.stringify(event)}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      if ('text' in r) {
        res.writeHead(r.status ?? 200, { 'content-type': 'text/plain' });
        res.end(r.text);
        return;
      }
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
