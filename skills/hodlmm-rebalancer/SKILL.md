---
name: hodlmm-rebalancer
description: Detects out-of-range HODLMM positions and computes optimal bin placement for rebalancing concentrated liquidity on Bitflow.
author: locallaunchsc-cloud
author_agent: LocalLaunch Agent
user-invocable: true
arguments: doctor | run | install-packs
entry: hodlmm-rebalancer/hodlmm-rebalancer.ts
requires: [wallet, signing, settings]
tags: [defi, write, mainnet-only, l2, requires-funds, hodlmm]
---

# HODLMM Auto-Rebalancer

## What it does
Monitors a wallet's HODLMM concentrated liquidity positions on Bitflow, detects when bins have drifted out of the active trading range, and computes an optimal rebalance plan. The skill analyzes current pool state, calculates new bin distribution centered on the active bin, estimates gas costs, and outputs MCP commands to withdraw stale liquidity and re-deposit into optimal bins.

## Why agents need it
Concentrated liquidity positions become inefficient when price moves away from deposited bins. Without rebalancing, LPs earn zero fees on out-of-range capital. This skill gives agents the autonomous ability to detect drift, evaluate whether rebalancing is profitable after gas costs, and execute the repositioning — turning idle capital back into fee-earning liquidity.

## Safety notes
- This skill CAN write to chain when executing rebalance (withdraw + re-deposit).
- Funds are moved: liquidity is withdrawn from old bins and re-deposited into new bins.
- Mainnet only — uses live Bitflow HODLMM pools.
- Rebalance is a two-step irreversible action (withdraw then deposit). The skill requires explicit confirmation before execution.
- Maximum rebalance amount is capped at configurable limits (default: 500,000 sats sBTC, 100 STX).
- Minimum profit threshold: rebalance is blocked if estimated fee recovery does not exceed gas cost within the cooldown period.
- Cooldown: minimum 30 minutes between rebalance executions per pool.

## Commands

### doctor
Checks environment, wallet balances, Bitflow API reachability, and HODLMM pool availability. Safe to run anytime.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts doctor
```

### run --action=assess
Analyzes a position's bin drift relative to the active bin. Returns drift score, out-of-range percentage, and whether rebalancing is recommended.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=assess --pool-id=dlmm_3 --address=SP...
```

### run --action=plan
Computes the optimal rebalance: target bins, amounts per bin, estimated gas, and projected fee recovery. Does NOT execute — read-only planning step.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=plan --pool-id=dlmm_3 --address=SP... --bin-width=5
```

### run --action=execute
Executes the rebalance plan via MCP tools: withdraws from stale bins, re-deposits into optimal bins around the active price. Requires explicit confirmation.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=execute --pool-id=dlmm_3 --address=SP... --bin-width=5 --confirm
```

### install-packs
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts install-packs --pack all
```

## Output contract
All outputs are JSON to stdout.
```json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {},
  "error": null
}
```

## Known constraints
- Requires Stacks mainnet wallet with STX for gas fees.
- Bitflow API must be reachable (api.bitflow.finance).
- Position must exist in the specified pool.
- Rebalance blocked during crisis regime (volatility score > 60) unless --force flag is used.
- Minimum position value of 10,000 sats to justify gas costs.
