import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { TASK_MONGODB_SETTINGS_COLLECTION_NAME } from '../../constant.js';

export enum TaskSettingsCategoryName {
  HTTPPROXY = 'httpProxy',
}
export type TaskSettingsCategory = 'httpProxy';

@Schema({ collection: TASK_MONGODB_SETTINGS_COLLECTION_NAME })
export class TaskSettings {
  @Prop({ type: String, enum: TaskSettingsCategoryName, required: true })
  category: string;

  @Prop({
    type: Object,
    required: true,
    properties: {
      product: { type: String, enum: ['datacenterProxies'], required: true },
      username: { type: String, required: true },
      password: { type: String, required: true },
      entryPoint: { type: String, required: true },
      port: { type: String, required: true },
      country: { type: String, required: true },
      assignedIP: { type: String, required: true },
      httpProxy: { type: String, required: true },
      count: { type: Number, required: true },
    },
  })
  value: {
    product: 'datacenterProxies';
    username: string;
    password: string;
    entryPoint: string;
    port: string;
    country: string;
    assignedIP: string;
    httpProxy: string;
    count: number;
  };
}

export const TaskSettingsSchema = SchemaFactory.createForClass(TaskSettings);

TaskSettingsSchema.index({ category: 1, 'value.product': 1 });
TaskSettingsSchema.index({ 'value.httpProxy': 1 }, { unique: true });
