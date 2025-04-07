// admin-api-key.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { TASK_MANAGER_ADMIN_API_KEY } from '../constant.js';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  private readonly validApiKey?: string = TASK_MANAGER_ADMIN_API_KEY;

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();
    const apiKey = request.headers['X-ADMIN-API-KEY'.toLowerCase()] ?? request.headers['X-ADMIN-API-KEY'];

    if (this.validApiKey && apiKey !== this.validApiKey) {
      throw new UnauthorizedException('Invalid Admin API Key');
    }
    return true;
  }
}
