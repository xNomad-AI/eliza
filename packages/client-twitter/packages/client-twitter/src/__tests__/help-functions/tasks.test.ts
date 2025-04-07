import { jest, describe, it, expect, beforeEach } from '@jest/globals';

import * as external from '../../settings/external.js';
import { defaultRunWithErrorHandling } from '../../help-functions/tasks.js';

// Create a spy for uploadErrorMessageToTaskManager
const mockUploadErrorMessageToTaskManager = jest.fn();

// Mock the external dependencies
jest.mock('../../settings/external.js', () => {
  const mockUploadErrorMessageToTaskManager = jest.fn();
  return {
    Logger: {
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }),
    },
    uploadErrorMessageToTaskManager: jest.fn().mockImplementation((...args) => 
      mockUploadErrorMessageToTaskManager(...args)
    ),
    __esModule: true, // This is needed for ES modules
  };
});

describe('defaultRunWithErrorHandling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadErrorMessageToTaskManager.mockClear();
  });

  // it('should execute handler successfully and respect task status', async () => {
  //   const mockValue = {
  //     taskStatus: 2,
  //   }
  //   const taskStatusSetter = (value?: number) => {
  //     if (value === undefined) {
  //       return mockValue.taskStatus;
  //     }
  //     return mockValue.taskStatus = value;
  //   }
    
  //   const handler = jest.fn().mockResolvedValue(1000 as never); // Return 5000ms delay

  //   defaultRunWithErrorHandling(
  //     'test-task',
  //     'test-user',
  //     'test-agent',
  //     taskStatusSetter,
  //     handler as any,
  //     { checkInterval: 500 } // Short interval for testing
  //   );

  //   expect(taskStatusSetter).toHaveBeenCalledWith(1); // Set running status
  //   expect(taskStatusSetter).toHaveBeenCalledWith(2); // Set completed status
  // });

  // it('should handle errors and upload them to task manager', async () => {
  //   const error = new Error('Test error');
  //   const taskStatusSetter = jest.fn()
  //     .mockImplementationOnce(() => 2) // First call: check if running
  //     .mockImplementation(() => 0);    // Subsequent calls: stop the loop
    
  //   const handler = jest.fn().mockRejectedValue(error as never);

  //   await defaultRunWithErrorHandling(
  //     'test-task',
  //     'test-user',
  //     'test-agent',
  //     taskStatusSetter as any,
  //     handler as any,
  //     { retryDelay: 100 } // Short delay for testing
  //   );

  //   expect(mockUploadErrorMessageToTaskManager).toHaveBeenCalledWith(
  //     'test-user',
  //     'test-agent',
  //     error
  //   );
  //   expect(handler).toHaveBeenCalled();
  //   expect(taskStatusSetter).toHaveBeenCalledWith(1);
  // });

  // it('should stop when task status is 0', async () => {
  //   const taskStatusSetter = jest.fn().mockReturnValue(0);
  //   const handler = jest.fn();

  //   await defaultRunWithErrorHandling(
  //     'test-task',
  //     'test-user',
  //     'test-agent',
  //     taskStatusSetter as any,
  //     handler as any
  //   );

  //   expect(handler).not.toHaveBeenCalled();
  //   expect(mockUploadErrorMessageToTaskManager).not.toHaveBeenCalled();
  // });

  // OK!
  // it('should use default interval when handler returns undefined', async () => {
  //   const taskStatusSetter = jest.fn()
  //     .mockImplementationOnce(() => 2) // First call: check if running
  //     .mockImplementation(() => 0);    // Subsequent calls: stop the loop
    
  //   const handler = jest.fn().mockResolvedValue(100 as never);

  //   await defaultRunWithErrorHandling(
  //     'test-task',
  //     'test-user',
  //     'test-agent',
  //     taskStatusSetter as any,
  //     handler as any,
  //     { checkInterval: 100 } // Short interval for testing
  //   );

  //   expect(handler).toHaveBeenCalled();
  //   expect(taskStatusSetter).toHaveBeenCalledWith(2);
  // });

  it('should be stopped success when change inject object value', async () => {
    const mockValue = {
      taskStatus: 2,
    }
    const taskStatusSetter = (value?: number) => {
      if (value === undefined) {
        return mockValue.taskStatus;
      }
      return mockValue.taskStatus = value;
    }
    
    const handler = jest.fn().mockResolvedValue(0 as never);

    let stop = false;
    defaultRunWithErrorHandling(
      'test-task',
      'test-user',
      'test-agent',
      taskStatusSetter,
      handler as any,
      { checkInterval: 100 } // Short interval for testing
    ).then(() => {
      stop = true;
    }).catch((error) => {
      console.error('Error in task:', error);
    });

    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for the loop to start
    mockValue.taskStatus = 0; // Simulate stopping the task

    expect(stop).toBe(true);
  });
});
