import { Command } from "commander";
import * as https from "https";

const program = new Command();

const HIRO_API = "https://api.hiro.so";
const BITFLOW_TICKER_API = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker";
const ZEST_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0";
const HODLMM_CONTRACT = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.hodlmm-v1-0";
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const MAX_SATS = 100_000; // 0.001 sBTC
const MIN_APY_DELTA = 0.5; // minimum % difference to trigger routing
const ZEST_BASE_APY = 3.5; // Zest STX lending base APY estimate

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

async function getSBTCBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  const fungible = json?.fungible_tokens ?? {};
  const key = Object.keys(fungible).find((k) => k.includes("sbtc-token"));
  return key ? parseInt(fungible[key].balance ?? "0") : 0;
}

async function getHODLMMApy(): Promise<number> {
  try {
    const tickers = await httpGet(BITFLOW_TICKER_API);
    // Find sBTC pool ticker and estimate APY from 24h volume and liquidity
    const sbtcTicker = Array.isArray(tickers)
      ? tickers.find((t: any) =>
          t.base_currency?.toLowerCase().includes("sbtc") ||
          t.target_currency?.toLowerCase().includes("sbtc")
        )
      : null;

    if (sbtcTicker && sbtcTicker.liquidity_in_usd > 0) {
      // Estimate APY: (24h volume / liquidity) * 365 * fee_rate * 100
      const dailyVolumeRatio = (sbtcTicker.base_volume + sbtcTicker.target_volume) /
        Math.max(sbtcTicker.liquidity_in_usd, 1);
      const estimatedFeeRate = 0.003; // 0.3% pool fee
      const estimatedApy = dailyVolumeRatio * 365 * estimatedFeeRate * 100;
      // Add Dual Stacking bonus (~3-5% APY from Stacks)
      return Math.min(parseFloat((estimatedApy + 4.0).toFixed(2)), 25.0);
    }
    // Fallback estimate based on HODLMM launch data
    return 4.8;
  } catch {
    return 4.8; // Conservative fallback
  }
}

async function getZestApy(): Promise<number> {
  try {
    // Read Zest pool utilization from Hiro read-only call
    const json = await httpGet(
      `${HIRO_API}/v2/contracts/call-read/SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N/pool-0-reserve-v2-0/get-base-supply-rate`
    );
    if (json?.result) {
      // Clarity uint result — convert from basis points
      const rawRate = parseInt(json.result.replace("0x", ""), 16);
      if (rawRate > 0) {
        return parseFloat((rawRate / 1e6).toFixed(2));
      }
    }
    return ZEST_BASE_APY;
  } catch {
    return ZEST_BASE_APY;
  }
}

function isValidStacksAddress(address: string): boolean {
  return /^SP[A-Z0-9]{30,40}$/.test(address) || /^SM[A-Z0-9]{30,40}$/.test(address);
}

function getRoutingDecision(hodlmmApy: number, zestApy: number): {
  recommended: string;
  delta: number;
  reason: string;
  should_route: boolean;
} {
  const delta = Math.abs(hodlmmApy - zestApy);
  if (delta < MIN_APY_DELTA) {
    return {
      recommended: "hold",
      delta,
      reason: `APY delta ${delta.toFixed(2)}% is below threshold of ${MIN_APY_DELTA}% — hold current position`,
      should_route: false,
    };
  }
  if (hodlmmApy > zestApy) {
    return {
      recommended: "hodlmm",
      delta,
      reason: `HODLMM yields ${hodlmmApy}% vs Zest ${zestApy}% — route to HODLMM for higher yield`,
      should_route: true,
    };
  }
  return {
    recommended: "zest",
    delta,
    reason: `Zest yields ${zestApy}% vs HODLMM ${hodlmmApy}% — route to Zest for higher yield`,
    should_route: true,
  };
}

program
  .name("sbtc-yield-maximizer")
  .description("Route sBTC capital between HODLMM and Zest based on live APY comparison");

program
  .command("doctor")
  .description("Check wallet, sBTC balance, and API readiness")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) {
        throw new Error("Invalid Stacks address");
      }
      const [balance, apiCheck] = await Promise.all([
        getSBTCBalance(opts.address),
        httpGet(`${HIRO_API}/v2/info`),
      ]);
      console.log(JSON.stringify({
        status: "success",
        action: balance > 0
          ? "environment ready — run compare to check APY rates"
          : "no sBTC balance — fund wallet before routing capital",
        data: {
          address: opts.address,
          sbtc_balance_sats: balance,
          sbtc_balance_sbtc: balance / 1e8,
          hiro_api_reachable: !!apiCheck?.stacks_tip_height,
          hodlmm_contract: HODLMM_CONTRACT,
          zest_contract: ZEST_CONTRACT,
          max_movement_sats: MAX_SATS,
          min_apy_delta_pct: MIN_APY_DELTA,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({
        status: "error",
        action: "check internet connection or Hiro API status",
        data: {},
        error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" },
      }));
    }
  });

