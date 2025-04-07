import { type Tweet } from 'agent-twitter-client';
import {
  composeContext,
  generateText,
  getEmbeddingZeroVector,
  ModelClass,
  stringToUuid,
  truncateToCompleteSentence,
  parseJSONObjectFromText,
  extractAttributes,
  cleanJsonResponse,
  postActionResponseFooter,
  generateTweetActions,
  ServiceType,
  type IAgentRuntime,
  type TemplateType,
  type UUID,
  type State,
  type ActionResponse,
  type IImageDescriptionService
} from '@elizaos/core';
import {
  Client,
  Events,
  GatewayIntentBits,
  TextChannel,
  Partials,
} from 'discord.js';
import pino from 'pino';

import type { ClientBase } from './base.js';
import { buildConversationThread, fetchMediaData } from './utils.js';
import { twitterMessageHandlerTemplate } from './interactions.js';
import { DEFAULT_MAX_TWEET_LENGTH } from './environment.js';
import { MediaData } from './types.js';
import { twitterPostCount } from './monitor/metrics.js';
import { Logger, taskManagerCli, uploadErrorMessageToTaskManager } from './settings/external.js';
import { defaultRunWithErrorHandling } from './help-functions/tasks.js';
import { TwitterDataFetcher } from './data-fetcher/twitter.js';

const MAX_TIMELINES_TO_FETCH = 15;

const twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.
Your response should be 1, 2, or 3 sentences (choose the length at random).
Your response should not contain any questions. Brief, concise statements only. The total character count MUST be less than {{maxTweetLength}}. No emojis. Use \\n\\n (double spaces) between statements if there are multiple statements in your response.`;

export const twitterActionTemplate =
  `
# INSTRUCTIONS: Determine actions for {{agentName}} (@{{twitterUserName}}) based on:
{{bio}}
{{postDirections}}

Guidelines:
- ONLY engage with content that DIRECTLY relates to character's core interests
- Direct mentions are priority IF they are on-topic
- Skip ALL content that is:
  - Off-topic or tangentially related
  - From high-profile accounts unless explicitly relevant
  - Generic/viral content without specific relevance
  - Political/controversial unless central to character
  - Promotional/marketing unless directly relevant

Actions (respond only with tags):
[LIKE] - Perfect topic match AND aligns with character (9.8/10)
[RETWEET] - Exceptional content that embodies character's expertise (9.5/10)
[QUOTE] - Can add substantial domain expertise (9.5/10)
[REPLY] - Can contribute meaningful, expert-level insight (9.5/10)

Tweet:
{{currentTweet}}

# Respond with qualifying action tags only. Default to NO action unless extremely confident of relevance.` +
  postActionResponseFooter;

interface PendingTweet {
  tweetTextForPosting: string;
  roomId: UUID;
  rawTweetContent: string;
  discordMessageId: string;
  channelId: string;
  timestamp: number;
}

type PendingTweetApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

class RuntimeTwitterPostHelper {
  private twitterDataFetcher: TwitterDataFetcher;

  constructor(
    private runtime: IAgentRuntime,
    private logger: pino.Logger<string, boolean>,
  ) {
    const pumpNewsApikey = this.runtime.getSetting('PUMPNEWS_API_KEY') || process.env?.PUMPNEWS_API_KEY;
    const twitterapiApikey = this.runtime.getSetting('TWITTERAPI_API_KEY') || process.env?.TWITTERAPI_API_KEY;
    this.twitterDataFetcher = new TwitterDataFetcher(pumpNewsApikey, twitterapiApikey);
  }

