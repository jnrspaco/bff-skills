import { Command } from "commander";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

const HIRO_API = "https://api.hiro.so";
const BITFLOW_TICKER = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker";
const ZEST_POOL_RESERVE = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZEST_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0";
const HODLMM_CONTRACT = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.hodlmm-v1-0";
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const BITFLOW_ROUTER = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router";

const MAX_SATS = 100_000;
const MIN_APY_DELTA = 0.5;
const MAX_SLIPPAGE = 0.01;
const COOLDOWN_MS = 60_000;
const STATE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".aibtc",
  "hodlmm-router-state.json"
);

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid JSON")); }
      });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

function loadState(): Record<string, number> {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
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

// Fixed: use @stacks/transactions-style validation
function isValidStacksAddress(address: string): boolean {
  // Stacks addresses are base58check encoded, 40-41 chars, start with SP or SM
  return typeof address === "string" &&
    /^(SP|SM)[0-9A-Z]{38,40}$/.test(address);
}

async function getSBTCBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  const fungible = json?.fungible_tokens ?? {};
  const key = Object.keys(fungible).find((k) => k.includes("sbtc-token"));
  return key ? parseInt(fungible[key].balance ?? "0") : 0;
}

// Fixed: live APY from actual contract read via Hiro
async function getZestApy(): Promise<{ apy: number; source: string }> {
  try {
    const url = `${HIRO_API}/v2/contracts/call-read/${ZEST_POOL_RESERVE}/pool-0-reserve-v2-0/get-base-supply-rate`;
    const json = await httpGet(url);
    if (json?.result && json.result !== "0x" && json.result !== "0x00") {
      const rawHex = json.result.replace("0x", "");
      const rawRate = parseInt(rawHex, 16);
      if (rawRate > 0 && rawRate < 10000000) {
        const apy = parseFloat((rawRate / 100000).toFixed(2));
        return { apy, source: "zest-contract-live" };
      }
    }
    return { apy: 3.5, source: "zest-fallback-estimate" };
  } catch {
    return { apy: 3.5, source: "zest-fallback-estimate" };
  }
}

// Fixed: live APY from Bitflow ticker with volume/liquidity ratio
async function getHODLMMApy(): Promise<{ apy: number; source: string; liquidity_usd: number }> {
  try {
    const tickers = await httpGet(BITFLOW_TICKER);
    if (Array.isArray(tickers) && tickers.length > 0) {
      const sbtcTicker = tickers.find((t: any) =>
        (t.base_currency?.toLowerCase().includes("sbtc") ||
          t.target_currency?.toLowerCase().includes("sbtc"))
      );
      if (sbtcTicker && sbtcTicker.liquidity_in_usd > 0) {
        const vol = (sbtcTicker.base_volume ?? 0) + (sbtcTicker.target_volume ?? 0);
        const dailyFeeYield = (vol / sbtcTicker.liquidity_in_usd) * 0.003;
        const annualizedFeeApy = dailyFeeYield * 365 * 100;
        const dualStackingBonus = 4.0;
        const totalApy = Math.min(parseFloat((annualizedFeeApy + dualStackingBonus).toFixed(2)), 30.0);
        return { apy: totalApy, source: "bitflow-ticker-live", liquidity_usd: sbtcTicker.liquidity_in_usd };
      }
    }
    return { apy: 4.8, source: "hodlmm-fallback-estimate", liquidity_usd: 0 };
  } catch {
    return { apy: 4.8, source: "hodlmm-fallback-estimate", liquidity_usd: 0 };
  }
}

function getRoutingDecision(hodlmmApy: number, zestApy: number) {
  const delta = Math.abs(hodlmmApy - zestApy);
  if (delta < MIN_APY_DELTA) {
    return { recommended: "hold", delta, reason: `delta ${delta.toFixed(2)}% below threshold — hold position`, should_route: false };
  }
  if (hodlmmApy > zestApy) {
    return { recommended: "hodlmm", delta, reason: `HODLMM ${hodlmmApy}% > Zest ${zestApy}% — route to HODLMM`, should_route: true };
  }
  return { recommended: "zest", delta, reason: `Zest ${zestApy}% > HODLMM ${hodlmmApy}% — route to Zest`, should_route: true };
}

program.name("hodlmm-capital-router").description("Route sBTC between HODLMM and Zest based on live APY");

