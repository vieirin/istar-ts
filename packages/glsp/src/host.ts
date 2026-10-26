/**
 * Hosting the diagram module: what every launcher (`@istar-ts/glsp/browser`,
 * `@istar-ts/glsp/node`) builds its GLSP server from, and what a host binds itself. Platform
 * neutral: no transport here.
 */
import type { AnyIstarModel, PistarFile } from '@istar-ts/core';
import { createModelStore, parsePistar } from '@istar-ts/core';
import type { SaveModelAction } from '@istar-ts/actions';
import { createActionDispatcher, withDirtyState } from '@istar-ts/actions';
import { ServerModule } from '@eclipse-glsp/server';
import { ContainerModule } from 'inversify';
import type { IstarGlspContribution } from './contribution';
import { ISTAR_GLSP, paletteOf } from './contribution';
import { configureIstarDiagram } from './diagram-module';
import { PistarFiles } from './files';
import type { IstarMcpHostExtensions } from './mcp-host';
import { IstarSharedModel } from './model-state';
import type { IstarSharedModelSource } from './model-state';

export type { IstarMcpHostExtensions } from './mcp-host';

/** What a launcher serves. */
export interface IstarGlspHostOptions {
  /** The diagrams the server offers, one diagram type each. Default `[ISTAR_GLSP]`. */
  readonly contributions?: readonly IstarGlspContribution[];
  /**
   * The host's model, shared by every session of `diagramType` (default: the first
   * contribution's): see `IstarSharedModel`. Without it each session has its own store, loaded
   * from `files` by `requestModel`'s `sourceUri`. Any `ActionDispatcher` will do (#249): see
   * `IstarSharedModelSource`.
   */
  readonly shared?: IstarSharedModelSource & { readonly diagramType?: string };
  /** Where `requestModel` reads files and a session's own dispatcher saves them. */
  readonly files?: PistarFiles;
  /** Further modules for every diagram's session container (e.g. an MCP diagram module). */
  readonly diagramModules?: readonly ContainerModule[];
  /** Further modules for the server container (e.g. an MCP server module). */
  readonly modules?: readonly ContainerModule[];
}

/**
 * The MCP server's options, on every launcher (`mcp` of `@istar-ts/glsp/node`'s and
 * `@istar-ts/glsp/browser`'s options), the host's `hostTools` and `context` (#175) included.
 */
export interface IstarMcpBaseOptions extends IstarMcpHostExtensions {
  /** Default `/mcp`. */
  readonly route?: string;
  /** The MCP server's name. Default `istar-glsp`. */
  readonly name?: string;
  /**
   * How server-mcp serves resources (a `context` provider, say): `'tools'` (its default) lists
   * each as a read-only tool of its name, `'resources'` as MCP resources.
   */
  readonly dataMode?: 'tools' | 'resources';
}

/** What `initialize`'s `mcpServer` carries for `options` (`withMcpServer`), defaults applied. */
export function mcpServerConfig(options: IstarMcpBaseOptions): {
  route: string;
  name: string;
  options?: { dataMode: 'tools' | 'resources' };
} {
  return {
    route: options.route ?? '/mcp',
    name: options.name ?? 'istar-glsp',
    ...(options.dataMode ? { options: { dataMode: options.dataMode } } : {}),
  };
}

/**
 * Binds a host's `IstarSharedModel`, for a diagram's session containers or a whole server. A
 * dispatcher without `isDirty` is adapted (`withDirtyState`) once, here, for every session.
 */
export function bindIstarSharedModel(shared: IstarSharedModelSource): ContainerModule {
  const store = shared.store;
  const dispatcher = withDirtyState(shared.dispatcher);
  return new ContainerModule((bind) => {
    bind(IstarSharedModel).toConstantValue({ store, dispatcher } satisfies IstarSharedModel);
  });
}

/**
 * The server module with every contribution's diagram, and the host modules to load next to it
 * (`files`, then `modules`): what a GLSP launcher's `configure(serverModule, ...modules)` takes.
 */
export function createIstarServerModules(options: IstarGlspHostOptions = {}): {
  serverModule: ServerModule;
  modules: ContainerModule[];
} {
  const contributions = options.contributions ?? [ISTAR_GLSP];
  const sharedType = options.shared?.diagramType ?? contributions[0]?.diagramType;
  const serverModule = new ServerModule();
  for (const contribution of contributions) {
    const modules = [...(options.diagramModules ?? [])];
    if (options.shared && contribution.diagramType === sharedType) {
      modules.push(bindIstarSharedModel(options.shared));
    }
    configureIstarDiagram(serverModule, contribution, ...modules);
  }
  const modules = [...(options.modules ?? [])];
  const files = options.files;
  if (files) {
    modules.unshift(new ContainerModule((bind) => bind(PistarFiles).toConstantValue(files)));
  }
  return { serverModule, modules };
}

/** How `createIstarSharedModel` starts. */
export interface IstarSharedModelOptions {
  /** The model: piStar text, a parsed piStar file, or a model. Default: an empty one. */
  readonly model?: string | PistarFile | AnyIstarModel;
  /** Writes the file for `saveModel` (the dispatcher's `save`). Without it, saving is rejected. */
  readonly save?: (file: PistarFile, action: SaveModelAction) => void | Promise<void>;
  /** `sourceModelChanged`'s `sourceModelName`, e.g. the file name. */
  readonly sourceModelName?: string;
  /** The dispatcher's `sendModel`: every `sourceModelChanged` carries the new model. */
  readonly sendModel?: boolean;
}

/**
 * A store and dispatcher for a contribution, set up as a session's own would be (its metamodel,
 * palette and property schemas): the model a launcher shares when the host has none of its own.
 * A host that already has a store (a React Flow canvas's) passes that instead.
 */
export function createIstarSharedModel(
  contribution: IstarGlspContribution,
  options: IstarSharedModelOptions = {},
): IstarSharedModel {
  const { model } = options;
  const parsed =
    model === undefined || isModel(model)
      ? model
      : parsePistar(model, {
          metamodel: contribution.metamodel,
          fileMetamodel: contribution.fileMetamodel ?? true,
        });
  const store = parsed
    ? createModelStore(parsed)
    : createModelStore(undefined, { metamodel: contribution.metamodel });
  const dispatcher = createActionDispatcher(store, {
    palette: paletteOf(contribution),
    ...(contribution.schemas ? { schemas: contribution.schemas } : {}),
    ...(options.save ? { save: options.save } : {}),
    ...(options.sourceModelName === undefined ? {} : { sourceModelName: options.sourceModelName }),
    ...(options.sendModel ? { sendModel: true } : {}),
  });
  return { store, dispatcher };
}

function isModel(model: string | PistarFile | AnyIstarModel): model is AnyIstarModel {
  return typeof model === 'object' && 'elements' in model && model.elements instanceof Map;
}
