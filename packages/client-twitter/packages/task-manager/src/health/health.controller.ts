import { Controller, Get } from '@nestjs/common';

import { DebugService } from './debug.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly debugService: DebugService
  ) {}

  @Get()
  checkHealth() {
    return { status: 'healthy' };
  }

  @Get("/debug")
  async debug() {
    await this.debugService.debug();
    return { status: 'debug' };
  }
}
