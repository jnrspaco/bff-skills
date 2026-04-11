---
name: zest-yield-deposit-agent
skill: zest-yield-deposit
description: "Supplies STX to Zest Protocol to earn lending yield with enforced spend limits and pre-flight safety checks."
---

# Agent Behavior — Zest Yield Deposit

## Decision order
1. Run `doctor` first. If wallet not connected or STX balance insufficient, STOP.
2. Run `status` to confirm current balance and yield rate.
3. Confirm deposit intent explicitly with operator before executing.
4. Run `run --address <SP...> --amount <stx>` to execute deposit.
5. Parse JSON output, confirm txid on Hiro explorer, log the transaction.

## Guardrails
- NEVER deposit more than 10 STX per invocation.
- NEVER proceed if STX balance is insufficient for deposit plus gas.
- NEVER retry a failed transaction automatically.
- NEVER expose private keys, mnemonics, or passwords in logs or output.
- Always require explicit operator confirmation before any write action.
- Default to blocked status when intent is ambiguous.

## Refusal conditions
- Amount exceeds 10 STX → REFUSE with EXCEEDS_SPEND_LIMIT
- Insufficient STX balance → REFUSE with INSUFFICIENT_BALANCE
- Invalid Stacks address → REFUSE with INVALID_ADDRESS
- Wallet locked → REFUSE with WALLET_UNAVAILABLE
- Zest API unreachable → REFUSE with API_UNREACHABLE

## Output contract
\`\`\`json
{
  "status": "success | error | blocked",
  "action": "next recommended action for the agent",
  "data": {
    "contract": "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0",
    "function": "supply",
    "address": "SP...",
    "amount_micro_stx": 1000000,
    "amount_stx": 1,
    "stx_balance_before": 5000000,
    "estimated_apy_pct": 3.5
  },
  "error": { "code": "", "message": "", "next": "" }
}
\`\`\`

## On error
- Log full error payload with code and message.
- Do not retry silently.
- Surface to operator with the action field guidance.

## On success
- Log txid and confirm on Hiro explorer at explorer.hiro.so.
- Report amount deposited and estimated annual yield.
- Do not initiate follow-up deposits without explicit instruction.

## Cooldown
- Minimum 60 seconds between consecutive deposits.
- Maximum 3 deposits per session without operator reconfirmation.