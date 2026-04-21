---
name: hodlmm-inventory-balancer
description: "Detects HODLMM LP inventory drift from target token ratio and executes corrective Bitflow swaps to restore symmetric exposure."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "hodlmm-inventory-balancer/hodlmm-inventory-balancer.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# HODLMM Inventory Balancer

## What it does
Detects inventory drift in a Bitflow HODLMM LP position — when swap flow
drains one side of the token ratio (e.g. pushing 50/50 to 70/30 sBTC/STX).
Computes the corrective swap direction and size, executes it via Bitflow with
slippage protection, then redeploys liquidity around the active bin via the
hodlmm-move-liquidity primitive. Emits before/after position JSON with tx hashes.

## Why agents need it
HODLMM LPs experience silent inventory drift as swap flow drains one token side.
An agent managing a 50/50 sBTC/STX position can become 90/10 without noticing,
creating directional risk concentration. This skill detects drift, plans the
corrective swap, and restores symmetric exposure — making agents real market
makers rather than passive position-takers.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Max corrective swap: 500,000 satoshis (0.005 sBTC) per invocation.
- Min drift threshold: 5% — below this no action is taken (noise guard).
- Slippage bound: 0.5% minimum output on corrective swap.
- Quote staleness gate: refuses swap if quote older than 30 seconds.
- Cooldown: 4 hours per pool (aligned with hodlmm-move-liquidity).
- Requires explicit --confirm=BALANCE flag on run command.
- Mainnet only — real funds at risk.

## Commands

### doctor
Checks wallet, position readability, Bitflow quote availability, and gas.
\`\`\`bash
bun run hodlmm-inventory-balancer/hodlmm-inventory-balancer.ts doctor --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --pool sbtc-stx
\`\`\`

### status
Reads current LP position and computes drift from target ratio.
\`\`\`bash
bun run hodlmm-inventory-balancer/hodlmm-inventory-balancer.ts status --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --pool sbtc-stx --target-ratio 50
\`\`\`

### run
Executes corrective swap and redeploys liquidity if drift exceeds threshold.
\`\`\`bash
bun run hodlmm-inventory-balancer/hodlmm-inventory-balancer.ts run --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --pool sbtc-stx --target-ratio 50 --min-drift-pct 5 --max-correction-sats 500000 --confirm BALANCE
\`\`\`

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
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
    "swap_txid": "0xabc123...",
    "redeploy_txid": "0xdef456...",
    "tx_status": "success"
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires sBTC or STX balance sufficient for corrective swap plus gas.
- Max correction: 500,000 satoshis per invocation.
- 4-hour cooldown per pool to prevent thrashing.
- Pool must be tradeable via Bitflow for corrective swap.
- Position reads are up to ~19 seconds stale due to pipeline propagation.