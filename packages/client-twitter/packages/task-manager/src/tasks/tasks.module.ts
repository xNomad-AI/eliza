import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TaskSchema, Task } from './schemas/task.schema.js';
import { TaskSettingsSchema, TaskSettings } from './schemas/task-settings.schema.js';
import { TaskSettingsService } from './task-settings.service.js';
import { TaskSettingsController } from './task-settings.controller.js';
import { WatcherModule } from '../watcher/watcher.module.js';
// import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    MongooseModule.forFeature([{ name: TaskSettings.name, schema: TaskSettingsSchema }]),
    WatcherModule
    // SharedModule
  ],
  controllers: [TasksController, TaskSettingsController],
  providers: [TasksService, TaskSettingsService],
  exports: [TasksService],
})
export class TasksModule { }
