import type { GoalDiagnostic, IstarElement, IstarModel } from '@istar-ts/core';
import { defineProperties, fromNodeIdDiagnostics, prop } from '@istar-ts/core';
import type { ElementComponentProps, IstarExtension } from '@istar-ts/react';
import { DefaultElementComponent, useTypedProperties } from '@istar-ts/react';
import type { ReactElement } from 'react';

/**
 * MutRoSe-shaped playground extension: GoalType / task Location+Params schemas, GoalType
 * coloring, G#/AT# naming, and a trimmed palette. LSP-style diagnostics are demonstrated via the
 * canvas `diagnostics` prop in App — not hardcoded here.
 *
 * Nothing here is part of @istar-ts/*; it only uses the public extension API.
 */

const GOAL_TYPES = ['Perform', 'Achieve', 'Query'] as const;

export const mutroseGoalProperties = defineProperties('istar.Goal', {
  Description: prop.string({ default: '', label: 'Description' }),
  GoalType: prop.enum([...GOAL_TYPES], { default: 'Perform', label: 'Goal type' }),
  QueriedProperty: prop.string({ label: 'Queried property' }),
  AchieveCondition: prop.string({ label: 'Achieve condition' }),
  Controls: prop.string({ label: 'Controls' }),
  Monitors: prop.string({ label: 'Monitors' }),
  Group: prop.string({ label: 'Group' }),
});

export const mutroseTaskProperties = defineProperties('istar.Task', {
  Description: prop.string({ default: '', label: 'Description' }),
  Location: prop.string({ label: 'Location' }),
  Params: prop.string({ label: 'Params' }),
});

function nextNumber(model: IstarModel, prefix: RegExp): number {
  let max = 0;
  for (const el of model.elements.values()) {
    const match = el.name.match(prefix);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function GoalNode(props: ElementComponentProps): ReactElement {
  const { values } = useTypedProperties(mutroseGoalProperties, props.element, props.actions);
  const goalType = String(values.GoalType ?? 'Perform');
  return (
    <div className="pg-mutrose-goal" data-goal-type={goalType}>
      <DefaultElementComponent {...props} />
    </div>
  );
}

function TaskNode(props: ElementComponentProps): ReactElement {
  return (
    <div className="pg-mutrose-task">
      <DefaultElementComponent {...props} />
    </div>
  );
}

export const mutroseExtension: IstarExtension = {
  name: 'mutrose',
  elements: {
    'istar.Goal': {
      component: GoalNode,
      properties: mutroseGoalProperties,
      defaultName: ({ model }) => `G${nextNumber(model, /^G(\d+)/)}: New Goal`,
    },
    'istar.Task': {
      component: TaskNode,
      properties: mutroseTaskProperties,
      defaultName: ({ model }) => `AT${nextNumber(model, /^AT(\d+)/)}: New Task`,
    },
    'istar.Quality': { palette: false },
    'istar.Resource': { palette: false },
    'istar.Agent': { palette: false },
    'istar.Role': { palette: false },
  },
  links: {
    'istar.IsALink': { palette: false },
    'istar.ParticipatesInLink': { palette: false },
    'istar.DependencyLink': { palette: false },
    'istar.ContributionLink': { palette: false },
    'istar.NeededByLink': { palette: false },
    'istar.QualificationLink': { palette: false },
  },
};

export const mutroseSchemas = [mutroseGoalProperties, mutroseTaskProperties];

/** Demo LSP-style issues for the first goal in a model (playground only). */
export function demoDiagnosticsFor(model: IstarModel<string, string>): GoalDiagnostic[] {
  const goal = [...model.elements.values()].find(
    (el: IstarElement<string>) => el.kind === 'istar.Goal',
  );
  const link = [...model.links.values()][0];
  // What MutRoSe's VS Code extension posts to its webview, through the one-line adapter.
  return fromNodeIdDiagnostics([
    ...(goal
      ? [
          {
            nodeId: goal.id,
            severity: 'warning',
            message: 'Query goals should declare QueriedProperty',
            source: 'mutrose',
          },
          {
            nodeId: goal.id,
            key: 'QueriedProperty',
            severity: 'error',
            message: 'expected an OCL expression',
            source: 'mutrose',
          },
        ]
      : []),
    ...(link
      ? [{ nodeId: link.id, severity: 'info', message: 'Demo: link diagnostic', source: 'demo' }]
      : []),
  ]);
}
