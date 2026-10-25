// The page: a headless GLSP server with MCP over the page's own store (`serveIstarGlsp`), as a
// page with a React Flow canvas starts one for an agent.
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { ISTAR_GLSP, createIstarSharedModel } from '@istar-ts/glsp/index';

const server = serveIstarGlsp({ shared: createIstarSharedModel(ISTAR_GLSP), mcp: true });
void server.mcp.ready.then(() => console.log('MCP at', server.mcp.url.href));
