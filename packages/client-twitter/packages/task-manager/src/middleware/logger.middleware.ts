import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl } = req;
    // res.on('finish', () => {
    //   const { statusCode } = res;
    //   this.logger.debug(`${method} ${originalUrl} ${statusCode}`);
    // });
    next();
    this.logger.debug(`${method} ${originalUrl} ${res.statusCode}`);
  }
}
