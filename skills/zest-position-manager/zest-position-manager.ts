import { Command } from "commander";
import * as https from "https";

const program = new Command();

const HIRO_API = "https://api.hiro.so";
const ZEST_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0";
const ZEST_POOL_RESERVE = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZEST_LP_TOKEN = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.lp-stx-v2-0";
const ZEST_POOL_RESERVE_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-0-reserve-v2-0";

const MAX_SUPPLY_STX = 10;
const MAX_BORROW_STX = 5;
const MAX_REPAY_STX = 10;
const MIN_HEALTH_FACTOR = 1.2;
const MIN_BORROW_HEALTH_FACTOR = 1.5;
const GAS_BUFFER = 10_000;

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

function isValidStacksAddress(address: string): boolean {
  return typeof address === "string" && /^(SP|SM)[0-9A-Z]{38,40}$/.test(address);
}

async function getSTXBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  return parseInt(json?.stx?.balance ?? "0");
}

async function getZestPosition(address: string): Promise<{ supplied: number; borrowed: number; health_factor: number }> {
  try {
    // Read supplied amount from LP token balance
    const balances = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
    const fungible = balances?.fungible_tokens ?? {};
    const lpKey = Object.keys(fungible).find((k) => k.includes("lp-stx"));
    const supplied = lpKey ? parseInt(fungible[lpKey].balance ?? "0") : 0;

    // Read borrowed amount from Hiro read-only call
    let borrowed = 0;
    try {
      const borrowUrl = `${HIRO_API}/v2/contracts/call-read/${ZEST_POOL_RESERVE}/pool-0-reserve-v2-0/get-borrow-balance`;
      const borrowJson = await httpGet(borrowUrl);
      if (borrowJson?.result && borrowJson.result !== "0x") {
        borrowed = parseInt(borrowJson.result.replace("0x", ""), 16);
      }
    } catch (_) {}

    // Compute health factor: supplied / (borrowed * liquidation_threshold)
    // Zest STX liquidation threshold is typically 80% (0.8)
    const LIQUIDATION_THRESHOLD = 0.8;
    let health_factor = 999; // infinite if no borrows
    if (borrowed > 0) {
      health_factor = parseFloat(((supplied * LIQUIDATION_THRESHOLD) / borrowed).toFixed(2));
    }

    return { supplied, borrowed, health_factor };
  } catch {
    return { supplied: 0, borrowed: 0, health_factor: 999 };
  }
}

function getHealthFactorStatus(hf: number): string {
  if (hf < MIN_HEALTH_FACTOR) return "DANGER — below minimum, repay immediately";
  if (hf < MIN_BORROW_HEALTH_FACTOR) return "WARNING — no new borrows allowed";
  if (hf < 2.0) return "CAUTION — monitor closely";
  return "SAFE";
}

program.name("zest-position-manager").description("Manage full Zest Protocol lending positions");

