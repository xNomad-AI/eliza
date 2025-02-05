import { AnchorProvider } from "@coral-xyz/anchor";
import { Wallet } from "@coral-xyz/anchor";
import axios from "axios";
import {
    Commitment,
    Connection,
    Keypair,
    PublicKey,
    Transaction,
} from "@solana/web3.js";
import {
    calculateWithSlippageBuy,
    CreateTokenMetadata,
    PriorityFee,
    PumpFunSDK,
    sendTx,
    TransactionResult
} from "pumpdotfun-sdk";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
    settings,
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    generateObjectDeprecated,
    composeContext,
    type Action,
    elizaLogger,
} from "@elizaos/core";

import { walletProvider } from "../providers/wallet.ts";

export const createAndBuyToken = async ({
                                            deployer,
                                            mint,
                                            tokenMetadata,
                                            buyAmountSol,
                                            priorityFee,
                                            allowOffCurve,
                                            commitment = "confirmed",
                                            sdk,
                                            connection,
                                            slippage,
                                        }: {
    deployer: Keypair;
    mint: Keypair;
    tokenMetadata: CreateTokenMetadata;
    buyAmountSol: bigint;
    priorityFee: PriorityFee;
    allowOffCurve: boolean;
    commitment?:
        | "processed"
        | "confirmed"
        | "finalized"
        | "recent"
        | "single"
        | "singleGossip"
        | "root"
        | "max";
    sdk: PumpFunSDK;
    connection: Connection;
    slippage: string;
}): Promise<{
    success: boolean;
    ca: string;
    creator?: string;
    error?: any;
}> => {
    let createResults: TransactionResult;
    try {
        elizaLogger.log("Creating token with metadata:", deployer.publicKey, mint.publicKey, tokenMetadata, buyAmountSol, priorityFee, allowOffCurve, slippage);
        const url = await uploadTokenMetadata(tokenMetadata);
        createResults = await createAndBuyWithUrl(
            sdk,
            deployer,
            mint,
            tokenMetadata,
            buyAmountSol,
            BigInt(slippage),
            priorityFee,
            commitment,
            url,
        );
    }catch (error) {
        elizaLogger.error("Error creating token:", error);
        return {
            success: false,
            ca: mint.publicKey.toBase58(),
            error: error.message || "Transaction failed",
        };
    }

    elizaLogger.log("Create Results: ", createResults);

    if (createResults.success) {
        elizaLogger.log(
            "Success:",
            `https://pump.fun/${mint.publicKey.toBase58()}`
        );
        const ata = getAssociatedTokenAddressSync(
            mint.publicKey,
            deployer.publicKey,
            allowOffCurve
        );
        const balance = await connection.getTokenAccountBalance(
            ata,
            "processed"
        );
        const amount = balance.value.uiAmount;
        if (amount === null) {
            elizaLogger.log(
                `${deployer.publicKey.toBase58()}:`,
                "No Account Found"
            );
        } else {
            elizaLogger.log(`${deployer.publicKey.toBase58()}:`, amount);
        }

        return {
            success: true,
            ca: mint.publicKey.toBase58(),
            creator: deployer.publicKey.toBase58(),
        };
    } else {
        elizaLogger.log("Create and Buy failed");
        return {
            success: false,
            ca: mint.publicKey.toBase58(),
            error: createResults.error || "Transaction failed",
        };
    }
};

export const buyToken = async ({
                                   sdk,
                                   buyer,
                                   mint,
                                   amount,
                                   priorityFee,
                                   allowOffCurve,
                                   slippage,
                                   connection,
                               }: {
    sdk: PumpFunSDK;
    buyer: Keypair;
    mint: PublicKey;
    amount: bigint;
    priorityFee: PriorityFee;
    allowOffCurve: boolean;
    slippage: string;
    connection: Connection;
}) => {
    const buyResults = await sdk.buy(
        buyer,
        mint,
        amount,
        BigInt(slippage),
        priorityFee
    );
    if (buyResults.success) {
        elizaLogger.log("Success:", `https://pump.fun/${mint.toBase58()}`);
        const ata = getAssociatedTokenAddressSync(
            mint,
            buyer.publicKey,
            allowOffCurve
        );
        const balance = await connection.getTokenAccountBalance(
            ata,
            "processed"
        );
        const amount = balance.value.uiAmount;
        if (amount === null) {
            elizaLogger.log(
                `${buyer.publicKey.toBase58()}:`,
                "No Account Found"
            );
        } else {
            elizaLogger.log(`${buyer.publicKey.toBase58()}:`, amount);
        }
    } else {
        elizaLogger.log("Buy failed");
    }
};

