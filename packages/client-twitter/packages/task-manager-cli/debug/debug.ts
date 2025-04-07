import { TaskActionName } from "../src/data-contracts";
import { Tasks } from "../src/Tasks";

async function start() {
  const taskCli = new Tasks();
  const res = await taskCli.tasksControllerCreateTask({
    title: 'task1',
    description: 'task1 description',
    action: TaskActionName.Start,
    configuration: {
      TWITTER_USERNAME: 'username',
      TWITTER_PASSWORD: 'password',
    }
  }, {
    baseURL: 'http://localhost:3000',
  });

  return res;
}

start().then(res => {
  console.log(res);
}).catch(err => {
  console.error(err);
});
