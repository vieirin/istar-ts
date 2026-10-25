/**
 * Hosting the diagram module: what every launcher (`@istar-ts/glsp/browser`,
 * `@istar-ts/glsp/node`) builds its GLSP server from, and what a host binds itself. Platform
 * neutral: no transport here.
 */
import type { AnyIstarModel, PistarFile } from '@istar-ts/core';
import { createModelStore, parsePistar } from '@istar-ts/core';
import type { SaveModelAction } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { ServerModule } from '@eclipse-glsp/server';
import { ContainerModule } from 'inversify';
import type { IstarGlspContribution } from './contribution';
import { ISTAR_GLSP, paletteOf } from './contribution';
import { configureIstarDiagram } from './diagram-module';
import { PistarFiles } from './files';
import { IstarSharedModel } from './model-state';

/** What a launcher serves. */
export interface IstarGlspHostOptions {
  /** The diagrams the server offers, one diagram type each. Default `[ISTAR_GLSP]`. */
  readonly contributions?: readonly IstarGlspContribution[];
  /**
   * The host's model, shared by every session of `diagramType` (default: the first
   * contribution's): see `IstarSharedModel`. Without it each session has its own store, loaded
   * from `files` by `requestModel`'s `sourceUri`.
   */
  readonly shared?: IstarSharedModel & { readonly diagramType?: string };
  /** Where `requestModel` reads files and a session's own dispatcher saves them. */
  readonly files?: PistarFiles;
  /** Further modules for every diagram's session container (e.g. an MCP diagram module). */
  readonly diagramModules?: readonly ContainerModule[];
  /** Further modules for the server container (e.g. an MCP server module). */
  readonly modules?: readonly ContainerModule[];
}

/** The MCP server's options, on every launcher (`mcp` of `@istar-ts/glsp/node`'s and
 * `@istar-ts/glsp/browser`'s options). */
export interface IstarMcpBaseOptions {
  /** Default `/mcp`. */
  readonly route?: string;
  /** The MCP server's name. Default `istar-glsp`. */
  readonly name?: string;
}

/** Binds a host's `IstarSharedModel`, for a diagram's session containers or a whole server. */
export function bindIstarSharedModel(shared: IstarSharedModel): ContainerModule {
  const { store, dispatcher } = shared;
  return new ContainerModule((bind) => {
    bind(IstarSharedModel).toConstantValue({ store, dispatcher });
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
  });
  return { store, dispatcher };
}

function isModel(model: string | PistarFile | AnyIstarModel): model is AnyIstarModel {
  return typeof model === 'object' && 'elements' in model && model.elements instanceof Map;
}