program.command("doctor")
  .description("Check wallet, balance, and API readiness")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) throw new Error("Invalid Stacks address");
      const [balance, apiInfo] = await Promise.all([
        getSBTCBalance(opts.address),
        httpGet(`${HIRO_API}/v2/info`),
      ]);
      const state = loadState();
      const cooldownRemaining = Math.max(0, COOLDOWN_MS - (Date.now() - (state.last_run ?? 0)));
      console.log(JSON.stringify({
        status: "success",
        action: balance > 0 ? "environment ready — run compare to check APY" : "no sBTC balance — fund wallet first",
        data: {
          address: opts.address,
          sbtc_balance_sats: balance,
          sbtc_balance_sbtc: balance / 1e8,
          hiro_api_reachable: !!apiInfo?.stacks_tip_height,
          stacks_tip_height: apiInfo?.stacks_tip_height,
          max_movement_sats: MAX_SATS,
          min_apy_delta_pct: MIN_APY_DELTA,
          cooldown_remaining_ms: cooldownRemaining,
          cooldown_ready: cooldownRemaining === 0,
          hodlmm_contract: HODLMM_CONTRACT,
          zest_contract: ZEST_CONTRACT,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check connectivity", data: {}, error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("compare")
  .description("Fetch live APY from both protocols")
  .action(async () => {
    try {
      const [hodlmm, zest] = await Promise.all([getHODLMMApy(), getZestApy()]);
      const decision = getRoutingDecision(hodlmm.apy, zest.apy);
      console.log(JSON.stringify({
        status: "success",
        action: decision.should_route
          ? `route to ${decision.recommended.toUpperCase()} — run with amount to execute`
          : "hold position — APY delta below threshold",
        data: {
          hodlmm_apy_pct: hodlmm.apy,
          hodlmm_apy_source: hodlmm.source,
          hodlmm_liquidity_usd: hodlmm.liquidity_usd,
          zest_apy_pct: zest.apy,
          zest_apy_source: zest.source,
          apy_delta_pct: parseFloat(decision.delta.toFixed(2)),
          recommended_protocol: decision.recommended,
          routing_decision: decision.reason,
          should_route: decision.should_route,
          timestamp: new Date().toISOString(),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check API connectivity", data: {}, error: { code: "APY_FETCH_FAILED", message: err.message, next: "run doctor to diagnose" } }));
    }
  });

program.command("run")
  .description("Execute capital routing on-chain")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--amount <number>", "Amount in satoshis (max 100000)")
  .action(async (opts) => {
    const amount = parseInt(opts.amount);

    if (isNaN(amount) || amount <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide valid positive satoshi amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive integer", next: "retry with --amount 1000" } }));
      return;
    }
    if (amount > MAX_SATS) {
      console.log(JSON.stringify({ status: "blocked", action: `reduce to ${MAX_SATS} sats or less`, data: { requested: amount, max: MAX_SATS }, error: { code: "EXCEEDS_SPEND_LIMIT", message: `${amount} exceeds max ${MAX_SATS}`, next: "reduce amount" } }));
      return;
    }
    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide valid Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "address must start with SP or SM", next: "check address" } }));
      return;
    }

    const state = loadState();
    const cooldownRemaining = COOLDOWN_MS - (Date.now() - (state.last_run ?? 0));
    if (cooldownRemaining > 0) {
      console.log(JSON.stringify({ status: "blocked", action: `wait ${(cooldownRemaining / 1000).toFixed(0)}s`, data: { cooldown_remaining_ms: cooldownRemaining }, error: { code: "COOLDOWN_ACTIVE", message: `cooldown active, ${(cooldownRemaining / 1000).toFixed(0)}s remaining`, next: "retry after cooldown" } }));
      return;
    }

    try {
      const [balance, hodlmm, zest] = await Promise.all([
        getSBTCBalance(opts.address),
        getHODLMMApy(),
        getZestApy(),
      ]);

      if (balance < amount) {
        console.log(JSON.stringify({ status: "blocked", action: "fund wallet with sBTC", data: { balance_sats: balance, requested_sats: amount }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance} sats < requested ${amount}`, next: "deposit sBTC and retry" } }));
        return;
      }

      const decision = getRoutingDecision(hodlmm.apy, zest.apy);

      if (!decision.should_route) {
        console.log(JSON.stringify({ status: "blocked", action: "hold — APY delta below threshold", data: { hodlmm_apy_pct: hodlmm.apy, zest_apy_pct: zest.apy, delta: decision.delta }, error: { code: "DELTA_TOO_SMALL", message: `delta ${decision.delta.toFixed(2)}% < min ${MIN_APY_DELTA}%`, next: "monitor and retry when conditions change" } }));
        return;
      }

      const minOutput = Math.floor(amount * (1 - MAX_SLIPPAGE));
      const targetContract = decision.recommended === "hodlmm" ? HODLMM_CONTRACT : ZEST_CONTRACT;
      const targetFunction = decision.recommended === "hodlmm" ? "add-liquidity" : "supply";

      // Update cooldown
      state.last_run = Date.now();
      saveState(state);

      // Emit on-chain execution params for MCP wallet
      console.log(JSON.stringify({
        status: "success",
        action: `executing ${decision.recommended.toUpperCase()} routing — MCP wallet signing transaction`,
        data: {
          hodlmm_apy_pct: hodlmm.apy,
          hodlmm_apy_source: hodlmm.source,
          zest_apy_pct: zest.apy,
          zest_apy_source: zest.source,
          apy_delta_pct: parseFloat(decision.delta.toFixed(2)),
          recommended_protocol: decision.recommended,
          routing_decision: decision.reason,
          execution: {
            target_contract: targetContract,
            target_function: targetFunction,
            sbtc_contract: SBTC_CONTRACT,
            bitflow_router: BITFLOW_ROUTER,
            from_address: opts.address,
            amount_sats: amount,
            amount_sbtc: amount / 1e8,
            min_output_sats: minOutput,
            slippage_max_pct: MAX_SLIPPAGE * 100,
          },
          balance_before_sats: balance,
          timestamp: new Date().toISOString(),
          tx_status: "pending_signature",
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "ROUTING_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();