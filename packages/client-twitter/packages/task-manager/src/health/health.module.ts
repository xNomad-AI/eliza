import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { HealthController } from './health.controller.js';
import { Task, TaskSchema } from '../tasks/schemas/task.schema.js';
import { DebugService } from './debug.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
  ],
  controllers: [HealthController],
  providers: [DebugService]
})
export class HealthModule {}
