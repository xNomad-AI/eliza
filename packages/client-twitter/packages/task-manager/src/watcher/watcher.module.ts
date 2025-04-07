import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';

import { WatcherService } from './watcher.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { Task, TaskSchema } from '../tasks/schemas/task.schema.js';
import { MongodbLock, MongodbLockSchema } from './schemas/lock.schema.js';
import { MongodbLockService } from './lock.service.js';
// import { SharedModule } from '../shared/shared.module.js';
import { ClientTwitterService } from './client-twitter.service.js';

// @Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    MongooseModule.forFeature([{ name: MongodbLock.name, schema: MongodbLockSchema }]),
    // SharedModule
  ],
  providers: [WatcherService, TasksService, MongodbLockService, ClientTwitterService],
  exports: [WatcherService],
})
export class WatcherModule { }
