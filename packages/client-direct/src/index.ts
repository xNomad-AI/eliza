import bodyParser from 'body-parser';
import cors from 'cors';
import express, { type Request as ExpressRequest } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
    type AgentRuntime,
    elizaLogger,
    messageCompletionFooter,
    generateCaption,
    generateImage,
    type Media,
    getEmbeddingZeroVector,
    composeContext,
    generateMessageResponse,
    generateObject,
    type Content,
    type Memory,
    ModelClass,
    type Client,
    stringToUuid,
    settings,
    type IAgentRuntime,
} from '@elizaos/core';
import { createApiRouter } from './api.ts';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'data', 'uploads');
        // Create the directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
});

function extractTransactionDetails(message) {
    if (!message || !message.content || !message.content.text) {
        return null;
    }

    const text = message.content.text;

    const confirmationKeywords = [
        'yes',
        'ok',
        'confirm',
        'proceed',
        'continue',
        'sure',
        'go ahead',
        'approved',
    ];
    const isConfirmation = confirmationKeywords.some(
        (keyword) =>
            text.toLowerCase() === keyword ||
            text.toLowerCase().includes(keyword),
    );

    if (isConfirmation) {
        return {
            isConfirmation: true,
            confirmationText: text.toLowerCase(),
            timestamp: message.createdAt || Date.now(),
        };
    }

    const details = {
        addresses: [],
        tokens: [],
        targetTokens: [],
        targetAddresses: [],
        amounts: [],
        actions: [],
        timestamp: message.createdAt || Date.now(),
        originalText: text,
    };

    const addressRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
    const foundAddresses = text.match(addressRegex);
    if (foundAddresses) {
        details.addresses = [...foundAddresses];

        if (
            foundAddresses.length > 1 &&
            (text.includes(' for ') || text.includes(' to '))
        ) {
            const forIndex = Math.max(
                text.indexOf(' for '),
                text.indexOf(' to '),
            );
            const addressesAfterFor = foundAddresses.filter(
                (addr) => text.indexOf(addr) > forIndex,
            );
            if (addressesAfterFor.length > 0) {
                details.targetAddresses = addressesAfterFor;
            }
        }
    }

    const tokenRegex = /\b(SOL|USDC|USDT|BTC|ETH|[A-Z0-9a-z]{2,10})\b/g;
    const foundTokens = text.match(tokenRegex);
    if (foundTokens) {
        details.tokens = [...foundTokens];
    }

    if (
        text.toLowerCase().includes('swap') ||
        text.toLowerCase().includes('exchange') ||
        text.toLowerCase().includes('trade') ||
        text.toLowerCase().includes('convert')
    ) {
        details.actions.push('swap');

        const swapRegex =
            /(?:swap|exchange|trade|convert|sell).*?(?:for|to)\s+(\w+|[1-9A-HJ-NP-Za-km-z]{32,44})/i;
        const swapMatch = text.match(swapRegex);
        if (swapMatch && swapMatch[1]) {
            if (swapMatch[1].length >= 32 && swapMatch[1].length <= 44) {
                if (!details.targetAddresses.includes(swapMatch[1])) {
                    details.targetAddresses.push(swapMatch[1]);
                }
            } else {
                details.targetTokens.push(swapMatch[1]);
            }
        }
    }

    const amountRegex =
        /\b\d+(\.\d+)?\s*(SOL|USDC|USDT|BTC|ETH|[A-Z0-9a-z]{2,10})?\b/g;
    let match;
    while ((match = amountRegex.exec(text)) !== null) {
        details.amounts.push(match[0]);
    }

    const actionKeywords = [
        'send',
        'transfer',
        'buy',
        'sell',
        'claim',
        'airdrop',
        'create',
        'mint',
        'exchange',
        'convert',
        'trade',
        'auto',
    ];

    for (const action of actionKeywords) {
        if (
            text.toLowerCase().includes(action) &&
            !details.actions.includes(action)
        ) {
            details.actions.push(action);
        }
    }

    return Object.values(details).some(
        (arr) =>
            (Array.isArray(arr) && arr.length > 0) ||
            (typeof arr === 'string' && arr),
    )
        ? details
        : null;
}

function isRelevantMessage(
    currentMessage,
    historicalMessage,
    transactionDetails,
) {
    if (!historicalMessage || !historicalMessage.content) {
        return false;
    }

    const messageAge =
        (currentMessage.createdAt || Date.now()) -
        (historicalMessage.createdAt || Date.now());
    if (messageAge < 48 * 60 * 60 * 1000) {
        return true;
    }

    if (!transactionDetails) {
        return true;
    }

    const text = historicalMessage.content.text || '';

    for (const address of transactionDetails.addresses) {
        if (text.includes(address)) {
            return true;
        }
    }

    for (const token of transactionDetails.tokens) {
        if (text.includes(token)) {
            return true;
        }
    }

    for (const action of transactionDetails.actions) {
        if (text.toLowerCase().includes(action)) {
            return true;
        }
    }

    return false;
}

