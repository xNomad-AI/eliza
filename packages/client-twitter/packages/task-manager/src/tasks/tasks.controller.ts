import { Controller, Post, Put, Param, Body, BadRequestException, Logger, UseGuards, Get } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader } from '@nestjs/swagger';
import { TwitterClient } from '@elizaos/client-twitter';

import { TasksService } from './tasks.service.js';
import { CreateTaskDto, ErrorReportDto, TaskResponseDto, UpdateTaskDto } from './dto/task.dto.js';
import { autoFixTwitterUsername, Task, TaskStatusName } from './schemas/task.schema.js';
import { workerUuid } from '../constant.js';
import { SHARED_SERVICE } from '../shared/shared.service.js';
import { AdminApiKeyGuard } from './tasks.guard.js';
import { TaskSettingsService } from './task-settings.service.js';
import { WatcherService } from '../watcher/watcher.service.js';

interface ErrorCacheConfig {
  maxLength: number;
  timeoutMs: number;
  updateIntervalMs: number; // Minimum interval between DB updates
}

interface ErrorEntry {
  message: string;
  timestamp: number;
}

class ErrorCacheService {
  private cache: Map<string, ErrorEntry[]> = new Map();
  private lastUpdateTime: Map<string, number> = new Map();
  private config: ErrorCacheConfig = {
    maxLength: 10,
    timeoutMs: 16 * 1000, // 16 sec timeout
    updateIntervalMs: 15 * 1000 // 15 seconds between updates
  };

  addError(taskTitle: string, errorMessage: string): boolean {
    if (!this.cache.has(taskTitle)) {
      this.cache.set(taskTitle, []);
    }

    const errors = this.cache.get(taskTitle)!;
    const now = Date.now();
    const lastUpdate = this.lastUpdateTime.get(taskTitle) || 0;

    // Clean up old errors but keep errors within the time window
    const recentErrors = errors.filter(
      error => now - error.timestamp < this.config.timeoutMs
    );

    // Add new error
    recentErrors.push({ message: errorMessage, timestamp: now });
    this.cache.set(taskTitle, recentErrors);

    // Check if we should trigger an update based on:
    // 1. Enough time has passed since last update
    // 2. Have enough errors accumulated
    return (now - lastUpdate >= this.config.updateIntervalMs && recentErrors.length > 0) || 
           recentErrors.length >= this.config.maxLength;
  }

  getAggregatedErrors(taskTitle: string): ErrorEntry | null {
    const errors = this.cache.get(taskTitle);
    if (!errors || errors.length === 0) return null;

    const now = Date.now();
    this.lastUpdateTime.set(taskTitle, now);

    // Get all errors within the time window
    const timeWindowErrors = errors.filter(
      error => now - error.timestamp < this.config.timeoutMs
    );

    if (timeWindowErrors.length === 0) {
      this.cache.delete(taskTitle);
      return null;
    }

    // Aggregate errors into a single message
    // Limit to the last 10 errors for aggregation
    const aggregatedMessage = timeWindowErrors.slice(timeWindowErrors.length - 10)
      .map(error => `[${new Date(error.timestamp).toISOString()}] ${error.message}`)
      .join('\n');

    // Clear cache after aggregating
    this.cache.delete(taskTitle);

    return {
      message: aggregatedMessage,
      timestamp: now
    };
  }
}

@ApiHeader({
  name: 'X-ADMIN-API-KEY',
  description: 'API Key needed to access this route',
  required: true,
})
@Controller('client-twitter/tasks')
@UseGuards(AdminApiKeyGuard)
export class TasksController {
  private readonly logger = new Logger(`${TasksController.name}_${workerUuid}`);
  private errorCacheService = new ErrorCacheService();
  private sharedService = SHARED_SERVICE;

  constructor(
    private readonly tasksService: TasksService,
    private readonly taskSettingsService: TaskSettingsService,
    private watcherService: WatcherService,
  ) { }

  @Post()
  @ApiCreatedResponse({
    type: TaskResponseDto,
    description: 'will full nested object for example configuration, so you should be careful when using this',
  })
  async createTask(
    @Body() createTaskDto: CreateTaskDto
  ) {
    if (createTaskDto.configuration?.TWITTER_USERNAME) {
      createTaskDto.configuration.TWITTER_USERNAME = autoFixTwitterUsername(
        createTaskDto.configuration.TWITTER_USERNAME
      );
    }

    const task: Task = {
      title: createTaskDto.title,
      agentId: createTaskDto.agentId,
      nftId: createTaskDto.nftId,
      action: createTaskDto.action,
      description: createTaskDto.description || '',
      configuration: createTaskDto.configuration || {},
      status: TaskStatusName.STOPPED,
      createdAt: new Date(),
      updatedAt: new Date(),
      eventUpdatedAt: new Date(),
      createdBy: workerUuid,
      tags: [],
      runningSignal: {
        startFailedForMultipleTimes: false,
      }
    };

    if (!this.sharedService.taskRuntime.get(task.title)) {
      this.logger.warn(`task ${task.title} runtime not found`);
      // http 400 error
      throw new BadRequestException(`task ${task.title} runtime not found`);
    }

    const dbTask = await this.tasksService.getTaskByTitle(task.title);
    if (dbTask) {
      // if task already exists, update it
      this.logger.warn(`task ${task.title} already exists, update it`);
      if (!dbTask.configuration.TWITTER_HTTP_PROXY) {
        const proxy = await this.taskSettingsService.randomGetHttpProxy();
        if (!proxy) {
          this.logger.error('no http proxy found');
        } else {
          dbTask.configuration.TWITTER_HTTP_PROXY = proxy;
        }
      }

      // using the old http proxy
      if (createTaskDto.configuration && dbTask.configuration.TWITTER_HTTP_PROXY) {
        createTaskDto.configuration.TWITTER_HTTP_PROXY = dbTask.configuration.TWITTER_HTTP_PROXY;
      }
      return await this.updateTask(dbTask.id, createTaskDto);
    } else {
      if (!task.configuration.TWITTER_HTTP_PROXY) {
        const proxy = await this.taskSettingsService.randomGetHttpProxy();
        if (!proxy) {
          this.logger.error('no http proxy found');
        } else {
          task.configuration.TWITTER_HTTP_PROXY = proxy;
        }
      }
    }

    const createdTask = await this.tasksService.create(task);
    this.watcherService.createTask(createdTask);

    return createdTask;
  }

