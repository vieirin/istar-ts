// Inversify reads decorator metadata through `Reflect`: load the polyfill before any class
// (`@eclipse-glsp/client`'s own container construction, next).
import 'reflect-metadata';
// The stock client's and this metamodel's own styling (#103) — see `styles.css`'s own comment.
import './styles.css';

export { mountGlspClient } from './mountGlspClient';
export type { MountGlspClientOptions, MountedGlspClient } from './mountGlspClient';
export type { GlspPortLike } from './connection';
export { redoAction, undoAction } from './actions';
