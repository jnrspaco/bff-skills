---
name: zest-position-manager
description: "Manages a full Zest Protocol lending position — supply, borrow, and repay — with health factor guardrails and hardcoded spend limits."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | status | supply | borrow | repay"
  entry: "zest-position-manager/zest-position-manager.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# Zest Position Manager

## What it does
Manages a complete Zest Protocol lending position on Stacks mainnet.
Handles three operations in one coherent skill: supply STX to earn yield,
borrow against collateral, and repay outstanding debt. Enforces a health
factor guardrail — refuses all operations if health factor drops below
a safe threshold. Produces on-chain tx hashes as proof for every write.

## Why agents need it
The existing zest-auto-repay skill only handles one leg of a position.
Agents managing lending portfolios need a full position manager that
can supply, borrow, and repay in sequence with safety guardrails. This
skill provides that complete loop with a health factor hard stop that
prevents liquidation risk.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Max supply per invocation: 10 STX — hardcoded.
- Max borrow per invocation: 5 STX — hardcoded.
- Max repay per invocation: 10 STX — hardcoded.
- Health factor hard stop: refuses borrow if health factor < 1.5.
- Agent will REFUSE all operations if health factor < 1.2 (danger zone).
- Agent will REFUSE borrow if it would push health factor below 1.5.
- Mainnet only — real funds at risk.

## Commands

### doctor
Checks wallet, STX balance, Hiro API, and Zest contract reachability.
\`\`\`bash
bun run zest-position-manager/zest-position-manager.ts doctor --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### status
Returns current position: supplied, borrowed, health factor, and available actions.
\`\`\`bash
bun run zest-position-manager/zest-position-manager.ts status --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### supply
Supplies STX to Zest lending pool to earn yield.
\`\`\`bash
bun run zest-position-manager/zest-position-manager.ts supply --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --amount 1
\`\`\`
Amount in STX. Max: 10 STX.

### borrow
Borrows STX against supplied collateral. Refuses if health factor would drop below 1.5.
\`\`\`bash
bun run zest-position-manager/zest-position-manager.ts borrow --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --amount 1
\`\`\`
Amount in STX. Max: 5 STX.

### repay
Repays outstanding Zest debt to improve health factor.
\`\`\`bash
bun run zest-position-manager/zest-position-manager.ts repay --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --amount 1
\`\`\`
Amount in STX. Max: 10 STX.

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "operation": "supply | borrow | repay",
    "address": "SP...",
    "amount_micro_stx": 1000000,
    "amount_stx": 1,
    "health_factor": 2.1,
    "supplied_micro_stx": 5000000,
    "borrowed_micro_stx": 1000000,
    "contract": "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0",
    "function": "supply"
  },
  "error": null
}
\`\`\`

## Known constraints
- Max supply: 10 STX per invocation.
- Max borrow: 5 STX per invocation.
- Max repay: 10 STX per invocation.
- Health factor hard stop: 1.5 for borrow, 1.2 for all operations.
- Requires STX balance for gas (~0.01 STX per operation).
- Uses Hiro API for balance and position reads.