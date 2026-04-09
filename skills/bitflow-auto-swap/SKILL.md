---
name: bitflow-auto-swap
description: "Fetches the best swap quote from Bitflow DEX and executes a STX-to-sBTC swap on-chain via the AIBTC MCP wallet."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | quote | run"
  entry: "bitflow-auto-swap/bitflow-auto-swap.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# Bitflow Auto Swap

## What it does
Queries the Bitflow DEX aggregator to get the best available swap route for STX → sBTC, then executes the swap on-chain using the AIBTC MCP wallet. Enforces a hardcoded maximum spend limit of 1 STX and 1% slippage tolerance to protect agent funds.

## Why agents need it
Autonomous DeFi agents need to convert STX to sBTC to participate in Bitcoin-native yield strategies. This skill provides a safe, auditable swap execution primitive with enforced spend limits, slippage protection, and full on-chain transaction proof via tx hash.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum swap input: 1 STX per invocation — hardcoded spend limit.
- Maximum slippage: 1% — hardcoded.
- Agent will REFUSE if wallet balance is insufficient.
- Agent will REFUSE if no valid swap route is found.
- Mainnet only — real funds at risk.

## Commands

### doctor
\`\`\`bash
bun run bitflow-auto-swap/bitflow-auto-swap.ts doctor --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### quote
\`\`\`bash
bun run bitflow-auto-swap/bitflow-auto-swap.ts quote --amount 1
\`\`\`

### run
\`\`\`bash
bun run bitflow-auto-swap/bitflow-auto-swap.ts run --amount 1 --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "tokenIn": "token-stx",
    "tokenOut": "token-sbtc",
    "amountIn_stx": 1,
    "estimated_sats": 21000,
    "minAmountOut_sats": 20790,
    "slippage_max": 0.01,
    "route": "STX → sBTC via Bitflow DEX",
    "contract": "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router"
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires STX balance greater than swap amount plus gas fees.
- Max swap: 1 STX per invocation.
- Max slippage: 1%.
- Uses Hiro API for balance checks.
- Uses CoinGecko for price estimation.