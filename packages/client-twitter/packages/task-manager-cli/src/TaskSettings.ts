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

import { TaskSettingsControllerUpdateManagerSettingsData, UpdateTaskSettingsDto } from './data-contracts';
import { ContentType, HttpClient, RequestParams } from './http-client';

export class TaskSettings<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {
  /**
   * No description
   *
   * @tags TaskSettings
   * @name TaskSettingsControllerUpdateManagerSettings
   * @request POST:/client-twitter/task-settings
   * @response `201` `TaskSettingsControllerUpdateManagerSettingsData`
   */
  taskSettingsControllerUpdateManagerSettings = (data: UpdateTaskSettingsDto[], params: RequestParams = {}) =>
    this.request<TaskSettingsControllerUpdateManagerSettingsData, any>({
      path: `/client-twitter/task-settings`,
      method: 'POST',
      body: data,
      type: ContentType.Json,
      ...params,
    });
}
