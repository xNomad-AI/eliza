import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { lockMongodbCollectionName } from '../../constant.js';

@Schema({ collection: lockMongodbCollectionName })
export class MongodbLock {
  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String })
  createdBy: string;

  @Prop({ type: Date})
  expiresAt: Date;
}

export const MongodbLockSchema = SchemaFactory.createForClass(MongodbLock);

MongodbLockSchema.index({ title: 1 }, { unique: true });
MongodbLockSchema.index({ expiresAt: 1 });
