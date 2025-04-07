// functions about running a tasks

import pino from 'pino';

import { Logger, uploadErrorMessageToTaskManager } from '../settings/external.js';

async function runWithErrorHandling(
  name: string,
  logger: pino.Logger<string, boolean>,
  // if value is undefined, return the task status else set the task status
  taskStatusSetter: (value?: number) => number,
  handler: () => Promise<number | undefined>,
  errorHandler?: (error: Error) => Promise<void>,
  options: {
    // when error occurs, retry after this delay
    retryDelay?: number;
    checkInterval?: number;
    // for status check interval
    statusCheckInterval?: number;
  } = {}
) {
  logger.info(`${name} loop started`);
  const {
    retryDelay = 30 * 1000, // 30 seconds
    checkInterval = 60 * 1000, // 1 minute
    statusCheckInterval = 10000 // 10 second
  } = options;

  while (true) {
    let status = taskStatusSetter();
    if (status === 0) {
      break;
    }
    taskStatusSetter(1);

    try {
      const randomDelay = await handler();
      logger.debug(`${name} handler completed`);
      taskStatusSetter(2);

      const sleepTime = randomDelay !== undefined ? randomDelay : checkInterval;
      let remainingTime = sleepTime;

      // Break the sleep into smaller intervals
      while (remainingTime > 0) {
        status = taskStatusSetter();
        logger.debug(`${name} read status: ${status}`);
        if (status === 0) {
          logger.info(`${name} received stop signal during sleep`);
          break;
        }

        const currentWait = Math.min(statusCheckInterval, remainingTime);
        await new Promise(resolve => setTimeout(resolve, currentWait));
        remainingTime -= currentWait;
      }

      if (status === 0) {
        break;
      }
    } catch (error) {
      logger.error(`Error in ${name}: ${error}`);
      if (errorHandler) {
        await errorHandler(error as Error);
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  taskStatusSetter(4);
  logger.info(`${name} loop ended`);
}

/**
 * loop function with error handling
 * @param name function name to be used in logger
 * @param twitterUserName 
 * @param agentId 
 * @param taskStatusSetter if value is undefined, return the task status else set the task status
 * @param handler the function to be executed, the response mean the next interval
 * @param options retryDelay: when error occurs, retry after this delay
 */
export async function defaultRunWithErrorHandling(
  name: string,
  twitterUserName: string,
  agentId: string,
  taskStatusSetter: (value?: number) => number,
  handler: () => Promise<number | undefined>,
  options: {
    retryDelay?: number;
    checkInterval?: number;
  } = {}
) {
  const logger = Logger.child({
    name: `${name}-task_${twitterUserName}-${agentId}`,
  });
  const errorHandler = async (error: Error) => {
    await uploadErrorMessageToTaskManager(
      twitterUserName,
      agentId,
      error,
    )
  };

  await runWithErrorHandling(
    name,
    logger,
    taskStatusSetter,
    handler,
    errorHandler,
    options
  );
}
