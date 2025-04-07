# client-twitter

eliza client-twitter

the client can start 1k twitter client stable running

https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/markdown/GraphQL.md

## Feature

- [x] approval check, only the tweet can post after check

### Approval check

## TODO

- [ ] add metrics to monitor the function's stable metrics
  - [ ] using influxdb to measure events
  - [ ] using prometheus to measure metrics
- [ ] using nestjs to manage clients
  - [ ] rules
    - [ ] each agentId has one twitter client
    - [ ] each twitter username has one twitter client

### Workflow

#### Start twitter client

Task Watcher: 
- Using nestjs start a watcher.
- The task watcher should ensure the task match the required status which user configed.
- If user change the task status to stopped, the watcher should stop the task if running; Same as change status to running.
- When process is restarted, the watcher should known that the task is not running and should restart all the tasks.
- The watcher will check the task status created by it intervally.
- The task watcher will handle the task defined in tasks dir

Task Manager: 
- Using nestjs and mongodb save the task configuration and status.
- Users can stop, start and restart the task, the watcher will receive the action event.
- User can get status and configuration.

prompt:

- I have a task which will not auto stopped.
- The backend should use mongodb.
- The worker should support multi process.

A task status and configuration manager: 
- The manager can get the current task status and change the task's configuration.
- Users can stop, start and restart the task.
- The management api should using nestjs.

A task worker: 
- The task worker is where the task running.
- The task worker will export the task's metrics using log and prometheus

Give me a framework using typescript, you can add other packages or middleware if needs.


