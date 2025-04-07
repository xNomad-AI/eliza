/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

import {
  CreateTaskDto,
  ErrorReportDto,
  TasksControllerCreateTaskData,
  TasksControllerGetTaskData,
  TasksControllerReportErrorData,
  TasksControllerStopTaskByAgentIdData,
  TasksControllerStopTaskData,
  TasksControllerSuspendedTaskData,
  TasksControllerUpdateTaskData,
  UpdateTaskDto,
} from './data-contracts';
import { ContentType, HttpClient, RequestParams } from './http-client';

export class Tasks<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerCreateTask
   * @request POST:/client-twitter/tasks
   * @response `201` `TasksControllerCreateTaskData` will full nested object for example configuration, so you should be careful when using this
   */
  tasksControllerCreateTask = (data: CreateTaskDto, params: RequestParams = {}) =>
    this.request<TasksControllerCreateTaskData, any>({
      path: `/client-twitter/tasks`,
      method: 'POST',
      body: data,
      type: ContentType.Json,
      format: 'json',
      ...params,
    });
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerStopTask
   * @request POST:/client-twitter/tasks/{title}/stop
   * @response `201` `TasksControllerStopTaskData`
   */
  tasksControllerStopTask = (title: string, params: RequestParams = {}) =>
    this.request<TasksControllerStopTaskData, any>({
      path: `/client-twitter/tasks/${title}/stop`,
      method: 'POST',
      format: 'json',
      ...params,
    });
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerStopTaskByAgentId
   * @request POST:/client-twitter/tasks/agent/{agentId}/stop
   * @response `201` `TasksControllerStopTaskByAgentIdData`
   */
  tasksControllerStopTaskByAgentId = (agentId: string, params: RequestParams = {}) =>
    this.request<TasksControllerStopTaskByAgentIdData, any>({
      path: `/client-twitter/tasks/agent/${agentId}/stop`,
      method: 'POST',
      format: 'json',
      ...params,
    });
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerSuspendedTask
   * @request POST:/client-twitter/tasks/{twitterUserName}/report/suspended
   * @response `201` `TasksControllerSuspendedTaskData`
   */
  tasksControllerSuspendedTask = (twitterUserName: string, params: RequestParams = {}) =>
    this.request<TasksControllerSuspendedTaskData, any>({
      path: `/client-twitter/tasks/${twitterUserName}/report/suspended`,
      method: 'POST',
      format: 'json',
      ...params,
    });
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerUpdateTask
   * @request PUT:/client-twitter/tasks/{id}
   * @response `201` `TasksControllerUpdateTaskData`
   */
  tasksControllerUpdateTask = (id: string, data: UpdateTaskDto, params: RequestParams = {}) =>
    this.request<TasksControllerUpdateTaskData, any>({
      path: `/client-twitter/tasks/${id}`,
      method: 'PUT',
      body: data,
      type: ContentType.Json,
      format: 'json',
      ...params,
    });
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerGetTask
   * @request GET:/client-twitter/tasks/{title}/status
   * @response `201` `TasksControllerGetTaskData`
   */
  tasksControllerGetTask = (title: string, params: RequestParams = {}) =>
    this.request<TasksControllerGetTaskData, any>({
      path: `/client-twitter/tasks/${title}/status`,
      method: 'GET',
      format: 'json',
      ...params,
    });
  /**
   * No description
   *
   * @tags Tasks
   * @name TasksControllerReportError
   * @request POST:/client-twitter/tasks/{twitterUserName}/report/error
   * @response `201` `TasksControllerReportErrorData` Returns the task with updated error information
   */
  tasksControllerReportError = (twitterUserName: string, data: ErrorReportDto, params: RequestParams = {}) =>
    this.request<TasksControllerReportErrorData, any>({
      path: `/client-twitter/tasks/${twitterUserName}/report/error`,
      method: 'POST',
      body: data,
      type: ContentType.Json,
      format: 'json',
      ...params,
    });
}
