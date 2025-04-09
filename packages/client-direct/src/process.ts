import {
    Content,
    elizaLogger,
    getEmbeddingZeroVector,
    IAgentRuntime,
    Media,
    Memory,
    stringToUuid,
    UUID,
} from '@elizaos/core';
import path from 'path';
import express from 'express';

enum DisplayType {
    AGENT_STATUS = "AGENT_STATUS", // Agent status
    AGENT_ACTION = "AGENT_ACTION", // Agent action
    AGENT_RESPONSE = "AGENT_RESPONSE" // Agent response
}

export async function getUserMessage(
    runtime: IAgentRuntime,
    req: express.Request,
) {
    const agentId = runtime.agentId;
    const roomId = stringToUuid(req.body.roomId ?? 'default-room-' + agentId);
    const accessToken = req.body?.accessToken;
    const userId = stringToUuid(req.body.userId ?? 'user');
    await runtime.ensureConnection(
        userId,
        roomId,
        req.body.userName,
        req.body.name,
        'direct',
    );
    const text = req.body.text;
    const messageId = stringToUuid(Date.now().toString());
    const attachments: Media[] = [];
    if (req.file) {
        const filePath = path.join(
            process.cwd(),
            'data',
            'uploads',
            req.file.filename,
        );
        attachments.push({
            id: Date.now().toString(),
            url: filePath,
            title: req.file.originalname,
            source: 'direct',
            description: `Uploaded file: ${req.file.originalname}`,
            text: '',
            contentType: req.file.mimetype,
        });
    }

    const content: Content = {
        text,
        attachments,
        source: 'direct',
        accessToken: accessToken,
        inReplyTo: undefined,
    };

    const userMessage = {
        content,
        userId,
        roomId,
        agentId: runtime.agentId,
        createdAt: Date.now(),
    };

    const memory: Memory = {
        id: stringToUuid(messageId + '-' + userId),
        ...userMessage,
        agentId: runtime.agentId,
        userId,
        roomId,
        content,
        createdAt: Date.now(),
    };
    memory.embedding = await getEmbeddingZeroVector();
    await runtime.messageManager.createMemory(memory);
    return memory;
}

export async function* handleUserMessage(
    runtime: IAgentRuntime,
    memory: Memory,
    stream: boolean = false,
) {
    const { roomId, agentId, userId, content } = memory;
    let state = await runtime.composeState(memory, {});
    
    if (stream) {
        yield {
            text: 'Connected',
            displayType: DisplayType.AGENT_STATUS
        }
    }
    for (let stepCnt = 0; stepCnt < 5; stepCnt++) {
        let task_record = await getTaskRecord(
        runtime,
        content.text,
        roomId,
        agentId,
        userId,
        );
        console.log('task_record', JSON.stringify(task_record));
        let shouldReturn = false;
        let actionResponseMessage = null as Content | null;
        let actionsProcessResult = [];
        if (stepCnt === 0 && stream) {
            yield {
                text: 'Detecting action',
                displayType: DisplayType.AGENT_STATUS
            }
        }
        let actionDetail = await getNextAction(
            runtime,
            task_record,
            await getChatHistory(runtime, roomId),
            false,
        );

        if (actionDetail.action === 'SWITCH_TASK') {
            task_record = {
                roomId,
                agentId,
                userId,
                taskId: task_record.taskId + 1,
                taskDefinition: actionDetail.parameters.newTaskDefinition,
                pastActions: [],
            };
            actionDetail = await getNextAction(
                runtime,
                task_record,
                await getChatHistory(runtime, roomId),
                true,
            );
        }
        console.log('received next action detail', actionDetail);

        // save response to memory
        if (actionDetail.action === 'GENERAL_CHAT') {
            actionDetail.action = 'none';
        }
        const agentRouterResponseMemory: Memory = {
            id: stringToUuid(Date.now().toString()),
            ...memory,
            userId: runtime.agentId,
            agentId: runtime.agentId,
            content: actionDetail,
            embedding: getEmbeddingZeroVector(),
            createdAt: Date.now(),
        };
        
        let finalParameters = actionDetail.parameters;
        if (actionDetail.action === 'WRAP_UP') {
            actionResponseMessage = { text: actionDetail.parameters.message, action: actionDetail.action };
            shouldReturn = true;
        } else {
            if (stream && actionDetail.action && !['wrap_up', 'none', 'general_chat'].includes(actionDetail.action.toLowerCase())) {
                yield {
                    text: `Processing Action: ${actionDetail.action}`,
                    displayType: DisplayType.AGENT_ACTION
                }
            }
            // if success, the formatResult will be the formatted parameters; else, the formatResult.parameters will be the original parameters
            const formatResult = await runtime.formatActionParameters(actionDetail.action, actionDetail.parameters, async (actionResponse) => {
                actionResponseMessage = actionResponse;
                return [memory];
            });
            console.log('formatResult', formatResult);
            console.log('actionResponseMessage', actionResponseMessage);
            finalParameters = formatResult.parameters;
            // check if the action parameters are incomplete, if so, ask user to provide more information
            if (formatResult.status === 'incomplete info') {
                shouldReturn = true;
            } else {
                const lastAction = task_record.pastActions.at(-1);
                // Check if this is the same action as the last one
                let pendingConfirmation = false;
                if (lastAction && 
                    lastAction.action === actionDetail.action && 
                    lastAction.status === 'pending') {
                    console.log('lastAction is pending', lastAction);
                    // Assume actions are the same until we find a difference
                    pendingConfirmation = true;
                    
                    // Compare parameters
                    for (const key in formatResult.parameters) {
                        const currentParam = formatResult.parameters[key];
                        const lastParam = lastAction.parameters[key];
                        // If parameters are different, actions are not the same
                        if (JSON.stringify(currentParam) !== JSON.stringify(lastParam)) {
                            pendingConfirmation = false;
                            console.log('mismatch', currentParam, lastParam);
                            break;
                        }
                    }
                }
                actionsProcessResult = await runtime.processActions(
                    memory,
                    [agentRouterResponseMemory],
                    await runtime.composeState(memory, {
                        agentName: runtime.character.name,
                        actionParameters: {
                          ...formatResult.parameters,
                          pendingConfirmation
                        },
                    }),
                    async (actionResponse) => {
                        actionResponseMessage = actionResponse;
                        return [memory];
                    }
                );
                shouldReturn = actionsProcessResult.some(
                    (processResult) => processResult != 'success',
                );
                

                // GENERAL CHAT
                if (actionDetail.action === 'none') {
                    shouldReturn = true;
                }
            }
        }
        actionResponseMessage.action = actionDetail.action === 'none' ? 'WRAP_UP' : actionDetail.action;
        actionResponseMessage.parameters = finalParameters;
        yield {
            ...actionResponseMessage,
            displayType: DisplayType.AGENT_RESPONSE
        };
        task_record.pastActions.push({
            action:
                actionDetail.action === 'none'
                    ? 'WRAP_UP'
                    : actionDetail.action,
            parameters: finalParameters,
            detail: actionDetail.explanation,
            result: actionResponseMessage?.result || actionResponseMessage?.text,
            status: actionsProcessResult[0] || 'failed',
        });
        const resMemory: Memory = {
            id: stringToUuid(Date.now().toString()),
            roomId,
            userId: runtime.agentId,
            agentId,
            content: actionResponseMessage,
            embedding: getEmbeddingZeroVector(),
            createdAt: Date.now(),
        };
        state = await runtime.updateRecentMessageState(state);
        await runtime.messageManager.createMemory(resMemory, true);
        console.log('task_record upsert to db', task_record);
        runtime.databaseAdapter.upsert?.('tasks', task_record);
        console.log('task_record upsert to db done');
        if (shouldReturn === true) {
            break;
        }
    }
}

