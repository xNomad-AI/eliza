import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Task, TaskActionName, TaskStatusName } from './schemas/task.schema.js';
import { taskTimeout } from '../constant.js';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>
  ) { }

  async create(createTask: Task): Promise<Task> {
    const createdTask = new this.taskModel(createTask);
    return createdTask.save();
  }

  async update(id: string, updateTask: Partial<Task>): Promise<Task | null> {
    updateTask.updatedAt = new Date();
    return this.taskModel.findByIdAndUpdate(id, updateTask, { new: true });
  }

  async updateByTitle(title: string, updateTask: Partial<Task>): Promise<Task | null> {
    updateTask.updatedAt = new Date();
    return this.taskModel.findOneAndUpdate({ title }, updateTask, { new: true });
  }

  async updateTaskRunningSignalByTitle(title: string, signal: keyof Task['runningSignal'], value: boolean) {
    return this.taskModel.updateOne({ title }, {
      $set: {
        [`runningSignal.${signal}`]: value,
        updatedAt: new Date(),
      }
    });
  }

  async getTask(id: string): Promise<Task | null> {
    return this.taskModel.findById(id).exec();
  }

  async getTasksGroupbyHttpProxy(): Promise<Map<string, Task[]>> {
    const tasks = await this.taskModel.find();
    const map = new Map<string, Task[]>();
    tasks.forEach(task => {
      const proxy = task.configuration.TWITTER_HTTP_PROXY;
      if (!proxy) {
        return;
      }

      if (!map.has(proxy)) {
        map.set(proxy, []);
      }
      map.get(proxy)?.push(task);
    });
    return map;
  }

  async getTaskByTitle(title: string): Promise<Required<Task> | null> {
    return this.taskModel.findOne({ title });
  }

  async getTaskByTwitterUserName(twitterUserName: string): Promise<Required<Task[]>> {
    return this.taskModel.find({ 'configuration.TWITTER_USERNAME': twitterUserName });
  }

  async getTaskByAgentId(agentId: string): Promise<Required<Task> | null> {
    return this.taskModel.findOne({ agentId });
  }

  async getTaskByNftId(nftId: string): Promise<Required<Task> | null> {
    return this.taskModel.findOne({ nftId });
  }

  async getTaskByTwitterUserNameAndAgentId(
    twitterUserName: string,
    agentId: string
  ): Promise<Required<Task> | null> {
    return this.taskModel.findOne({
      'configuration.TWITTER_USERNAME': twitterUserName,
      agentId,
    });
  }

  async getTaskByTitles(titles: string[]): Promise<Task[]> {
    const tasks = await this.taskModel.find({ title: { $in: titles } });
    return tasks;
  }

  async startTask(id: string): Promise<Task | null> {
    return this.update(id, { action: 'start' });
  }

  async stopTask(title: string): Promise<Task | null> {
    return this.updateByTitle(title, { action: 'stop' });
  }

  async restartTask(id: string): Promise<Task | null> {
    return this.update(id, { action: 'restart' });
  }

  async getNewTasks(): Promise<Task[]> {
    const query = {
      $or: [
        // get the task require to start
        { action: TaskActionName.START, status: TaskStatusName.STOPPED },
        // get the timeout task
        { updatedAt: { $lt: new Date(Date.now() - taskTimeout) }, status: TaskStatusName.RUNNING },
      ]
    };
    let tasks = await this.taskModel.find(query);
    // remove the task that is paused and tagged as failed
    tasks = tasks.filter(task => {
      // pauseUntil
      if (task.pauseUntil && task.pauseUntil > new Date()) {
        return false;
      }
      if (task.runningSignal.startFailedForMultipleTimes) return false;
      return true;
    });

    return tasks;
  }
}
