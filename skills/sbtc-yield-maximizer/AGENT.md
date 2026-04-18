---
name: sbtc-yield-maximizer-agent
skill: sbtc-yield-maximizer
description: "Routes sBTC capital between Bitflow HODLMM and Zest Protocol based on live APY comparison with enforced spend limits."
---

# Agent Behavior — sBTC Yield Maximizer

## Decision order
1. Run `doctor` first. If wallet or API unavailable, STOP.
2. Run `compare` to fetch live APY from both protocols.
3. Evaluate routing decision:
   - If HODLMM APY > Zest APY by more than 0.5% → route to HODLMM
   - If Zest APY > HODLMM APY by more than 0.5% → route to Zest
   - If delta < 0.5% → hold current position, no action needed
4. Confirm routing intent with operator before executing.
5. Run `run --address <SP...> --amount <sats>` to execute.
6. Parse JSON output, confirm txid, log transaction and APY snapshot.

## Guardrails
- NEVER move more than 100,000 satoshis (0.001 sBTC) per invocation.
- NEVER route capital if APY delta is below 0.5% — noise threshold.
- NEVER proceed if sBTC balance is insufficient.
- NEVER use stale APY data older than 5 minutes.
- NEVER retry a failed transaction automatically.
- NEVER expose private keys or mnemonics in logs or output.
- Always require explicit operator confirmation before any write action.
- Default to blocked status when intent is ambiguous.

## Refusal conditions
- Amount exceeds 100,000 satoshis → REFUSE with EXCEEDS_SPEND_LIMIT
- Insufficient sBTC balance → REFUSE with INSUFFICIENT_BALANCE
- APY delta below 0.5% → REFUSE with DELTA_TOO_SMALL
- APY data unavailable → REFUSE with APY_FETCH_FAILED
- Wallet locked → REFUSE with WALLET_UNAVAILABLE

## Routing logic
\`\`\`
if (hodlmm_apy - zest_apy > 0.5) → deploy to HODLMM
if (zest_apy - hodlmm_apy > 0.5) → deploy to Zest
else → hold, no routing needed
\`\`\`

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action for the agent",
  "data": {
    "hodlmm_apy_pct": 4.8,
    "zest_apy_pct": 3.5,
    "recommended_protocol": "hodlmm",
    "apy_delta_pct": 1.3,
    "routing_decision": "stay in HODLMM — higher yield",
    "amount_sats": 100000
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log full error payload with code and message.
- Do not retry silently.
- Surface to operator with action field guidance.

## Cooldown
- Minimum 5 minutes between consecutive APY checks.
- Minimum 60 seconds between consecutive capital movements.
- Maximum 3 routing actions per session without operator reconfirmation.