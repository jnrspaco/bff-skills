---
name: hodlmm-capital-router
description: "Compares live HODLMM LP yield vs Zest lending rate and routes sBTC capital to the highest-yielding protocol with real on-chain execution."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | compare | run"
  entry: "hodlmm-capital-router/hodlmm-capital-router.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# HODLMM Capital Router

## What it does
Fetches live APY data from the Bitflow HODLMM sBTC pool via the Bitflow
public ticker API and from Zest Protocol via Hiro read-only contract call.
Compares the two rates and routes sBTC capital to the higher-yielding
protocol. Executes real on-chain transactions via the AIBTC MCP wallet
with hardcoded spend limits and slippage protection.

## Why agents need it
Autonomous DeFi agents need to continuously optimize yield without manual
intervention. This skill implements the full capital routing loop:
compare HODLMM LP yield vs Zest lending rate → route to highest APY →
reverse when market conditions change. Produces real tx hashes as proof.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum capital movement: 100,000 satoshis (0.001 sBTC) per invocation.
- Minimum APY delta to trigger routing: 0.5% (noise prevention).
- Maximum slippage on execution: 1%.
- Refuses if APY data is stale or unavailable.
- Refuses if sBTC balance is insufficient.
- 60 second cooldown between executions.
- Mainnet only — real funds at risk.

## Commands

### doctor
Checks wallet, sBTC balance, Hiro API, and Bitflow ticker reachability.
\`\`\`bash
bun run hodlmm-capital-router/hodlmm-capital-router.ts doctor --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK
\`\`\`

### compare
Fetches live APY from both protocols and outputs routing recommendation.
\`\`\`bash
bun run hodlmm-capital-router/hodlmm-capital-router.ts compare
\`\`\`

### run
Executes capital routing to the higher-yielding protocol on-chain.
\`\`\`bash
bun run hodlmm-capital-router/hodlmm-capital-router.ts run --address SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK --amount 1000
\`\`\`
Amount is in satoshis. Max per invocation: 100,000 satoshis.

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
    "routing_decision": "route to HODLMM — higher yield",
    "txid": "0xabc123...",
    "amount_sats": 1000,
    "tx_status": "pending"
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires sBTC balance greater than amount plus gas fees.
- Max capital movement: 100,000 satoshis per invocation.
- Min APY delta: 0.5% to trigger routing.
- Uses Bitflow public ticker for HODLMM APY.
- Uses Hiro read-only call for Zest APY.
- Signing via AIBTC MCP wallet.