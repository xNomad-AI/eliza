// this file should only container external dependencies

import { elizaLogger } from '@elizaos/core';
import pino from 'pino';
import { Tasks } from '@xnomad/task-manager-cli'

export const Logger: pino.Logger<string, boolean> = elizaLogger.child({
  plugin: 'client-twitter',
  name: 'client-twitter',
});

const TASK_MANAGER_BASE_ENDPOINT = process.env.TASK_MANAGER_BASE_ENDPOINT;
export const taskManagerCli = new Tasks({
  baseURL: TASK_MANAGER_BASE_ENDPOINT!,
  headers: {
    'X-ADMIN-API-KEY': process.env.TASK_MANAGER_ADMIN_API_KEY!,
  }
});

export async function uploadErrorMessageToTaskManager(twitterUsername: string, agentId: string, error: Error) {
  try {
    await taskManagerCli.tasksControllerReportError(twitterUsername, {
      agentId,
      message: error.message,
    });
  } catch (e) {
    Logger.info(`failed uploadErrorMessageToTaskManager ${twitterUsername} ${agentId} ${e.message}`);
  }
}
