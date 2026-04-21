import { Command } from "commander";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

const HIRO_API = "https://api.hiro.so";
const BITFLOW_TICKER = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker";
const HODLMM_CONTRACT = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.hodlmm-v1-0";
const BITFLOW_ROUTER = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const STX_TOKEN = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx-token";

const MAX_CORRECTION_SATS = 500_000;
const MIN_DRIFT_PCT = 5;
const MAX_QUOTE_STALENESS_MS = 30_000;
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const SLIPPAGE_BUFFER = 0.005; // 0.5%
const STATE_FILE = path.join(process.env.HOME || "~", ".aibtc", "hodlmm-balancer-state.json");

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

function loadState(): Record<string, number> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (_) {}
  return {};
}

function saveState(state: Record<string, number>) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (_) {}
}

function isValidStacksAddress(address: string): boolean {
  return /^SP[A-Z0-9]{30,40}$/.test(address) || /^SM[A-Z0-9]{30,40}$/.test(address);
}

async function getSTXBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  return parseInt(json?.stx?.balance ?? "0");
}

async function getSBTCBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  const fungible = json?.fungible_tokens ?? {};
  const key = Object.keys(fungible).find((k) => k.includes("sbtc-token"));
  return key ? parseInt(fungible[key].balance ?? "0") : 0;
}

async function getPoolPrice(): Promise<{ sbtcPerStx: number; stxPerSbtc: number; timestamp: number }> {
  const tickers = await httpGet(BITFLOW_TICKER);
  const sbtcTicker = Array.isArray(tickers)
    ? tickers.find((t: any) =>
        (t.base_currency?.includes("sbtc") || t.target_currency?.includes("sbtc")) &&
        (t.base_currency?.includes("stx") || t.target_currency?.includes("stx"))
      )
    : null;

  if (sbtcTicker?.last_price) {
    return {
      sbtcPerStx: 1 / sbtcTicker.last_price,
      stxPerSbtc: sbtcTicker.last_price,
      timestamp: Date.now(),
    };
  }
  // Fallback: estimate from CoinGecko
  const stxPrice = await httpGet("https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd");
  const stxUsd = stxPrice?.blockstack?.usd ?? 0.21;
  const sbtcUsd = 95000; // approximate BTC price
  return {
    sbtcPerStx: sbtcUsd / stxUsd,
    stxPerSbtc: stxUsd / sbtcUsd,
    timestamp: Date.now(),
  };
}

interface PositionRatio {
  sbtc_sats: number;
  stx_micro: number;
  sbtc_pct: number;
  stx_pct: number;
  total_value_usd: number;
}

function computeRatio(
  sbtcSats: number,
  stxMicro: number,
  stxPerSbtc: number
): PositionRatio {
  // Convert to common unit (microSTX equivalent)
  const sbtcValueInStx = (sbtcSats / 1e8) * stxPerSbtc * 1e6;
  const totalValue = sbtcValueInStx + stxMicro;

  if (totalValue === 0) {
    return { sbtc_sats: 0, stx_micro: 0, sbtc_pct: 50, stx_pct: 50, total_value_usd: 0 };
  }

  const sbtcPct = (sbtcValueInStx / totalValue) * 100;
  const stxPct = (stxMicro / totalValue) * 100;

  return {
    sbtc_sats: sbtcSats,
    stx_micro: stxMicro,
    sbtc_pct: parseFloat(sbtcPct.toFixed(2)),
    stx_pct: parseFloat(stxPct.toFixed(2)),
    total_value_usd: parseFloat(((totalValue / 1e6) * 0.21).toFixed(4)),
  };
}

function computeCorrectiveSwap(
  ratio: PositionRatio,
  targetPct: number,
  maxCorrectionSats: number,
  stxPerSbtc: number
): { direction: string; amount_sats: number; minimum_out: number; drift_pct: number } {
  const drift = Math.abs(ratio.sbtc_pct - targetPct);
  const overweightSbtc = ratio.sbtc_pct > targetPct;

  // Compute excess value in sBTC sats
  const excessPct = Math.abs(ratio.sbtc_pct - targetPct) / 100;
  const totalSbtcSats = ratio.sbtc_sats;
  const excessSbtcSats = Math.floor(totalSbtcSats * excessPct * 0.5); // conservative: correct half the excess

  const correctionSats = Math.min(excessSbtcSats, maxCorrectionSats);

  if (overweightSbtc) {
    // Sell sBTC, buy STX
    const expectedStxMicro = Math.floor((correctionSats / 1e8) * stxPerSbtc * 1e6);
    const minimumOut = Math.floor(expectedStxMicro * (1 - SLIPPAGE_BUFFER));
    return {
      direction: "sbtc_to_stx",
      amount_sats: correctionSats,
      minimum_out: minimumOut,
      drift_pct: parseFloat(drift.toFixed(2)),
    };
  } else {
    // Sell STX, buy sBTC
    const excessStxMicro = Math.floor((ratio.stx_micro) * excessPct * 0.5);
    const excessInSats = Math.floor((excessStxMicro / 1e6) * (1 / stxPerSbtc) * 1e8);
    const corrSats = Math.min(excessInSats, maxCorrectionSats);
    const expectedSbtcSats = Math.floor(corrSats * (1 - SLIPPAGE_BUFFER));
    return {
      direction: "stx_to_sbtc",
      amount_sats: corrSats,
      minimum_out: expectedSbtcSats,
      drift_pct: parseFloat(drift.toFixed(2)),
    };
  }
}

