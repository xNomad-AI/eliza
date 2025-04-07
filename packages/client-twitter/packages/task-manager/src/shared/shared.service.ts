import { Logger } from '@nestjs/common';
import { type IAgentRuntime } from '@elizaos/core';

import { workerUuid } from '../constant.js';
import { Task } from '../tasks/schemas/task.schema.js';

export class SharedService {
  private readonly logger = new Logger(`${SharedService.name}_${workerUuid}`);
  // task.title -> task
  tasks: Map<string, Task> = new Map();
  // task.title -> runtime
  taskRuntime: Map<string, IAgentRuntime> = new Map();

  constructor(
  ) { }

  /**
   * inject task runtime to watcher service
   * @param taskTitle task title
   * @param runtime client twitter's runtime
   */
  async setTaskRuntime(taskTitle: string, runtime: IAgentRuntime) {
    if (this.taskRuntime.has(taskTitle)) {
      this.logger.warn(`task ${taskTitle} runtime already exists`);
    }
    this.taskRuntime.set(taskTitle, runtime);
  }
}

export const SHARED_SERVICE = new SharedService();
