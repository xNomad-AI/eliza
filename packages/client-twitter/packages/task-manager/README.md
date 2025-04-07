# Task Manager

This project is a task management application built with NestJS and MongoDB. It allows users to create, update, start, stop, and restart tasks, while also providing real-time updates on task status through WebSocket events.

## Features

- Create new tasks with specific configurations.
- Update existing tasks.
- Start, stop, and restart tasks.
- Real-time status updates via WebSocket.
- MongoDB integration for persistent storage of task configurations and statuses.

## Project Structure

```
task-manager
├── src
│   ├── main.ts                # Entry point of the application
│   ├── app.module.ts          # Root module that imports other modules
│   ├── tasks                   # Module for task management
│   │   ├── tasks.module.ts     # Defines the Tasks module
│   │   ├── tasks.controller.ts  # Handles incoming requests related to tasks
│   │   ├── tasks.service.ts     # Business logic for managing tasks
│   │   ├── dto                  # Data Transfer Objects for task creation and updates
│   │   │   ├── create-task.dto.ts
│   │   │   └── update-task.dto.ts
│   │   ├── schemas              # MongoDB schemas for tasks
│   │   │   └── task.schema.ts
│   │   └── interfaces           # Interfaces defining task properties
│   │       └── task.interface.ts
│   ├── events                   # Module for handling events
│   │   ├── events.module.ts     # Defines the Events module
│   │   ├── events.gateway.ts     # WebSocket gateway for task events
│   │   └── events.service.ts     # Logic for managing events
│   └── config                   # Configuration files
│       └── database.config.ts    # Database configuration for MongoDB
├── test                         # Test files
│   ├── app.e2e-spec.ts         # End-to-end tests for the application
│   └── jest-e2e.json           # Jest configuration for end-to-end testing
├── .eslintrc.js                # ESLint configuration
├── .gitignore                   # Git ignore file
├── .prettierrc                 # Prettier configuration
├── nest-cli.json               # NestJS CLI configuration
├── package.json                # npm configuration and dependencies
├── tsconfig.json               # TypeScript configuration
└── README.md                   # Project documentation
```

## Getting Started

1. Clone the repository:
   ```
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```
   cd task-manager
   ```

3. Install the dependencies:
   ```
   npm install
   ```

4. Set up your MongoDB database and update the configuration in `src/config/database.config.ts`.

5. Run the application:
   ```
   npm run start
   ```

## API Endpoints

- `POST /tasks` - Create a new task
- `PUT /tasks/:id` - Update an existing task
- `GET /tasks/:id/status` - Get the status of a task
- `POST /tasks/:id/start` - Start a task
- `POST /tasks/:id/stop` - Stop a task
- `POST /tasks/:id/restart` - Restart a task

## License

This project is licensed under the MIT License.