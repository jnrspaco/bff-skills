import { Command } from "commander";

const program = new Command();
const HIRO_API = "https://api.hiro.so";
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const MAX_SPEND_SATS = 100_000;

async function getSBTCBalance(address: string): Promise<number> {
  const res = await fetch(`${HIRO_API}/extended/v1/address/${address}/balances`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Hiro API error: ${res.status}`);
  const json: any = await res.json();
  const fungible = json?.fungible_tokens ?? {};
  const key = Object.keys(fungible).find((k) => k.includes("sbtc-token"));
  return key ? parseInt(fungible[key].balance ?? "0") : 0;
}

function isValidStacksAddress(address: string): boolean {
  return /^SP[A-Z0-9]{30,40}$/.test(address) || /^SM[A-Z0-9]{30,40}$/.test(address);
}

program.name("sbtc-transfer").description("Transfer sBTC between Stacks addresses with safety checks");

program.command("doctor").description("Check API readiness").action(async () => {
  try {
    const res = await fetch(`${HIRO_API}/v2/info`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`API unreachable: ${res.status}`);
    console.log(JSON.stringify({ status: "success", action: "environment ready — run status to check sBTC balance", data: { api_reachable: true, contract: SBTC_CONTRACT, max_spend_sats: MAX_SPEND_SATS }, error: null }));
  } catch (err: any) {
    console.log(JSON.stringify({ status: "error", action: "check internet connection or Hiro API status", data: {}, error: { code: "API_UNREACHABLE", message: err.message, next: "retry after 30s" } }));
  }
});

program.command("status").description("Check sBTC balance")
  .requiredOption("--address <address>", "Stacks wallet address to check")
  .action(async (opts) => {
    try {
      const balance = await getSBTCBalance(opts.address);
      console.log(JSON.stringify({ status: "success", action: balance > 0 ? "sBTC balance available — ready to transfer" : "no sBTC balance — fund wallet before transferring", data: { address: opts.address, sbtc_balance_sats: balance, sbtc_balance_sbtc: balance / 1e8 }, error: null }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose connectivity", data: {}, error: { code: "BALANCE_FETCH_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("run").description("Execute sBTC transfer")
  .requiredOption("--from <address>", "Sender Stacks address")
  .requiredOption("--to <address>", "Recipient Stacks address")
  .requiredOption("--amount <number>", "Amount in satoshis (max 100000)")
  .action(async (opts) => {
    const amount = parseInt(opts.amount);
    if (isNaN(amount) || amount <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide a valid positive amount in satoshis", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be a positive integer", next: "retry with --amount 100" } }));
      return;
    }
    if (amount > MAX_SPEND_SATS) {
      console.log(JSON.stringify({ status: "blocked", action: "reduce amount to 100000 satoshis or less", data: { requested: amount, max_allowed: MAX_SPEND_SATS }, error: { code: "EXCEEDS_SPEND_LIMIT", message: `amount ${amount} exceeds max spend limit of ${MAX_SPEND_SATS} satoshis`, next: "reduce amount and retry" } }));
      return;
    }
    if (!isValidStacksAddress(opts.to)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide a valid Stacks SP or SM address", data: {}, error: { code: "INVALID_RECIPIENT", message: "recipient must be a valid Stacks address starting with SP or SM", next: "check recipient address and retry" } }));
      return;
    }
    if (!isValidStacksAddress(opts.from)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide a valid Stacks SP or SM address for sender", data: {}, error: { code: "INVALID_SENDER", message: "sender address must be a valid Stacks address", next: "check sender address and retry" } }));
      return;
    }
    try {
      const balanceBefore = await getSBTCBalance(opts.from);
      if (balanceBefore < amount) {
        console.log(JSON.stringify({ status: "blocked", action: "fund wallet with sBTC before transferring", data: { balance: balanceBefore, requested: amount }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balanceBefore} sats is less than requested ${amount} sats`, next: "deposit sBTC and retry" } }));
        return;
      }
      console.log(JSON.stringify({ status: "success", action: `transfer ready — sign and broadcast via MCP wallet: call ${SBTC_CONTRACT} transfer with amount=${amount} from=${opts.from} to=${opts.to}`, data: { contract: SBTC_CONTRACT, function: "transfer", from: opts.from, to: opts.to, amount_sats: amount, amount_sbtc: amount / 1e8, balance_before_sats: balanceBefore, memo: null }, error: null }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose connectivity", data: {}, error: { code: "TRANSFER_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();