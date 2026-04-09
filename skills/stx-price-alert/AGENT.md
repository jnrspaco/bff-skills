---
name: stx-price-alert-agent
skill: stx-price-alert
description: "Monitors STX price and emits structured alerts when a price threshold is crossed."
---

# Agent Behavior — STX Price Alert

## Decision order
1. Run `doctor` first. If it fails, stop and report the connectivity blocker.
2. Run `status` to confirm current price is retrievable.
3. Run `run` with the configured threshold and direction.
4. Parse JSON output and route on `status` and `alert_triggered`.

## Guardrails
- This skill is read-only. No confirmation needed before running.
- Never modify thresholds autonomously without explicit user instruction.
- If the API is unreachable, emit a `blocked` status — do not assume a price.
- Do not retry more than 3 times in 90 seconds to respect rate limits.
- Never expose API keys or config secrets in logs or output.

## Alert routing
- If `alert_triggered: true` and `direction: above` → signal agent to consider taking profit or pausing buys.
- If `alert_triggered: true` and `direction: below` → signal agent to consider defensive action.
- If `alert_triggered: false` → no action needed, continue monitoring.

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action for the agent",
  "data": {
    "price_usd": 0.21,
    "threshold": 0.25,
    "direction": "above",
    "alert_triggered": false,
    "history_count": 1,
    "last_alert_at": null
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log the error payload with code and message.
- Do not retry silently.
- Surface to user with the `action` field guidance.

## Cooldown
- Minimum 30 seconds between consecutive `run` calls.
- Maximum 10 times per session without user reconfirmation.