/**
 * A GLSP client over a WebSocket, as a stock `@eclipse-glsp/client` connects (protocol's
 * `BaseJsonrpcGLSPClient`), on Node's own `WebSocket`.
 */
import type { ActionMessage, GLSPClient } from '@eclipse-glsp/server';
import { BaseJsonrpcGLSPClient, createWebSocketConnection, wrap } from '@eclipse-glsp/server';

export async function connect(
  url: string,
): Promise<{ client: GLSPClient; received: ActionMessage[]; socket: WebSocket }> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), {
      once: true,
    });
  });
  const client = new BaseJsonrpcGLSPClient({
    id: 'test-client',
    connectionProvider: createWebSocketConnection(wrap(socket)),
  });
  await client.start();
  const received: ActionMessage[] = [];
  client.onActionMessage((message) => received.push(message));
  return { client, received, socket };
}
