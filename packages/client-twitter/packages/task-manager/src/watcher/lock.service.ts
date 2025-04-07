import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { leaseTime, workerUuid } from '../constant.js';
import { MongodbLock } from './schemas/lock.schema.js';

@Injectable()
export class MongodbLockService {
  private readonly logger = new Logger(`${MongodbLockService.name}_${workerUuid}`);

  constructor(
    @InjectModel(MongodbLock.name) private readonly lockModel: Model<MongodbLock>
  ) { }

  async acquireLock(taskTitle: string): Promise<boolean> {
    const lockDoc: MongodbLock = {
      title: taskTitle,
      expiresAt: new Date(Date.now() + leaseTime),
      createdBy: workerUuid,
    };

    try {
      await this.lockModel.insertOne(lockDoc);
      this.logger.debug(`Lock acquired for task ${taskTitle}`);
      return true;
    } catch (err: any) {
      if (err.code === 11000) {
        const currentLock = await this.lockModel.findOne({ title: taskTitle });
        if (currentLock && currentLock.expiresAt < new Date()) {
          await this.lockModel.deleteOne({ title: taskTitle });
          return await this.acquireLock(taskTitle);
        }
        return false;
      }

      this.logger.error(`Failed to acquire lock for task ${taskTitle}`, err);
      return false;
    }
  }

  async renewLock(taskTitle: string): Promise<boolean> {
    const result = await this.lockModel.updateOne(
      {
        title: taskTitle,
        expiresAt: { $lt: new Date() }
      },
      { $set: { expiresAt: new Date(Date.now() + leaseTime) } }
    );

    if (result.modifiedCount === 0) {
      this.logger.warn(`Failed to renew lock for task ${taskTitle}`);
    }

    return result.modifiedCount === 1;
  }

  async releaseLock(taskTitle: string): Promise<boolean> {
    const result = await this.lockModel.deleteOne({
      title: taskTitle,
      createdBy: workerUuid,
      expiresAt: { $gt: new Date() }
    });
    this.logger.debug(`Lock released for task ${taskTitle}`);

    if (result.deletedCount === 0) {
      this.logger.error(`Failed to release lock for task ${taskTitle}`);
    }

    return result.deletedCount === 1;
  }
}