export const sellToken = async ({
                                    sdk,
                                    seller,
                                    mint,
                                    amount,
                                    priorityFee,
                                    allowOffCurve,
                                    slippage,
                                    connection,
                                }: {
    sdk: PumpFunSDK;
    seller: Keypair;
    mint: PublicKey;
    amount: bigint;
    priorityFee: PriorityFee;
    allowOffCurve: boolean;
    slippage: string;
    connection: Connection;
}) => {
    const sellResults = await sdk.sell(
        seller,
        mint,
        amount,
        BigInt(slippage),
        priorityFee
    );
    if (sellResults.success) {
        elizaLogger.log("Success:", `https://pump.fun/${mint.toBase58()}`);
        const ata = getAssociatedTokenAddressSync(
            mint,
            seller.publicKey,
            allowOffCurve
        );
        const balance = await connection.getTokenAccountBalance(
            ata,
            "processed"
        );
        const amount = balance.value.uiAmount;
        if (amount === null) {
            elizaLogger.log(
                `${seller.publicKey.toBase58()}:`,
                "No Account Found"
            );
        } else {
            elizaLogger.log(`${seller.publicKey.toBase58()}:`, amount);
        }
    } else {
        elizaLogger.log("Sell failed");
    }
};

// previous logic:
// if (typeof window !== "undefined" && typeof window.confirm === "function") {
//     return window.confirm(
//         "Confirm the creation and purchase of the token?"
//     );
// }
// return true;
const promptConfirmation = async (): Promise<boolean> => {
    return true;
};

// Save the base64 data to a file
import * as fs from "fs";
import * as path from "path";
import { getWalletKey } from "../keypairUtils.ts";
import bs58 from "bs58";

const pumpfunTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "name": "GLITCHIZA",
    "symbol": "GLITCHIZA",
    "description": "A test token",
    "twitter": "https://x.com/elonmusk",
    "website": "https://x.com",
    "telegram": "https://t.me/+El39K_BrnIVhOWM1",
    "buyAmountSol": "0.00069"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract or generate (come up with if not included) the following information about the requested token creation:
- Token name
- Token symbol
- Token description
- Twitter URL
- Website URL
- Telegram URL
- Amount of SOL to buy

