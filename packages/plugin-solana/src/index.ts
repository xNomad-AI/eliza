import {AgentRuntime, elizaLogger, IAgentRuntime, stringToUuid} from "@elizaos/core";

export * from "./providers/token.ts";
export * from "./providers/wallet.ts";
export * from "./providers/trustScoreProvider.ts";
export * from "./evaluators/trust.ts";
import type { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer.ts";
import transferSol from "./actions/transfer_sol.ts";
import { TokenProvider } from "./providers/token.ts";
import { WalletProvider } from "./providers/wallet.ts";
import { getTokenBalance, getTokenBalances } from "./providers/tokenUtils.ts";
import { walletProvider } from "./providers/wallet.ts";
import { trustScoreProvider } from "./providers/trustScoreProvider.ts";
import { trustEvaluator } from "./evaluators/trust.ts";
import { executeSwap } from "./actions/swap.ts";
import {autoExecuteSwap, checkAutoSwapTask} from "./actions/autoSwap.ts";
import take_order from "./actions/takeOrder";
import pumpfun from "./actions/pumpfun.ts";
import fomo from "./actions/fomo.ts";
import { executeSwapForDAO } from "./actions/swapDao";
import {airdrop} from "./actions/airdrop.ts";
export { TokenProvider, WalletProvider, getTokenBalance, getTokenBalances };
export const solanaPlugin: Plugin = {
    name: "solana",
    description: "Solana Plugin for Eliza",
    actions: [
        // transferToken,
        // transferSol,
        executeSwap,
        pumpfun,
        autoExecuteSwap,
        airdrop,
        // fomo,
        // executeSwapForDAO,
        // take_order,
    ],
    evaluators: [],
    providers: [walletProvider],
};
export default solanaPlugin;

export async function createSolanaPlugin(runtime: IAgentRuntime): Promise<Plugin>{
    // start a loop that runs every x seconds
    setInterval(
        async () => {
            // await checkAutoSwapTask(runtime)
        },
        20000
    );
    return {
        name: "solana",
        description: "Solana Plugin for Eliza",
        actions: [
            // transferToken,
            // transferSol,
            executeSwap,
            pumpfun,
            autoExecuteSwap,
            airdrop,
            // fomo,
            // executeSwapForDAO,
            // take_order,
        ],
        evaluators: [],
        providers: [walletProvider],
    };
}