  @Post(':title/stop')
  @ApiCreatedResponse({
    type: TaskResponseDto,
  })
  async stopTask(
    @Param('title') title: string
  ) {
    const task = await this.tasksService.stopTask(title);
    if (!task) {
      // http 400 error
      throw new BadRequestException('the task not exists');
    }

    if (!this.sharedService.taskRuntime.get(task.title)) {
      this.logger.warn(`task ${task.title} runtime not found`);
      // http 400 error
      throw new BadRequestException(`task ${task.title} runtime not found`);
    }

    this.watcherService.stopTask(task);

    return task;
  }

  @Post('/agent/:agentId/stop')
  @ApiCreatedResponse({
    type: TaskResponseDto,
  })
  async stopTaskByAgentId(
    @Param('agentId') agentId: string
  ) {
    const task = await this.tasksService.getTaskByAgentId(agentId);
    if (!task) {
      // http 400 error
      throw new BadRequestException('the task not exists');
    }

    TwitterClient.stopByAgentId(agentId);
    return { 'message': 'stopping the client' };
  }

  @Post(':twitterUserName/report/suspended')
  @ApiCreatedResponse({
    type: TaskResponseDto,
  })
  async suspendedTask(
    @Param('twitterUserName') twitterUserName: string
  ) {
    // TODO using getTaskByTwitterUserNameAndAgentId
    // pause the task for 4 hours
    const tasks = await this.tasksService.getTaskByTwitterUserName(twitterUserName);
    if (tasks.length === 0) {
      throw new BadRequestException('the task not exists');
    }

    const ret: (Task | null)[] = [];

    for (const task of tasks) {
      let tags: Task['tags'] = ['suspended'];
      if (task.tags.includes('suspended')) {
        tags = [...task.tags];
      } else {
        tags = [...task.tags, 'suspended'];
      }
      const resp = await this.tasksService.updateByTitle(
        // 4h
        task.title, { tags, pauseUntil: new Date(Date.now() + 1000 * 60 * 60 * 4) }
      );
      ret.push(resp);
    }

    return ret;
  }

  @Put(':id')
  @ApiCreatedResponse({
    type: TaskResponseDto,
  })
  async updateTask(
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto
  ) {
    const task: Partial<Task> = {
      ...updateTaskDto,
      runningSignal: {
        startFailedForMultipleTimes: false,
      }
    };
    const updatedTask = await this.tasksService.update(id, task);
    if (!updatedTask) {
      // http 400 error
      throw new BadRequestException('the task not exists');
    }

    if (!this.sharedService.taskRuntime.get(updatedTask.title)) {
      this.logger.warn(`task ${updatedTask.title} runtime not found`);
      // http 400 error
      throw new BadRequestException(`task ${updatedTask.title} runtime not found`);
    }

    this.watcherService.updateTask(updatedTask);
    return updatedTask;
  }

  @Get(':title/status')
  @ApiCreatedResponse({
    type: TaskResponseDto,
  })
  async getTask(@Param('title') title: string) {
    const ret = await this.tasksService.getTaskByTitle(title);
    if (!ret) {
      // http 400 error
      throw new BadRequestException('the task not exists');
    }

    return ret;
  }

  @Post(':twitterUserName/report/error')
  @ApiCreatedResponse({
    type: TaskResponseDto,
    description: 'Returns the task with updated error information',
  })
  async reportError(
    @Param('twitterUserName') twitterUserName: string,
    @Body() body: ErrorReportDto
  ) {
    const task = await this.tasksService.getTaskByTwitterUserNameAndAgentId(twitterUserName, body.agentId);
    if (!task) {
      throw new BadRequestException('the task not exists');
    }

    const shouldUpdate = this.errorCacheService.addError(task.title, body.message);

    if (shouldUpdate) {
      const latestError = this.errorCacheService.getAggregatedErrors(task.title);
      if (latestError) {
        const updatedTask = await this.tasksService.updateByTitle(task.title, {
          lastError: {
            message: latestError.message,
            updatedAt: new Date(latestError.timestamp),
          },
        });

        return updatedTask;
      }
    }

    return task;
  }
}