// some people have more memory than disk.io
const upload = multer({ storage /*: multer.memoryStorage() */ });

export const messageHandlerTemplate = ` 
# Knowledge 
{{knowledge}} 
About {{agentName}}: 
{{bio}} 
{{lore}} 
 
{{providers}} 
 
{{attachments}} 
 
# Capabilities 
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section. 
Also Note {{agentName}} is an expert on Solana blockchain and has extensive knowledge of Solana transactions, including trading, swapping, and transferring. 
{{messageDirections}} 
 
{{recentMessages}} 
 
{{actions}} 
 
{{actionExamples}} 
- Note: Action examples are for reference only. Do not use the information from them in your response. 
 
# Task: Carefully analyze the conversation context to determine the appropriate blockchain action for {{agentName}}.

# Instructions: Generate the next message for {{agentName}} in valid JSON format:
\`\`\` 
json 
{ 
    "user": "{{agentName}}", 
    "text": "<string>",  
    "action": "<string>" 
} 
\`\`\` 
 
# Action Matching Framework:

## 1. Intent Recognition (Primary Analysis)
- Identify explicit action keywords and blockchain commands in the latest message
- Map user intent to specific blockchain operations using this priority hierarchy:
  * Direct commands: "create," "swap," "send," "transfer," "claim," "buy," "sell", "sell all" 
  * Confirmation responses: "yes", "confirm", "ok", "proceed", "continue"
  * Object references: token names, wallet addresses, amounts
  * Contextual clues: "airdrop," "liquidity," "transaction", "analyze"

## 2. Parameter Extraction
- For each potential action, identify if all required parameters are present:
  * CLAIM_AIRDROP: airdrop identifier or source
  * AUTO_TASK: token, price condition, time parameters
  * CREATE_TOKEN: name, symbol, description, social links
  * EXECUTE_SWAP: source token, target token, amount, slippage
    > Always preserve both source AND target tokens for swaps
    > Check for "swap X for Y" or "swap X to Y" patterns
  * SEND_TOKEN: recipient address, token, amount
  * ANALYZE: token symbol or token address
- For confirmation messages:
  * Check previous action context
  * Maintain ALL parameters from the previous action
  * For EXECUTE_SWAP, ensure both source and target tokens are preserved

## 3. Context-Aware Validation
- Review conversation history to resolve ambiguities and implicit references
- Check for previously mentioned tokens, amounts, or addresses that apply to current intent
- Verify if the user has already been informed about prerequisites (e.g., fees, confirmations)
- Detect if the current message is responding to a previous action suggestion or error
- For confirmation messages (yes, ok, confirm, etc.):
  * ALWAYS maintain the original action type from the previous message
  * NEVER generate a new action when processing a confirmation message
  * If previous action was EXECUTE_SWAP, the confirmation MUST continue with EXECUTE_SWAP
  * Confirmation words alone should maintain the action from previous context
- Prioritize maintaining action context over new action detection
- For EXECUTE_SWAP flows, ignore transfer-related keywords in confirmation messages

## 4. Confidence-Based Decision
- Assign confidence scores to potential actions based on:
  * Parameter completeness (all required parameters identified)
  * Intent clarity (direct command vs implied action)
  * Contextual consistency (aligns with conversation flow)
- Select the action with highest confidence score above threshold

## 5. Response Generation Rules
- For high-confidence action matches:
  * Set appropriate action value
  * Keep text response concise (<15 words) and confirmation-focused
  * Include essential transaction details for verification
- For medium-confidence matches:
  * Set provisional action but request explicit confirmation
  * List identified parameters for user verification
- For low-confidence situations:
  * Set action to "none"
  * Generate contextually relevant response that either:
    > Seeks clarification on specific missing parameters
    > Suggests potential actions based on partial intent recognition
    > Continues conversation naturally if no action intent detected

## 6. Error Recovery Protocol
- If previous action failed, analyze error type:
  * Parameter error: Request specific correction
  * Authorization error: Prompt for authentication
  * Blockchain error: Suggest alternative approaches
  * Rate limit/timing error: Suggest retry parameters
- Avoid repeating failed actions with identical parameters

# Specific Action Triggers:

1. CLAIM_AIRDROP: 
   - Explicit mentions of "airdrop," "claim," "get tokens"
   - References to specific airdrop campaigns or eligibility
   - Questions about available airdrops

2. AUTO_TASK (AUTO_BUY/SELL/SWAP): 
   - Conditional statements: "when price reaches," "if token goes above/below"
   - Time-based requests: "in 2 hours," "every day," "schedule," "automated"
   - Monitoring requests: "alert me," "watch for," "keep track of"

3. CREATE_TOKEN: 
   - Direct creation intent: "make a token," "create coin," "launch token"
   - Token parameter specification: naming, supply discussion, tokenomics
   - References to pump.fun platform or meme tokens

4. EXECUTE_SWAP: 
   - Exchange terminology: "swap," "exchange," "trade," "convert", "sell", "buy"
   - Pairing specifications: "X to Y," "for," "into"
   - Amount specifications with token references

5. SEND_TOKEN: 
   - Transfer vocabulary: "send," "transfer," "pay," "withdraw"
   - Recipient specification: addresses, names, "to wallet"
   - Amount and token type specifications
   
6. ANALYZE:
   - Explicit mentions of "analyze," "check," "review," "inspect"
    - Token symbol or address references for analysis
    
7. WALLET_PORTFOLIO:
    - Direct requests for wallet status: "show my wallet," "portfolio"
    - Balance inquiries: "how much do I have," "what's in your wallet"
    - Token-specific balance checks
`;

