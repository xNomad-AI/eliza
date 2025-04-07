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

import { HealthControllerDebugData } from './data-contracts';
import { HttpClient, RequestParams } from './http-client';

export class Debug<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {
  /**
   * No description
   *
   * @tags Health
   * @name HealthControllerDebug
   * @request GET:/health/debug
   * @response `200` `HealthControllerDebugData`
   */
  healthControllerDebug = (params: RequestParams = {}) =>
    this.request<HealthControllerDebugData, any>({
      path: `/health/debug`,
      method: 'GET',
      ...params,
    });
}
