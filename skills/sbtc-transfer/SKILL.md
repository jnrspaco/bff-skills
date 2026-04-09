---
name: sbtc-transfer
description: "Transfers sBTC between Stacks addresses using the SIP-010 token standard with safety checks and on-chain proof."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "sbtc-transfer/sbtc-transfer.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# sBTC Transfer

## What it does
Transfers sBTC tokens between Stacks addresses by calling the SIP-010 transfer function on the sBTC token contract (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). Includes pre-flight balance checks, spend limit enforcement, and full on-chain transaction proof via tx hash.

## Why agents need it
sBTC is programmable Bitcoin on Stacks. Agents that manage yield, execute DeFi strategies, or coordinate payments need a safe, auditable primitive to move sBTC between addresses with enforced spend limits and refusal conditions.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum transfer per invocation: 0.001 sBTC (100,000 satoshis) — hardcoded spend limit.
- Agent will REFUSE if wallet balance is insufficient.
- Agent will REFUSE if recipient address is invalid.
- Agent will REFUSE if amount exceeds spend limit.
- Mainnet only — real funds at risk.

## Commands

### doctor
\`\`\`bash
bun run sbtc-transfer/sbtc-transfer.ts doctor
\`\`\`

### status
\`\`\`bash
bun run sbtc-transfer/sbtc-transfer.ts status --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### run
\`\`\`bash
bun run sbtc-transfer/sbtc-transfer.ts run --from SP... --to SP... --amount 100
\`\`\`
Amount is in satoshis. Max per run: 100,000 satoshis (0.001 sBTC).

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "contract": "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    "from": "SP...",
    "to": "SP...",
    "amount_sats": 100,
    "balance_before_sats": 500000
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires STX in wallet for gas fees.
- Requires sBTC balance greater than transfer amount.
- Max spend limit: 100,000 satoshis per invocation.