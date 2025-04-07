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

import { HealthControllerCheckHealthData } from './data-contracts';
import { HttpClient, RequestParams } from './http-client';

export class Health<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {
  /**
   * No description
   *
   * @tags Health
   * @name HealthControllerCheckHealth
   * @request GET:/health
   * @response `200` `HealthControllerCheckHealthData`
   */
  healthControllerCheckHealth = (params: RequestParams = {}) =>
    this.request<HealthControllerCheckHealthData, any>({
      path: `/health`,
      method: 'GET',
      ...params,
    });
}
