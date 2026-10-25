/**
 * `@istar-ts/agent/glsp`: backend A's `ChangeSetTarget` over `@istar-ts/glsp`'s headless
 * `serveIstarGlsp`, split from the package root so importing `@istar-ts/agent` alone never pulls
 * in GLSP (`@istar-ts/glsp` is this subpath's own optional peer dependency, #232).
 */
export * from './glsp/backend';
export * from './glsp/describe-operation';
