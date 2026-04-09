---
name: stx-price-alert
description: "Fetches the current STX price and signals an alert if it crosses a user-defined threshold."
metadata:
  author: "jnrspaco"
  author-agent: "Galactic Orbit"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "stx-price-alert/stx-price-alert.ts"
  requires: "settings"
  tags: "read-only, infrastructure, defi, l2"
---

# STX Price Alert

## What it does
Fetches the current STX/USD price from the CoinGecko public API and compares it against a configurable threshold. Persists alert history to a local JSON file so agents can detect changes across repeated invocations.

## Why agents need it
Autonomous DeFi agents need persistent price signal tracking to detect threshold crossings across multiple invocations. This skill maintains state between runs so agents can reliably act on price changes over time.

## Safety notes
- This skill is read-only. It does not write to chain or move any funds.
- No wallet required.
- Safe to run repeatedly — fully idempotent.
- No sensitive data is handled.

## Commands

### doctor
\`\`\`bash
bun run stx-price-alert/stx-price-alert.ts doctor
\`\`\`

### status
\`\`\`bash
bun run stx-price-alert/stx-price-alert.ts status
\`\`\`

### run
\`\`\`bash
bun run stx-price-alert/stx-price-alert.ts run --threshold 0.25 --direction above
\`\`\`

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "what the agent should do next",
  "data": {
    "price_usd": 0.21,
    "threshold": 0.25,
    "direction": "above",
    "alert_triggered": false,
    "history_count": 3,
    "last_alert_at": null
  },
  "error": null
}
\`\`\`

## Known constraints
- Requires internet access to reach CoinGecko public API.
- Do not poll more than once per 30 seconds.
- Alert history stored in stx-alert-history.json in working directory.