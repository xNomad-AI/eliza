import { Controller, Put, Body, Logger, UseGuards, Post } from '@nestjs/common';
import { ApiBody, ApiHeader } from '@nestjs/swagger';

import { workerUuid } from '../constant.js';
import { AdminApiKeyGuard } from './tasks.guard.js';
import { TaskSettingsService } from './task-settings.service.js';
import { UpdateTaskSettingsDto } from './dto/task-settings.dto.js';

@ApiHeader({
  name: 'X-ADMIN-API-KEY',
  description: 'API Key needed to access this route',
  required: true,
})
@Controller('client-twitter/task-settings')
@UseGuards(AdminApiKeyGuard)
export class TaskSettingsController {
  private readonly logger = new Logger(`${TaskSettingsController.name}_${workerUuid}`);

  constructor(
    private readonly taskSettingsService: TaskSettingsService,
  ) {}

  @Post()
  @ApiBody({ 
    type: UpdateTaskSettingsDto,
    isArray: true
  })
  // @ApiCreatedResponse()
  async updateManagerSettings(
    @Body() updateTaskSettingsDto: UpdateTaskSettingsDto[]
  ) {
    // only insert the new settings, not update the existing ones, return the inserted count
    return this.taskSettingsService.upsertManagerSettings(updateTaskSettingsDto);
  }
}
