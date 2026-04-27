---
name: zest-supply-executor
description: "Supplies STX to Zest Protocol lending pool via AIBTC MCP wallet and returns a real on-chain transaction ID as proof."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | run"
  entry: "zest-supply-executor/zest-supply-executor.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# Zest Supply Executor

## What it does
Supplies STX to the Zest Protocol lending pool on Stacks mainnet by calling
the AIBTC MCP wallet's zest_supply tool directly. Spawns the MCP server,
unlocks the wallet, executes the supply transaction, and returns the real
on-chain transaction ID as proof. Enforces a hardcoded 1 STX spend limit
per invocation with pre-flight balance checks.

## Why agents need it
Agents need a simple, provable primitive to supply STX to Zest and start
earning yield. This skill closes the loop between intent and execution —
it does not just output parameters, it actually signs and broadcasts the
transaction and returns the txid.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum supply per invocation: 1 STX — hardcoded spend limit.
- Agent will REFUSE if STX balance is insufficient.
- Agent will REFUSE if wallet unlock fails.
- Agent will REFUSE if amount exceeds spend limit.
- Mainnet only — real funds at risk.
- Requires CLIENT_MNEMONIC environment variable.

## Commands

### doctor
Checks MCP server, wallet unlock, and STX balance.
\`\`\`bash
bun run zest-supply-executor/zest-supply-executor.ts doctor
\`\`\`

### run
Supplies STX to Zest lending pool and returns real txid.
\`\`\`bash
bun run zest-supply-executor/zest-supply-executor.ts run --amount 0.1
\`\`\`
Amount in STX. Max per invocation: 1 STX.

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "txid": "0xabc123...",
    "amount_stx": 0.1,
    "amount_micro_stx": 100000,
    "protocol": "zest",
    "function": "supply",
    "tx_status": "pending"
  },
  "error": null
}
\`\`\`

## Known constraints
- Max supply: 1 STX per invocation.
- Requires CLIENT_MNEMONIC environment variable set.
- Requires STX balance greater than amount plus gas (~0.01 STX).
- MCP server spawned locally via npx @aibtc/mcp-server.