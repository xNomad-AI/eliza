import { Client, type IAgentRuntime } from '@elizaos/core';
import assert from 'assert';
import { Tasks } from '@xnomad/task-manager-cli'
import { Logger } from '@nestjs/common';
import { TwitterConfig, validateTwitterConfig } from '@elizaos/client-twitter'
import { TaskActionName } from '@xnomad/task-manager-cli';

import { SHARED_SERVICE } from './shared.service.js';
import { taskManagerBaseEndpoint } from '../constant.js';
import { autoFixTwitterUsername, getTaskTitle } from '../tasks/schemas/task.schema.js';

function initTaskCli() {
  const task = new Tasks({
    baseURL: taskManagerBaseEndpoint,
    headers: {
      'X-ADMIN-API-KEY': process.env.TASK_MANAGER_ADMIN_API_KEY!,
    }
  });
  return task;
}

const task = initTaskCli();

// should be only run once, each agent should using one instance of this class
export class TwitterClientStarter implements Client {
  private runtime: IAgentRuntime;
  private logger = new Logger(TwitterClientStarter.name);
  private agentId: string;
  private twitterUsername: string;

  constructor(private nftId: string) { }

  // one loop to start all actions, so that can easy stop the client
  async start(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.agentId = runtime.agentId;

    const twitterConfig: TwitterConfig = await validateTwitterConfig(runtime);
    assert(twitterConfig.TWITTER_USERNAME, 'TWITTER_USERNAME is required');
    twitterConfig.TWITTER_USERNAME = autoFixTwitterUsername(twitterConfig.TWITTER_USERNAME);
    this.twitterUsername = twitterConfig.TWITTER_USERNAME;
    if (runtime?.character?.settings?.secrets?.TWITTER_USERNAME) {
      runtime.character.settings.secrets.TWITTER_USERNAME = autoFixTwitterUsername(this.twitterUsername);
    }

    const title = getTaskTitle(this.twitterUsername, this.nftId);
    // inject the runtime to the task manager
    if (SHARED_SERVICE.taskRuntime.has(title)) {
      this.logger.debug(`waiting ${title} for previous task to be stopped`);
      const preRuntime = SHARED_SERVICE.taskRuntime.get(title)!;
      await this.stop(preRuntime);
      this.logger.warn(`task ${title} runtime already exists, will be replaced`);
    }
    SHARED_SERVICE.setTaskRuntime(title, runtime);

    await task.tasksControllerCreateTask({
      title,
      action: TaskActionName.Start,
      configuration: twitterConfig as any,
      agentId: this.agentId,
      nftId: this.nftId,
    });
    return this;
  }

  async stop(runtime?: IAgentRuntime) {
    const title = getTaskTitle(this.twitterUsername, this.nftId);
    if (!SHARED_SERVICE.taskRuntime.has(title)) {
      SHARED_SERVICE.setTaskRuntime(title, runtime ?? this.runtime);
    }

    await task.tasksControllerStopTask(title);
  }
};
