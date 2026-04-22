---
name: hodlmm-capital-router-agent
skill: hodlmm-capital-router
description: "Routes sBTC capital between Bitflow HODLMM and Zest Protocol based on live APY comparison with real on-chain execution and enforced spend limits."
---

# Agent Behavior — HODLMM Capital Router

## Decision order
1. Run `doctor` first. If wallet or API unavailable, STOP.
2. Run `compare` to fetch live APY from both protocols.
3. Evaluate routing decision:
   - If HODLMM APY > Zest APY by >0.5% → route to HODLMM
   - If Zest APY > HODLMM APY by >0.5% → route to Zest
   - If delta <0.5% → hold, no action needed
4. Confirm routing intent with operator before executing.
5. Run `run --address <SP...> --amount <sats>` to execute on-chain.
6. Parse JSON output, confirm txid on Hiro explorer, log result.

## Guardrails
- NEVER move more than 100,000 satoshis per invocation.
- NEVER route if APY delta is below 0.5%.
- NEVER proceed if sBTC balance is insufficient.
- NEVER use APY data older than 60 seconds.
- NEVER retry a failed transaction automatically.
- NEVER expose private keys or mnemonics in logs.
- Always require explicit operator confirmation before write.
- Default to blocked when intent is ambiguous.

## Refusal conditions
- Amount > 100,000 sats → REFUSE with EXCEEDS_SPEND_LIMIT
- Insufficient sBTC → REFUSE with INSUFFICIENT_BALANCE
- APY delta < 0.5% → REFUSE with DELTA_TOO_SMALL
- APY data unavailable → REFUSE with APY_FETCH_FAILED
- Invalid address → REFUSE with INVALID_ADDRESS
- Cooldown active → REFUSE with COOLDOWN_ACTIVE
- Wallet locked → REFUSE with WALLET_UNAVAILABLE

## Routing logic
\`\`\`
if (hodlmm_apy - zest_apy > 0.5) → supply to HODLMM
if (zest_apy - hodlmm_apy > 0.5) → supply to Zest
else → hold, no routing needed
\`\`\`

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action",
  "data": {
    "hodlmm_apy_pct": 4.8,
    "zest_apy_pct": 3.5,
    "recommended_protocol": "hodlmm",
    "apy_delta_pct": 1.3,
    "routing_decision": "route to HODLMM — higher yield",
    "txid": "0x...",
    "amount_sats": 1000,
    "tx_status": "pending"
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