// using prometheus client
import client from 'prom-client';

// export const register = new client.Registry();

// client.collectDefaultMetrics({
//   prefix: 'client_twitter_',
//   register,
// });

const prefix = 'client_twitter_';

export const twitterAccountStatus = new client.Gauge({
  name: `${prefix}twitter_account_status`,
  help: 'twitter account running status, 0 stopped, 1 running, 2 stopping',
  // registers: [register],
  labelNames: ['twitterName', 'twitterHttpProxy', 'agentId'],
});

// using the post interval and post count to check if there has any missing post
export const twitterPostInterval = new client.Gauge({
  name: `${prefix}twitter_post_interval`,
  help: 'max post interval in minutes',
  // registers: [register],
  labelNames: ['twitterName'],
});

export const twitterPostCount = new client.Counter({
  name: `${prefix}twitter_post_count`,
  help: 'post count',
  // registers: [register],
  labelNames: ['twitterName'],
});