Respond with a JSON markdown block containing only the extracted values. Twitter URL, Website URL, Telegram URL is not must required, if not provided, it will be empty.
Amount of SOL to buy is not required, if not provided, it will be 0.
`;

export default {
    name: "CREATE_AND_BUY_TOKEN",
    similes: ["CREATE_AND_PURCHASE_TOKEN", "DEPLOY_AND_BUY_TOKEN"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.info(`validating CREATE_AND_BUY_TOKEN`);
        message.content?.attachments?.forEach((attachment) => {
            elizaLogger.log("Valiating User Attachment:", attachment.contentType, attachment.url);
        });
        return true;
    },
    description:
        "Create a new token and buy a specified amount using SOL. Requires deployer private key, token metadata, buy amount in SOL, priority fee, and allowOffCurve flag.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting CREATE_AND_BUY_TOKEN handler...");

        // Compose state if not provided
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Get wallet info for context
        const walletInfo = await walletProvider.get(runtime, message, state);
        state.walletInfo = walletInfo;

        // Generate structured content from natural language
        const pumpContext = composeContext({
            state,
            template: pumpfunTemplate,
        });

        const content = await generateObjectDeprecated({
            runtime,
            context: pumpContext,
            modelClass: ModelClass.LARGE,
        });

        elizaLogger.info('Generated content:', content);

        let { name, symbol, description, twitter, website, telegram, buyAmountSol } = content;
        if (!name){
            name = symbol;
        }
        let tokenMetadata = {
            name,
            symbol,
            description,
            twitter,
            website,
            telegram,
        };
        elizaLogger.info(`Content for CREATE_AND_BUY_TOKEN action: ${JSON.stringify(tokenMetadata)}, ${buyAmountSol}`);
        const imageUrl = message.content?.attachments?.[0]?.url;
        elizaLogger.info("image url", imageUrl);

        const fullTokenMetadata: CreateTokenMetadata = {
            name: tokenMetadata.name,
            symbol: tokenMetadata.symbol,
            description: tokenMetadata.description,
            twitter: tokenMetadata.twitter,
            telegram: tokenMetadata.telegram,
            website: tokenMetadata.website,
            file: await fs.openAsBlob(imageUrl),
        };

        // Default priority fee for high network load
        const priorityFee = {
            unitLimit: 250_000,
            unitPrice: 100_000,
        };
        const slippage = "100";
        try {
            // Get private key from settings and create deployer keypair
            const { keypair: deployerKeypair } = await getWalletKey(
                runtime,
                true
            );
            elizaLogger.log(
                `deployer: ${deployerKeypair.publicKey.toBase58()}`
            );
            // Generate new mint keypair
            const mintKeypair = Keypair.generate();
            elizaLogger.log(
                `Generated mint address: ${mintKeypair.publicKey.toBase58()}`
            );

            // Setup connection and SDK
            const rpcUrl = runtime.getSetting("SOLANA_RPC_URL") || settings.SOLANA_RPC_URL;
            const connection = new Connection(rpcUrl, {
                commitment: "confirmed",
                confirmTransactionInitialTimeout: 500000, // 120 seconds
            });

            elizaLogger.log(
                `rpc connection: ${rpcUrl}, ${deployerKeypair.publicKey.toBase58()}`
            );

            const wallet = new Wallet(deployerKeypair);

            let provider: AnchorProvider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
            let sdk: PumpFunSDK;
            try {
                sdk = new PumpFunSDK(provider);
            }catch (e){
                console.error("Error initializing PumpFunSDK:", e);
                throw e;
            }
            elizaLogger.log("starting buyamount", Number(buyAmountSol));

            // Convert SOL to lamports (1 SOL = 1_000_000_000 lamports)
            const lamports = Math.floor(Number(buyAmountSol) * 1_000_000_000);

            elizaLogger.log("Executing create and buy transaction...", deployerKeypair.publicKey, mintKeypair.publicKey);

            const result = await createAndBuyToken({
                deployer: deployerKeypair,
                mint: mintKeypair,
                tokenMetadata: fullTokenMetadata,
                buyAmountSol: BigInt(lamports),
                priorityFee,
                allowOffCurve: false,
                sdk,
                connection,
                slippage,
            });

            if (callback) {
                if (result.success) {
                    callback({
                        text: `Token ${tokenMetadata.name} (${tokenMetadata.symbol}) created successfully!\nContract Address: ${result.ca}\nCreator: ${result.creator}\nView at: https://pump.fun/${result.ca}`,
                        content: {
                            tokenInfo: {
                                symbol: tokenMetadata.symbol,
                                address: result.ca,
                                creator: result.creator,
                                name: tokenMetadata.name,
                                description: tokenMetadata.description,
                                timestamp: Date.now(),
                            },
                        },
                    });
                } else {
                    callback({
                        text: `Failed to create token: ${result.error}\nAttempted mint address: ${result.ca}`,
                        content: {
                            error: result.error,
                            mintAddress: result.ca,
                        },
                    });
                }
            }
            const successMessage = `Token created success: ${result.success}!,  View at: https://pump.fun/${mintKeypair.publicKey.toBase58()}`;
            elizaLogger.log(successMessage);
            return result.success;
        } catch (error) {
            if (callback) {
                callback({
                    text: `Error during pumpfun token creation: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: 'Create a new token called GLITCHIZA with symbol GLITCHIZA and generate a description about it on pump.fun, with twitter https://x.com/elonmusk, with website https://x.com, with telegram https://t.me/+El39K_BrnIVhOWM1, buy 0.00069 SOL worth.'
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Token GLITCHIZA (GLITCHIZA) created successfully on pump.fun!\nContract Address: 3kD5DN4bbA3nykb1abjS66VF7cYZkKdirX8bZ6ShJjBB\nCreator: 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa\nView at: https://pump.fun/EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
                    action: "CREATE_AND_BUY_TOKEN",
                    content: {
                        tokenInfo: {
                            symbol: "GLITCHIZA",
                            address:
                                "EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
                            creator:
                                "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
                            name: "GLITCHIZA",
                            description: "A GLITCHIZA token",
                            twitter: "https://x.com/elonmusk",
                            website: "https://x.com",
                            telegram: "https://t.me/+El39K_BrnIVhOWM1",
                        },
                    },
                },
            },
        ],
    ] as ActionExample[][],
} as Action;

async function uploadTokenMetadata(create): Promise<any> {
    create = create as CreateTokenMetadata;
    elizaLogger.log("Uploading token metadata to IPFS...", create);
    let formData = new FormData();
    formData.append("name", create.name);
    formData.append("symbol", create.symbol);
    formData.append("description", create.description);
    formData.append("twitter", create.twitter || "");
    formData.append("telegram", create.telegram || "");
    formData.append("website", create.website || "");
    formData.append("file", create.file);
    formData.append("showName", "true");

    try {
        const response = await axios.post("https://pump.fun/api/ipfs", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });
        return response.data;
    } catch (error) {
        throw new Error(`Upload failed: ${error.message}`);
    }
}


async function createAndBuyWithUrl(sdk: PumpFunSDK, creator: Keypair, mint: Keypair, createTokenMetadata: CreateTokenMetadata, buyAmountSol: bigint, slippageBasisPoints?: bigint, priorityFees?: PriorityFee, commitment?: Commitment, url?:string): Promise<TransactionResult> {
    let createTx = await sdk.getCreateInstructions(creator.publicKey, createTokenMetadata.name, createTokenMetadata.symbol, url, mint);
    let newTx = new Transaction().add(createTx);
    if (buyAmountSol > 0) {
        const globalAccount = await sdk.getGlobalAccount('confirmed');
        const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
        const buyAmountWithSlippage = calculateWithSlippageBuy(buyAmountSol, BigInt(slippageBasisPoints));
        const buyTx = await sdk.getBuyInstructions(creator.publicKey, mint.publicKey, globalAccount.feeRecipient, buyAmount, buyAmountWithSlippage);
        newTx.add(buyTx);
    }
    let createResults = await sendTx(sdk.connection, newTx, creator.publicKey, [creator, mint], priorityFees, commitment);
    return createResults;
}


// async function run(){
//     const keypair =         Keypair.fromSecretKey(bs58.decode(''))
//
//     const getProvider = () => {
//         const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=9626fbff-7925-49f4-a66a-27525747b2db');
//         const wallet = new Wallet(keypair);
//         return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
//     };
//     const sdk = new PumpFunSDK(getProvider());
//     console.log(1111)
// }
//
// run().catch(console.error);