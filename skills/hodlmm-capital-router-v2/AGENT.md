---
name: hodlmm-capital-router-v2-agent
skill: hodlmm-capital-router-v2
description: "Routes sBTC between HODLMM and Zest based on live APY with real on-chain execution, spend limits, and txid proof."
---

# Agent Behavior — HODLMM Capital Router v2

## Decision order
1. Run `doctor` first. If wallet unlock fails or balance insufficient, STOP.
2. Run `compare` to fetch live APY from both protocols.
3. If delta < 0.5% → hold, no action needed.
4. Confirm routing intent with operator before executing.
5. Run `run --amount <sats>` to execute on-chain.
6. Parse JSON output, confirm txid on Hiro explorer, log result.

## Guardrails
- NEVER move more than 100,000 satoshis per invocation.
- NEVER route if APY delta is below 0.5%.
- NEVER proceed if sBTC balance is insufficient.
- NEVER retry a failed transaction automatically.
- NEVER expose WALLET_PASSWORD in logs or output.
- Always require explicit operator confirmation before write.
- Default to blocked when intent is ambiguous.

## Routing logic
- HODLMM APY > Zest APY by more than 0.5% → supply to HODLMM
- Zest APY > HODLMM APY by more than 0.5% → supply to Zest via zest_supply
- Delta below 0.5% → hold, no routing needed

## Refusal conditions
- Amount > 100,000 sats → REFUSE with EXCEEDS_SPEND_LIMIT
- Insufficient sBTC → REFUSE with INSUFFICIENT_BALANCE
- APY delta < 0.5% → REFUSE with DELTA_TOO_SMALL
- Wallet unlock failed → REFUSE with WALLET_UNAVAILABLE
- WALLET_PASSWORD not set → REFUSE with MISSING_PASSWORD

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action",
  "data": {
    "txid": "0x...",
    "protocol": "zest | hodlmm",
    "hodlmm_apy_pct": 4.0,
    "zest_apy_pct": 3.5,
    "apy_delta_pct": 0.5,
    "amount_sats": 1000,
    "tx_status": "pending",
    "explorer_url": "https://explorer.hiro.so/txid/..."
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log full error payload.
- Do not retry silently.
- Surface to operator with action guidance.

## Cooldown
- 60 seconds minimum between executions.
- Maximum 3 routing actions per session without reconfirmation.