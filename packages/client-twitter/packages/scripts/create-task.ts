import asserts from 'assert';
import { Tasks, TaskActionName } from '@xnomad/task-manager-cli';
// load .env file
import dotenv from 'dotenv';
import { join } from 'path';
dotenv.config({ path: join(process.cwd(), '.env') });

const TWITTER_HTTP_PROXY = process.env.TWITTER_HTTP_PROXY;
const TWITTER_2FA_SECRET = process.env.TWITTER_2FA_SECRET;
const TWITTER_EMAIL = process.env.TWITTER_EMAIL;
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;

const TASK_MANAGER_BASE_ENDPOINT = process.env.TASK_MANAGER_BASE_ENDPOINT || 'http://localhost:3000';
const TASK_MANAGER_ADMIN_API_KEY = process.env.TASK_MANAGER_ADMIN_API_KEY;
asserts(TASK_MANAGER_ADMIN_API_KEY, 'TASK_MANAGER_ADMIN_API_KEY is required');

// init http proxies for client twitter
async function start() {
  const tasks = new Tasks({
    baseURL: TASK_MANAGER_BASE_ENDPOINT,
    headers: {
      'X-ADMIN-API-KEY': process.env.TASK_MANAGER_ADMIN_API_KEY!,
    }
  });

  const resp = await tasks.tasksControllerCreateTask({
    title: TWITTER_USERNAME!,
    action: TaskActionName.Start,
    agentId: 'debug',
    nftId: 'debug',
    configuration: {
      TWITTER_USERNAME,
      TWITTER_PASSWORD,
      TWITTER_EMAIL,
      TWITTER_2FA_SECRET,
      TWITTER_HTTP_PROXY,
    },
  })

  return resp;
}

start().then((res) => {
  console.log(res);
}).catch((err) => {
  console.error(err);
});
