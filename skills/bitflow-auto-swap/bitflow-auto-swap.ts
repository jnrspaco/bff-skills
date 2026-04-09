import { Command } from "commander";
import * as https from "https";

const program = new Command();
const HIRO_API = "https://api.hiro.so";
const MAX_STX_AMOUNT = 1_000_000;
const MAX_SLIPPAGE = 0.01;
const STX_TOKEN = "token-stx";
const SBTC_TOKEN = "token-sbtc";

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON response")); }
      });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
  });
}

async function getSTXBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  return parseInt(json?.stx?.balance ?? "0");
}

async function getSTXPrice(): Promise<number> {
  const json = await httpGet("https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd");
  return json?.blockstack?.usd ?? 0;
}

function isValidStacksAddress(address: string): boolean {
  return /^SP[A-Z0-9]{30,40}$/.test(address) || /^SM[A-Z0-9]{30,40}$/.test(address);
}

program.name("bitflow-auto-swap").description("Execute STX→sBTC swaps on Bitflow DEX with safety checks");

program.command("doctor").description("Check wallet and API readiness")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) throw new Error("Invalid Stacks address");
      const [balance, price] = await Promise.all([getSTXBalance(opts.address), getSTXPrice()]);
      console.log(JSON.stringify({
        status: "success",
        action: balance >= MAX_STX_AMOUNT ? "environment ready — run quote to preview swap" : "low STX balance — fund wallet before swapping",
        data: { address: opts.address, stx_balance_micro: balance, stx_balance_stx: balance / 1_000_000, stx_price_usd: price, max_swap_stx: 1, max_slippage_pct: 1, hiro_api_reachable: true },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check internet connection or API status", data: {}, error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("quote").description("Get estimated swap output for STX→sBTC")
  .requiredOption("--amount <number>", "Amount in STX (max 1)")
  .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);
    if (isNaN(amountSTX) || amountSTX <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide a valid positive STX amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive", next: "retry with --amount 1" } }));
      return;
    }
    const amountMicro = Math.floor(amountSTX * 1_000_000);
    if (amountMicro > MAX_STX_AMOUNT) {
      console.log(JSON.stringify({ status: "blocked", action: "reduce amount to 1 STX or less", data: { requested_stx: amountSTX, max_stx: 1 }, error: { code: "EXCEEDS_SPEND_LIMIT", message: `${amountSTX} STX exceeds max of 1 STX`, next: "retry with --amount 1" } }));
      return;
    }
    try {
      const price = await getSTXPrice();
      const estimatedSats = Math.floor(amountSTX * price * 100_000_000 * 0.000001);
      console.log(JSON.stringify({
        status: "success",
        action: "quote estimated — run with same amount to execute swap",
        data: { tokenIn: STX_TOKEN, tokenOut: SBTC_TOKEN, amountIn_micro: amountMicro, amountIn_stx: amountSTX, stx_price_usd: price, estimated_sats: estimatedSats, slippage_max: MAX_SLIPPAGE, route: "STX → sBTC via Bitflow DEX" },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check API connectivity", data: {}, error: { code: "QUOTE_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("run").description("Execute STX→sBTC swap on Bitflow")
  .requiredOption("--amount <number>", "Amount in STX (max 1)")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);
    if (isNaN(amountSTX) || amountSTX <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide a valid positive STX amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive", next: "retry with --amount 1" } }));
      return;
    }
    const amountMicro = Math.floor(amountSTX * 1_000_000);
    if (amountMicro > MAX_STX_AMOUNT) {
      console.log(JSON.stringify({ status: "blocked", action: "reduce amount to 1 STX or less", data: { requested_stx: amountSTX, max_stx: 1 }, error: { code: "EXCEEDS_SPEND_LIMIT", message: `${amountSTX} STX exceeds max of 1 STX`, next: "reduce and retry" } }));
      return;
    }
    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide a valid SP or SM Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "address must start with SP or SM", next: "check address and retry" } }));
      return;
    }
    try {
      const [balance, price] = await Promise.all([getSTXBalance(opts.address), getSTXPrice()]);
      if (balance < amountMicro + 10_000) {
        console.log(JSON.stringify({ status: "blocked", action: "fund wallet with more STX before swapping", data: { balance_micro: balance, required_micro: amountMicro + 10_000 }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance} microSTX insufficient`, next: "add STX and retry" } }));
        return;
      }
      const estimatedSats = Math.floor(amountSTX * price * 100_000_000 * 0.000001);
      const minAmountOut = Math.floor(estimatedSats * (1 - MAX_SLIPPAGE));
      console.log(JSON.stringify({
        status: "success",
        action: `swap ready — sign and broadcast via MCP wallet: call Bitflow univ2-router swap-exact-tokens-for-tokens with ${amountSTX} STX → sBTC min output ${minAmountOut} sats`,
        data: { tokenIn: STX_TOKEN, tokenOut: SBTC_TOKEN, amountIn_micro: amountMicro, amountIn_stx: amountSTX, stx_price_usd: price, estimated_sats: estimatedSats, minAmountOut_sats: minAmountOut, slippage_max: MAX_SLIPPAGE, route: "STX → sBTC via Bitflow DEX", address: opts.address, contract: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router", function: "swap-exact-tokens-for-tokens" },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "SWAP_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();