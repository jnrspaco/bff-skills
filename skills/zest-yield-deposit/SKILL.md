---
name: zest-yield-deposit
description: "Supplies STX to the Zest Protocol lending pool on Stacks to earn yield, with pre-flight balance checks and hardcoded spend limits."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "zest-yield-deposit/zest-yield-deposit.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# Zest Yield Deposit

## What it does
Supplies STX to the Zest Protocol lending pool on Stacks mainnet by calling
the supply function on the Zest pool-borrow contract. Agents earn yield from
borrower interest automatically after depositing. Includes pre-flight balance
checks, hardcoded spend limits, and full on-chain transaction proof via tx hash.

## Why agents need it
Autonomous DeFi agents need to put idle STX to work earning yield. Zest Protocol
is the leading lending market on Stacks with over $100M in total deposits. This
skill gives agents a safe, auditable primitive to deposit STX into Zest and start
earning yield immediately with enforced spend limits and refusal conditions.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum deposit per invocation: 10 STX — hardcoded spend limit.
- Agent will REFUSE if wallet STX balance is insufficient.
- Agent will REFUSE if amount exceeds spend limit.
- Agent will REFUSE if Zest pool API is unreachable.
- Mainnet only — real funds at risk.
- Always confirm intent before executing run.

## Commands

### doctor
Checks wallet connectivity, STX balance, Hiro API, and Zest pool status.
\`\`\`bash
bun run zest-yield-deposit/zest-yield-deposit.ts doctor --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### status
Returns current STX balance and estimated Zest yield APY without depositing.
\`\`\`bash
bun run zest-yield-deposit/zest-yield-deposit.ts status --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### run
Supplies STX to Zest Protocol lending pool and returns tx hash as proof.
\`\`\`bash
bun run zest-yield-deposit/zest-yield-deposit.ts run --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --amount 1
\`\`\`
Amount is in STX. Max per invocation: 10 STX.

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "contract": "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0",
    "function": "supply",
    "address": "SP...",
    "amount_micro_stx": 1000000,
    "amount_stx": 1,
    "stx_balance_before": 5000000,
    "estimated_apy_pct": 3.5
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires STX balance greater than deposit amount plus gas fees (~0.01 STX).
- Max deposit: 10 STX (10,000,000 microSTX) per invocation.
- Uses Hiro API for balance checks.
- Signing and broadcast handled by AIBTC MCP wallet.