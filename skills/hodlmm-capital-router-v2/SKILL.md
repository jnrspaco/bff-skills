---
name: hodlmm-capital-router-v2
description: "Compares live HODLMM LP yield vs Zest lending rate and routes sBTC capital to the highest-yielding protocol with real on-chain execution and txid proof."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | compare | run"
  entry: "hodlmm-capital-router-v2/hodlmm-capital-router-v2.ts"
  requires: "wallet, signing, settings, AIBTC_WALLET_ID, WALLET_PASSWORD"
  tags: "defi, write, mainnet-only, requires-funds, l2"
---

# HODLMM Capital Router v2

## What it does
Fetches live APY from Bitflow HODLMM sBTC pool and Zest Protocol lending
market. Compares rates and routes sBTC capital to the higher-yielding
protocol. Executes real on-chain transactions via AIBTC MCP wallet and
returns verified txids as proof. v2 adds real execution — not just params.

## Why agents need it
Agents managing sBTC need to continuously optimize yield. This skill
implements the full capital routing loop with real on-chain execution:
compare HODLMM vs Zest APY → route to highest yield → return txid proof.

## Safety notes
- This skill WRITES to chain and moves real funds.
- Maximum capital movement: 100,000 satoshis per invocation.
- Minimum APY delta to trigger routing: 0.5%.
- Maximum slippage: 1%.
- Requires WALLET_PASSWORD environment variable.
- Mainnet only — real funds at risk.

## Commands

### doctor
Unlocks wallet, checks sBTC balance, fetches live APY from both protocols.
\`\`\`bash
bun run hodlmm-capital-router-v2/hodlmm-capital-router-v2.ts doctor
\`\`\`

### compare
Fetches live APY from both protocols without executing.
\`\`\`bash
bun run hodlmm-capital-router-v2/hodlmm-capital-router-v2.ts compare
\`\`\`

### run
Routes capital to highest-yielding protocol and returns real txid.
\`\`\`bash
bun run hodlmm-capital-router-v2/hodlmm-capital-router-v2.ts run --amount 1000
\`\`\`
Amount in satoshis. Max: 100,000 satoshis (0.001 sBTC).

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "txid": "0xabc123...",
    "protocol": "zest | hodlmm",
    "hodlmm_apy_pct": 4.0,
    "zest_apy_pct": 3.5,
    "apy_delta_pct": 0.5,
    "amount_sats": 1000,
    "tx_status": "pending",
    "explorer_url": "https://explorer.hiro.so/txid/..."
  },
  "error": null
}
\`\`\`

## Known constraints
- Max movement: 100,000 satoshis per invocation.
- Min APY delta: 0.5% to trigger routing.
- Requires WALLET_PASSWORD env var.
- Uses Bitflow ticker for HODLMM APY.
- Uses Hiro read-only call for Zest APY.