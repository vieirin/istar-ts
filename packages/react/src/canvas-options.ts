import type { Provider } from 'react';
import { createContext, useContext } from 'react';

/** How links without saved vertices are drawn. */
export type LinkShape = 'straight' | 'curved';

export interface CanvasOptions {
  readonly linkShape: LinkShape;
}

const CanvasOptionsContext = createContext<CanvasOptions>({ linkShape: 'straight' });

export const CanvasOptionsProvider: Provider<CanvasOptions> = CanvasOptionsContext.Provider;

export function useCanvasOptions(): CanvasOptions {
  return useContext(CanvasOptionsContext);
}
