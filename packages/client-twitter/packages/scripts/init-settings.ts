import asserts from 'assert';
import * as fs from "fs";
import { TaskSettings } from '@xnomad/task-manager-cli';
// load .env file
import dotenv from 'dotenv';
import { join } from 'path';
dotenv.config({ path: join(process.cwd(), '.env') });

const PROXY_FILE = process.env.PROXY_FILE || 'Proxylists.json';
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;
const TASK_MANAGER_BASE_ENDPOINT = process.env.TASK_MANAGER_BASE_ENDPOINT || 'http://localhost:3000';
const TASK_MANAGER_ADMIN_API_KEY = process.env.TASK_MANAGER_ADMIN_API_KEY;
asserts(TASK_MANAGER_ADMIN_API_KEY, 'TASK_MANAGER_ADMIN_API_KEY is required');

// init http proxies for client twitter
async function start() {
  const taskSettings = new TaskSettings({
    baseURL: TASK_MANAGER_BASE_ENDPOINT,
    headers: {
      'X-ADMIN-API-KEY': TASK_MANAGER_ADMIN_API_KEY!,
    }
  });

  // read values from the file
  const filePath = `${process.cwd()}/data/${PROXY_FILE}`;
  /**
  * [{
      "entryPoint": "example.com",
      "ip": "xx.xx.xx.xx",
      "port": 8195,
      "countryCode": "ID"
    }]
   */
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    console.error(`Failed to read file: ${filePath}`, error);
    return;
  }

  const resp = await taskSettings.taskSettingsControllerUpdateManagerSettings(
    JSON.parse(content).map((item: any) => {
      return {
        ...item,
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD,
      };
    })
  );
  return resp;
}

start().then((res) => {
  console.log(res);
}).catch((err) => {
  console.error(err);
});
