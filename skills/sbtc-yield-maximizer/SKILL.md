---
name: sbtc-yield-maximizer
description: "Compares HODLMM LP yield vs Zest lending rate and routes sBTC capital to the highest-yielding protocol autonomously."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | compare | run"
  entry: "sbtc-yield-maximizer/sbtc-yield-maximizer.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# sBTC Yield Maximizer

## What it does
Fetches live APY data from both the Bitflow HODLMM sBTC pool and the Zest
Protocol STX lending market. Compares the two rates and routes capital to
the higher-yielding protocol. If HODLMM bins are active and earning more,
capital stays or moves there. If Zest lending rate exceeds HODLMM yield,
the skill prepares a withdrawal from HODLMM and a deposit into Zest.
Reverses when HODLMM becomes more profitable again.

## Why agents need it
Autonomous DeFi agents need to continuously optimize yield without manual
intervention. This skill implements the capital routing decision loop:
compare HODLMM LP yield vs Zest lending rate → route to highest APY →
reverse when market conditions change. It is the clearest expression of
an agent acting as autonomous capital allocator on Bitcoin DeFi.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum capital movement per invocation: 0.001 sBTC (100,000 satoshis).
- Agent will REFUSE if APY data is unavailable or stale.
- Agent will REFUSE if the yield difference is below 0.5% (noise threshold).
- Agent will REFUSE if sBTC balance is insufficient.
- Mainnet only — real funds at risk.
- Always confirm intent before executing run.

## Commands

### doctor
Checks wallet, sBTC balance, Hiro API, and Bitflow ticker reachability.
\`\`\`bash
bun run sbtc-yield-maximizer/sbtc-yield-maximizer.ts doctor --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### compare
Fetches live APY from both protocols and outputs routing recommendation.
\`\`\`bash
bun run sbtc-yield-maximizer/sbtc-yield-maximizer.ts compare
\`\`\`

### run
Executes capital routing to the higher-yielding protocol.
\`\`\`bash
bun run sbtc-yield-maximizer/sbtc-yield-maximizer.ts run --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --amount 100
\`\`\`
Amount is in satoshis. Max per invocation: 100,000 satoshis (0.001 sBTC).

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "hodlmm_apy_pct": 4.8,
    "zest_apy_pct": 3.5,
    "recommended_protocol": "hodlmm",
    "apy_delta_pct": 1.3,
    "routing_decision": "stay in HODLMM — higher yield",
    "amount_sats": 100000
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires sBTC balance greater than transfer amount plus gas fees.
- Max capital movement: 100,000 satoshis per invocation.
- Minimum yield delta to trigger routing: 0.5%.
- Uses Bitflow public ticker API for HODLMM APY estimation.
- Zest APY sourced from Hiro read-only contract call.