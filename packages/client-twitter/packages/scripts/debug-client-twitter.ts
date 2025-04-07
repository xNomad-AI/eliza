import path from 'path';
import {
  AgentRuntime,
  CacheManager,
  FsCacheAdapter,
  Character,
  IAgentRuntime,
  ModelProviderName,
} from '@elizaos/core';
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite';
import Database from 'better-sqlite3';
import express from 'express';
import { exit } from 'process';
import client from 'prom-client';
import { assert } from 'console';
import dotenv from 'dotenv';

import { TwitterClientInterface } from '@elizaos/client-twitter';
import { wrapperFetchFunction } from '@elizaos/client-twitter';

// import { register } from '../src/monitor/metrics';
dotenv.config();

const openApiKey = process.env.OPENAI_API_KEY;
assert(openApiKey, 'OPENAI_API_KEY is required');
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
assert(TWITTER_USERNAME, 'TWITTER_USERNAME is required');
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;
assert(TWITTER_PASSWORD, 'TWITTER_PASSWORD is required');
const TWITTER_2FA_SECRET = process.env.TWITTER_2FA_SECRET;
assert(TWITTER_2FA_SECRET, 'TWITTER_2FA_SECRET is required');
const TWITTER_EMAIL = process.env.TWITTER_EMAIL;
assert(TWITTER_EMAIL, 'TWITTER_EMAIL is required');
const TWITTER_HTTP_PROXY = process.env.TWITTER_HTTP_PROXY;
const TWITTER_TOPIC = process.env.TWITTER_TOPIC;
const TWITTER_POST_TEMPLATE = process.env.TWITTER_POST_TEMPLATE;

const register = client.register;
type UUID = `${string}-${string}-${string}-${string}-${string}`;
const baseDir = path.resolve(process.cwd(), 'data');

function initializeFsCache(character: Character) {
  const cacheDir = path.resolve(baseDir, character.id as any, 'cache');
  const cache = new CacheManager(new FsCacheAdapter(cacheDir));
  return cache;
}

function initCharacter(
  name: string,
  settings: Character['settings'],
): Character {
  return {
    id: name as UUID,
    name,
    modelProvider: ModelProviderName.OPENAI,
    bio: [],
    lore: [],
    messageExamples: [],
    postExamples: [],
    topics: TWITTER_TOPIC ? [TWITTER_TOPIC] : [],
    adjectives: [],
    clients: [],
    templates: {
      twitterPostTemplate: TWITTER_POST_TEMPLATE,
    },
    plugins: [],
    style: {
      all: [],
      chat: [],
      post: [],
    },
    settings,
  };
}

async function createRuntime(character: Character) {
  const filePath = path.resolve(baseDir, 'db.sqlite');
  const db = new SqliteDatabaseAdapter(new Database(filePath));
  const cache = initializeFsCache(character);

  // Test the connection
  db.init()
    .then(() => {
      console.log('Successfully connected to SQLite database');
    })
    .catch((error) => {
      console.error('Failed to connect to SQLite:', error);
    });

  const runtime = new AgentRuntime({
    databaseAdapter: db,
    cacheManager: cache,
    token: openApiKey!,
    modelProvider: ModelProviderName.OPENAI,
    character,
    fetch: TWITTER_HTTP_PROXY ? wrapperFetchFunction(TWITTER_HTTP_PROXY) : undefined,
  });

  runtime.getSetting;

  return runtime;
}

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Define a route to expose the metrics
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(err);
    }
  });

  // Start the Express server
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

async function start() {
  const characters: Character[] = [
    initCharacter('debug', {
      secrets: {
        TWITTER_DRY_RUN: 'false',
        TWITTER_USERNAME: TWITTER_USERNAME!,
        TWITTER_PASSWORD: TWITTER_PASSWORD!,
        TWITTER_2FA_SECRET: TWITTER_2FA_SECRET!,
        TWITTER_EMAIL: TWITTER_EMAIL!,
        TWITTER_HTTP_PROXY: TWITTER_HTTP_PROXY as any,

        MAX_TWEET_LENGTH: '200',
        TWITTER_SEARCH_ENABLE: 'false',
        POST_INTERVAL_MIN: '5',
        POST_INTERVAL_MAX: '10',
        ENABLE_TWITTER_POST_GENERATION: 'true',
      },
    }),
  ];
  const runtimes: IAgentRuntime[] = await Promise.all(
    characters.map(createRuntime),
  );

  for (const runtime of runtimes) {
    // start the client
    await TwitterClientInterface.start(runtime);
  }

  let shouldExit = false;
  // receive ctrl + c and break the loop
  process.on('SIGINT', () => {
    shouldExit = true;
  });

  while (!shouldExit) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log('start to stop the client');
  for (const runtime of runtimes) {
    // stop the client
    await TwitterClientInterface.stop(runtime);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000 * 10));
  return 'end';
}

start()
  .then((res) => {
    console.log(res);
    exit(0);
  })
  .catch(console.error);
