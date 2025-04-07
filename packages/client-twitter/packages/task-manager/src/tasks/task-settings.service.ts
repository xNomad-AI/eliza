import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';

import { TaskSettings } from './schemas/task-settings.schema.js';
import { UpdateTaskSettingsDto } from './dto/task-settings.dto.js';
import { TasksService } from './tasks.service.js';

@Injectable()
export class TaskSettingsService {
  private logger = new Logger(TaskSettingsService.name);

  constructor(
    @InjectModel(TaskSettings.name) private readonly taskSettingsModel: Model<TaskSettings>,
    private readonly tasksService: TasksService,
  ) { }

  async upsertManagerSettings(proxies: UpdateTaskSettingsDto[]) {
    const httpProxies: string[] = proxies.map((proxy) => {
      const username = proxy.username;
      const password = proxy.password;
      return `http://${username}:${password}@${proxy.entryPoint}:${proxy.port}`;
    });

    const existingProxies = await this.taskSettingsModel.find({
      'value.httpProxy': { $in: httpProxies },
    });
    const existingHttpProxies = existingProxies.map(
      (proxy) => proxy.value.httpProxy,
    );

    const insertedDocs: TaskSettings[] = [];
    for (const proxy of proxies) {
      const username = proxy.username;
      const password = proxy.password;
      const httpProxy = `http://${username}:${password}@${proxy.entryPoint}:${proxy.port}`;

      if (!existingHttpProxies.includes(httpProxy)) {
        insertedDocs.push({
          category: 'httpProxy',
          value: {
            product: 'datacenterProxies',
            username,
            password,
            // example.com
            entryPoint: proxy.entryPoint,
            // 8001
            port: proxy.port.toString(),
            country: proxy.countryCode,
            assignedIP: proxy.ip,
            httpProxy: `http://${username}:${password}@${proxy.entryPoint}:${proxy.port}`,
            // how many agent using this proxy
            count: 0,
          },
        });
      }
    }

    await this.taskSettingsModel.insertMany(insertedDocs);
    return insertedDocs.length;
  }

  async randomGetHttpProxy() {
    const HTTP_PROXY_MAX_USERS = 2;

    const proxies = await this.taskSettingsModel
      .find({
        category: 'httpProxy',
        'value.product': 'datacenterProxies',
        'value.count': { $lt: HTTP_PROXY_MAX_USERS },
      })
      .sort({ 'value.count': 1 })
      .limit(1);

    if (proxies.length !== 0) {
      const proxy = proxies[0].value.httpProxy;
      await this.increaseHttpProxyCount(proxy);
      return proxy;
    }
  }

  async increaseHttpProxyCount(httpProxy: string) {
    await this.taskSettingsModel.updateOne(
      { 'value.httpProxy': httpProxy },
      { $inc: { 'value.count': 1 } },
    );
  }

  // interval update the count from running tasks, every weak is ok
  @Cron(CronExpression.EVERY_WEEK)
  // @Cron(CronExpression.EVERY_10_SECONDS)
  async updateHttpProxyUsage() {
    this.logger.debug(`start updateHttpProxyUsage`);

    const groupedTasks = await this.tasksService.getTasksGroupbyHttpProxy();
    for (const [httpProxy, tasks] of groupedTasks) {
      await this.taskSettingsModel.updateOne(
        { 'value.httpProxy': httpProxy },
        { $set: { 'value.count': tasks.length } },
      );
    }

    this.logger.debug(`end updateHttpProxyUsage, updated ${groupedTasks.size} proxies`);
  }
}
