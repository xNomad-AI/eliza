import { UUID, type IAgentRuntime } from '@elizaos/core';

import { TwitterClientState, TwitterClientStatus } from '../monitor/state';
import { TwitterConfig } from '../environment';
import { type TwitterManager } from '..';

class ClientTwitterStatement {
  // stop or start or other
  status: TwitterClientStatus;

  // client now running in which function
  state: TwitterClientState;

  config: TwitterConfig;

  runtime: IAgentRuntime;

  manager: TwitterManager;

  constructor(
    status: TwitterClientStatus,
    state: TwitterClientState,
    config: TwitterConfig,
    runtime: IAgentRuntime,
    manager: TwitterManager,
  ) {
    this.status = status;
    this.state = state;
    this.config = config;
    this.runtime = runtime;
    this.manager = manager;
  }
}

export class GlobalSettings {
  // agentId -> twitter config
  private agent: Record<UUID, ClientTwitterStatement> = {};
  // twitter username -> twitter config
  private username: Record<string, UUID> = {};

  constructor() { }

  addClientTwitterStatement(
    config: TwitterConfig,
    runtime: IAgentRuntime,
    manager: TwitterManager,
  ) {
    const statement = new ClientTwitterStatement(
      TwitterClientStatus.RUNNING,
      TwitterClientState.TWITTER_STARTUP,
      config,
      runtime,
      manager,
    );

    this.agent[runtime.agentId] = statement;
    this.username[config.TWITTER_USERNAME!] = runtime.agentId;
    console.log(`addClientTwitterStatement ${config.TWITTER_USERNAME!} ${runtime.agentId}`);

    return statement;
  }

  setClientTwitterStatus(agentId: UUID, status: TwitterClientStatus) {
    if (!this.agent[agentId]) {
      throw new Error(`setClientTwitterStatus agentId ${agentId} not found`);
    }
    this.agent[agentId].status = status;
  }

  setClientTwitterState(agentId: UUID, state: TwitterClientState) {
    if (!this.agent[agentId]) {
      throw new Error(`setClientTwitterState agentId ${agentId} not found`);
    }
    this.agent[agentId].state = state;
  }

  removeClientTwitter(agentId: UUID) {
    if (!this.agent[agentId]) {
      throw new Error(`removeClientTwitter agentId ${agentId} not found`);
    }
    delete this.agent[agentId];
  }

  getAgentTwitterConfig(agentId: UUID): TwitterConfig {
    if (!this.agent[agentId]) {
      throw new Error(`getAgentTwitterConfig agentId ${agentId} not found`);
    }
    return this.agent[agentId].config;
  }

  getAgentTwitterManager(agentId: UUID): TwitterManager {
    if (!this.agent[agentId]) {
      throw new Error(`getAgentTwitterManager agentId ${agentId} not found`);
    }
    return this.agent[agentId].manager;
  }

  getCurrentTwitterAccountStatus(username: string): TwitterClientStatus {
    if (username in this.username) {
      return this.getCurrentAgentTwitterAccountStatus(this.username[username]);
    }
    return TwitterClientStatus.STOPPED;
  }

  getCurrentAgentTwitterAccountStatus(agentId: UUID): TwitterClientStatus {
    if (this.agent[agentId]) {
      return this.agent[agentId].status;
    }
    return TwitterClientStatus.STOPPED;
  }

  isAgentTwitterAccountStopped(agentId: UUID): boolean {
    return (
      this.getCurrentAgentTwitterAccountStatus(agentId) === TwitterClientStatus.STOPPED
    );
  }
}

export const GLOBAL_SETTINGS = new GlobalSettings();
