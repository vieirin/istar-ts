import type { Provider } from 'react';
import { createContext, useContext } from 'react';

/** How links without saved vertices are drawn. */
export type LinkShape = 'straight' | 'curved';

export interface CanvasOptions {
  readonly linkShape: LinkShape;
  /** Draw each link's `name` at its middle (off by default, as in piStar). */
  readonly linkNames: boolean;
}

const CanvasOptionsContext = createContext<CanvasOptions>({
  linkShape: 'straight',
  linkNames: false,
});

export const CanvasOptionsProvider: Provider<CanvasOptions> = CanvasOptionsContext.Provider;

export function useCanvasOptions(): CanvasOptions {
  return useContext(CanvasOptionsContext);
}
