import { type Client, type IAgentRuntime, ActionTimelineType, UUID } from '@elizaos/core';

import { ClientBase } from './base.js';
import {
  validateTwitterConfig,
  type TwitterConfig,
} from './environment.js';
import { TwitterInteractionClient } from './interactions.js';
import { TwitterPostClient } from './post.js';
import { TwitterSearchClient } from './search.js';
import { TwitterSpaceClient } from './spaces.js';
import {
  GLOBAL_SETTINGS,
} from './settings/index.js';
import {
  Logger,
  uploadErrorMessageToTaskManager,
} from './settings/external.js';
import { TwitterClientStatus } from './monitor/state.js';
import {
  twitterAccountStatus,
  twitterPostCount,
  twitterPostInterval,
} from './monitor/metrics.js';
import { wrapperFetchFunction } from './scraper.js';

/**
 * A manager that orchestrates all specialized Twitter logic:
 * - client: base operations (login, timeline caching, etc.)
 * - post: autonomous posting logic
 * - search: searching tweets / replying logic
 * - interaction: handling mentions, replies
 * - space: launching and managing Twitter Spaces (optional)
 */
export class TwitterManager {
  client: ClientBase;
  post: TwitterPostClient;
  search: TwitterSearchClient;
  interaction: TwitterInteractionClient;
  space?: TwitterSpaceClient;

  constructor(
    runtime: IAgentRuntime,
    twitterConfig: TwitterConfig,
  ) {
    // Pass twitterConfig to the base client
    this.client = new ClientBase(runtime, twitterConfig);

    // Posting logic
    this.post = new TwitterPostClient(this.client, runtime);

    // Optional search logic (enabled if TWITTER_SEARCH_ENABLE is true)
    if (twitterConfig.TWITTER_SEARCH_ENABLE) {
      this.client.logger.warn('Twitter/X client running in a mode that:');
      this.client.logger.warn('1. violates consent of random users');
      this.client.logger.warn('2. burns your rate limit');
      this.client.logger.warn('3. can get your account banned');
      this.client.logger.warn('use at your own risk');
      this.search = new TwitterSearchClient(this.client, runtime);
    }

    // Mentions and interactions
    this.interaction = new TwitterInteractionClient(this.client, runtime);

    // Optional Spaces logic (enabled if TWITTER_SPACES_ENABLE is true)
    if (twitterConfig.TWITTER_SPACES_ENABLE) {
      this.space = new TwitterSpaceClient(this.client, runtime);
    }

    // console.log('TwitterManager constructor end');
  }

  async start() {
    // TODO fix transaction issue
    try {
      // Initialize login/session
      await this.client.init();
      // Start the posting loop
      await this.post.start();
    } catch (error) {
      await uploadErrorMessageToTaskManager(
        this.client.twitterConfig.TWITTER_USERNAME,
        this.client.runtime.agentId,
        error,
      )
      throw error;
    }

    // Start the search logic if it exists
    if (this.search) {
      await this.search.start();
    }

    // Start interactions (mentions, replies)
    await this.interaction.start();

    // If Spaces are enabled, start the periodic check
    if (this.space) {
      this.space.startPeriodicSpaceCheck();
    }
  }

  // response: stop success or not
  async stop(): Promise<boolean> {
    let maxCheckTimes = 60;

    while (maxCheckTimes > 0) {
      maxCheckTimes--;
      // 2s
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let ok = await this.post.stop();
      if (!ok) continue;

      ok = await this.interaction.stop();
      if (!ok) continue;

      if (this.space) await this.space.stopSpace();
      if (this.search) await this.search.stop();

      break;
    }

    if (maxCheckTimes === 0) {
      return false;
    }
    return true;
  }
}

function hidePassword(url: string) {
  if (!url) return url;

  try {
    const urlParts = new URL(url);
    urlParts.password = '***';
    return urlParts.toString();
  } catch (error) {
    return url;
  }
}

// TODO if twitter username changed
export class TwitterClientClass implements Client {
  private runtime: IAgentRuntime;

  private getProxy(TWITTER_HTTP_PROXY?: string): string {
    const proxy = hidePassword(TWITTER_HTTP_PROXY ?? 'NONE');
    return proxy;
  }

