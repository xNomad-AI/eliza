import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { MongoDBDatabaseAdapter } from '@elizaos/adapter-mongodb';
import { MongoClient } from 'mongodb';
import assert from 'assert';
import { AgentRuntime, CacheManager, Character, DbCacheAdapter, IDatabaseCacheAdapter, ModelProviderName, UUID, type IAgentRuntime } from '@elizaos/core';

import { mongodbDbName, OPENAI_API_KEY, TWITTER_2FA_SECRET, TWITTER_EMAIL, TWITTER_PASSWORD, TWITTER_USERNAME } from '../constant.js';
import { SHARED_SERVICE } from '../shared/shared.service.js';

async function initializeDatabase(
  client: MongoClient,
  dbName: string,
): Promise<MongoDBDatabaseAdapter> {
  try {
    const newDB = new MongoDBDatabaseAdapter(client, dbName);
    await newDB.init();
    return newDB;
  } catch (error) {
    console.error('Failed to initialize MongoDBDatabaseAdapter:', error);
    throw error;
  }
}

function initializeDbCache(
  character: Character,
  db: IDatabaseCacheAdapter,
) {
  const cache = new CacheManager(new DbCacheAdapter(db, character.id!));
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
    topics: [],
    adjectives: [],
    clients: [],
    plugins: [],
    style: {
      all: [],
      chat: [],
      post: [],
    },
    settings,
  };
}

export async function createRuntime(client: MongoClient) {
  assert(OPENAI_API_KEY, 'OPENAI_API_KEY is required');
  assert(TWITTER_USERNAME, 'TWITTER_USERNAME is required');
  assert(TWITTER_PASSWORD, 'TWITTER_PASSWORD is required');
  assert(TWITTER_2FA_SECRET, 'TWITTER_2FA_SECRET is required');
  assert(TWITTER_EMAIL, 'TWITTER_EMAIL is required');

  const character = initCharacter('debug', {
    secrets: {
      TWITTER_USERNAME,
      TWITTER_PASSWORD,
      TWITTER_EMAIL,
      TWITTER_2FA_SECRET
    }
  });
  const db = await initializeDatabase(client, mongodbDbName);
  const cache = initializeDbCache(character, db);

  const runtime = new AgentRuntime({
    databaseAdapter: db,
    cacheManager: cache,
    token: OPENAI_API_KEY,
    modelProvider: ModelProviderName.OPENAI,
    character
  });

  return runtime;
}

@Injectable()
export class DebugService {
  private sharedService = SHARED_SERVICE;
  private logger = new Logger(DebugService.name);

  constructor(
    @InjectConnection() private readonly connection: mongoose.Connection
  ) {}

  async debug() {
    this.logger.debug(`start set task runtime ${TWITTER_USERNAME!}`);
    const runtime = await createRuntime(this.connection.getClient());

    this.sharedService.setTaskRuntime(TWITTER_USERNAME!, runtime);
    this.logger.debug(`set task runtime ${TWITTER_USERNAME!}`);
  }
}