async function getChatHistory(
        runtime: IAgentRuntime,
        roomId: UUID,
    ): Promise<
        {
            role: string;
            content: string;
            attachment?: Media;
            idx: number;
        }[]
    > {
        // get recent messages
        const recentMessages = await runtime.messageManager.getMemories({
            roomId,
            count: 5,
            unique: false,
        });
        // convert into the request format of agent-router
        return recentMessages
            .slice()
            .reverse()
            .map((msg, idx) => {
                const role = msg.userId === runtime.agentId ? 'assistant' : 'user';
                return {
                    role,
                    content: msg.content.text || '',
                    attachments: msg.content.attachments,
                    idx: idx,
                };
            });
}

async function getTaskRecord(
    runtime: IAgentRuntime,
    text: string,
    roomId: string,
    agentId: string,
    userId: string,
) {
    // query tasks
    let task_record = {
        roomId,
        agentId,
        userId,
        taskId: 0,
        taskDefinition: text,
        pastActions: [],
    };
    const result = await runtime.databaseAdapter.queryLatestTask?.('tasks', {
        roomId,
        agentId,
        userId,
    });
    const lastestTask = result?.[0];
    if (lastestTask?.pastActions?.at(-1)?.action === 'WRAP_UP') {
        task_record.taskId = lastestTask.taskId + 1;
    } else if (lastestTask) {
        task_record = lastestTask;
    }
    return task_record;
}

async function getNextAction(
    runtime: IAgentRuntime,
    taskRecord: any,
    chatHistory: any[],
    switchedTask: boolean = false,
): Promise<{
    action: string;
    text: string;
    parameters: any;
    explanation: string;
}> {
    // call agent router to get response
    const body: any = {
        chain: runtime.getSetting('NFT_CHAIN'),
        chat_history: chatHistory,
        task_definition: taskRecord.taskDefinition,
        past_steps: taskRecord?.pastActions || [],
        switched_task: switchedTask,
    };
    console.log('get next action request', JSON.stringify(body));
    body.actions = runtime.actions.map((action) => {
        return action.functionCallSpec;
    });
    const response = await fetch(
        runtime.getSetting('AGENT_ROUTER_URL') + '/plan',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        },
    );
    if (response.status !== 200) {
        elizaLogger.error(
            'Error in agent router response',
            await response.text(),
        );
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    // deal with null parameters
    const jsonResponse = await response.json();
    for (const key in jsonResponse.parameters) {
        if (jsonResponse.parameters[key] === null || jsonResponse.parameters[key] === undefined || jsonResponse.parameters[key] === '' || jsonResponse.parameters[key] === 'None') {
            jsonResponse.parameters[key] = null;
        }
    }
    return jsonResponse;
}