  async start(runtime: IAgentRuntime) {
    this.runtime = runtime;
    const twitterConfig: TwitterConfig = await validateTwitterConfig(runtime);

    // get proxy from config
    const proxy = this.getProxy(twitterConfig.TWITTER_HTTP_PROXY);
    Logger.debug(
      `Twitter client started username=${twitterConfig.TWITTER_USERNAME}`,
    );

    try {
      twitterAccountStatus.labels(twitterConfig.TWITTER_USERNAME, proxy, runtime.agentId).set(1);
      // init the post count
      twitterPostCount.labels(twitterConfig.TWITTER_USERNAME).inc(0);
      // if badder then max, there must be some issue
      twitterPostInterval
        .labels(twitterConfig.TWITTER_USERNAME)
        .set(twitterConfig.POST_INTERVAL_MAX);

      // only if the status is stopped can start a new client
      if (!GLOBAL_SETTINGS.isAgentTwitterAccountStopped(runtime.agentId)) {
        const msg = `Twitter client ${twitterConfig.TWITTER_USERNAME} is not stopped, cannot start, status=${GLOBAL_SETTINGS.getCurrentAgentTwitterAccountStatus(runtime.agentId)}`;
        throw new Error(msg);
      }

      const manager = new TwitterManager(runtime, twitterConfig);
      GLOBAL_SETTINGS.addClientTwitterStatement(twitterConfig, runtime, manager);

      await manager.start();
      return this;
    } catch (error) {
      twitterAccountStatus.labels(twitterConfig.TWITTER_USERNAME, proxy, runtime.agentId).set(0);
      GLOBAL_SETTINGS.setClientTwitterStatus(runtime.agentId, TwitterClientStatus.STOPPED);
      throw error;
    }
  }

  async stop(runtime?: IAgentRuntime): Promise<void> {
    if (!runtime) runtime = this.runtime;

    return await this.stopByAgentId(runtime.agentId);
  }

  // stop the twitter client by agentId
  async stopByAgentId(agentId: UUID): Promise<void> {
    if (
      GLOBAL_SETTINGS.getCurrentAgentTwitterAccountStatus(agentId) === TwitterClientStatus.RUNNING ||
      GLOBAL_SETTINGS.getCurrentAgentTwitterAccountStatus(agentId) === TwitterClientStatus.STOP_FAILED
    ) {
      const twitterConfig = GLOBAL_SETTINGS.getAgentTwitterConfig(agentId);
      const username = twitterConfig.TWITTER_USERNAME;
      const proxy = this.getProxy(twitterConfig.TWITTER_HTTP_PROXY);

      twitterAccountStatus.labels(username, proxy, agentId).set(2);

      GLOBAL_SETTINGS.setClientTwitterStatus(agentId, TwitterClientStatus.STOPPING);
      const manager: TwitterManager = GLOBAL_SETTINGS.getAgentTwitterManager(agentId);
      const ok = await manager.stop();

      if (!ok) {
        GLOBAL_SETTINGS.setClientTwitterStatus(agentId, TwitterClientStatus.STOP_FAILED);
        throw new Error(
          `Twitter client ${username} failed to stop, please try again`,
        );
      } else {
        GLOBAL_SETTINGS.removeClientTwitter(agentId);
        twitterAccountStatus.labels(username, proxy, agentId).set(0);
        Logger.info(`Twitter client ${agentId} stopped`);
      }
    } else {
      Logger.warn(
        `Twitter client ${agentId} is not running, cannot stop`,
      );
    }
  }

  getStatus(runtime: IAgentRuntime) {
    return GLOBAL_SETTINGS.getCurrentAgentTwitterAccountStatus(runtime.agentId);
  }
}

export const TwitterClient: Client & {
  getStatus(runtime: IAgentRuntime): TwitterClientStatus;
  stopByAgentId(agentId: string): Promise<void>;
} = new TwitterClientClass();
export const TwitterClientInterface: Client = TwitterClient;

export default TwitterClientInterface;
export { TwitterClientStatus, TwitterConfig, ActionTimelineType, validateTwitterConfig, wrapperFetchFunction };
