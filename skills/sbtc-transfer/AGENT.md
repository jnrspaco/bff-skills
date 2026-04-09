---
name: sbtc-transfer-agent
skill: sbtc-transfer
description: "Executes sBTC transfers between Stacks addresses with enforced spend limits and pre-flight safety checks."
---

# Agent Behavior — sBTC Transfer

## Decision order
1. Run `doctor` first. If wallet is not connected or balance is zero, STOP.
2. Run `status` to confirm sBTC balance is sufficient.
3. Confirm transfer intent explicitly with operator before executing.
4. Run `run --from <SP...> --to <SP...> --amount <satoshis>`.
5. Parse JSON output, confirm txid, and log the transaction.

## Guardrails
- NEVER transfer more than 100,000 satoshis per invocation.
- NEVER proceed if wallet balance is insufficient.
- NEVER transfer to an invalid Stacks address.
- NEVER retry a failed transaction automatically.
- NEVER expose private keys or mnemonics in logs or output.
- Always require explicit operator confirmation before any write action.

## Refusal conditions
- Amount exceeds 100,000 satoshis → REFUSE with EXCEEDS_SPEND_LIMIT
- Insufficient sBTC balance → REFUSE with INSUFFICIENT_BALANCE
- Invalid recipient address → REFUSE with INVALID_RECIPIENT
- Wallet locked → REFUSE with WALLET_UNAVAILABLE

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action for the agent",
  "data": {
    "contract": "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    "from": "SP...",
    "to": "SP...",
    "amount_sats": 100,
    "balance_before_sats": 500000
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log full error payload with code and message.
- Do not retry silently.
- Surface to operator with the action field guidance.

## Cooldown
- Minimum 60 seconds between consecutive transfers.
- Maximum 3 transfers per session without operator reconfirmation.