program.command("doctor")
  .description("Check wallet, balance, and Zest API readiness")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) throw new Error("Invalid Stacks address");
      const [balance, apiInfo] = await Promise.all([
        getSTXBalance(opts.address),
        httpGet(`${HIRO_API}/v2/info`),
      ]);
      console.log(JSON.stringify({
        status: "success",
        action: balance >= 1_000_000
          ? "environment ready — run status to check position"
          : "low STX balance — fund wallet before managing position",
        data: {
          address: opts.address,
          stx_balance_micro: balance,
          stx_balance_stx: balance / 1e6,
          hiro_api_reachable: !!apiInfo?.stacks_tip_height,
          stacks_tip_height: apiInfo?.stacks_tip_height,
          zest_contract: ZEST_CONTRACT,
          limits: {
            max_supply_stx: MAX_SUPPLY_STX,
            max_borrow_stx: MAX_BORROW_STX,
            max_repay_stx: MAX_REPAY_STX,
            min_health_factor: MIN_HEALTH_FACTOR,
            min_borrow_health_factor: MIN_BORROW_HEALTH_FACTOR,
          },
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check connectivity", data: {}, error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("status")
  .description("Read current Zest position and health factor")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) throw new Error("Invalid Stacks address");
      const [balance, position] = await Promise.all([
        getSTXBalance(opts.address),
        getZestPosition(opts.address),
      ]);
      const hfStatus = getHealthFactorStatus(position.health_factor);
      const canBorrow = position.health_factor >= MIN_BORROW_HEALTH_FACTOR;
      const canSupply = position.health_factor >= MIN_HEALTH_FACTOR;

      console.log(JSON.stringify({
        status: "success",
        action: position.health_factor < MIN_HEALTH_FACTOR
          ? "DANGER — repay debt immediately to avoid liquidation"
          : canBorrow
          ? "position healthy — can supply or borrow within limits"
          : "position caution — supply only, no new borrows allowed",
        data: {
          address: opts.address,
          stx_balance_micro: balance,
          stx_balance_stx: balance / 1e6,
          position: {
            supplied_micro_stx: position.supplied,
            supplied_stx: position.supplied / 1e6,
            borrowed_micro_stx: position.borrowed,
            borrowed_stx: position.borrowed / 1e6,
            health_factor: position.health_factor,
            health_factor_status: hfStatus,
          },
          available_actions: {
            can_supply: canSupply,
            can_borrow: canBorrow,
            can_repay: position.borrowed > 0,
          },
          timestamp: new Date().toISOString(),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "STATUS_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("supply")
  .description("Supply STX to Zest lending pool")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--amount <number>", "Amount in STX (max 10)")
  .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);
    if (isNaN(amountSTX) || amountSTX <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide valid positive STX amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive", next: "retry with --amount 1" } }));
      return;
    }
    if (amountSTX > MAX_SUPPLY_STX) {
      console.log(JSON.stringify({ status: "blocked", action: `reduce to ${MAX_SUPPLY_STX} STX or less`, data: { requested_stx: amountSTX, max_stx: MAX_SUPPLY_STX }, error: { code: "EXCEEDS_SUPPLY_LIMIT", message: `${amountSTX} STX exceeds max supply of ${MAX_SUPPLY_STX} STX`, next: "reduce amount" } }));
      return;
    }
    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide valid Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "invalid address", next: "check address" } }));
      return;
    }
    try {
      const [balance, position] = await Promise.all([getSTXBalance(opts.address), getZestPosition(opts.address)]);
      const amountMicro = Math.floor(amountSTX * 1e6);
      if (balance < amountMicro + GAS_BUFFER) {
        console.log(JSON.stringify({ status: "blocked", action: "fund wallet with more STX", data: { balance_stx: balance / 1e6, required_stx: amountSTX + 0.01 }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance / 1e6} STX insufficient`, next: "add STX and retry" } }));
        return;
      }
      if (position.health_factor < MIN_HEALTH_FACTOR) {
        console.log(JSON.stringify({ status: "blocked", action: "repay debt first — health factor in danger zone", data: { health_factor: position.health_factor }, error: { code: "HEALTH_FACTOR_DANGER", message: `health factor ${position.health_factor} below minimum ${MIN_HEALTH_FACTOR}`, next: "run repay to improve health factor" } }));
        return;
      }
      console.log(JSON.stringify({
        status: "success",
        action: `supply ready — sign and broadcast via MCP wallet: call ${ZEST_CONTRACT} supply with ${amountSTX} STX`,
        data: {
          operation: "supply",
          contract: ZEST_CONTRACT,
          function: "supply",
          args: { lp: ZEST_LP_TOKEN, pool_reserve: ZEST_POOL_RESERVE_CONTRACT, amount: amountMicro, owner: opts.address },
          address: opts.address,
          amount_micro_stx: amountMicro,
          amount_stx: amountSTX,
          health_factor: position.health_factor,
          health_factor_status: getHealthFactorStatus(position.health_factor),
          supplied_before_micro: position.supplied,
          borrowed_micro: position.borrowed,
          stx_balance_before: balance,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "SUPPLY_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("borrow")
  .description("Borrow STX against Zest collateral")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--amount <number>", "Amount in STX (max 5)")
  .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);
    if (isNaN(amountSTX) || amountSTX <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide valid positive STX amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive", next: "retry with --amount 1" } }));
      return;
    }
    if (amountSTX > MAX_BORROW_STX) {
      console.log(JSON.stringify({ status: "blocked", action: `reduce to ${MAX_BORROW_STX} STX or less`, data: { requested_stx: amountSTX, max_stx: MAX_BORROW_STX }, error: { code: "EXCEEDS_BORROW_LIMIT", message: `${amountSTX} STX exceeds max borrow of ${MAX_BORROW_STX} STX`, next: "reduce amount" } }));
      return;
    }
    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide valid Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "invalid address", next: "check address" } }));
      return;
    }
    try {
      const position = await getZestPosition(opts.address);
      const amountMicro = Math.floor(amountSTX * 1e6);
      if (position.health_factor < MIN_HEALTH_FACTOR) {
        console.log(JSON.stringify({ status: "blocked", action: "repay debt — health factor in danger zone", data: { health_factor: position.health_factor }, error: { code: "HEALTH_FACTOR_DANGER", message: `health factor ${position.health_factor} below minimum ${MIN_HEALTH_FACTOR}`, next: "run repay first" } }));
        return;
      }
      // Compute post-borrow health factor
      const LIQUIDATION_THRESHOLD = 0.8;
      const newBorrowed = position.borrowed + amountMicro;
      const postBorrowHF = newBorrowed > 0
        ? parseFloat(((position.supplied * LIQUIDATION_THRESHOLD) / newBorrowed).toFixed(2))
        : 999;
      if (postBorrowHF < MIN_BORROW_HEALTH_FACTOR) {
        console.log(JSON.stringify({ status: "blocked", action: "reduce borrow amount to keep health factor above 1.5", data: { current_health_factor: position.health_factor, post_borrow_health_factor: postBorrowHF, min_required: MIN_BORROW_HEALTH_FACTOR }, error: { code: "HEALTH_FACTOR_TOO_LOW", message: `borrow would push health factor to ${postBorrowHF}, below minimum ${MIN_BORROW_HEALTH_FACTOR}`, next: "reduce borrow amount or supply more collateral" } }));
        return;
      }
      if (position.supplied === 0) {
        console.log(JSON.stringify({ status: "blocked", action: "supply STX as collateral before borrowing", data: {}, error: { code: "NO_COLLATERAL", message: "no collateral supplied — run supply first", next: "run supply then retry borrow" } }));
        return;
      }
      console.log(JSON.stringify({
        status: "success",
        action: `borrow ready — sign and broadcast via MCP wallet: call ${ZEST_CONTRACT} borrow with ${amountSTX} STX`,
        data: {
          operation: "borrow",
          contract: ZEST_CONTRACT,
          function: "borrow",
          args: { lp: ZEST_LP_TOKEN, pool_reserve: ZEST_POOL_RESERVE_CONTRACT, amount: amountMicro, owner: opts.address },
          address: opts.address,
          amount_micro_stx: amountMicro,
          amount_stx: amountSTX,
          health_factor_before: position.health_factor,
          health_factor_after_borrow: postBorrowHF,
          health_factor_status: getHealthFactorStatus(postBorrowHF),
          supplied_micro: position.supplied,
          borrowed_before_micro: position.borrowed,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "BORROW_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.command("repay")
  .description("Repay Zest debt to improve health factor")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--amount <number>", "Amount in STX (max 10)")
  .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);
    if (isNaN(amountSTX) || amountSTX <= 0) {
      console.log(JSON.stringify({ status: "error", action: "provide valid positive STX amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive", next: "retry with --amount 1" } }));
      return;
    }
    if (amountSTX > MAX_REPAY_STX) {
      console.log(JSON.stringify({ status: "blocked", action: `reduce to ${MAX_REPAY_STX} STX or less`, data: { requested_stx: amountSTX, max_stx: MAX_REPAY_STX }, error: { code: "EXCEEDS_REPAY_LIMIT", message: `${amountSTX} STX exceeds max repay of ${MAX_REPAY_STX} STX`, next: "reduce amount" } }));
      return;
    }
    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({ status: "blocked", action: "provide valid Stacks address", data: {}, error: { code: "INVALID_ADDRESS", message: "invalid address", next: "check address" } }));
      return;
    }
    try {
      const [balance, position] = await Promise.all([getSTXBalance(opts.address), getZestPosition(opts.address)]);
      const amountMicro = Math.floor(amountSTX * 1e6);
      if (balance < amountMicro + GAS_BUFFER) {
        console.log(JSON.stringify({ status: "blocked", action: "fund wallet with STX to repay", data: { balance_stx: balance / 1e6, required_stx: amountSTX + 0.01 }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance / 1e6} STX insufficient`, next: "add STX and retry" } }));
        return;
      }
      if (position.borrowed === 0) {
        console.log(JSON.stringify({ status: "blocked", action: "no outstanding debt to repay", data: { borrowed_micro: 0 }, error: { code: "NO_DEBT", message: "no outstanding Zest debt found", next: "run status to check position" } }));
        return;
      }
      const repayAmount = Math.min(amountMicro, position.borrowed);
      const LIQUIDATION_THRESHOLD = 0.8;
      const newBorrowed = Math.max(0, position.borrowed - repayAmount);
      const postRepayHF = newBorrowed > 0
        ? parseFloat(((position.supplied * LIQUIDATION_THRESHOLD) / newBorrowed).toFixed(2))
        : 999;
      console.log(JSON.stringify({
        status: "success",
        action: `repay ready — sign and broadcast via MCP wallet: call ${ZEST_CONTRACT} repay with ${amountSTX} STX`,
        data: {
          operation: "repay",
          contract: ZEST_CONTRACT,
          function: "repay",
          args: { lp: ZEST_LP_TOKEN, pool_reserve: ZEST_POOL_RESERVE_CONTRACT, amount: repayAmount, owner: opts.address },
          address: opts.address,
          amount_micro_stx: repayAmount,
          amount_stx: repayAmount / 1e6,
          health_factor_before: position.health_factor,
          health_factor_after_repay: postRepayHF,
          health_factor_status: getHealthFactorStatus(postRepayHF),
          supplied_micro: position.supplied,
          borrowed_before_micro: position.borrowed,
          borrowed_after_micro: newBorrowed,
          stx_balance_before: balance,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose", data: {}, error: { code: "REPAY_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();