import { type IAgentRuntime } from '@elizaos/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

import { Task } from "../schemas/task.schema.js";

export enum TaskEventName {
  TASK_CREATED = 'tasks.created',
  TASK_UPDATED = 'tasks.updated',
  TASK_START = 'tasks.start',
  TASK_STOP = 'tasks.stop',
  TASK_RESTART = 'tasks.restart',
}

type TaskEventData = { task: Task, runtime: IAgentRuntime, eventName: TaskEventName, message?: string };

export class TaskEvent {
  static logger = new Logger(`${TaskEvent.name}`);

  eventName: TaskEventName;
  // the conig of task
  task: Task;
  // the runtime of task
  runtime: IAgentRuntime;
  // only the newer event will be processed
  eventCreatedAt: Date;
  message?: string;

  constructor(data: TaskEventData) {
    this.task = data.task;
    this.runtime = data.runtime;
    this.message = data.message;
    this.eventCreatedAt = new Date();
  }

  static createEvent(
    eventEmitter: EventEmitter2,
    task: Task,
    runtime: IAgentRuntime,
    eventName: TaskEventName
  ): TaskEvent {
    const event = new TaskEvent({
      task,
      runtime,
      eventName,
      message: `${task.title} ${eventName}`,
    });

    const ok = eventEmitter.emit(
      eventName,
      event,
    );
    
    TaskEvent.logger.debug(`task ${eventName} event emitted: ${ok}`);
    return event;
  }

  static createTaskCreatedEvent(eventEmitter: EventEmitter2, task: Task, runtime: IAgentRuntime): TaskEvent {
    return TaskEvent.createEvent(
      eventEmitter,
      task,
      runtime,
      TaskEventName.TASK_CREATED,
    )
  }

  static createTaskStopEvent(eventEmitter: EventEmitter2, task: Task, runtime: IAgentRuntime): TaskEvent {
    return TaskEvent.createEvent(
      eventEmitter,
      task,
      runtime,
      TaskEventName.TASK_STOP,
    )
  }

  static createTaskUpdatedEvent(eventEmitter: EventEmitter2, task: Task, runtime: IAgentRuntime): TaskEvent {
    return TaskEvent.createEvent(
      eventEmitter,
      task,
      runtime,
      TaskEventName.TASK_UPDATED,
    )
  }

  static createTaskRestartEvent(eventEmitter: EventEmitter2, task: Task, runtime: IAgentRuntime): TaskEvent {
    return TaskEvent.createEvent(
      eventEmitter,
      task,
      runtime,
      TaskEventName.TASK_RESTART,
    )
  }

  static createTaskStartEvent(eventEmitter: EventEmitter2, task: Task, runtime: IAgentRuntime): TaskEvent {
    return TaskEvent.createEvent(
      eventEmitter,
      task,
      runtime,
      TaskEventName.TASK_START,
    )
  }
}
