import {
  type Content,
  type IAgentRuntime,
  type IImageDescriptionService,
  type Memory,
  type State,
  type UUID,
  getEmbeddingZeroVector,
  stringToUuid,
  ActionTimelineType,
} from '@elizaos/core';
import {
  type QueryTweetsResponse,
  SearchMode,
  type Tweet,
} from 'agent-twitter-client';
import { EventEmitter } from 'events';
import pino from 'pino';

import type { TwitterConfig } from './environment.js';
import { CustomScraper } from './scraper.js';
import { GLOBAL_SETTINGS } from './settings/index.js';
import { Logger } from './settings/external.js';
import { TwitterClientState } from './monitor/state.js';

export function extractAnswer(text: string): string {
  const startIndex = text.indexOf('Answer: ') + 8;
  const endIndex = text.indexOf('<|endoftext|>', 11);
  return text.slice(startIndex, endIndex);
}

type TwitterProfile = {
  id: string;
  username: string;
  screenName: string;
  bio: string;
  nicknames: string[];
};

class RequestQueue {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;

  async add<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      try {
        await request();
      } catch (error) {
        console.error('Error processing request:', error);
        this.queue.unshift(request);
        await this.exponentialBackoff(this.queue.length);
      }
      await this.randomDelay();
    }

    this.processing = false;
  }

  private async exponentialBackoff(retryCount: number): Promise<void> {
    const delay = Math.pow(2, retryCount) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async randomDelay(): Promise<void> {
    const delay = Math.floor(Math.random() * 2000) + 1500;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export class ClientBase extends EventEmitter {
  static _twitterClients: { [accountIdentifier: string]: CustomScraper } = {};
  twitterClient: CustomScraper;
  runtime: IAgentRuntime;
  runtimeHelper: RuntimeHelper;
  twitterConfig: TwitterConfig;
  directions: string;
  lastCheckedTweetId: bigint | null = null;
  imageDescriptionService: IImageDescriptionService;
  temperature = 0.5;

  requestQueue: RequestQueue = new RequestQueue();

  profile: TwitterProfile | null;

  logger: pino.Logger<string, boolean>;

  async getTweet(tweetId: string): Promise<Tweet> {
    const cachedTweet = await this.runtimeHelper.getCachedTweet(tweetId);

    if (cachedTweet) {
      return cachedTweet;
    }

    const tweet = await this.requestQueue.add(() =>
      this.twitterClient.getTweet(tweetId),
    );

    await this.runtimeHelper.cacheTweet(tweet);
    return tweet;
  }

  callback: (self: ClientBase) => any = null;

  onReady() {
    throw new Error('Not implemented in base class, please call from subclass');
  }

  /**
   * Parse the raw tweet data into a standardized Tweet object.
   */
  private parseTweet(raw: any, depth = 0, maxDepth = 3): Tweet {
    // If we've reached maxDepth, don't parse nested quotes/retweets further
    const canRecurse = depth < maxDepth;

    const quotedStatus =
      raw.quoted_status_result?.result && canRecurse
        ? this.parseTweet(raw.quoted_status_result.result, depth + 1, maxDepth)
        : undefined;

    const retweetedStatus =
      raw.retweeted_status_result?.result && canRecurse
        ? this.parseTweet(
            raw.retweeted_status_result.result,
            depth + 1,
            maxDepth,
          )
        : undefined;

    const t: Tweet = {
      bookmarkCount:
        raw.bookmarkCount ?? raw.legacy?.bookmark_count ?? undefined,
      conversationId: raw.conversationId ?? raw.legacy?.conversation_id_str,
      hashtags: raw.hashtags ?? raw.legacy?.entities?.hashtags ?? [],
      html: raw.html,
      id: raw.id ?? raw.rest_id ?? raw.id_str ?? undefined,
      inReplyToStatus: raw.inReplyToStatus,
      inReplyToStatusId:
        raw.inReplyToStatusId ??
        raw.legacy?.in_reply_to_status_id_str ??
        undefined,
      isQuoted: raw.legacy?.is_quote_status === true,
      isPin: raw.isPin,
      isReply: raw.isReply,
      isRetweet: raw.legacy?.retweeted === true,
      isSelfThread: raw.isSelfThread,
      language: raw.legacy?.lang,
      likes: raw.legacy?.favorite_count ?? 0,
      name:
        raw.name ??
        raw?.user_results?.result?.legacy?.name ??
        raw.core?.user_results?.result?.legacy?.name,
      mentions: raw.mentions ?? raw.legacy?.entities?.user_mentions ?? [],
      permanentUrl:
        raw.permanentUrl ??
        (raw.core?.user_results?.result?.legacy?.screen_name && raw.rest_id
          ? `https://x.com/${raw.core?.user_results?.result?.legacy?.screen_name}/status/${raw.rest_id}`
          : undefined),
      photos:
        raw.photos ??
        (raw.legacy?.entities?.media
          ?.filter((media: any) => media.type === 'photo')
          .map((media: any) => ({
            id: media.id_str,
            url: media.media_url_https,
            alt_text: media.alt_text,
          })) ||
          []),
      place: raw.place,
      poll: raw.poll ?? null,
      quotedStatus,
      quotedStatusId:
        raw.quotedStatusId ?? raw.legacy?.quoted_status_id_str ?? undefined,
      quotes: raw.legacy?.quote_count ?? 0,
      replies: raw.legacy?.reply_count ?? 0,
      retweets: raw.legacy?.retweet_count ?? 0,
      retweetedStatus,
      retweetedStatusId: raw.legacy?.retweeted_status_id_str ?? undefined,
      text: raw.text ?? raw.legacy?.full_text ?? undefined,
      thread: raw.thread || [],
      timeParsed: raw.timeParsed
        ? new Date(raw.timeParsed)
        : raw.legacy?.created_at
          ? new Date(raw.legacy?.created_at)
          : undefined,
      timestamp:
        raw.timestamp ??
        (raw.legacy?.created_at
          ? new Date(raw.legacy.created_at).getTime() / 1000
          : undefined),
      urls: raw.urls ?? raw.legacy?.entities?.urls ?? [],
      userId: raw.userId ?? raw.legacy?.user_id_str ?? undefined,
      username:
        raw.username ??
        raw.core?.user_results?.result?.legacy?.screen_name ??
        undefined,
      videos:
        raw.videos ??
        raw.legacy?.entities?.media?.filter(
          (media: any) => media.type === 'video',
        ) ??
        [],
      views: raw.views?.count ? Number(raw.views.count) : 0,
      sensitiveContent: raw.sensitiveContent,
    };

    return t;
  }

  constructor(runtime: IAgentRuntime, twitterConfig: TwitterConfig) {
    super();
    this.runtime = runtime;
    this.twitterConfig = twitterConfig;
    // TODO fix when twitter username changed
    this.logger = Logger.child({
      name: `${this.twitterConfig.TWITTER_USERNAME}-${this.runtime.agentId}`,
    });
    this.runtimeHelper = new RuntimeHelper(runtime, this.logger);
    const username = twitterConfig.TWITTER_USERNAME;

    if (ClientBase._twitterClients[username]) {
      this.twitterClient = ClientBase._twitterClients[username];
    } else {
      // this.twitterClient = new CustomScraper(
      //   {
      //     transform: {
      //       response: (data: any) => {
      //         if (data.__typename === 'Tweet') {
      //           return this.parseTweet(data);
      //         }
      //         return data;
      //       },
      //       request: (data: any) => {
      //         if (data.__typename === 'Tweet') {
      //           return this.parseTweet(data);
      //         }
      //         return data;
      //       },
      //     },
      //   },
      //   this.twitterConfig.TWITTER_HTTP_PROXY,
      // );
      this.twitterClient = new CustomScraper(
        {
          transform: (data) => {
            if (data.__typename === 'Tweet') {
              return this.parseTweet(data);
            }
            return data;
          },
        } as any,
        this.twitterConfig.TWITTER_HTTP_PROXY,
      );
      ClientBase._twitterClients[username] = this.twitterClient;
    }

    this.directions = this.runtimeHelper.getDirections();
  }

  private async twitterLoginInitCookies() {
    const username = this.twitterConfig.TWITTER_USERNAME;
    const authToken = this.twitterConfig.TWITTER_COOKIES_AUTH_TOKEN;
    const ct0 = this.twitterConfig.TWITTER_COOKIES_CT0;
    const guestId = this.twitterConfig.TWITTER_COOKIES_GUEST_ID;

    this.logger.debug('Waiting for Twitter login cookie init');
    GLOBAL_SETTINGS.setClientTwitterState(this.runtime.agentId, TwitterClientState.TWITTER_LOGIN_COOKIE_INIT);

    const createTwitterCookies = (
      authToken: string,
      ct0: string,
      guestId: string,
    ) =>
      authToken && ct0 && guestId
        ? [
            { key: 'auth_token', value: authToken, domain: '.twitter.com' },
            { key: 'ct0', value: ct0, domain: '.twitter.com' },
            { key: 'guest_id', value: guestId, domain: '.twitter.com' },
          ]
        : null;

    const cachedCookies =
      (await this.runtimeHelper.getCachedCookies(username)) ||
      createTwitterCookies(authToken, ct0, guestId);

    if (cachedCookies) {
      this.logger.info('Using cached cookies');
      await this.setCookiesFromArray(cachedCookies);
    }
  }

  private async twitterLogin() {
    const username = this.twitterConfig.TWITTER_USERNAME;
    let retries = this.twitterConfig.TWITTER_RETRY_LIMIT;

    this.logger.debug('Waiting for Twitter login');
    GLOBAL_SETTINGS.setClientTwitterState(this.runtime.agentId, TwitterClientState.TWITTER_LOGIN);

    while (retries > 0) {
      let errorMessage: string | undefined;
      try {
        if (await this.twitterClient.isLoggedIn()) {
          // cookies are valid, no login required
          this.logger.info('Successfully logged in.');
          break;
        } else {
          await this.twitterClient.login(
            username,
            this.twitterConfig.TWITTER_PASSWORD,
            this.twitterConfig.TWITTER_EMAIL,
            this.twitterConfig.TWITTER_2FA_SECRET,
          );
          if (await this.twitterClient.isLoggedIn()) {
            // fresh login, store new cookies
            this.logger.info('Successfully logged in.');
            this.logger.info('Caching cookies');
            await this.runtimeHelper.cacheCookies(
              username,
              await this.twitterClient.getCookies(),
            );
            break;
          }
        }
      } catch (error) {
        this.logger.error(`Login attempt failed: ${error.message}`);
        errorMessage = error.message;
      }

      retries--;
      this.logger.warn(
        `Failed to login to Twitter. Retrying... (${retries} attempts left)`,
      );

      if (retries === 0) {
        this.logger.error('Max retries reached. Exiting login process.');
        throw new Error(`Twitter login failed after maximum retries: ${errorMessage}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async initTwitterProfile() {
    const username = this.twitterConfig.TWITTER_USERNAME;

    this.logger.debug('Waiting for Twitter profile init');
    GLOBAL_SETTINGS.setClientTwitterState(this.runtime.agentId, TwitterClientState.TWITTER_PROFILE_INIT);

    this.profile = await this.fetchProfile(username);

    if (this.profile) {
      this.logger.debug('Twitter user ID:', this.profile.id);
      this.logger.debug('Twitter loaded:', JSON.stringify(this.profile));
      // Store profile info for use in responses
      this.runtimeHelper.setTwitterProfile(this.profile);
    } else {
      throw new Error('Failed to load profile');
    }
  }

  async init() {
    await this.twitterLoginInitCookies();
    await this.twitterLogin();
    await this.initTwitterProfile();
    await this.loadLatestCheckedTweetId();
    await this.populateTimeline();
  }

  async fetchOwnPosts(count: number): Promise<Tweet[]> {
    this.logger.debug('fetching own posts');
    const homeTimeline = await this.twitterClient.getUserTweets(
      this.profile.id,
      count,
    );
    // Use parseTweet on each tweet
    return homeTimeline.tweets.map((t) => this.parseTweet(t));
  }

  /**
   * Fetch timeline for twitter account, optionally only from followed accounts
   */
  async fetchHomeTimeline(
    count: number,
    following?: boolean,
  ): Promise<Tweet[]> {
    this.logger.debug('fetching home timeline');
    const homeTimeline = following
      ? await this.twitterClient.fetchFollowingTimeline(count, [])
      : await this.twitterClient.fetchHomeTimeline(count, []);

    // this.logger.debug(homeTimeline, { depth: Number.POSITIVE_INFINITY });
    const processedTimeline = homeTimeline
      .filter((t) => t.__typename !== 'TweetWithVisibilityResults') // what's this about?
      .map((tweet) => this.parseTweet(tweet));

    //this.logger.debug("process homeTimeline", processedTimeline);
    return processedTimeline;
  }

  async fetchTimelineForActions(count: number): Promise<Tweet[]> {
    this.logger.debug('fetching timeline for actions');

    const agentUsername = this.twitterConfig.TWITTER_USERNAME;

    const homeTimeline =
      this.twitterConfig.ACTION_TIMELINE_TYPE === ActionTimelineType.Following
        ? await this.twitterClient.fetchFollowingTimeline(count, [])
        : await this.twitterClient.fetchHomeTimeline(count, []);

    // Parse, filter out self-tweets, limit to count
    return homeTimeline
      .map((tweet) => this.parseTweet(tweet))
      .filter((tweet) => tweet.username !== agentUsername) // do not perform action on self-tweets
      .slice(0, count);
    // TODO: Once the 'count' parameter is fixed in the 'fetchTimeline' method of the 'agent-twitter-client',
    // this workaround can be removed.
    // Related issue: https://github.com/elizaos/agent-twitter-client/issues/43
  }

  async fetchSearchTweets(
    query: string,
    maxTweets: number,
    searchMode: SearchMode,
    cursor?: string,
  ): Promise<QueryTweetsResponse> {
    try {
      // Sometimes this fails because we are rate limited. in this case, we just need to return an empty array
      // if we dont get a response in 5 seconds, something is wrong
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ tweets: [] }), 15000),
      );

      try {
        const result = await this.requestQueue.add(
          async () =>
            await Promise.race([
              this.twitterClient.fetchSearchTweets(
                query,
                maxTweets,
                searchMode,
                cursor,
              ),
              timeoutPromise,
            ]),
        );
        return (result ?? { tweets: [] }) as QueryTweetsResponse;
      } catch (error) {
        this.logger.error('Error fetching search tweets:', error);
        return { tweets: [] };
      }
    } catch (error) {
      this.logger.error('Error fetching search tweets:', error);
      return { tweets: [] };
    }
  }

  private async populateTimeline() {
    const username = this.twitterConfig.TWITTER_USERNAME;

    this.logger.debug('populating timeline...');
    GLOBAL_SETTINGS.setClientTwitterState(this.runtime.agentId, TwitterClientState.TWITTER_POPULATE_TIMELINE);

    const cachedTimeline = await this.runtimeHelper.getOrCreateCachedTimeline(
      this.profile,
    );
    if (cachedTimeline.ret) return;

    const timeline = await this.fetchHomeTimeline(cachedTimeline.res ? 10 : 50);

    // Get the most recent 20 mentions and interactions
    const mentionsAndInteractions = await this.fetchSearchTweets(
      `@${username}`,
      20,
      SearchMode.Latest,
    );

    // Combine the timeline tweets and mentions/interactions
    const allTweets = [...timeline, ...mentionsAndInteractions.tweets];
    // Create a Set to store unique tweet IDs
    const roomIds = new Set<UUID>();

    // Add tweet IDs to the Set
    for (const tweet of allTweets) {
      roomIds.add(this.runtimeHelper.getTweetRoomId(tweet.conversationId));
    }
    // Create a Set to store the existing memory IDs
    const existingMemoryIds = await this.runtimeHelper.getMemoryIdsByRoomIds(
      Array.from(roomIds),
    );
    // Filter out the tweets that already exist in the database
    const tweetsToSave = allTweets.filter(
      (tweet) =>
        !existingMemoryIds.has(this.runtimeHelper.getTweetMemoryId(tweet.id)),
    );

    this.logger.debug(
      'processingTweets: ',
      JSON.stringify({
        processingTweets: tweetsToSave.map((tweet) => tweet.id).join(','),
      }),
    );

    await this.runtimeHelper.ensureUserExists(username);
    // Save the new tweets as memories
    await this.runtimeHelper.saveTweets(this.profile, tweetsToSave, {
      inReplyToAddAgentId: false,
      checkMemoryExists: false,
    });

    // Cache
    await this.cacheTimeline(timeline);
    await this.runtimeHelper.cacheMentions(
      username,
      mentionsAndInteractions.tweets,
    );
  }

  private async setCookiesFromArray(cookiesArray: any[]) {
    const cookieStrings = cookiesArray.map(
      (cookie) =>
        `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
          cookie.secure ? 'Secure' : ''
        }; ${cookie.httpOnly ? 'HttpOnly' : ''}; SameSite=${
          cookie.sameSite || 'Lax'
        }`,
    );
    await this.twitterClient.setCookies(cookieStrings);
  }

  async saveRequestMessage(message: Memory, state: State) {
    return this.runtimeHelper.saveRequestMessage(
      message,
      state,
      this.twitterClient,
    );
  }

  private async loadLatestCheckedTweetId(): Promise<void> {
    const latestCheckedTweetId =
      await this.runtimeHelper.getCachedLatestCheckedTweetId(
        this.profile.username,
      );

    if (latestCheckedTweetId) {
      this.lastCheckedTweetId = latestCheckedTweetId;
    }
  }

  async cacheLatestCheckedTweetId() {
    if (this.lastCheckedTweetId) {
      await this.runtimeHelper.cacheLatestCheckedTweetId(
        this.profile.username,
        this.lastCheckedTweetId,
      );
    }
  }

  async cacheTimeline(timeline: Tweet[]) {
    await this.runtimeHelper.cacheTimeline(this.profile.username, timeline);
  }

  private async fetchProfile(username: string): Promise<TwitterProfile> {
    try {
      const profile = await this.twitterClient.getProfile(username);
      const character = this.runtimeHelper.getCharacter();
      return {
        id: profile.userId,
        username,
        screenName: profile.name || character.name,
        bio:
          profile.biography || typeof character.bio === 'string'
            ? (character.bio as string)
            : character.bio.length > 0
              ? character.bio[0]
              : '',
        nicknames: character.twitterProfile?.nicknames || [],
      } satisfies TwitterProfile;
    } catch (error) {
      console.error('Error fetching Twitter profile:', error);
      throw error;
    }
  }
}

class RuntimeHelper {
  // TODO add runtime helper to base class
  constructor(
    private runtime: IAgentRuntime,
    private logger: pino.Logger<string, boolean>,
  ) {}

  async saveRequestMessage(
    message: Memory,
    state: State,
    twitterClient: CustomScraper,
  ) {
    if (message.content.text) {
      const recentMessage = await this.runtime.messageManager.getMemories({
        roomId: message.roomId,
        count: 1,
        unique: false,
      });

      if (
        recentMessage.length > 0 &&
        recentMessage[0].content === message.content
      ) {
        this.logger.debug('Message already saved', recentMessage[0].id);
      } else {
        await this.runtime.messageManager.createMemory({
          ...message,
          embedding: getEmbeddingZeroVector(),
        });
      }

      await this.runtime.evaluate(message, {
        ...state,
        twitterClient: twitterClient,
      });
    }
  }

  getDirections() {
    const ret =
      '- ' +
      this.runtime.character.style.all.join('\n- ') +
      '- ' +
      this.runtime.character.style.post.join();
    return ret;
  }

  async cacheTweet(tweet: Tweet): Promise<void> {
    if (!tweet) {
      console.warn('Tweet is undefined, skipping cache');
      return;
    }

    this.runtime.cacheManager.set(`twitter/tweets/${tweet.id}`, tweet);
  }

  async getCachedTweet(tweetId: string): Promise<Tweet | undefined> {
    const cached = await this.runtime.cacheManager.get<Tweet>(
      `twitter/tweets/${tweetId}`,
    );

    return cached;
  }

  async getCachedLatestCheckedTweetId(
    username: string,
  ): Promise<bigint | undefined> {
    const latestCheckedTweetId = await this.runtime.cacheManager.get<string>(
      `twitter/${username}/latest_checked_tweet_id`,
    );

    if (latestCheckedTweetId) {
      return BigInt(latestCheckedTweetId);
    }
  }

  async cacheLatestCheckedTweetId(
    username: string,
    lastCheckedTweetId: BigInt,
  ) {
    await this.runtime.cacheManager.set(
      `twitter/${username}/latest_checked_tweet_id`,
      lastCheckedTweetId.toString(),
    );
  }

  async getCachedTimeline(username: string): Promise<Tweet[] | undefined> {
    return await this.runtime.cacheManager.get<Tweet[]>(
      `twitter/${username}/timeline`,
    );
  }

  async ensureUserExists(username: string) {
    await this.runtime.ensureUserExists(
      this.runtime.agentId,
      username,
      this.runtime.character.name,
      'twitter',
    );
  }

  async getMemoryIdsByRoomIds(roomIds: UUID[]): Promise<Set<UUID>> {
    const existingMemories =
      await this.runtime.messageManager.getMemoriesByRoomIds({
        roomIds: roomIds,
      });

    const existingMemoryIds = new Set<UUID>(
      existingMemories.map((memory) => memory.id),
    );

    return existingMemoryIds;
  }

  getTweetRoomId(conversationId?: string): UUID {
    return stringToUuid(conversationId + '-' + this.runtime.agentId);
  }

  getTweetMemoryId(tweetId?: string) {
    return this.getTweetRoomId(tweetId);
  }

  async saveTweets(
    profile: TwitterProfile,
    tweetsToSave: Tweet[],
    options = {
      inReplyToAddAgentId: true,
      checkMemoryExists: true,
    },
  ) {
    // Save the missing tweets as memories
    for (const tweet of tweetsToSave) {
      this.logger.debug('Saving Tweet', tweet.id);

      const roomId = stringToUuid(
        tweet.conversationId + '-' + this.runtime.agentId,
      );

      const userId =
        tweet.userId === profile.id
          ? this.runtime.agentId
          : stringToUuid(tweet.userId);

      if (tweet.userId === profile.id) {
        await this.runtime.ensureConnection(
          this.runtime.agentId,
          roomId,
          profile.username,
          profile.screenName,
          'twitter',
        );
      } else {
        await this.runtime.ensureConnection(
          userId,
          roomId,
          tweet.username,
          tweet.name,
          'twitter',
        );
      }

      const inReplyTo = () => {
        if (options.inReplyToAddAgentId) {
          return tweet.inReplyToStatusId
            ? stringToUuid(tweet.inReplyToStatusId + '-' + this.runtime.agentId)
            : undefined;
        } else {
          return tweet.inReplyToStatusId
            ? stringToUuid(tweet.inReplyToStatusId)
            : undefined;
        }
      };

      const content = {
        text: tweet.text,
        url: tweet.permanentUrl,
        source: 'twitter',
        inReplyTo: inReplyTo(),
      } as Content;

      this.logger.debug('Creating memory for tweet', tweet.id);

      if (options.checkMemoryExists) {
        // check if it already exists
        const memory = await this.runtime.messageManager.getMemoryById(
          stringToUuid(tweet.id + '-' + this.runtime.agentId),
        );

        if (memory) {
          this.logger.info(
            'Memory already exists, skipping timeline population',
          );
          break;
        }
      }

      await this.runtime.messageManager.createMemory({
        id: stringToUuid(tweet.id + '-' + this.runtime.agentId),
        userId,
        content: content,
        agentId: this.runtime.agentId,
        roomId,
        embedding: getEmbeddingZeroVector(),
        createdAt: tweet.timestamp * 1000,
      });

      await this.cacheTweet(tweet);
    }
  }

  async getOrCreateCachedTimeline(
    profile: TwitterProfile,
  ): Promise<{ ret: boolean; res?: Tweet[] }> {
    const username = profile.username;

    const cachedTimeline = await this.getCachedTimeline(username);

    // Check if the cache file exists
    if (cachedTimeline) {
      // Read the cached search results from the file

      // Get the existing memories from the database
      const existingMemories =
        await this.runtime.messageManager.getMemoriesByRoomIds({
          roomIds: cachedTimeline.map((tweet) =>
            stringToUuid(tweet.conversationId + '-' + this.runtime.agentId),
          ),
        });

      //TODO: load tweets not in cache?

      // Create a Set to store the IDs of existing memories
      const existingMemoryIds = new Set(
        existingMemories.map((memory) => memory.id.toString()),
      );

      // Check if any of the cached tweets exist in the existing memories
      const someCachedTweetsExist = cachedTimeline.some((tweet) =>
        existingMemoryIds.has(
          stringToUuid(tweet.id + '-' + this.runtime.agentId),
        ),
      );

      if (someCachedTweetsExist) {
        // Filter out the cached tweets that already exist in the database
        const tweetsToSave = cachedTimeline.filter(
          (tweet) =>
            !existingMemoryIds.has(
              stringToUuid(tweet.id + '-' + this.runtime.agentId),
            ),
        );

        this.logger.debug({
          processingTweets: tweetsToSave.map((tweet) => tweet.id).join(','),
        });

        // Save the missing tweets as memories
        await this.saveTweets(profile, tweetsToSave);

        this.logger.debug(
          `Populated ${tweetsToSave.length} missing tweets from the cache.`,
        );
        return { ret: true };
      }
    }

    return { ret: false, res: cachedTimeline };
  }

  async cacheTimeline(username: string, timeline: Tweet[]) {
    await this.runtime.cacheManager.set(
      `twitter/${username}/timeline`,
      timeline,
      { expires: Date.now() + 10 * 1000 },
    );
  }

  async cacheMentions(username: string, mentions: Tweet[]) {
    await this.runtime.cacheManager.set(
      `twitter/${username}/mentions`,
      mentions,
      { expires: Date.now() + 10 * 1000 },
    );
  }

  async getCachedCookies(username: string) {
    return await this.runtime.cacheManager.get<any[]>(
      `twitter/${username}/cookies`,
    );
  }

  async cacheCookies(username: string, cookies: any[]) {
    await this.runtime.cacheManager.set(`twitter/${username}/cookies`, cookies);
  }

  setTwitterProfile(profile: TwitterProfile) {
    this.runtime.character.twitterProfile = {
      id: profile.id,
      username: profile.username,
      screenName: profile.screenName,
      bio: profile.bio,
      nicknames: profile.nicknames,
    };
  }

  getCharacter() {
    return this.runtime.character;
  }
}