export const hyperfiHandlerTemplate = `{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}.

Response format should be formatted in a JSON block like this:
\`\`\`json
{ "lookAt": "{{nearby}}" or null, "emote": "{{emotes}}" or null, "say": "string" or null, "actions": (array of strings) or null }
\`\`\`
`;

export class DirectClient {
    public app: express.Application;
    public agents: Map<string, AgentRuntime>; // container management
    private server: any; // Store server instance
    public startAgent: Function; // Store startAgent functor
    public loadCharacterTryPath: Function; // Store loadCharacterTryPath functor
    public jsonToCharacter: Function; // Store jsonToCharacter functor

    constructor() {
        elizaLogger.log('DirectClient constructor');
        this.app = express();
        this.app.use(cors());
        this.agents = new Map();

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));

        // Serve both uploads and generated images
        this.app.use(
            '/media/uploads',
            express.static(path.join(process.cwd(), '/data/uploads')),
        );
        this.app.use(
            '/media/generated',
            express.static(path.join(process.cwd(), '/generatedImages')),
        );

        const apiRouter = createApiRouter(this.agents, this);
        this.app.use(apiRouter);

        // Define an interface that extends the Express Request interface
        interface CustomRequest extends ExpressRequest {
            file?: Express.Multer.File;
        }

        // Update the route handler to use CustomRequest instead of express.Request
        this.app.post(
            '/:agentId/whisper',
            upload.single('file'),
            async (req: CustomRequest, res: express.Response) => {
                const audioFile = req.file; // Access the uploaded file using req.file
                const agentId = req.params.agentId;

                if (!audioFile) {
                    res.status(400).send('No audio file provided');
                    return;
                }

                let runtime = this.agents.get(agentId);
                const apiKey = runtime.getSetting('OPENAI_API_KEY');

                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase(),
                    );
                }

                if (!runtime) {
                    res.status(404).send('Agent not found');
                    return;
                }

                const openai = new OpenAI({
                    apiKey,
                });

                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(audioFile.path),
                    model: 'whisper-1',
                });

                res.json(transcription);
            },
        );

        this.app.post(
            '/:agentId/message',
            upload.single('file'),
            async (req: express.Request, res: express.Response) => {
                const messageStart = Date.now();
                const agentId = req.params.agentId;
                const roomId = stringToUuid(
                    req.body.roomId ?? 'default-room-' + agentId,
                );
                const accessToken = req.body?.accessToken;
                if (process.env?.ENABLE_CHAT_AUTH == 'true' && !accessToken) {
                    res.status(401).send('No accessToken provided');
                    return;
                }
                const userId = stringToUuid(req.body.userId ?? 'user');

                let runtime = this.agents.get(agentId);

                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase(),
                    );
                }

                if (!runtime) {
                    res.status(404).send('Agent not found');
                    return;
                }

                await runtime.ensureConnection(
                    userId,
                    roomId,
                    req.body.userName,
                    req.body.name,
                    'direct',
                );

                const text = req.body.text;
                // if empty text, directly return
                // if (!text) {
                //     res.json([]);
                //     return;
                // }

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

                const transactionDetails =
                    extractTransactionDetails(userMessage);

                let runtimeTransactionContext =
                    (await runtime.cacheManager.get(
                        `transactionContext-${agentId}`,
                    )) || {};

                if (transactionDetails) {
                    if (
                        'isConfirmation' in transactionDetails &&
                        transactionDetails.isConfirmation &&
                        runtimeTransactionContext[roomId]
                    ) {
                        runtimeTransactionContext[roomId] = {
                            ...runtimeTransactionContext[roomId],
                            isConfirmed: true,
                            confirmationText:
                                transactionDetails.confirmationText,
                            lastUpdated: Date.now(),
                        };
                    } else {
                        runtimeTransactionContext[roomId] = {
                            ...runtimeTransactionContext[roomId],
                            ...transactionDetails,
                            lastUpdated: Date.now(),
                        };
                    }
                    await runtime.cacheManager.set(
                        `transactionContext-${agentId}`,
                        runtimeTransactionContext,
                        { expires: 60 * 60 * 24 },
                    );
                }

                const memory: Memory = {
                    id: stringToUuid(messageId + '-' + userId),
                    ...userMessage,
                    agentId: runtime.agentId,
                    userId,
                    roomId,
                    content,
                    createdAt: Date.now(),
                };

                const originalComposeState = runtime.composeState;
                runtime.composeState = async function (userMessage, options) {
                    const state = await originalComposeState.call(
                        this,
                        userMessage,
                        options,
                    );

                    if (
                        state.recentMessages &&
                        Array.isArray(state.recentMessages)
                    ) {
                        const transactionContext =
                            runtimeTransactionContext &&
                            runtimeTransactionContext[userMessage.roomId];
                        state.recentMessages = state.recentMessages.filter(
                            (msg) =>
                                isRelevantMessage(
                                    userMessage,
                                    msg,
                                    transactionContext,
                                ),
                        );

                        if (transactionContext) {
                            state.transactionContext = transactionContext;
                        }
                    }

                    return state;
                };

                memory.embedding = await getEmbeddingZeroVector();
                await runtime.messageManager.createMemory(memory);
                console.log(
                    `${messageId} Message creation elapsed: ${Date.now() - messageStart}ms`,
                );
                let state = await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                });

                runtime.composeState = originalComposeState;

                let contextTemplate = messageHandlerTemplate;
                if (state.transactionContext) {
                    contextTemplate = messageHandlerTemplate.replace(
                        '# Capabilities',
                        `# Transaction Context\n${JSON.stringify(
                            state.transactionContext,
                            null,
                            2,
                        )}\n\n# Capabilities`,
                    );
                }

                const context = composeContext({
                    state,
                    template: contextTemplate,
                });
                const aiResponseMessage = await generateMessageResponse({
                    runtime: runtime,
                    context,
                    modelClass: ModelClass.LARGE,
                });
                console.log(
                    `${messageId} message query elapsed: ${Date.now() - messageStart}ms, context: ${context}, response: ${JSON.stringify(aiResponseMessage)}`,
                );

                if (!aiResponseMessage) {
                    res.status(500).send(
                        'No response from generateMessageResponse',
                    );
                    return;
                }

                // save response to memory
                const aiResponseMemory: Memory = {
                    id: stringToUuid(Date.now().toString()),
                    ...userMessage,
                    userId: runtime.agentId,
                    agentId: runtime.agentId,
                    content: aiResponseMessage,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: Date.now(),
                };

                let actionResponseMessage = null as Content | null;

                await runtime.processActions(
                    memory,
                    [aiResponseMemory],
                    state,
                    async (newMessages) => {
                        actionResponseMessage = newMessages;
                        return [memory];
                    },
                );
                console.log(
                    `${messageId} message process elapsed: ${Date.now() - messageStart}ms`,
                );
                // await runtime.evaluate(memory, state);

                // Check if we should suppress the initial actionMessage
                const action = runtime.actions.find(
                    (a) => a.name === aiResponseMessage.action,
                );
                const shouldSuppressInitialMessage =
                    action?.suppressInitialMessage;
                if (actionResponseMessage) {
                    actionResponseMessage.action = action?.name;
                }
                const responseMessages = [];

                if (!shouldSuppressInitialMessage) {
                    responseMessages.push(aiResponseMemory);
                }

                if (actionResponseMessage) {
                    responseMessages.push(actionResponseMessage);
                }

                // Update transaction status instead of completely clearing context
                if (
                    aiResponseMessage.action === 'EXECUTE_SWAP' &&
                    actionResponseMessage &&
                    actionResponseMessage.text &&
                    actionResponseMessage.text.includes('Transaction ID')
                ) {
                    // After the transaction is completed, retain contextual information but mark it as completed,
                    // and clear any information that may have been mistakenly reused
                    if (runtimeTransactionContext[roomId]) {
                        runtimeTransactionContext[roomId] = {
                            ...runtimeTransactionContext[roomId],
                            transactionCompleted: true,
                            lastTransactionId:
                                actionResponseMessage.text.match(
                                    /Transaction ID: ([a-zA-Z0-9]+)/,
                                )?.[1] || '',
                            transactionAction: aiResponseMessage.action,
                            lastUpdated: Date.now(),
                        };

                        // Clear temporary transaction status that may cause problems
                        delete runtimeTransactionContext[roomId].isConfirmation;
                        delete runtimeTransactionContext[roomId].isConfirmed;

                        await runtime.cacheManager.set(
                            `transactionContext-${agentId}`,
                            runtimeTransactionContext,
                            { expires: 60 * 60 * 24 },
                        );
                    }
                }

                for (const m of responseMessages) {
                    const resMemory: Memory = {
                        id: stringToUuid(Date.now().toString()),
                        roomId: userMessage.roomId,
                        userId: runtime.agentId,
                        agentId: runtime.agentId,
                        content: m,
                        embedding: getEmbeddingZeroVector(),
                        createdAt: Date.now(),
                    };
                    state = await runtime.updateRecentMessageState(state);
                    await runtime.messageManager.createMemory(resMemory, true);
                }
                console.log(
                    `${messageId} message response elapsed: ${Date.now() - messageStart}ms`,
                );
                res.json(responseMessages);
            },
        );

        this.app.post(
            '/agents/:agentIdOrName/hyperfi/v1',
            async (req: express.Request, res: express.Response) => {
                // get runtime
                const agentId = req.params.agentIdOrName;
                let runtime = this.agents.get(agentId);
                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase(),
                    );
                }
                if (!runtime) {
                    res.status(404).send('Agent not found');
                    return;
                }

                // can we be in more than one hyperfi world at once
                // but you may want the same context is multiple worlds
                // this is more like an instanceId
                const roomId = stringToUuid(req.body.roomId ?? 'hyperfi');

                const body = req.body;

                // hyperfi specific parameters
                let nearby = [];
                let availableEmotes = [];

                if (body.nearby) {
                    nearby = body.nearby;
                }
                if (body.messages) {
                    // loop on the messages and record the memories
                    // might want to do this in parallel
                    for (const msg of body.messages) {
                        const parts = msg.split(/:\s*/);
                        const mUserId = stringToUuid(parts[0]);
                        await runtime.ensureConnection(
                            mUserId,
                            roomId, // where
                            parts[0], // username
                            parts[0], // userScreeName?
                            'hyperfi',
                        );
                        const content: Content = {
                            text: parts[1] || '',
                            attachments: [],
                            source: 'hyperfi',
                            inReplyTo: undefined,
                        };
                        const memory: Memory = {
                            id: stringToUuid(msg),
                            agentId: runtime.agentId,
                            userId: mUserId,
                            roomId,
                            content,
                        };
                        await runtime.messageManager.createMemory(memory);
                    }
                }
                if (body.availableEmotes) {
                    availableEmotes = body.availableEmotes;
                }

                const content: Content = {
                    // we need to compose who's near and what emotes are available
                    text: JSON.stringify(req.body),
                    attachments: [],
                    source: 'hyperfi',
                    inReplyTo: undefined,
                };

                const userId = stringToUuid('hyperfi');
                const userMessage = {
                    content,
                    userId,
                    roomId,
                    agentId: runtime.agentId,
                };

                const state = await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                });

                let template = hyperfiHandlerTemplate;
                template = template.replace(
                    '{{emotes}}',
                    availableEmotes.join('|'),
                );
                template = template.replace('{{nearby}}', nearby.join('|'));
                const context = composeContext({
                    state,
                    template,
                });

                function createHyperfiOutSchema(
                    nearby: string[],
                    availableEmotes: string[],
                ) {
                    const lookAtSchema =
                        nearby.length > 1
                            ? z
                                  .union(
                                      nearby.map((item) => z.literal(item)) as [
                                          z.ZodLiteral<string>,
                                          z.ZodLiteral<string>,
                                          ...z.ZodLiteral<string>[],
                                      ],
                                  )
                                  .nullable()
                            : nearby.length === 1
                              ? z.literal(nearby[0]).nullable()
                              : z.null(); // Fallback for empty array

                    const emoteSchema =
                        availableEmotes.length > 1
                            ? z
                                  .union(
                                      availableEmotes.map((item) =>
                                          z.literal(item),
                                      ) as [
                                          z.ZodLiteral<string>,
                                          z.ZodLiteral<string>,
                                          ...z.ZodLiteral<string>[],
                                      ],
                                  )
                                  .nullable()
                            : availableEmotes.length === 1
                              ? z.literal(availableEmotes[0]).nullable()
                              : z.null(); // Fallback for empty array

                    return z.object({
                        lookAt: lookAtSchema,
                        emote: emoteSchema,
                        say: z.string().nullable(),
                        actions: z.array(z.string()).nullable(),
                    });
                }

                // Define the schema for the expected output
                const hyperfiOutSchema = createHyperfiOutSchema(
                    nearby,
                    availableEmotes,
                );

                // Call LLM
                const response = await generateObject({
                    runtime,
                    context,
                    modelClass: ModelClass.SMALL, // 1s processing time on openai small
                    schema: hyperfiOutSchema,
                });

                if (!response) {
                    res.status(500).send(
                        'No response from generateMessageResponse',
                    );
                    return;
                }

                let hfOut;
                try {
                    hfOut = hyperfiOutSchema.parse(response.object);
                } catch {
                    elizaLogger.error(
                        'cant serialize response',
                        response.object,
                    );
                    res.status(500).send('Error in LLM response, try again');
                    return;
                }

                // do this in the background
                new Promise((resolve) => {
                    const contentObj: Content = {
                        text: hfOut.say,
                    };

                    if (hfOut.lookAt !== null || hfOut.emote !== null) {
                        contentObj.text += '. Then I ';
                        if (hfOut.lookAt !== null) {
                            contentObj.text += 'looked at ' + hfOut.lookAt;
                            if (hfOut.emote !== null) {
                                contentObj.text += ' and ';
                            }
                        }
                        if (hfOut.emote !== null) {
                            contentObj.text = 'emoted ' + hfOut.emote;
                        }
                    }

                    if (hfOut.actions !== null) {
                        // content can only do one action
                        contentObj.action = hfOut.actions[0];
                    }

                    // save response to memory
                    const responseMessage = {
                        ...userMessage,
                        userId: runtime.agentId,
                        content: contentObj,
                    };

                    runtime.messageManager
                        .createMemory(responseMessage)
                        .then(() => {
                            const messageId = stringToUuid(
                                Date.now().toString(),
                            );
                            const memory: Memory = {
                                id: messageId,
                                agentId: runtime.agentId,
                                userId,
                                roomId,
                                content,
                                createdAt: Date.now(),
                            };

                            // run evaluators (generally can be done in parallel with processActions)
                            // can an evaluator modify memory? it could but currently doesn't
                            runtime.evaluate(memory, state).then(() => {
                                // only need to call if responseMessage.content.action is set
                                if (contentObj.action) {
                                    // pass memory (query) to any actions to call
                                    runtime.processActions(
                                        memory,
                                        [responseMessage],
                                        state,
                                        async (_newMessages) => {
                                            // FIXME: this is supposed override what the LLM said/decided
                                            // but the promise doesn't make this possible
                                            //message = newMessages;
                                            return [memory];
                                        },
                                    ); // 0.674s
                                }
                                resolve(true);
                            });
                        });
                });
                res.json({ response: hfOut });
            },
        );

        this.app.post(
            '/:agentId/image',
            async (req: express.Request, res: express.Response) => {
                const agentId = req.params.agentId;
                const agent = this.agents.get(agentId);
                if (!agent) {
                    res.status(404).send('Agent not found');
                    return;
                }

                const images = await generateImage({ ...req.body }, agent);
                const imagesRes: { image: string; caption: string }[] = [];
                if (images.data && images.data.length > 0) {
                    for (let i = 0; i < images.data.length; i++) {
                        const caption = await generateCaption(
                            { imageUrl: images.data[i] },
                            agent,
                        );
                        imagesRes.push({
                            image: images.data[i],
                            caption: caption.title,
                        });
                    }
                }
                res.json({ images: imagesRes });
            },
        );

        this.app.post(
            '/fine-tune',
            async (req: express.Request, res: express.Response) => {
                try {
                    const response = await fetch(
                        'https://api.bageldb.ai/api/v1/asset',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-KEY': `${process.env.BAGEL_API_KEY}`,
                            },
                            body: JSON.stringify(req.body),
                        },
                    );

                    const data = await response.json();
                    res.json(data);
                } catch (error) {
                    res.status(500).json({
                        error: 'Please create an account at bakery.bagel.net and get an API key. Then set the BAGEL_API_KEY environment variable.',
                        details: error.message,
                    });
                }
            },
        );
        this.app.get(
            '/fine-tune/:assetId',
            async (req: express.Request, res: express.Response) => {
                const assetId = req.params.assetId;
                const downloadDir = path.join(
                    process.cwd(),
                    'downloads',
                    assetId,
                );

                elizaLogger.log('Download directory:', downloadDir);

                try {
                    elizaLogger.log('Creating directory...');
                    await fs.promises.mkdir(downloadDir, { recursive: true });

                    elizaLogger.log('Fetching file...');
                    const fileResponse = await fetch(
                        `https://api.bageldb.ai/api/v1/asset/${assetId}/download`,
                        {
                            headers: {
                                'X-API-KEY': `${process.env.BAGEL_API_KEY}`,
                            },
                        },
                    );

                    if (!fileResponse.ok) {
                        throw new Error(
                            `API responded with status ${
                                fileResponse.status
                            }: ${await fileResponse.text()}`,
                        );
                    }

                    elizaLogger.log('Response headers:', fileResponse.headers);

                    const fileName =
                        fileResponse.headers
                            .get('content-disposition')
                            ?.split('filename=')[1]
                            ?.replace(/"/g, /* " */ '') || 'default_name.txt';

                    elizaLogger.log('Saving as:', fileName);

                    const arrayBuffer = await fileResponse.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const filePath = path.join(downloadDir, fileName);
                    elizaLogger.log('Full file path:', filePath);

                    await fs.promises.writeFile(filePath, buffer);

                    // Verify file was written
                    const stats = await fs.promises.stat(filePath);
                    elizaLogger.log(
                        'File written successfully. Size:',
                        stats.size,
                        'bytes',
                    );

                    res.json({
                        success: true,
                        message: 'Single file downloaded successfully',
                        downloadPath: downloadDir,
                        fileCount: 1,
                        fileName: fileName,
                        fileSize: stats.size,
                    });
                } catch (error) {
                    elizaLogger.error('Detailed error:', error);
                    res.status(500).json({
                        error: 'Failed to download files from BagelDB',
                        details: error.message,
                        stack: error.stack,
                    });
                }
            },
        );

        this.app.post('/:agentId/speak', async (req, res) => {
            const agentId = req.params.agentId;
            const roomId = stringToUuid(
                req.body.roomId ?? 'default-room-' + agentId,
            );
            const userId = stringToUuid(req.body.userId ?? 'user');
            const text = req.body.text;

            if (!text) {
                res.status(400).send('No text provided');
                return;
            }

            let runtime = this.agents.get(agentId);

            // if runtime is null, look for runtime with the same name
            if (!runtime) {
                runtime = Array.from(this.agents.values()).find(
                    (a) =>
                        a.character.name.toLowerCase() ===
                        agentId.toLowerCase(),
                );
            }

            if (!runtime) {
                res.status(404).send('Agent not found');
                return;
            }

            try {
                // Process message through agent (same as /message endpoint)
                await runtime.ensureConnection(
                    userId,
                    roomId,
                    req.body.userName,
                    req.body.name,
                    'direct',
                );

                const messageId = stringToUuid(Date.now().toString());

                const content: Content = {
                    text,
                    attachments: [],
                    source: 'direct',
                    inReplyTo: undefined,
                };

                const userMessage = {
                    content,
                    userId,
                    roomId,
                    agentId: runtime.agentId,
                };

                const memory: Memory = {
                    id: messageId,
                    agentId: runtime.agentId,
                    userId,
                    roomId,
                    content,
                    createdAt: Date.now(),
                };

                await runtime.messageManager.createMemory(memory);

                const state = await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                });

                const context = composeContext({
                    state,
                    template: messageHandlerTemplate,
                });

                const response = await generateMessageResponse({
                    runtime: runtime,
                    context,
                    modelClass: ModelClass.LARGE,
                });

                // save response to memory
                const responseMessage = {
                    ...userMessage,
                    userId: runtime.agentId,
                    content: response,
                };

                await runtime.messageManager.createMemory(responseMessage);

                if (!response) {
                    res.status(500).send(
                        'No response from generateMessageResponse',
                    );
                    return;
                }

                await runtime.evaluate(memory, state);

                const _result = await runtime.processActions(
                    memory,
                    [responseMessage],
                    state,
                    async () => {
                        return [memory];
                    },
                );

                // Get the text to convert to speech
                const textToSpeak = response.text;

                // Convert to speech using ElevenLabs
                const elevenLabsApiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`;
                const apiKey = process.env.ELEVENLABS_XI_API_KEY;

                if (!apiKey) {
                    throw new Error('ELEVENLABS_XI_API_KEY not configured');
                }

                const speechResponse = await fetch(elevenLabsApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': apiKey,
                    },
                    body: JSON.stringify({
                        text: textToSpeak,
                        model_id:
                            process.env.ELEVENLABS_MODEL_ID ||
                            'eleven_multilingual_v2',
                        voice_settings: {
                            stability: Number.parseFloat(
                                process.env.ELEVENLABS_VOICE_STABILITY || '0.5',
                            ),
                            similarity_boost: Number.parseFloat(
                                process.env.ELEVENLABS_VOICE_SIMILARITY_BOOST ||
                                    '0.9',
                            ),
                            style: Number.parseFloat(
                                process.env.ELEVENLABS_VOICE_STYLE || '0.66',
                            ),
                            use_speaker_boost:
                                process.env
                                    .ELEVENLABS_VOICE_USE_SPEAKER_BOOST ===
                                'true',
                        },
                    }),
                });

                if (!speechResponse.ok) {
                    throw new Error(
                        `ElevenLabs API error: ${speechResponse.statusText}`,
                    );
                }

                const audioBuffer = await speechResponse.arrayBuffer();

                // Set appropriate headers for audio streaming
                res.set({
                    'Content-Type': 'audio/mpeg',
                    'Transfer-Encoding': 'chunked',
                });

                res.send(Buffer.from(audioBuffer));
            } catch (error) {
                elizaLogger.error(
                    'Error processing message or generating speech:',
                    error,
                );
                res.status(500).json({
                    error: 'Error processing message or generating speech',
                    details: error.message,
                });
            }
        });

        this.app.post('/:agentId/tts', async (req, res) => {
            const text = req.body.text;

            if (!text) {
                res.status(400).send('No text provided');
                return;
            }

            try {
                // Convert to speech using ElevenLabs
                const elevenLabsApiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`;
                const apiKey = process.env.ELEVENLABS_XI_API_KEY;

                if (!apiKey) {
                    throw new Error('ELEVENLABS_XI_API_KEY not configured');
                }

                const speechResponse = await fetch(elevenLabsApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': apiKey,
                    },
                    body: JSON.stringify({
                        text,
                        model_id:
                            process.env.ELEVENLABS_MODEL_ID ||
                            'eleven_multilingual_v2',
                        voice_settings: {
                            stability: Number.parseFloat(
                                process.env.ELEVENLABS_VOICE_STABILITY || '0.5',
                            ),
                            similarity_boost: Number.parseFloat(
                                process.env.ELEVENLABS_VOICE_SIMILARITY_BOOST ||
                                    '0.9',
                            ),
                            style: Number.parseFloat(
                                process.env.ELEVENLABS_VOICE_STYLE || '0.66',
                            ),
                            use_speaker_boost:
                                process.env
                                    .ELEVENLABS_VOICE_USE_SPEAKER_BOOST ===
                                'true',
                        },
                    }),
                });

                if (!speechResponse.ok) {
                    throw new Error(
                        `ElevenLabs API error: ${speechResponse.statusText}`,
                    );
                }

                const audioBuffer = await speechResponse.arrayBuffer();

                res.set({
                    'Content-Type': 'audio/mpeg',
                    'Transfer-Encoding': 'chunked',
                });

                res.send(Buffer.from(audioBuffer));
            } catch (error) {
                elizaLogger.error(
                    'Error processing message or generating speech:',
                    error,
                );
                res.status(500).json({
                    error: 'Error processing message or generating speech',
                    details: error.message,
                });
            }
        });
    }

    // agent/src/index.ts:startAgent calls this
    public registerAgent(runtime: AgentRuntime) {
        // register any plugin endpoints?
        // but once and only once
        this.agents.set(runtime.agentId, runtime);
    }

    public unregisterAgent(runtime: AgentRuntime) {
        this.agents.delete(runtime.agentId);
    }

    public start(port: number) {
        this.server = this.app.listen(port, () => {
            elizaLogger.success(
                `REST API bound to 0.0.0.0:${port}. If running locally, access it at http://localhost:${port}.`,
            );
        });

        // Handle graceful shutdown
        const gracefulShutdown = () => {
            elizaLogger.log('Received shutdown signal, closing server...');
            this.server.close(() => {
                elizaLogger.success('Server closed successfully');
                process.exit(0);
            });

            // Force close after 5 seconds if server hasn't closed
            setTimeout(() => {
                elizaLogger.error(
                    'Could not close connections in time, forcefully shutting down',
                );
                process.exit(1);
            }, 5000);
        };

        // Handle different shutdown signals
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    }

    public stop() {
        if (this.server) {
            this.server.close(() => {
                elizaLogger.success('Server stopped');
            });
        }
    }
}

export const DirectClientInterface: Client = {
    start: async (_runtime: IAgentRuntime) => {
        elizaLogger.log('DirectClientInterface start');
        const client = new DirectClient();
        const serverPort = Number.parseInt(settings.SERVER_PORT || '3000');
        client.start(serverPort);
        return client;
    },
    stop: async (_runtime: IAgentRuntime, client?: Client) => {
        if (client instanceof DirectClient) {
            client.stop();
        }
    },
};

export default DirectClientInterface;