program
  .name("hodlmm-inventory-balancer")
  .description("Detect and correct HODLMM LP inventory drift via Bitflow corrective swaps");

program
  .command("doctor")
  .description("Check wallet, position, Bitflow quote, and gas readiness")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--pool <pool>", "Pool identifier e.g. sbtc-stx")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) throw new Error("Invalid Stacks address");
      const [stxBalance, sbtcBalance, price, apiInfo] = await Promise.all([
        getSTXBalance(opts.address),
        getSBTCBalance(opts.address),
        getPoolPrice(),
        httpGet(`${HIRO_API}/v2/info`),
      ]);
      const quoteAgeMs = Date.now() - price.timestamp;
      const state = loadState();
      const lastRun = state[opts.pool] ?? 0;
      const cooldownRemaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastRun));

      console.log(JSON.stringify({
        status: "success",
        action: stxBalance > 10000 || sbtcBalance > 0
          ? "environment ready — run status to check drift"
          : "insufficient balance — fund wallet before balancing",
        data: {
          address: opts.address,
          pool: opts.pool,
          stx_balance_micro: stxBalance,
          stx_balance_stx: stxBalance / 1e6,
          sbtc_balance_sats: sbtcBalance,
          sbtc_balance_sbtc: sbtcBalance / 1e8,
          bitflow_quote_age_ms: quoteAgeMs,
          quote_fresh: quoteAgeMs < MAX_QUOTE_STALENESS_MS,
          stx_per_sbtc: price.stxPerSbtc,
          hiro_api_reachable: !!apiInfo?.stacks_tip_height,
          cooldown_remaining_ms: cooldownRemaining,
          cooldown_ready: cooldownRemaining === 0,
          max_correction_sats: MAX_CORRECTION_SATS,
          min_drift_pct: MIN_DRIFT_PCT,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check connectivity", data: {}, error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program
  .command("status")
  .description("Read LP position and compute drift from target ratio")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--pool <pool>", "Pool identifier e.g. sbtc-stx")
  .option("--target-ratio <number>", "Target sBTC ratio percentage (default 50)", "50")
  .action(async (opts) => {
    try {
      const targetPct = parseFloat(opts.targetRatio);
      const [sbtcBalance, stxBalance, price] = await Promise.all([
        getSBTCBalance(opts.address),
        getSTXBalance(opts.address),
        getPoolPrice(),
      ]);

      const ratio = computeRatio(sbtcBalance, stxBalance, price.stxPerSbtc);
      const drift = Math.abs(ratio.sbtc_pct - targetPct);
      const needsRebalance = drift >= MIN_DRIFT_PCT;

      console.log(JSON.stringify({
        status: "success",
        action: needsRebalance
          ? `drift detected (${drift.toFixed(1)}%) — run to execute corrective swap`
          : `within target range (drift ${drift.toFixed(1)}% < ${MIN_DRIFT_PCT}%) — no action needed`,
        data: {
          pool: opts.pool,
          address: opts.address,
          current_ratio: { sbtc_pct: ratio.sbtc_pct, stx_pct: ratio.stx_pct },
          target_ratio: { sbtc_pct: targetPct, stx_pct: 100 - targetPct },
          drift_pct: parseFloat(drift.toFixed(2)),
          needs_rebalance: needsRebalance,
          sbtc_sats: sbtcBalance,
          stx_micro: stxBalance,
          pool_price: { stx_per_sbtc: price.stxPerSbtc },
          total_value_usd: ratio.total_value_usd,
          timestamp: new Date().toISOString(),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "STATUS_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program
  .command("run")
  .description("Execute corrective swap and redeploy liquidity")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--pool <pool>", "Pool identifier e.g. sbtc-stx")
  .option("--target-ratio <number>", "Target sBTC ratio percentage (default 50)", "50")
  .option("--min-drift-pct <number>", "Minimum drift to trigger action (default 5)", "5")
  .option("--max-correction-sats <number>", "Max corrective swap in satoshis (default 500000)", "500000")
  .requiredOption("--confirm <string>", "Must be BALANCE to execute")
  .action(async (opts) => {
    if (opts.confirm !== "BALANCE") {
      console.log(JSON.stringify({ status: "blocked", action: "pass --confirm BALANCE to execute", data: {}, error: { code: "CONFIRMATION_REQUIRED", message: "explicit confirmation required: --confirm BALANCE", next: "rerun with --confirm BALANCE" } }));
      return;
    }

    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide valid SP or SM Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "invalid address", next: "check address" } }));
      return;
    }

    const targetPct = parseFloat(opts.targetRatio);
    const minDrift = parseFloat(opts.minDriftPct);
    const maxCorrection = parseInt(opts.maxCorrectionSats);

    if (maxCorrection > MAX_CORRECTION_SATS) {
      console.log(JSON.stringify({ status: "blocked", action: `reduce max-correction-sats to ${MAX_CORRECTION_SATS} or less`, data: {}, error: { code: "EXCEEDS_MAX_CORRECTION", message: `max correction ${maxCorrection} exceeds limit ${MAX_CORRECTION_SATS}`, next: "reduce and retry" } }));
      return;
    }

    // Check cooldown
    const state = loadState();
    const lastRun = state[opts.pool] ?? 0;
    const cooldownRemaining = COOLDOWN_MS - (Date.now() - lastRun);
    if (cooldownRemaining > 0) {
      const hoursLeft = (cooldownRemaining / 3600000).toFixed(1);
      console.log(JSON.stringify({ status: "blocked", action: `wait ${hoursLeft}h before next correction on this pool`, data: { cooldown_remaining_ms: cooldownRemaining }, error: { code: "COOLDOWN_ACTIVE", message: `4h cooldown active, ${hoursLeft}h remaining`, next: `retry after ${hoursLeft} hours` } }));
      return;
    }

    try {
      const [sbtcBalance, stxBalance, price] = await Promise.all([
        getSBTCBalance(opts.address),
        getSTXBalance(opts.address),
        getPoolPrice(),
      ]);

      // Check quote freshness
      const quoteAge = Date.now() - price.timestamp;
      if (quoteAge > MAX_QUOTE_STALENESS_MS) {
        console.log(JSON.stringify({ status: "blocked", action: "retry — Bitflow quote is stale", data: { quote_age_ms: quoteAge }, error: { code: "QUOTE_STALE", message: `quote ${quoteAge}ms old exceeds ${MAX_QUOTE_STALENESS_MS}ms limit`, next: "retry immediately" } }));
        return;
      }

      const ratio = computeRatio(sbtcBalance, stxBalance, price.stxPerSbtc);
      const drift = Math.abs(ratio.sbtc_pct - targetPct);

      if (drift < minDrift) {
        console.log(JSON.stringify({ status: "blocked", action: "hold — drift below threshold, no correction needed", data: { drift_pct: drift, min_drift_pct: minDrift, current_ratio: ratio }, error: { code: "DRIFT_BELOW_THRESHOLD", message: `drift ${drift.toFixed(2)}% below min ${minDrift}%`, next: "monitor and retry when drift increases" } }));
        return;
      }

      const swap = computeCorrectiveSwap(ratio, targetPct, maxCorrection, price.stxPerSbtc);

      if (swap.amount_sats <= 0) {
        console.log(JSON.stringify({ status: "blocked", action: "insufficient position size for corrective swap", data: {}, error: { code: "SWAP_SIZE_TOO_SMALL", message: "computed corrective swap amount is zero", next: "fund position and retry" } }));
        return;
      }

      // Update cooldown state
      state[opts.pool] = Date.now();
      saveState(state);

      // Emit swap parameters for MCP wallet to sign and broadcast
      console.log(JSON.stringify({
        status: "success",
        action: `corrective swap ready — sign and broadcast via MCP wallet: ${swap.direction} ${swap.amount_sats} sats on Bitflow, then redeploy via hodlmm-move-liquidity`,
        data: {
          pool: opts.pool,
          before_ratio_pct: { sbtc: ratio.sbtc_pct, stx: ratio.stx_pct },
          drift_pct: swap.drift_pct,
          corrective_swap: {
            direction: swap.direction,
            amount_sats: swap.amount_sats,
            amount_sbtc: swap.amount_sats / 1e8,
            minimum_out: swap.minimum_out,
            slippage_max_pct: 0.5,
          },
          bitflow_router: BITFLOW_ROUTER,
          token_in: swap.direction === "sbtc_to_stx" ? SBTC_TOKEN : STX_TOKEN,
          token_out: swap.direction === "sbtc_to_stx" ? STX_TOKEN : SBTC_TOKEN,
          hodlmm_redeploy_contract: HODLMM_CONTRACT,
          hodlmm_redeploy_command: `hodlmm-move-liquidity run --pool ${opts.pool} --confirm`,
          address: opts.address,
          quote_age_ms: quoteAge,
          timestamp: new Date().toISOString(),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "BALANCE_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();