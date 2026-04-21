---
name: hodlmm-inventory-balancer-agent
skill: hodlmm-inventory-balancer
description: "Detects and corrects HODLMM LP inventory drift by executing Bitflow swaps to restore target token ratio with enforced safety gates."
---

# Agent Behavior — HODLMM Inventory Balancer

## Decision order
1. Run `doctor` first. If wallet, position, or Bitflow quote unavailable, STOP.
2. Run `status` to compute current drift from target ratio.
3. If drift < `--min-drift-pct` (default 5%) → emit blocked, no action.
4. If drift >= threshold → compute corrective swap direction and size.
5. Confirm intent explicitly with operator before executing.
6. Run `run --confirm BALANCE` to execute swap and redeploy.
7. Parse JSON output, verify both tx hashes on Hiro explorer, log result.

## Guardrails
- NEVER execute corrective swap without `--confirm=BALANCE` flag.
- NEVER swap more than 500,000 satoshis per invocation.
- NEVER act on drift below 5% — noise threshold prevents over-correction.
- NEVER use a Bitflow quote older than 30 seconds.
- NEVER fire more often than every 4 hours per pool (thrash prevention).
- NEVER proceed if wallet gas reserve is insufficient.
- NEVER expose private keys or mnemonics in logs or output.
- Always require explicit operator confirmation before any write action.

## Refusal conditions
- Drift < 5% → REFUSE with DRIFT_BELOW_THRESHOLD
- Corrective amount > 500,000 sats → REFUSE with EXCEEDS_MAX_CORRECTION
- Bitflow quote older than 30s → REFUSE with QUOTE_STALE
- Pool volume too thin for swap → REFUSE with INSUFFICIENT_POOL_LIQUIDITY
- Previous cycle state unresolved → REFUSE with PREVIOUS_CYCLE_UNRESOLVED
- Wallet gas reserve insufficient → REFUSE with INSUFFICIENT_GAS
- --confirm flag missing or wrong → REFUSE with CONFIRMATION_REQUIRED
- Wallet locked → REFUSE with WALLET_UNAVAILABLE

## Ratio computation
Per-bin token amounts are price-weighted, not raw sums.
Each bin's contribution = bin_token_amount × bin_price / total_position_value.
Naive raw token sum misrepresents real exposure — this skill uses price-weighted ratios.

## Corrective swap sizing
- Compute: excess_token = over_weight_side - target_weight
- Swap size = min(excess_token_value, max_correction_sats)
- Apply 0.5% slippage buffer: minimum_out = expected_out × 0.995
- Direction: sell over-weight token, buy under-weight token

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action for the agent",
  "data": {
    "pool": "sbtc-stx",
    "before_ratio_pct": { "sbtc": 68, "stx": 32 },
    "after_ratio_pct": { "sbtc": 51, "stx": 49 },
    "drift_pct": 18,
    "corrective_swap": {
      "direction": "sbtc_to_stx",
      "amount_sats": 180000,
      "minimum_out_micro_stx": 850000
    },
    "swap_txid": "0x...",
    "redeploy_txid": "0x...",
    "tx_status": "success"
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log full error payload with code and message.
- Do not retry silently.
- Surface to operator with action field guidance.

## Cooldown
- 4 hours minimum between corrections per pool.
- 60 seconds minimum between consecutive run calls.
- Maximum 2 corrections per session without operator reconfirmation.