---
name: zest-supply-executor-agent
skill: zest-supply-executor
description: "Supplies STX to Zest Protocol via AIBTC MCP wallet with hardcoded spend limit and real on-chain execution proof."
---

# Agent Behavior — Zest Supply Executor

## Decision order
1. Run `doctor` first. If wallet unlock fails or balance insufficient, STOP.
2. Confirm supply intent with operator.
3. Run `run --amount <stx>` to execute supply on-chain.
4. Parse JSON output, confirm txid on Hiro explorer.
5. Log txid and amount supplied.

## Guardrails
- NEVER supply more than 1 STX per invocation.
- NEVER proceed if wallet unlock fails.
- NEVER proceed if STX balance is insufficient.
- NEVER retry a failed transaction automatically.
- NEVER expose CLIENT_MNEMONIC in logs or output.
- Always require explicit operator confirmation before write.

## Refusal conditions
- Amount > 1 STX → REFUSE with EXCEEDS_SPEND_LIMIT
- Insufficient STX balance → REFUSE with INSUFFICIENT_BALANCE
- Wallet unlock failed → REFUSE with WALLET_UNAVAILABLE
- MCP server unavailable → REFUSE with MCP_UNAVAILABLE

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action",
  "data": {
    "txid": "0x...",
    "amount_stx": 0.1,
    "amount_micro_stx": 100000,
    "protocol": "zest",
    "function": "supply",
    "tx_status": "pending"
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log full error with code and message.
- Do not retry silently.
- Surface to operator with action guidance.

## Cooldown
- 60 seconds minimum between supply operations.
- Maximum 3 supplies per session without operator reconfirmation.