import { describe, expect, test } from 'vitest';
import { DEEPSEEK, PROVIDERS, createChatClient, fenceAttachments } from '../src';
import type { Attachment } from '../src';

const okModels = async (url: string | URL | Request) => {
  expect(String(url)).toBe(`${DEEPSEEK.baseUrl}/models`);
  return new Response(
    JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
    { status: 200 },
  );
};
const unauthorized = async () => new Response('nope', { status: 401 });
const networkDown = async (): Promise<Response> => {
  throw new Error('network down');
};
const unparsable = async () => new Response('not json', { status: 200 });

describe('PROVIDERS.deepseek', () => {
  const provider = PROVIDERS.deepseek;

  test('is keyed by id, built from DEEPSEEK', () => {
    expect(provider.id).toBe('deepseek');
    expect(provider.baseUrl).toBe(DEEPSEEK.baseUrl);
    expect(provider.defaultModel).toBe(DEEPSEEK.model);
    expect(provider.fallbackModels.map((m) => m.id)).toEqual([
      DEEPSEEK.model,
      'deepseek-chat',
      'deepseek-reasoner',
    ]);
  });

  test('listModels resolves the API response', async () => {
    const models = await provider.listModels('sk-test', okModels);
    expect(models).toEqual([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]);
  });

  test('listModels falls back on a non-2xx answer', async () => {
    const models = await provider.listModels('sk-test', unauthorized);
    expect(models).toEqual(provider.fallbackModels);
  });

  test('listModels falls back when fetch rejects', async () => {
    const models = await provider.listModels('sk-test', networkDown);
    expect(models).toEqual(provider.fallbackModels);
  });

  test('listModels falls back on an unparsable body', async () => {
    const models = await provider.listModels('sk-test', unparsable);
    expect(models).toEqual(provider.fallbackModels);
  });
});

describe('fenceAttachments', () => {
  test('fences each file with its name, using a fence longer than any backtick run inside it', () => {
    const files: readonly Attachment[] = [
      { name: 'notes.md', mime: 'text/markdown', text: 'plain text' },
      {
        name: 'snippet.md',
        mime: 'text/markdown',
        text: 'before\n```js\ncode\n```\nafter',
      },
    ];
    const rendered = fenceAttachments(files);

    expect(rendered).toContain('notes.md\n```\nplain text\n```');
    // The file's own ``` run must not be able to close the fence early.
    expect(rendered).toContain('snippet.md\n````\nbefore\n```js\ncode\n```\nafter\n````');
  });

  test('DEEPSEEK_PROVIDER.attach uses the same fencing', () => {
    const files: readonly Attachment[] = [{ name: 'a.txt', mime: 'text/plain', text: 'hi' }];
    expect(PROVIDERS.deepseek.attach(files)).toBe(fenceAttachments(files));
  });
});

describe('createChatClient', () => {
  test('the plain { baseUrl, model } form keeps working, with no provider', () => {
    const client = createChatClient({
      baseUrl: 'http://127.0.0.1:1/',
      model: 'deepseek-flash',
      apiKey: 'sk-test',
    });
    expect(client.model).toBe('deepseek-flash');
    expect(client.baseUrl).toBe('http://127.0.0.1:1');
    expect(client.provider).toBeUndefined();
  });

  test('DEEPSEEK keeps working as a plain baseUrl/model pair', () => {
    const client = createChatClient({
      baseUrl: DEEPSEEK.baseUrl,
      model: DEEPSEEK.model,
      apiKey: 'sk-test',
    });
    expect(client.baseUrl).toBe(DEEPSEEK.baseUrl);
    expect(client.model).toBe(DEEPSEEK.model);
  });

  test('accepts a provider id, defaulting to its defaultModel', () => {
    const client = createChatClient({ provider: 'deepseek', apiKey: 'sk-test' });
    expect(client.baseUrl).toBe(DEEPSEEK.baseUrl);
    expect(client.model).toBe(DEEPSEEK.model);
    expect(client.provider).toBe(PROVIDERS.deepseek);
  });

  test('accepts a provider value and an explicit model', () => {
    const client = createChatClient({
      provider: PROVIDERS.deepseek,
      model: 'deepseek-reasoner',
      apiKey: 'sk-test',
    });
    expect(client.model).toBe('deepseek-reasoner');
    expect(client.provider).toBe(PROVIDERS.deepseek);
  });
});
