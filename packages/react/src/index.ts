export { IstarCanvas } from './IstarCanvas';
export type { LinkShape } from './canvas-options';
export type { IstarCanvasHandle, IstarCanvasProps, IstarFitViewOptions } from './IstarCanvas';
export { IstarPalette, paletteEntryFor, paletteSections, usePaletteControls } from './Palette';
export type {
  IstarPaletteProps,
  PaletteControl,
  PaletteControls,
  PaletteOrientation,
} from './Palette';
export { dependencyIcon, elementIcon, linkIcon } from './palette-icons';
export type { ElementIconOptions, LinkIconStyle } from './palette-icons';
export {
  IstarProvider,
  useDiagnosticsStore,
  useElementDiagnostics,
  useGoalDiagnostics,
  useIstarEditor,
  useIstarStore,
  useOptionalIstarEditor,
  useSelectedTarget,
  useStoreModel,
} from './context';
export type { IstarEditor, IstarProviderProps, Notice, Selection, Tool } from './context';
export {
  LINE_DASHES,
  applyExtensions,
  createRegistry,
  metamodelWithExtensions,
  registryForMetamodel,
  defaultNameFor,
  defaultPropertiesFor,
  defaultRegistry,
  elementSize,
} from './registry';
export type {
  ElementActions,
  ElementComponentProps,
  ElementKindConfig,
  ElementKindOverride,
  AnyIstarRegistry,
  InspectorProps,
  IstarExtension,
  LinkLabelProps,
  LinkLineStyle,
  IstarRegistry,
  LinkActions,
  LinkKindConfig,
  LinkKindOverride,
  ElementToolEntry,
  LinkToolEntry,
  PaletteEntry,
  PaletteGroup,
  RegistryOverrides,
} from './registry';
export {
  DefaultActorComponent,
  DefaultElementComponent,
  EditableLabel,
} from './default-components';
export type { EditableLabelProps } from './default-components';
export { ElementIssuesBadge, describeDiagnostic } from './ElementIssuesBadge';
export type { ElementIssuesBadgeProps } from './ElementIssuesBadge';
export { diagnosticToIssue, groupIssuesById, issueToDiagnostic, worstSeverity } from './issues';
// The diagnostics protocol lives in core; re-exported for hosts that only depend on react.
export {
  createDiagnosticsStore,
  fromLspDiagnostic,
  fromLspDiagnostics,
  fromNodeIdDiagnostic,
  fromNodeIdDiagnostics,
  groupDiagnostics,
  mergeDiagnostics,
  worstDiagnosticSeverity,
} from '@istar-ts/core';
export type {
  DiagnosticRange,
  DiagnosticSeverity,
  DiagnosticsStore,
  FromLspOptions,
  GoalDiagnostic,
  LspDiagnosticLike,
  NodeIdDiagnostic,
} from '@istar-ts/core';
export type { ElementIssue, IssueSeverity } from './issues';
export {
  ACTOR_RADIUS,
  ActorSymbol,
  DefaultNodeShape,
  GoalShape,
  PathShape,
  QUALITY_PATH,
  QualityShape,
  ResourceShape,
  TaskShape,
  shapeViewBox,
} from './shapes';
export type { ShapeProps, ShapeSpec } from './shapes';
export { pathBounds } from './svg-path';
export { FULL_TEXT_BOX, FittedLabel, LabelHeader, TEXT_BOXES, useFitText } from './label-fit';
export type { FittedLabelProps, LabelFit, TextBox } from './label-fit';
export type { PathBounds } from './svg-path';
export { OPEN_ARROW, resolveLinkStyle } from './edges';
export type { ResolvedLinkStyle } from './edges';
export { ACTOR_PADDING, actorBoundary, modelToFlow } from './layout';
export type { Box, FlowGraph } from './layout';
export {
  CommitText,
  CustomPropertiesEditor,
  DefaultElementInspector,
  DiagnosticList,
  DefaultLinkInspector,
  InspectorField,
  IstarInspector,
  PropertyField,
  useTypedProperties,
} from './Inspector';
export type {
  CommitTextProps,
  DiagnosticListProps,
  IstarInspectorProps,
  PropertyFieldProps,
} from './Inspector';
