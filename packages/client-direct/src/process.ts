import {
    Content,
    elizaLogger,
    getEmbeddingZeroVector,
    IAgentRuntime,
    Media,
    Memory,
    stringToUuid,
    UUID
} from "@elizaos/core";
import path from "path";
import express from "express";

export async function getUserMessage(runtime: IAgentRuntime, req: express.Request){
    const agentId = runtime.agentId;
    const roomId = stringToUuid(
        req.body.roomId ?? 'default-room-' + agentId,
    );
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

export async function handleUserMessage(runtime: IAgentRuntime, memory: Memory) {
    const {roomId, agentId, userId, content} = memory;
    let state = await runtime.composeState(memory, {});
    const responseMessages = [];
    const task_record = await getTaskRecord(runtime, content.text, roomId, agentId, userId);
    for (let stepCnt = 0; stepCnt < 5; stepCnt++) {
        let shouldReturn = false;
        const actionDetail = await getNextAction(runtime, task_record, await getChatHistory(runtime, roomId));
        elizaLogger.log('received next action detail', actionDetail);
        // save response to memory
        const agentRouterResponseMemory: Memory = {
            id: stringToUuid(Date.now().toString()),
            ...memory,
            userId: runtime.agentId,
            agentId: runtime.agentId,
            content: actionDetail,
            embedding: getEmbeddingZeroVector(),
            createdAt: Date.now(),
        };

        let actionResponseMessage = null as Content | null;
        if (actionDetail.action === 'WRAP_UP') {
            actionResponseMessage = {
                text: actionDetail.parameters.message,
                action: actionDetail.action,
            };
            shouldReturn = true;
        } else {
            const actionsProcessResult =
                await runtime.processActions(
                    memory,
                    [agentRouterResponseMemory],
                    await runtime.composeState(memory, {
                        agentName: runtime.character.name,
                        actionParameters: actionDetail.parameters,
                    }),
                    async (actionResponse) => {
                        actionResponseMessage = actionResponse;
                        return [memory];
                    },
                );
            responseMessages.push(actionResponseMessage);
            shouldReturn = actionsProcessResult.some((processResult) => processResult === false);
            if (shouldReturn) {
                break;
            }
        }
        task_record.pastActions.push({
            action: actionDetail.action,
            detail: actionDetail.explanation,
            result:
                actionResponseMessage?.result ||
                actionResponseMessage?.text,
        });

        if (shouldReturn === true) {
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
            await runtime.messageManager.createMemory(
                resMemory,
                true,
            );
            break;
        }
    }
    runtime.databaseAdapter.upsert?.('tasks', task_record);
    return responseMessages;
}

async function getChatHistory(runtime: IAgentRuntime, roomId: UUID): Promise<{
    role: string;
    content: string;
    idx: number;
}[]> {
    // get recent messages
    const recentMessages = await runtime.messageManager.getMemories(
        {
            roomId,
            count: 5,
            unique: false,
        },
    );
    // convert into the request format of agent-router
    return recentMessages
        .slice()
        .reverse()
        .map((msg, idx) => {
            const role =
                msg.userId === runtime.agentId
                    ? 'assistant'
                    : 'user';
            return {
                role,
                content: msg.content.text || '',
                idx: idx,
            };
        });
}

async function getTaskRecord(runtime: IAgentRuntime, text: string, roomId: string, agentId: string, userId: string){
    // query tasks
    let task_record = {
        roomId,
        agentId,
        userId,
        taskId: 0,
        taskDefinition: text,
        pastActions: [],
    };
    const result =
        await runtime.databaseAdapter.queryLatestTask?.(
            'tasks',
            {
                roomId,
                agentId,
                userId,
            },
        );
    const lastestTask = result?.[0];
    if (lastestTask?.pastActions?.at(-1)?.action === 'WRAP_UP') {
        task_record.taskId = lastestTask.taskId + 1;
    } else if (lastestTask) {
        task_record = lastestTask;
    }
    return task_record;
}

async function getNextAction(runtime: IAgentRuntime, taskRecord: any, chatHistory: any[]): Promise<{
    action: string;
    text: string;
    parameters: any;
    explanation: string;
}>{
    // call agent router to get response
    const body : any = {
        chat_history: chatHistory,
        task_definition: taskRecord.taskDefinition,
        past_steps: taskRecord?.pastActions || [],
    };
    elizaLogger.log('get next action request', JSON.stringify(body));
    body.actions = runtime.actions.map((action) => {
        return action.functionCallSpec
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
        elizaLogger.error('Error in agent router response', await response.text());
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}