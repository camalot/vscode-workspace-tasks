import * as path from 'path';
import { TaskItem } from '../taskItem';

/**
 * Builds a stable workflow run identifier scoped by config file path and workflow name.
 */
export function getCircleCiWorkflowRunId(item: TaskItem): string | undefined {
  const workflowName = typeof item.metadata?.workflowName === 'string'
    ? item.metadata.workflowName
    : (item.originalLabel || item.label);

  const filePath = item.taskFileUri?.fsPath || item.resourceUri?.fsPath;
  if (!workflowName || !filePath) {
    return undefined;
  }

  const normalized = path.normalize(filePath);
  return `circleci@${normalized}::${workflowName}`;
}
