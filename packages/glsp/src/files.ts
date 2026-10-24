/**
 * Where piStar files come from is the host's business (a Node host reads the disk, a worker asks
 * its page), so the session reads and writes them through a `PistarFiles` the host binds.
 */
import type { MaybePromise } from '@eclipse-glsp/server';

/** Reads and writes the text of piStar files, by the URI the client sends as `sourceUri`. */
export interface PistarFiles {
  read(uri: string): MaybePromise<string>;
  write(uri: string, text: string): MaybePromise<void>;
}

/** Service identifier of the host's `PistarFiles`. */
export const PistarFiles: unique symbol = Symbol('PistarFiles');

/** `PistarFiles` over a map of URI → text (tests, a worker given its files up front). */
export function memoryPistarFiles(files: Map<string, string> = new Map()): PistarFiles {
  return {
    read(uri) {
      const text = files.get(uri);
      if (text === undefined) throw new Error(`no file "${uri}"`);
      return text;
    },
    write(uri, text) {
      files.set(uri, text);
    },
  };
}
