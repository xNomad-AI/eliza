import {
    Connection,
    PublicKey,
    RpcResponseAndContext,
    SignatureStatus,
    VersionedTransaction,
} from "@solana/web3.js";
import {
    getOrCreateAssociatedTokenAccount,
  } from "@solana/spl-token";
import {
    ActionExample,
    composeContext,
    generateObjectDeprecated,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    settings,
    type State,
    type Action,
    elizaLogger,
} from "@elizaos/core";
import BigNumber from "bignumber.js";
import { getWalletKey } from "../keypairUtils.ts";
import { walletProvider, WalletProvider } from "../providers/wallet.ts";
import { getTokenDecimals } from "./swapUtils.ts";

async function swapToken(
    connection: Connection,
    walletPublicKey: PublicKey,
    inputTokenCA: string,
    outputTokenCA: string,
    amount: number,
    runtime: IAgentRuntime
): Promise<any> {
    try {
        // Get the decimals for the input token
        const decimals =
            inputTokenCA === settings.SOL_ADDRESS
                ? new BigNumber(9)
                : new BigNumber(
                      await getTokenDecimals(connection, inputTokenCA)
                  );

        elizaLogger.log("Decimals:", decimals.toString());

        // Use BigNumber for adjustedAmount: amount * (10 ** decimals)
        const amountBN = new BigNumber(amount);
        const adjustedAmount = amountBN.multipliedBy(
            new BigNumber(10).pow(decimals)
        );

        elizaLogger.log("Fetching quote with params:", {
            inputMint: inputTokenCA,
            outputMint: outputTokenCA,
            amount: adjustedAmount,
        });

        // auto slippage
        let url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputTokenCA}&outputMint=${outputTokenCA}&amount=${adjustedAmount}&dynamicSlippage=true&autoSlippage=true&maxAccounts=64&onlyDirectRoutes=false&asLegacyTransaction=false`;
        if (settings.JUP_SWAP_FEE_BPS !== undefined) {
            url += `&platformFeeBps=${settings.JUP_SWAP_FEE_BPS}`;
        }

        const quoteResponse = await fetch(url);
        const quoteData = await quoteResponse.json();

        if (!quoteData || quoteData.error) {
            elizaLogger.error("Quote error:", quoteData);
            throw new Error(
                `Failed to get quote: ${quoteData?.error || "Unknown error"}`
            );
        }

        // get or create fee token account
        const { keypair } = await getWalletKey(runtime, true);
        const FEE_ACCOUNT_INPUT_MINT_ACCOUNT = (
            await getOrCreateAssociatedTokenAccount(
              connection,
              keypair,
              new PublicKey(quoteData.inputMint),
              new PublicKey(settings.JUP_SWAP_FEE_ACCOUNT),
            )
          ).address;

        const FEE_ACCOUNT_OUTPUT_MINT_ACCOUNT = (
            await getOrCreateAssociatedTokenAccount(
                connection,
                keypair,
                new PublicKey(quoteData.outputMint),
                new PublicKey(settings.JUP_SWAP_FEE_ACCOUNT)
            )
          ).address;

        const swapRequestBody = {
            quoteResponse: quoteData,
            userPublicKey: walletPublicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            feeAccount: FEE_ACCOUNT_INPUT_MINT_ACCOUNT.toBase58(),
            dynamicSlippage: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                global: false,
                maxLamports: 4000000,
                priorityLevel: "veryHigh"
              }
            },
        };

        elizaLogger.log("Requesting swap with body:", swapRequestBody);

        const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(swapRequestBody),
        });

        const swapData = await swapResponse.json();

        if (!swapData || !swapData.swapTransaction) {
            elizaLogger.error("Swap error:", swapData);
            throw new Error(
                `Failed to get swap transaction: ${swapData?.error || "No swap transaction returned"}`
            );
        }

        elizaLogger.log("Swap transaction received");
        return swapData;
    } catch (error) {
        elizaLogger.error("Error in swapToken:", error);
        throw error;
    }
}

const swapTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "inputTokenSymbol": "SOL",
    "outputTokenSymbol": "USDC",
    "inputTokenCA": "So11111111111111111111111111111111111111112",
    "outputTokenCA": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1.5
}
\`\`\`

{{recentMessages}}

Given the recent messages and wallet information below:

{{walletInfo}}

Extract the following information about the requested token swap:
- Input token symbol (the token being sold)
- Output token symbol (the token being bought)
- Input token contract address if provided
- Output token contract address if provided
- Amount to swap

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined. The result should be a valid JSON object with the following schema:
\`\`\`json
{
    "inputTokenSymbol": string | null,
    "outputTokenSymbol": string | null,
    "inputTokenCA": string | null,
    "outputTokenCA": string | null,
    "amount": number | string | null
}
\`\`\``;

// if we get the token symbol but not the CA, check walet for matching token, and if we have, get the CA for it

// get all the tokens in the wallet using the wallet provider
async function getTokensInWallet(runtime: IAgentRuntime) {
    const { publicKey } = await getWalletKey(runtime, false);
    const walletProvider = new WalletProvider(
        new Connection("https://api.mainnet-beta.solana.com"),
        publicKey
    );

    const walletInfo = await walletProvider.fetchPortfolioValue(runtime);
    const items = walletInfo.items;
    return items;
}

// check if the token symbol is in the wallet
async function getTokenFromWallet(runtime: IAgentRuntime, tokenSymbol: string) {
    try {
        const items = await getTokensInWallet(runtime);
        const token = items.find((item) => item.symbol === tokenSymbol);

        if (token) {
            return token.address;
        } else {
            return null;
        }
    } catch (error) {
        elizaLogger.error("Error checking token in wallet:", error);
        return null;
    }
}

// swapToken should took CA, not symbol

export const executeSwap: Action = {
    name: "SWAP_TOKEN",
    similes: ["SWAP_TOKENS", "TOKEN_SWAP", "TRADE_TOKENS", "EXCHANGE_TOKENS"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // Check if the necessary parameters are provided in the message
        elizaLogger.log("Message:", message);
        return true;
    },
    description: "Perform a token swap.",
    template: swapTemplate,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        // composeState
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        const walletInfo = await walletProvider.get(runtime, message, state);

        state.walletInfo = walletInfo;

        const swapContext = composeContext({
            state,
            template: swapTemplate,
        });

        const response = await generateObjectDeprecated({
            runtime,
            context: swapContext,
            modelClass: ModelClass.LARGE,
        });

        elizaLogger.log("Response:", response);
        // const type = response.inputTokenSymbol?.toUpperCase() === "SOL" ? "buy" : "sell";

        // Add SOL handling logic
        if (response.inputTokenSymbol?.toUpperCase() === "SOL") {
            response.inputTokenCA = settings.SOL_ADDRESS;
        }
        if (response.outputTokenSymbol?.toUpperCase() === "SOL") {
            response.outputTokenCA = settings.SOL_ADDRESS;
        }

        // if both contract addresses are set, lets execute the swap
        // TODO: try to resolve CA from symbol based on existing symbol in wallet
        if (!response.inputTokenCA && response.inputTokenSymbol) {
            elizaLogger.log(
                `Attempting to resolve CA for input token symbol: ${response.inputTokenSymbol}`
            );
            response.inputTokenCA = await getTokenFromWallet(
                runtime,
                response.inputTokenSymbol
            );
            if (response.inputTokenCA) {
                elizaLogger.log(
                    `Resolved inputTokenCA: ${response.inputTokenCA}`
                );
            } else {
                elizaLogger.log(
                    "No contract addresses provided, skipping swap"
                );
                const responseMsg = {
                    text: "I need the contract addresses to perform the swap",
                };
                callback?.(responseMsg);
                return true;
            }
        }

        if (!response.outputTokenCA && response.outputTokenSymbol) {
            elizaLogger.log(
                `Attempting to resolve CA for output token symbol: ${response.outputTokenSymbol}`
            );
            response.outputTokenCA = await getTokenFromWallet(
                runtime,
                response.outputTokenSymbol
            );
            if (response.outputTokenCA) {
                elizaLogger.log(
                    `Resolved outputTokenCA: ${response.outputTokenCA}`
                );
            } else {
                elizaLogger.log(
                    "No contract addresses provided, skipping swap"
                );
                const responseMsg = {
                    text: "I need the contract addresses to perform the swap",
                };
                callback?.(responseMsg);
                return true;
            }
        }

        if (!response.amount) {
            elizaLogger.log("No amount provided, skipping swap");
            const responseMsg = {
                text: "I need the amount to perform the swap",
            };
            callback?.(responseMsg);
            return true;
        }

        // TODO: if response amount is half, all, etc, semantically retrieve amount and return as number
        if (!response.amount) {
            elizaLogger.log("Amount is not a number, skipping swap");
            const responseMsg = {
                text: "The amount must be a number",
            };
            callback?.(responseMsg);
            return true;
        }
        try {
            const connection = new Connection(
                "https://api.mainnet-beta.solana.com"
            );
            const { publicKey: walletPublicKey } = await getWalletKey(
                runtime,
                false
            );

            // const provider = new WalletProvider(connection, walletPublicKey);

            elizaLogger.log("Wallet Public Key:", walletPublicKey);
            elizaLogger.log("inputTokenSymbol:", response.inputTokenCA);
            elizaLogger.log("outputTokenSymbol:", response.outputTokenCA);
            elizaLogger.log("amount:", response.amount);

            const swapResult = await swapToken(
                connection,
                walletPublicKey,
                response.inputTokenCA as string,
                response.outputTokenCA as string,
                response.amount as number,
                runtime,
            );

            elizaLogger.log("Deserializing transaction...");
            const transactionBuf = Buffer.from(
                swapResult.swapTransaction,
                "base64"
            );
            const transaction =
                VersionedTransaction.deserialize(transactionBuf);

            elizaLogger.log("Preparing to sign transaction...");

            elizaLogger.log("Creating keypair...");
            const { keypair } = await getWalletKey(runtime, true);
            // Verify the public key matches what we expect
            if (keypair.publicKey.toBase58() !== walletPublicKey.toBase58()) {
                throw new Error(
                    "Generated public key doesn't match expected public key"
                );
            }

            elizaLogger.log("Signing transaction...");
            transaction.sign([keypair]);

            elizaLogger.log("Sending transaction...");

            const latestBlockhash = await connection.getLatestBlockhash();

            const txid = await connection.sendTransaction(transaction, {
                skipPreflight: false,
                maxRetries: 3,
                preflightCommitment: "confirmed",
            });

            elizaLogger.log("Transaction sent:", txid);

            let confirmation: RpcResponseAndContext<SignatureStatus | null>;

            // wait for 30s for the transaction to be processed
            for (let i = 0; i < 30; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                confirmation = await connection.getSignatureStatus(txid, {
                    searchTransactionHistory: false,
                });

                if (confirmation.value) {
                    break;
                }
            }
            // always timeout, so commented out
            // const confirmation = await connection.confirmTransaction(
            //     {
            //         signature: txid,
            //         blockhash: latestBlockhash.blockhash,
            //         lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            //     },
            //     // if using confirmed, there will be an timeout
            //     "recent"
            // );

            if (confirmation.value.err) {
                throw new Error(
                    `Transaction failed: ${confirmation.value.err}`
                );
            }

            if (confirmation.value.err) {
                throw new Error(
                    `Transaction failed: ${confirmation.value.err}`
                );
            }

            elizaLogger.log("Swap completed successfully!");
            elizaLogger.log(`Transaction ID: ${txid}`);

            const responseMsg = {
                text: `Swap completed successfully! Transaction ID: ${txid}`,
            };

            callback?.(responseMsg);

            return true;
        } catch (error) {
            elizaLogger.error("Error during token swap:", error);
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Initiating 1 ETH swap for DAI...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swap in progress... Awaiting confirmation.",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swap completed. 1 ETH converted to 3000 DAI. Transaction ID: ...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Swapping 0.5 BTC for USDT...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Transaction being processed...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "BTC swapped successfully! 0.5 BTC for 12000 USDT. Transaction ID: ...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Attempting to swap 10,000 USDT for 5,000 AAVE...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swap completed! 10,000 USDT converted to 5,000 AAVE. Transaction ID: ...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Starting 50 LINK to ETH swap...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Executing swap...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swap success! 50 LINK converted to 5 ETH. Transaction ID: ...",
                },
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    inputTokenSymbol: "SOL",
                    outputTokenSymbol: "USDC",
                    amount: 0.1,
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swapping 0.1 SOL for USDC...",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swap completed successfully! Transaction ID: ...",
                },
            },
        ],
        // Add more examples as needed
    ] as ActionExample[][],
} as Action;