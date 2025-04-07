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

/** The type of action this task will perform */
export enum TaskActionName {
  Restart = 'restart',
  Stop = 'stop',
  Start = 'start',
}

/** Type of action timeline */
export enum ActionTimelineType {
  Foryou = 'foryou',
  Following = 'following',
}

export interface TwitterConfig {
  /**
   * Optional flag for dry run mode
   * @example true
   */
  TWITTER_DRY_RUN?: boolean;
  /**
   * Twitter username
   * @example "user123"
   */
  TWITTER_USERNAME?: string;
  /**
   * Twitter password
   * @example "password123"
   */
  TWITTER_PASSWORD?: string;
  /**
   * Twitter email
   * @example "user@example.com"
   */
  TWITTER_EMAIL?: string;
  /**
   * Maximum tweet length
   * @example 280
   */
  MAX_TWEET_LENGTH?: number;
  /**
   * Enable Twitter search
   * @example true
   */
  TWITTER_SEARCH_ENABLE?: boolean;
  /**
   * Twitter 2FA secret
   * @example "2FASecret123"
   */
  TWITTER_2FA_SECRET?: string;
  /**
   * Retry limit for Twitter actions
   * @example 3
   */
  TWITTER_RETRY_LIMIT?: number;
  /**
   * Polling interval for Twitter actions in milliseconds
   * @example 5000
   */
  TWITTER_POLL_INTERVAL?: number;
  /**
   * Target users for Twitter actions
   * @example ["user1","user2"]
   */
  TWITTER_TARGET_USERS?: string[];
  /**
   * Enable Twitter post generation
   * @example true
   */
  ENABLE_TWITTER_POST_GENERATION?: boolean;
  /**
   * Minimum interval between posts in seconds
   * @example 60
   */
  POST_INTERVAL_MIN?: number;
  /**
   * Maximum interval between posts in seconds
   * @example 300
   */
  POST_INTERVAL_MAX?: number;
  /**
   * Enable action processing
   * @example true
   */
  ENABLE_ACTION_PROCESSING?: boolean;
  /**
   * Interval for processing actions in milliseconds
   * @example 10000
   */
  ACTION_INTERVAL?: number;
  /**
   * Post immediately without delay
   * @example false
   */
  POST_IMMEDIATELY?: boolean;
  /**
   * Enable Twitter Spaces
   * @example true
   */
  TWITTER_SPACES_ENABLE?: boolean;
  /**
   * Maximum number of actions to process at a time
   * @example 5
   */
  MAX_ACTIONS_PROCESSING?: number;
  /**
   * Type of action timeline
   * @example "following"
   */
  ACTION_TIMELINE_TYPE?: ActionTimelineType;
  /**
   * HTTP proxy for Twitter requests
   * @example "http://proxy.example.com:8080"
   */
  TWITTER_HTTP_PROXY?: string;
  /**
   * Twitter cookies authentication token
   * @example "auth_token_123"
   */
  TWITTER_COOKIES_AUTH_TOKEN?: string;
  /**
   * Twitter cookies ct0 value
   * @example "ct0_value_123"
   */
  TWITTER_COOKIES_CT0?: string;
  /**
   * Twitter cookies guest ID
   * @example "guest_id_123"
   */
  TWITTER_COOKIES_GUEST_ID?: string;
}

export interface CreateTaskDto {
  /**
   * The title of the task
   * @example "Twitter Post Scheduler"
   */
  title: string;
  /**
   * ai nft id in xnomad
   * @example "solana:xx:xx"
   */
  nftId: string;
  /**
   * which agent start the twitter client
   * @example "xx:xx:xx"
   */
  agentId: string;
  /**
   * Optional description of the task
   * @example "A task that schedules Twitter posts"
   */
  description?: string;
  /**
   * The type of action this task will perform
   * @example "restart"
   */
  action: TaskActionName;
  configuration?: TwitterConfig;
}

export interface TaskResponseDto {
  id?: string;
  title: string;
  /** Available actions: restart, stop, start */
  action: 'restart' | 'stop' | 'start';
  description?: string;
  /**
   * Task status: restarted, running, completed, stopped
   * @default "stopped"
   */
  status: 'restarted' | 'running' | 'completed' | 'stopped';
  /** Twitter configuration and additional settings */
  configuration: TwitterConfig;
  /**
   * Task creation timestamp
   * @format date-time
   * @default "Date.now()"
   */
  createdAt: string;
  createdBy?: string;
  /**
   * Last update timestamp
   * @format date-time
   * @default "Date.now()"
   */
  updatedAt: string;
  /**
   * Pause until this date
   * @format date-time
   */
  pauseUntil?: string;
  /** Task tags */
  tags?: 'suspended'[];
}

export interface UpdateTaskDto {
  /**
   * The title of the task
   * @example "Twitter Post Scheduler"
   */
  title: string;
  /**
   * ai nft id in xnomad
   * @example "solana:xx:xx"
   */
  nftId: string;
  /**
   * which agent start the twitter client
   * @example "xx:xx:xx"
   */
  agentId: string;
  /**
   * Optional description of the task
   * @example "A task that schedules Twitter posts"
   */
  description?: string;
  /**
   * The type of action this task will perform
   * @example "restart"
   */
  action: TaskActionName;
  configuration?: TwitterConfig;
}

export interface ErrorReportDto {
  /**
   * Agent ID associated with the task
   * @example "agent-123"
   */
  agentId: string;
  /**
   * Error message to be reported
   * @example "Connection timeout while accessing Twitter API"
   */
  message: string;
}

export interface UpdateTaskSettingsDto {
  entryPoint: string;
  ip: string;
  port: number;
  countryCode: string;
  username: string;
  password: string;
}

export type TasksControllerCreateTaskData = TaskResponseDto;

export type TasksControllerStopTaskData = TaskResponseDto;

export type TasksControllerStopTaskByAgentIdData = TaskResponseDto;

export type TasksControllerSuspendedTaskData = TaskResponseDto;

export type TasksControllerUpdateTaskData = TaskResponseDto;

export type TasksControllerGetTaskData = TaskResponseDto;

export type TasksControllerReportErrorData = TaskResponseDto;

export type TaskSettingsControllerUpdateManagerSettingsData = any;

export type HealthControllerCheckHealthData = any;

export type HealthControllerDebugData = any;