  private async handleRawTweetContent(rawTweetContent: string, maxTweetLength: number) {
    // First attempt to clean content
    let tweetTextForPosting = null;
    let mediaData = null;

    // Try parsing as JSON first
    const parsedResponse = parseJSONObjectFromText(rawTweetContent);
    if (parsedResponse?.text) {
      tweetTextForPosting = parsedResponse.text;
    } else {
      // If not JSON, use the raw text directly
      tweetTextForPosting = rawTweetContent.trim();
    }

    if (parsedResponse?.attachments && parsedResponse?.attachments.length > 0) {
      mediaData = await fetchMediaData(parsedResponse.attachments);
    }

    // Try extracting text attribute
    if (!tweetTextForPosting) {
      const parsingText = extractAttributes(rawTweetContent, ['text']).text;
      if (parsingText) {
        tweetTextForPosting = truncateToCompleteSentence(
          extractAttributes(rawTweetContent, ['text']).text,
          maxTweetLength,
        );
      }
    }

    // Use the raw text
    if (!tweetTextForPosting) {
      tweetTextForPosting = rawTweetContent;
    }

    // Truncate the content to the maximum tweet length specified in the environment settings, ensuring the truncation respects sentence boundaries.
    if (maxTweetLength) {
      tweetTextForPosting = truncateToCompleteSentence(
        tweetTextForPosting,
        maxTweetLength,
      );
    }

    const removeQuotes = (str: string) => str.replace(/^['"](.*)['"]$/, '$1');

    const fixNewLines = (str: string) => str.replaceAll(/\\n/g, '\n\n'); //ensures double spaces

    // Final cleaning
    tweetTextForPosting = removeQuotes(fixNewLines(tweetTextForPosting));

    return { tweetTextForPosting, mediaData };
  }

  /**
   * Generates and posts a new tweet. If isDryRun is true, only logs what would have been posted.
   */
  async generatePostTweet(username: string, max_tweet_length: number) {
    // it's better to using 4/5 MAX_LEN to prevent reach the limit
    const maxTweetLength = Math.floor((max_tweet_length * 4) / 5);

    if (this.runtime.character.topics.includes('crypto currency news')) {
      return await this.generateCryptoCurrencyNews(username, maxTweetLength);
    }

    const roomId = stringToUuid('twitter_generate_room-' + username);
    const topics = this.runtime.character.topics.join(', ');

    const state = await this.runtime.composeState(
      {
        userId: this.runtime.agentId,
        roomId: roomId,
        agentId: this.runtime.agentId,
        content: {
          text: topics || '',
          action: 'TWEET',
        },
      },
      {
        twitterUserName: username,
        maxTweetLength,
      },
    );

    const context = composeContext({
      state,
      template:
        this.runtime.character.templates?.twitterPostTemplate ||
        twitterPostTemplate,
    });

    this.logger.debug('generate post prompt:\n' + context);

    const response = await generateText({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.SMALL,
    });

    const rawTweetContent = cleanJsonResponse(response);
    const { tweetTextForPosting, mediaData } = await this.handleRawTweetContent(
      rawTweetContent,
      maxTweetLength,
    );

    return { tweetTextForPosting, rawTweetContent, mediaData, roomId };
  }

  private async generateCryptoCurrencyNews(username: string, maxTweetLength: number) {
    const roomId = stringToUuid('twitter_generate_room-' + username);
    const topics = this.runtime.character.topics.join(', ');

    let tokenTweets: {
      symbol: string;
      tweetContents: string[];
    };
    const trendingTokens = await getTrendingTokens(
      this.runtime.getSetting('BIRDEYE_API_KEY'),
    );
    for (const item of trendingTokens) {
      const itemKey = 'token:analysis:' + item.symbol;
      const postTime: number | undefined =
        await this.runtime.cacheManager.get(itemKey);
      if (postTime && Date.now() - postTime < 1000 * 60 * 60 * 12) {
        continue;
      }
      
      const tweets = await this.twitterDataFetcher.fetchTweets({ address: item.address, symbol: item.symbol });
      if (tweets.length < 8) {
        continue;
      }

      tokenTweets = {
        symbol: item.symbol,
        tweetContents: tweets,
      };
      Logger.log(
        `Found trending token:, ${item.symbol} with ${tweets.length} tweets`,
      );
      await this.runtime.cacheManager.set(itemKey, Date.now());
      break;
    }

    let additionalKeys: { [key: string]: any };
    let template: TemplateType;
    if (tokenTweets) {
      additionalKeys = {
        twitterUserName: username,
        maxTweetLength,
        tokenSymbol: tokenTweets?.symbol,
        tweetContents: tokenTweets?.tweetContents,
      };
      template = this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate;
    } else {
      additionalKeys = {
        twitterUserName: username,
        maxTweetLength,
        trendingTokens: trendingTokens.map((item) => item.symbol).join(', '),
      };
      template = template = this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate;
    }

    const state = await this.runtime.composeState(
      {
        userId: this.runtime.agentId,
        roomId: roomId,
        agentId: this.runtime.agentId,
        content: {
          text: topics || '',
          action: 'TWEET',
        },
      },
      additionalKeys,
    );

    const context = composeContext({
      state,
      template,
    });

    this.logger.debug('generate post prompt:\n' + context);

    const response = await generateText({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.SMALL,
    });

    const rawTweetContent = cleanJsonResponse(response);
    const { tweetTextForPosting, mediaData } = await this.handleRawTweetContent(
      rawTweetContent,
      maxTweetLength,
    );

    return { tweetTextForPosting, rawTweetContent, mediaData, roomId };
  }
}

export class TwitterPostClient {
  client: ClientBase;
  runtime: IAgentRuntime;
  twitterUsername: string;
  private approvalCheckInterval: number;

  private isProcessing = false;
  private lastProcessTime = 0;
  private isDryRun: boolean;
  private discordClientForApproval: Client;
  private approvalRequired = false;
  private discordApprovalChannelId: string;
  private runtimeTwitterPostHelper: RuntimeTwitterPostHelper;

  private backendTaskStatus: {
    // 0 stopped, 1 running, 2 completed, 4 exit
    generateNewTweet: number;
    processTweetActions: number;
    runPendingTweetCheck: number;
  } = {
      generateNewTweet: 2,
      processTweetActions: 2,
      runPendingTweetCheck: 2,
    };

  private logger: pino.Logger<string, boolean>;

  constructor(client: ClientBase, runtime: IAgentRuntime) {
    this.client = client;
    this.runtime = runtime;
    this.logger = client.logger;
    this.twitterUsername = this.client.twitterConfig.TWITTER_USERNAME;
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;
    this.runtimeTwitterPostHelper = new RuntimeTwitterPostHelper(
      this.runtime,
      this.logger,
    );

    // Log configuration on initialization
    // this.logger.log('Twitter Client Configuration:');
    // this.logger.log(`- Username: ${this.twitterUsername}`);
    this.logger.log(
      `- Dry Run Mode: ${this.isDryRun ? 'enabled' : 'disabled'}`,
    );

    this.logger.log(
      `- Enable Post: ${this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION ? 'enabled' : 'disabled'}`,
    );

    this.logger.log(
      `- Post Interval: ${this.client.twitterConfig.POST_INTERVAL_MIN}-${this.client.twitterConfig.POST_INTERVAL_MAX} minutes`,
    );
    this.logger.log(
      `- Action Processing: ${this.client.twitterConfig.ENABLE_ACTION_PROCESSING
        ? 'enabled'
        : 'disabled'
      }`,
    );
    this.logger.log(
      `- Action Interval: ${this.client.twitterConfig.ACTION_INTERVAL} minutes`,
    );
    this.logger.log(
      `- Post Immediately: ${this.client.twitterConfig.POST_IMMEDIATELY ? 'enabled' : 'disabled'
      }`,
    );
    this.logger.log(
      `- Search Enabled: ${this.client.twitterConfig.TWITTER_SEARCH_ENABLE ? 'enabled' : 'disabled'
      }`,
    );

    const targetUsers = this.client.twitterConfig.TWITTER_TARGET_USERS;
    if (targetUsers) {
      this.logger.log(`- Target Users: ${targetUsers}`);
    }

    if (this.isDryRun) {
      this.logger.log(
        'Twitter client initialized in dry run mode - no actual tweets should be posted',
      );
    }

    // Initialize Discord webhook
    const approvalRequired = this.client.twitterConfig.TWITTER_APPROVAL_ENABLED;
    if (approvalRequired) {
      const discordToken = this.runtime.getSetting(
        'TWITTER_APPROVAL_DISCORD_BOT_TOKEN',
      );
      const approvalChannelId = this.runtime.getSetting(
        'TWITTER_APPROVAL_DISCORD_CHANNEL_ID',
      );

      this.approvalCheckInterval = this.client.twitterConfig.APPROVAL_CHECK_INTERVAL || 5 * 60 * 1000;

      if (!discordToken || !approvalChannelId) {
        throw new Error(
          'TWITTER_APPROVAL_DISCORD_BOT_TOKEN and TWITTER_APPROVAL_DISCORD_CHANNEL_ID are required for approval workflow',
        );
      }

      this.approvalRequired = true;
      this.discordApprovalChannelId = approvalChannelId;

      // Set up Discord client event handlers
      this.setupDiscordClient();
    }
  }

  private setupDiscordClient() {
    this.discordClientForApproval = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });
    this.discordClientForApproval.once(Events.ClientReady, (readyClient) => {
      this.logger.log(`Discord bot is ready as ${readyClient.user.tag}!`);

      // Generate invite link with required permissions
      const invite = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274877991936&scope=bot`;
      // 274877991936 includes permissions for:
      // - Send Messages
      // - Read Messages/View Channels
      // - Read Message History

      this.logger.log(
        `Use this link to properly invite the Twitter Post Approval Discord bot: ${invite}`,
      );
    });
    // Login to Discord
    this.discordClientForApproval.login(
      this.runtime.getSetting('TWITTER_APPROVAL_DISCORD_BOT_TOKEN'),
    );
  }

  private async generateNewTweetLoop() {
    let lastDelay: number;

    await defaultRunWithErrorHandling(
      'generateNewTweetLoop',
      this.client.twitterConfig.TWITTER_USERNAME,
      this.client.runtime.agentId,
      (value?: number) => {
        if (value !== undefined) {
          this.backendTaskStatus.generateNewTweet = value;
        }
        return this.backendTaskStatus.generateNewTweet;
      },
      async () => {
        const lastPost = await this.runtime.cacheManager.get<{
          timestamp: number;
          id?: string;
        }>(`twitter/${this.client.profile.username}/lastPost`);
    
        const lastPostTimestamp = lastPost?.timestamp ?? 0;
        const minMinutes = this.client.twitterConfig.POST_INTERVAL_MIN;
        const maxMinutes = this.client.twitterConfig.POST_INTERVAL_MAX;
        const randomMinutes =
          Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
        const delay = randomMinutes * 60 * 1000;

        this.logger.info("Next tweet scheduled at " + new Date(lastPostTimestamp + delay).toISOString());
        while (Date.now() <= lastPostTimestamp + (lastDelay ?? delay)) {
          // 1 minute
          await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
        }

        await this.generateNewTweet();
        lastDelay = delay;
        return delay;
      },
    );
  }

  private async processActionsLoop() {
    const actionInterval = this.client.twitterConfig.ACTION_INTERVAL; // Defaults to 5 minutes

    await defaultRunWithErrorHandling(
      'processActionsLoop',
      this.client.twitterConfig.TWITTER_USERNAME,
      this.client.runtime.agentId,
      (value?: number) => {
        if (value !== undefined) {
          this.backendTaskStatus.processTweetActions = value;
        }
        return this.backendTaskStatus.processTweetActions
      },
      async () => {
        const results = await this.processTweetActions();
        if (results) {
          this.logger.log(`Processed ${results.length} tweets`);
          this.logger.log(
            `Next action processing scheduled in ${actionInterval} minutes`,
          );
        }
        return undefined;
      },
      {
        checkInterval: actionInterval * 60 * 1000, // now in minutes
      }
    );
  }

  private async runPendingTweetCheckLoop() {
    await defaultRunWithErrorHandling(
      'runPendingTweetCheckLoop',
      this.client.twitterConfig.TWITTER_USERNAME,
      this.client.runtime.agentId,
      (value?: number) => {
        if (value !== undefined) {
          this.backendTaskStatus.runPendingTweetCheck = value;
        }
        return this.backendTaskStatus.runPendingTweetCheck
      },
      async () => {
        await this.handlePendingTweet();
        return undefined;
      },
      {
        checkInterval: this.approvalCheckInterval,
      }
    );
  }

  async start() {
    if (!this.client.profile) {
      await this.client.init();
    }

    if (this.client.twitterConfig.POST_IMMEDIATELY) {
      await this.generateNewTweet();
      // wait 1min to let the tweet be posted and prevent the generateNewTweetLoop generate a new tweet next immediately
      await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    }

    if (this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION) {
      this.generateNewTweetLoop();
    }

    if (this.client.twitterConfig.ENABLE_ACTION_PROCESSING) {
      this.processActionsLoop();
    }

    // Start the pending tweet check loop if enabled
    if (this.approvalRequired) this.runPendingTweetCheckLoop();
  }

  createTweetObject(
    tweetResult: any,
    client: any,
    twitterUsername: string,
  ): Tweet {
    return {
      id: tweetResult.rest_id,
      name: client.profile.screenName,
      username: client.profile.username,
      text: tweetResult.legacy.full_text,
      conversationId: tweetResult.legacy.conversation_id_str,
      createdAt: tweetResult.legacy.created_at,
      timestamp: new Date(tweetResult.legacy.created_at).getTime(),
      userId: client.profile.id,
      inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
      permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
      hashtags: [],
      mentions: [],
      photos: [],
      thread: [],
      urls: [],
      videos: [],
    } as Tweet;
  }

  async processAndCacheTweet(
    runtime: IAgentRuntime,
    client: ClientBase,
    tweet: Tweet,
    roomId: UUID,
    rawTweetContent: string,
  ) {
    // Cache the last post details
    await runtime.cacheManager.set(
      `twitter/${client.profile.username}/lastPost`,
      {
        id: tweet.id,
        timestamp: Date.now(),
      },
    );

    // Cache the tweet
    await client.runtimeHelper.cacheTweet(tweet);

    // Log the posted tweet
    this.logger.log(`Tweet posted:\n ${tweet.permanentUrl}`);

    // Ensure the room and participant exist
    await runtime.ensureRoomExists(roomId);
    await runtime.ensureParticipantInRoom(runtime.agentId, roomId);

    // Create a memory for the tweet
    await runtime.messageManager.createMemory({
      id: stringToUuid(tweet.id + '-' + runtime.agentId),
      userId: runtime.agentId,
      agentId: runtime.agentId,
      content: {
        text: rawTweetContent.trim(),
        url: tweet.permanentUrl,
        source: 'twitter',
      },
      roomId,
      embedding: getEmbeddingZeroVector(),
      createdAt: tweet.timestamp,
    });
  }

  async handleNoteTweet(
    client: ClientBase,
    content: string,
    tweetId?: string,
    mediaData?: MediaData[],
  ) {
    try {
      const noteTweetResult = await client.requestQueue.add(
        async () =>
          await client.twitterClient.sendNoteTweet(content, tweetId, mediaData),
      );

      if (noteTweetResult.errors && noteTweetResult.errors.length > 0) {
        // Note Tweet failed due to authorization. Falling back to standard Tweet.
        const truncateContent = truncateToCompleteSentence(
          content,
          this.client.twitterConfig.MAX_TWEET_LENGTH,
        );
        return await this.sendStandardTweet(client, truncateContent, tweetId);
      } else {
        return noteTweetResult.data.notetweet_create.tweet_results.result;
      }
    } catch (error) {
      throw new Error(`Note Tweet failed: ${error}`);
    }
  }

  async sendStandardTweet(
    client: ClientBase,
    content: string,
    tweetId?: string,
    mediaData?: MediaData[],
  ) {
    try {
      const standardTweetResult = await client.requestQueue.add(
        async () =>
          await client.twitterClient.sendTweet(content, tweetId, mediaData),
      );
      /**
       * const body = {
          errors: [
            {
              "message": "Authorization: Status is a duplicate. (187)",
              "locations": [
                {
                  "line": 18,
                  "column": 3
                }
              ],
              "path": [
                "create_tweet"
              ],
              "extensions": {
                "name": "AuthorizationError",
                "source": "Client",
                "code": 187,
                "kind": "Permissions",
                "tracing": {
                  "trace_id": "xx"
                }
              },
              "code": 187,
              "kind": "Permissions",
              "name": "AuthorizationError",
              "source": "Client",
              "tracing": {
                "trace_id": "xx"
              }
            }
          ],
          data: {}
        }
       */
      const body = await standardTweetResult.json();
      if (!body?.data?.create_tweet?.tweet_results?.result) {
        const errorCode = body?.errors?.[0]?.code;
        if (errorCode === 187) {
          this.logger.warn(
            `Authorization: Status is a duplicate. (187), content: ${content}`,
          );
        } else {
          // "Authorization: Denied by access control: Missing TwitterUserNotSuspended"
          if (body?.errors?.[0]?.message === 'Authorization: Denied by access control: Missing TwitterUserNotSuspended') {
            // upload the info to task-manager, so that do not retry again
            await taskManagerCli.tasksControllerSuspendedTask(this.twitterUsername);
            this.logger.error(`${this.twitterUsername} Account suspended`);
          }

          this.logger.error('Error sending tweet; Bad response:', body);
          // TODO fix 'Authorization: Status is a duplicate. (187)'
          this.logger.error(
            `Error sending tweet; contentLen: ${content.length}, content: ${content}`,
          );
        }
        return;
      }
      return body.data.create_tweet.tweet_results.result;
    } catch (error) {
      // console.log(error)
      this.logger.error('Error sending standard Tweet:', error);
      throw error;
    }
  }

  async postTweet(
    runtime: IAgentRuntime,
    client: ClientBase,
    tweetTextForPosting: string,
    roomId: UUID,
    rawTweetContent: string,
    twitterUsername: string,
    mediaData?: MediaData[],
  ) {
    try {
      this.logger.log(`Posting new tweet:\n`);

      let result;

      if (tweetTextForPosting.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(
          client,
          tweetTextForPosting,
          undefined,
          mediaData,
        );
      } else {
        result = await this.sendStandardTweet(
          client,
          tweetTextForPosting,
          undefined,
          mediaData,
        );
      }

      if (result === undefined) {
        this.logger.error('Error sending tweet; result is undefined');
        return;
      }

      twitterPostCount.labels(twitterUsername).inc();

      const tweet = this.createTweetObject(result, client, twitterUsername);

      await this.processAndCacheTweet(
        runtime,
        client,
        tweet,
        roomId,
        rawTweetContent,
      );
    } catch (error) {
      this.logger.error('postTweet Error sending tweet:', error);
    }
  }

  /**
   * Generates and posts a new tweet. If isDryRun is true, only logs what would have been posted.
   */
  async generateNewTweet() {
    try {
      this.logger.log('generatePostTweet start');
      let postTweet = await this.runtimeTwitterPostHelper.generatePostTweet(
        this.client.profile.username,
        this.client.twitterConfig.MAX_TWEET_LENGTH,
      );
      this.logger.log('generatePostTweet end');

      // check if the tweet content is duplicate
      // fix 'Authorization: Status is a duplicate. (187)'
      const lastPost = await this.runtime.cacheManager.get<{
        timestamp: number;
        id?: string;
      }>(`twitter/${this.client.profile.username}/lastPost`);
      if (lastPost && lastPost.id) {
        const lastPostContent = await this.runtime.messageManager.getMemoryById(
          stringToUuid(lastPost.id + '-' + this.runtime.agentId),
        );
        if (lastPostContent?.content.text === postTweet.tweetTextForPosting) {
          this.logger.warn(
            `The tweet content is the same as the last post, skipping: ${postTweet.tweetTextForPosting}`,
          );
          // retry once
          postTweet = await this.runtimeTwitterPostHelper.generatePostTweet(
            this.client.profile.username,
            this.client.twitterConfig.MAX_TWEET_LENGTH,
          );
        }
      }

      if (this.isDryRun) {
        this.logger.info(
          `Dry run: would have posted tweet: ${postTweet.tweetTextForPosting}`,
        );
        return;
      }

      this.logger.log('postTweet start');
      if (this.approvalRequired) {
        // Send for approval instead of posting directly
        this.logger.log(
          `Sending Tweet For Approval:\n ${postTweet.tweetTextForPosting}`,
        );
        await this.sendForApproval(
          postTweet.tweetTextForPosting,
          postTweet.roomId,
          postTweet.rawTweetContent,
        );
        this.logger.log('Tweet sent for approval');
      } else {
        this.logger.log(
          `Posting new tweet:\n ${postTweet.tweetTextForPosting}`,
        );
        this.postTweet(
          this.runtime,
          this.client,
          postTweet.tweetTextForPosting,
          postTweet.roomId,
          postTweet.rawTweetContent,
          this.twitterUsername,
          postTweet.mediaData,
        ).catch((error) => {
          uploadErrorMessageToTaskManager(
            this.client.twitterConfig.TWITTER_USERNAME,
            this.client.runtime.agentId,
            error,
          );
          this.logger.error('Error posting tweet:', error);
        });
      }
      this.logger.log('postTweet end');
    } catch (error) {
      throw new Error(
        `generateNewTweet: ${error}`,
      );
    }
  }

  private async generateTweetContent(
    tweetState: any,
    options?: {
      template?: TemplateType;
      context?: string;
    },
  ): Promise<string> {
    const context = composeContext({
      state: tweetState,
      template:
        options?.template ||
        this.runtime.character.templates?.twitterPostTemplate ||
        twitterPostTemplate,
    });

    const response = await generateText({
      runtime: this.runtime,
      context: options?.context || context,
      modelClass: ModelClass.SMALL,
    });

    this.logger.log('generate tweet content response:\n' + response);

    // First clean up any markdown and newlines
    const cleanedResponse = cleanJsonResponse(response);

    // Try to parse as JSON first
    const jsonResponse = parseJSONObjectFromText(cleanedResponse);
    if (jsonResponse.text) {
      const truncateContent = truncateToCompleteSentence(
        jsonResponse.text,
        this.client.twitterConfig.MAX_TWEET_LENGTH,
      );
      return truncateContent;
    }
    if (typeof jsonResponse === 'object') {
      const possibleContent =
        jsonResponse.content || jsonResponse.message || jsonResponse.response;
      if (possibleContent) {
        const truncateContent = truncateToCompleteSentence(
          possibleContent,
          this.client.twitterConfig.MAX_TWEET_LENGTH,
        );
        return truncateContent;
      }
    }

    let truncateContent = null;
    // Try extracting text attribute
    const parsingText = extractAttributes(cleanedResponse, ['text']).text;
    if (parsingText) {
      truncateContent = truncateToCompleteSentence(
        parsingText,
        this.client.twitterConfig.MAX_TWEET_LENGTH,
      );
    }

    if (!truncateContent) {
      // If not JSON or no valid content found, clean the raw text
      truncateContent = truncateToCompleteSentence(
        cleanedResponse,
        this.client.twitterConfig.MAX_TWEET_LENGTH,
      );
    }

    return truncateContent;
  }

  /**
   * Processes tweet actions (likes, retweets, quotes, replies). If isDryRun is true,
   * only simulates and logs actions without making API calls.
   */
  private async processTweetActions() {
    if (this.isProcessing) {
      this.logger.log('Already processing tweet actions, skipping');
      return null;
    }

    try {
      this.isProcessing = true;
      this.lastProcessTime = Date.now();

      this.logger.log('Processing tweet actions');

      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.twitterUsername,
        this.runtime.character.name,
        'twitter',
      );

      const timelines = await this.client.fetchTimelineForActions(
        MAX_TIMELINES_TO_FETCH,
      );
      const maxActionsProcessing =
        this.client.twitterConfig.MAX_ACTIONS_PROCESSING;
      const processedTimelines = [];

      for (const tweet of timelines) {
        try {
          // Skip if we've already processed this tweet
          const memory = await this.runtime.messageManager.getMemoryById(
            stringToUuid(tweet.id + '-' + this.runtime.agentId),
          );
          if (memory) {
            this.logger.log(`Already processed tweet ID: ${tweet.id}`);
            continue;
          }

          const roomId = stringToUuid(
            tweet.conversationId + '-' + this.runtime.agentId,
          );

          const tweetState = await this.runtime.composeState(
            {
              userId: this.runtime.agentId,
              roomId,
              agentId: this.runtime.agentId,
              content: { text: '', action: '' },
            },
            {
              twitterUserName: this.twitterUsername,
              currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})\nText: ${tweet.text}`,
            },
          );

          const actionContext = composeContext({
            state: tweetState,
            template:
              this.runtime.character.templates?.twitterActionTemplate ||
              twitterActionTemplate,
          });

          const actionResponse = await generateTweetActions({
            runtime: this.runtime,
            context: actionContext,
            modelClass: ModelClass.SMALL,
          });

          if (!actionResponse) {
            this.logger.log(`No valid actions generated for tweet ${tweet.id}`);
            continue;
          }
          processedTimelines.push({
            tweet: tweet,
            actionResponse: actionResponse,
            tweetState: tweetState,
            roomId: roomId,
          });
        } catch (error) {
          this.logger.error(`Error processing tweet ${tweet.id}:`, error);
          continue;
        }
      }

      const sortProcessedTimeline = (arr: typeof processedTimelines) => {
        return arr.sort((a, b) => {
          // Count the number of true values in the actionResponse object
          const countTrue = (obj: typeof a.actionResponse) =>
            Object.values(obj).filter(Boolean).length;

          const countA = countTrue(a.actionResponse);
          const countB = countTrue(b.actionResponse);

          // Primary sort by number of true values
          if (countA !== countB) {
            return countB - countA;
          }

          // Secondary sort by the "like" property
          if (a.actionResponse.like !== b.actionResponse.like) {
            return a.actionResponse.like ? -1 : 1;
          }

          // Tertiary sort keeps the remaining objects with equal weight
          return 0;
        });
      };
      // Sort the timeline based on the action decision score,
      // then slice the results according to the environment variable to limit the number of actions per cycle.
      const sortedTimelines = sortProcessedTimeline(processedTimelines).slice(
        0,
        maxActionsProcessing,
      );

      return this.processTimelineActions(sortedTimelines); // Return results array to indicate completion
    } catch (error) {
      this.logger.error('Error in processTweetActions:', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processes a list of timelines by executing the corresponding tweet actions.
   * Each timeline includes the tweet, action response, tweet state, and room context.
   * Results are returned for tracking completed actions.
   *
   * @param timelines - Array of objects containing tweet details, action responses, and state information.
   * @returns A promise that resolves to an array of results with details of executed actions.
   */
  private async processTimelineActions(
    timelines: {
      tweet: Tweet;
      actionResponse: ActionResponse;
      tweetState: State;
      roomId: UUID;
    }[],
  ): Promise<
    {
      tweetId: string;
      actionResponse: ActionResponse;
      executedActions: string[];
    }[]
  > {
    const results = [];
    for (const timeline of timelines) {
      const { actionResponse, tweetState, roomId, tweet } = timeline;
      try {
        const executedActions: string[] = [];
        // Execute actions
        if (actionResponse.like) {
          if (this.isDryRun) {
            this.logger.info(`Dry run: would have liked tweet ${tweet.id}`);
            executedActions.push('like (dry run)');
          } else {
            try {
              await this.client.twitterClient.likeTweet(tweet.id);
              executedActions.push('like');
              this.logger.log(`Liked tweet ${tweet.id}`);
            } catch (error) {
              this.logger.error(`Error liking tweet ${tweet.id}:`, error);
            }
          }
        }

        if (actionResponse.retweet) {
          if (this.isDryRun) {
            this.logger.info(`Dry run: would have retweeted tweet ${tweet.id}`);
            executedActions.push('retweet (dry run)');
          } else {
            try {
              await this.client.twitterClient.retweet(tweet.id);
              executedActions.push('retweet');
              this.logger.log(`Retweeted tweet ${tweet.id}`);
            } catch (error) {
              this.logger.error(`Error retweeting tweet ${tweet.id}:`, error);
            }
          }
        }

        if (actionResponse.quote) {
          try {
            // Build conversation thread for context
            const thread = await buildConversationThread(tweet, this.client);
            const formattedConversation = thread
              .map(
                (t) =>
                  `@${t.username} (${new Date(
                    t.timestamp * 1000,
                  ).toLocaleString()}): ${t.text}`,
              )
              .join('\n\n');

            // Generate image descriptions if present
            const imageDescriptions = [];
            if (tweet.photos?.length > 0) {
              this.logger.log('Processing images in tweet for context');
              for (const photo of tweet.photos) {
                const description = await this.runtime
                  .getService<IImageDescriptionService>(
                    ServiceType.IMAGE_DESCRIPTION,
                  )
                  .describeImage(photo.url);
                imageDescriptions.push(description);
              }
            }

            // Handle quoted tweet if present
            let quotedContent = '';
            if (tweet.quotedStatusId) {
              try {
                const quotedTweet = await this.client.twitterClient.getTweet(
                  tweet.quotedStatusId,
                );
                if (quotedTweet) {
                  quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
                }
              } catch (error) {
                this.logger.error('Error fetching quoted tweet:', error);
              }
            }

            // Compose rich state with all context
            const enrichedState = await this.runtime.composeState(
              {
                userId: this.runtime.agentId,
                roomId: stringToUuid(
                  tweet.conversationId + '-' + this.runtime.agentId,
                ),
                agentId: this.runtime.agentId,
                content: {
                  text: tweet.text,
                  action: 'QUOTE',
                },
              },
              {
                twitterUserName: this.twitterUsername,
                currentPost: `From @${tweet.username}: ${tweet.text}`,
                formattedConversation,
                imageContext:
                  imageDescriptions.length > 0
                    ? `\nImages in Tweet:\n${imageDescriptions
                      .map((desc, i) => `Image ${i + 1}: ${desc}`)
                      .join('\n')}`
                    : '',
                quotedContent,
              },
            );

            const quoteContent = await this.generateTweetContent(
              enrichedState,
              {
                template:
                  this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                  twitterMessageHandlerTemplate,
              },
            );

            if (!quoteContent) {
              this.logger.error('Failed to generate valid quote tweet content');
              return;
            }

            this.logger.log('Generated quote tweet content:', quoteContent);
            // Check for dry run mode
            if (this.isDryRun) {
              this.logger.info(
                `Dry run: A quote tweet for tweet ID ${tweet.id} would have been posted with the following content: "${quoteContent}".`,
              );
              executedActions.push('quote (dry run)');
            } else {
              // Send the tweet through request queue
              const result = await this.client.requestQueue.add(
                async () =>
                  await this.client.twitterClient.sendQuoteTweet(
                    quoteContent,
                    tweet.id,
                  ),
              );

              const body = await result.json();

              if (body?.data?.create_tweet?.tweet_results?.result) {
                this.logger.log('Successfully posted quote tweet');
                executedActions.push('quote');

                // Cache generation context for debugging
                await this.runtime.cacheManager.set(
                  `twitter/quote_generation_${tweet.id}.txt`,
                  `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`,
                );
              } else {
                this.logger.error('Quote tweet creation failed:', body);
              }
            }
          } catch (error) {
            this.logger.error('Error in quote tweet generation:', error);
          }
        }

        if (actionResponse.reply) {
          try {
            await this.handleTextOnlyReply(tweet, tweetState, executedActions);
          } catch (error) {
            this.logger.error(`Error replying to tweet ${tweet.id}:`, error);
          }
        }

        // Add these checks before creating memory
        await this.runtime.ensureRoomExists(roomId);
        await this.runtime.ensureUserExists(
          stringToUuid(tweet.userId),
          tweet.username,
          tweet.name,
          'twitter',
        );
        await this.runtime.ensureParticipantInRoom(
          this.runtime.agentId,
          roomId,
        );

        if (!this.isDryRun) {
          // Then create the memory
          await this.runtime.messageManager.createMemory({
            id: stringToUuid(tweet.id + '-' + this.runtime.agentId),
            userId: stringToUuid(tweet.userId),
            content: {
              text: tweet.text,
              url: tweet.permanentUrl,
              source: 'twitter',
              action: executedActions.join(','),
            },
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: tweet.timestamp * 1000,
          });
        }

        results.push({
          tweetId: tweet.id,
          actionResponse: actionResponse,
          executedActions,
        });
      } catch (error) {
        this.logger.error(`Error processing tweet ${tweet.id}:`, error);
        continue;
      }
    }

    return results;
  }

  /**
   * Handles text-only replies to tweets. If isDryRun is true, only logs what would
   * have been replied without making API calls.
   */
  private async handleTextOnlyReply(
    tweet: Tweet,
    tweetState: any,
    executedActions: string[],
  ) {
    try {
      // Build conversation thread for context
      const thread = await buildConversationThread(tweet, this.client);
      const formattedConversation = thread
        .map(
          (t) =>
            `@${t.username} (${new Date(
              t.timestamp * 1000,
            ).toLocaleString()}): ${t.text}`,
        )
        .join('\n\n');

      // Generate image descriptions if present
      const imageDescriptions = [];
      if (tweet.photos?.length > 0) {
        this.logger.log('Processing images in tweet for context');
        for (const photo of tweet.photos) {
          const description = await this.runtime
            .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
            .describeImage(photo.url);
          imageDescriptions.push(description);
        }
      }

      // Handle quoted tweet if present
      let quotedContent = '';
      if (tweet.quotedStatusId) {
        try {
          const quotedTweet = await this.client.twitterClient.getTweet(
            tweet.quotedStatusId,
          );
          if (quotedTweet) {
            quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
          }
        } catch (error) {
          this.logger.error('Error fetching quoted tweet:', error);
        }
      }

      // Compose rich state with all context
      const enrichedState = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId: stringToUuid(
            tweet.conversationId + '-' + this.runtime.agentId,
          ),
          agentId: this.runtime.agentId,
          content: { text: tweet.text, action: '' },
        },
        {
          twitterUserName: this.twitterUsername,
          currentPost: `From @${tweet.username}: ${tweet.text}`,
          formattedConversation,
          imageContext:
            imageDescriptions.length > 0
              ? `\nImages in Tweet:\n${imageDescriptions
                .map((desc, i) => `Image ${i + 1}: ${desc}`)
                .join('\n')}`
              : '',
          quotedContent,
        },
      );

      // Generate and clean the reply content
      const replyText = await this.generateTweetContent(enrichedState, {
        template:
          this.runtime.character.templates?.twitterMessageHandlerTemplate ||
          twitterMessageHandlerTemplate,
      });

      if (!replyText) {
        this.logger.error('Failed to generate valid reply content');
        return;
      }

      if (this.isDryRun) {
        this.logger.info(
          `Dry run: reply to tweet ${tweet.id} would have been: ${replyText}`,
        );
        executedActions.push('reply (dry run)');
        return;
      }

      this.logger.debug('Final reply text to be sent:', replyText);

      let result;

      if (replyText.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(this.client, replyText, tweet.id);
      } else {
        result = await this.sendStandardTweet(this.client, replyText, tweet.id);
      }

      if (result) {
        this.logger.log('Successfully posted reply tweet');
        executedActions.push('reply');

        // Cache generation context for debugging
        await this.runtime.cacheManager.set(
          `twitter/reply_generation_${tweet.id}.txt`,
          `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`,
        );
      } else {
        this.logger.error('Tweet reply creation failed');
      }
    } catch (error) {
      this.logger.error('Error in handleTextOnlyReply:', error);
    }
  }

  // if false, should stop again
  async stop(): Promise<boolean> {
    // set stats to 0, stop the loop
    this.backendTaskStatus.generateNewTweet = 0;
    this.backendTaskStatus.processTweetActions = 0;
    this.backendTaskStatus.runPendingTweetCheck = 0;

    // check if all loop exit
    return [
      this.backendTaskStatus.generateNewTweet,
      this.backendTaskStatus.processTweetActions,
      this.backendTaskStatus.runPendingTweetCheck
    ].every(status => status === 4);
  }

  private async sendForApproval(
    tweetTextForPosting: string,
    roomId: UUID,
    rawTweetContent: string,
  ): Promise<string | null> {
    try {
      const embed = {
        title: 'New Tweet Pending Approval',
        description: tweetTextForPosting,
        fields: [
          {
            name: 'Character',
            value: this.client.profile.username,
            inline: true,
          },
          {
            name: 'Length',
            value: tweetTextForPosting.length.toString(),
            inline: true,
          },
        ],
        footer: {
          text: "Reply with '👍' to post or '❌' to discard, This will automatically expire and remove after 24 hours if no response received",
        },
        timestamp: new Date().toISOString(),
      };

      const channel = await this.discordClientForApproval.channels.fetch(
        this.discordApprovalChannelId,
      );

      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error('Invalid approval channel');
      }

      const message = await channel.send({ embeds: [embed] });

      // Store the pending tweet
      const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
      const currentPendingTweets =
        (await this.runtime.cacheManager.get<PendingTweet[]>(
          pendingTweetsKey,
        )) || [];
      // Add new pending tweet
      currentPendingTweets.push({
        tweetTextForPosting,
        roomId,
        rawTweetContent,
        discordMessageId: message.id,
        channelId: this.discordApprovalChannelId,
        timestamp: Date.now(),
      });

      // Store updated array
      await this.runtime.cacheManager.set(
        pendingTweetsKey,
        currentPendingTweets,
      );

      return message.id;
    } catch (error) {
      this.logger.error('Error Sending Twitter Post Approval Request:', error);
      return null;
    }
  }

  private async checkApprovalStatus(
    discordMessageId: string,
  ): Promise<PendingTweetApprovalStatus> {
    try {
      // Fetch message and its replies from Discord
      const channel = await this.discordClientForApproval.channels.fetch(
        this.discordApprovalChannelId,
      );

      this.logger.log(`channel ${JSON.stringify(channel)}`);

      if (!(channel instanceof TextChannel)) {
        this.logger.error('Invalid approval channel');
        return 'PENDING';
      }

      // Fetch the original message and its replies
      const message = await channel.messages.fetch(discordMessageId);

      // Look for thumbs up reaction ('👍')
      const thumbsUpReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === '👍',
      );

      // Look for reject reaction ('❌')
      const rejectReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === '❌',
      );

      // Check if the reaction exists and has reactions
      if (rejectReaction) {
        const count = rejectReaction.count;
        if (count > 0) {
          return 'REJECTED';
        }
      }

      // Check if the reaction exists and has reactions
      if (thumbsUpReaction) {
        // You might want to check for specific users who can approve
        // For now, we'll return true if anyone used thumbs up
        const count = thumbsUpReaction.count;
        if (count > 0) {
          return 'APPROVED';
        }
      }

      return 'PENDING';
    } catch (error) {
      this.logger.error('Error checking approval status:', error);
      return 'PENDING';
    }
  }

  private async cleanupPendingTweet(discordMessageId: string) {
    const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
    const currentPendingTweets =
      (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) ||
      [];

    // Remove the specific tweet
    const updatedPendingTweets = currentPendingTweets.filter(
      (tweet) => tweet.discordMessageId !== discordMessageId,
    );

    if (updatedPendingTweets.length === 0) {
      await this.runtime.cacheManager.delete(pendingTweetsKey);
    } else {
      await this.runtime.cacheManager.set(
        pendingTweetsKey,
        updatedPendingTweets,
      );
    }
  }

  private async handlePendingTweet() {
    this.logger.log('Checking Pending Tweets...');
    const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
    const pendingTweets =
      (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) ||
      [];

    for (const pendingTweet of pendingTweets) {
      // Check if tweet is older than 24 hours
      const isExpired =
        Date.now() - pendingTweet.timestamp > 24 * 60 * 60 * 1000;

      if (isExpired) {
        this.logger.log('Pending tweet expired, cleaning up');

        // Notify on Discord about expiration
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId,
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId,
            );
            await originalMessage.reply(
              'This tweet approval request has expired (24h timeout).',
            );
          }
        } catch (error) {
          this.logger.error('Error sending expiration notification:', error);
        }

        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
        return;
      }

      // Check approval status
      this.logger.log('Checking approval status...');
      const approvalStatus: PendingTweetApprovalStatus =
        await this.checkApprovalStatus(pendingTweet.discordMessageId);

      if (approvalStatus === 'APPROVED') {
        this.logger.log('Tweet Approved, Posting');
        await this.postTweet(
          this.runtime,
          this.client,
          pendingTweet.tweetTextForPosting,
          pendingTweet.roomId,
          pendingTweet.rawTweetContent,
          this.twitterUsername,
        );

        // Notify on Discord about posting
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId,
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId,
            );
            await originalMessage.reply(
              'Tweet has been posted successfully! ✅',
            );
          }
        } catch (error) {
          this.logger.error('Error sending post notification:', error);
        }

        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
      } else if (approvalStatus === 'REJECTED') {
        this.logger.log('Tweet Rejected, Cleaning Up');
        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
        // Notify about Rejection of Tweet
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId,
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId,
            );
            await originalMessage.reply('Tweet has been rejected! ❌');
          }
        } catch (error) {
          this.logger.error('Error sending rejection notification:', error);
        }
      }
    }
  }
}

async function getTrendingTokens(birdeypeApiKey: string): Promise<
  {
    address: string;
    symbol: string;
    name: string;
  }[]
> {
  const url =
    'https://public-api.birdeye.so/defi/token_trending?sort_by=volume24hUSD&sort_type=desc&offset=0&limit=20';
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': birdeypeApiKey,
        accept: 'application/json',
        'x-chain': 'solana',
      },
    });
    const result = await response.json();
    return result?.data.tokens;
  } catch (error) {
    Logger.error(`Error fetching trending tokens:, error`);
    return null;
  }
}