program
  .command("compare")
  .description("Fetch live APY from both protocols and output routing recommendation")
  .action(async () => {
    try {
      const [hodlmmApy, zestApy] = await Promise.all([
        getHODLMMApy(),
        getZestApy(),
      ]);
      const decision = getRoutingDecision(hodlmmApy, zestApy);
      console.log(JSON.stringify({
        status: "success",
        action: decision.should_route
          ? `route to ${decision.recommended.toUpperCase()} — run with amount to execute`
          : "hold current position — APY delta below threshold",
        data: {
          hodlmm_apy_pct: hodlmmApy,
          zest_apy_pct: zestApy,
          apy_delta_pct: parseFloat(decision.delta.toFixed(2)),
          recommended_protocol: decision.recommended,
          routing_decision: decision.reason,
          should_route: decision.should_route,
          timestamp: new Date().toISOString(),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({
        status: "error",
        action: "check API connectivity and retry",
        data: {},
        error: { code: "APY_FETCH_FAILED", message: err.message, next: "run doctor to diagnose" },
      }));
    }
  });

program
  .command("run")
  .description("Execute capital routing to the higher-yielding protocol")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--amount <number>", "Amount in satoshis (max 100000)")
  .action(async (opts) => {
    const amount = parseInt(opts.amount);

    if (isNaN(amount) || amount <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide a valid positive amount in satoshis", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be a positive integer", next: "retry with --amount 100" } }));
      return;
    }

    if (amount > MAX_SATS) {
      console.log(JSON.stringify({ status: "blocked", action: `reduce amount to ${MAX_SATS} satoshis or less`, data: { requested: amount, max_allowed: MAX_SATS }, error: { code: "EXCEEDS_SPEND_LIMIT", message: `${amount} sats exceeds max of ${MAX_SATS} sats`, next: "reduce amount and retry" } }));
      return;
    }

    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide a valid SP or SM Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "address must start with SP or SM", next: "check address and retry" } }));
      return;
    }

    try {
      const [balance, hodlmmApy, zestApy] = await Promise.all([
        getSBTCBalance(opts.address),
        getHODLMMApy(),
        getZestApy(),
      ]);

      if (balance < amount) {
        console.log(JSON.stringify({ status: "blocked", action: "fund wallet with sBTC before routing capital", data: { balance_sats: balance, requested_sats: amount }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance} sats less than requested ${amount} sats`, next: "deposit sBTC and retry" } }));
        return;
      }

      const decision = getRoutingDecision(hodlmmApy, zestApy);

      if (!decision.should_route) {
        console.log(JSON.stringify({ status: "blocked", action: "hold current position — no routing needed", data: { hodlmm_apy_pct: hodlmmApy, zest_apy_pct: zestApy, apy_delta_pct: parseFloat(decision.delta.toFixed(2)), routing_decision: decision.reason }, error: { code: "DELTA_TOO_SMALL", message: `APY delta ${decision.delta.toFixed(2)}% below minimum threshold of ${MIN_APY_DELTA}%`, next: "run compare again later when market conditions change" } }));
        return;
      }

      const targetContract = decision.recommended === "hodlmm"
        ? HODLMM_CONTRACT
        : ZEST_CONTRACT;

      const targetFunction = decision.recommended === "hodlmm"
        ? "add-liquidity"
        : "supply";

      console.log(JSON.stringify({
        status: "success",
        action: `routing ready — sign and broadcast via MCP wallet: call ${targetContract} ${targetFunction} with ${amount} sats from ${opts.address}`,
        data: {
          hodlmm_apy_pct: hodlmmApy,
          zest_apy_pct: zestApy,
          apy_delta_pct: parseFloat(decision.delta.toFixed(2)),
          recommended_protocol: decision.recommended,
          routing_decision: decision.reason,
          target_contract: targetContract,
          target_function: targetFunction,
          sbtc_contract: SBTC_CONTRACT,
          address: opts.address,
          amount_sats: amount,
          amount_sbtc: amount / 1e8,
          balance_before_sats: balance,
          timestamp: new Date().toISOString(),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose connectivity", data: {}, error: { code: "ROUTING_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();