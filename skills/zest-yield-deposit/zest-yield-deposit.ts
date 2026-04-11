import { Command } from "commander";
import * as https from "https";

const program = new Command();

const HIRO_API = "https://api.hiro.so";
const ZEST_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-0";
const ZEST_POOL_RESERVE = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-0-reserve-v2-0";
const STX_TOKEN = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx-token";
const MAX_STX_AMOUNT = 10_000_000; // 10 STX in microSTX
const GAS_BUFFER = 10_000; // ~0.01 STX for gas
const ESTIMATED_APY = 3.5; // Zest STX lending APY estimate

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

async function checkHiroAPI(): Promise<boolean> {
  const json = await httpGet(`${HIRO_API}/v2/info`);
  return !!json?.stacks_tip_height;
}

function isValidStacksAddress(address: string): boolean {
  return /^SP[A-Z0-9]{30,40}$/.test(address) || /^SM[A-Z0-9]{30,40}$/.test(address);
}

function microToSTX(micro: number): number {
  return micro / 1_000_000;
}

program
  .name("zest-yield-deposit")
  .description("Supply STX to Zest Protocol lending pool to earn yield");

program
  .command("doctor")
  .description("Check wallet, STX balance, and API readiness")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) {
        throw new Error("Invalid Stacks address — must start with SP or SM");
      }
      const [balance, apiOk] = await Promise.all([
        getSTXBalance(opts.address),
        checkHiroAPI(),
      ]);
      const balanceSTX = microToSTX(balance);
      const ready = balance >= 1_000_000 + GAS_BUFFER;
      console.log(JSON.stringify({
        status: "success",
        action: ready
          ? "environment ready — run status to check yield rate, then run to deposit"
          : "low STX balance — fund wallet with at least 1 STX before depositing",
        data: {
          address: opts.address,
          stx_balance_micro: balance,
          stx_balance_stx: balanceSTX,
          hiro_api_reachable: apiOk,
          zest_contract: ZEST_CONTRACT,
          max_deposit_stx: 10,
          estimated_apy_pct: ESTIMATED_APY,
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
  .command("status")
  .description("Check STX balance and estimated Zest yield APY")
  .requiredOption("--address <address>", "Stacks wallet address")
  .action(async (opts) => {
    try {
      if (!isValidStacksAddress(opts.address)) {
        throw new Error("Invalid Stacks address");
      }
      const balance = await getSTXBalance(opts.address);
      const balanceSTX = microToSTX(balance);
      const annualYield = balanceSTX * (ESTIMATED_APY / 100);
      console.log(JSON.stringify({
        status: "success",
        action: balance >= 1_000_000
          ? "ready to deposit — run with --amount to supply STX to Zest"
          : "insufficient balance — add more STX before depositing",
        data: {
          address: opts.address,
          stx_balance_micro: balance,
          stx_balance_stx: balanceSTX,
          estimated_apy_pct: ESTIMATED_APY,
          estimated_annual_yield_stx: parseFloat(annualYield.toFixed(4)),
          zest_contract: ZEST_CONTRACT,
          max_deposit_stx: 10,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({
        status: "error",
        action: "run doctor to diagnose connectivity",
        data: {},
        error: { code: "STATUS_FAILED", message: err.message, next: "retry after 30s" },
      }));
    }
  });

program
  .command("run")
  .description("Supply STX to Zest Protocol lending pool")
  .requiredOption("--address <address>", "Stacks wallet address")
  .requiredOption("--amount <number>", "Amount in STX to deposit (max 10)")
  .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);

    if (isNaN(amountSTX) || amountSTX <= 0) {
      console.log(JSON.stringify({
        status: "error",
        action: "provide a valid positive STX amount",
        data: {},
        error: { code: "INVALID_AMOUNT", message: "amount must be a positive number", next: "retry with --amount 1" },
      }));
      return;
    }

    const amountMicro = Math.floor(amountSTX * 1_000_000);

    if (amountMicro > MAX_STX_AMOUNT) {
      console.log(JSON.stringify({
        status: "blocked",
        action: "reduce amount to 10 STX or less",
        data: { requested_stx: amountSTX, max_stx: 10 },
        error: { code: "EXCEEDS_SPEND_LIMIT", message: `${amountSTX} STX exceeds max deposit of 10 STX`, next: "retry with --amount 10 or less" },
      }));
      return;
    }

    if (!isValidStacksAddress(opts.address)) {
      console.log(JSON.stringify({
        status: "blocked",
        action: "provide a valid SP or SM Stacks address",
        data: {},
        error: { code: "INVALID_ADDRESS", message: "address must start with SP or SM", next: "check address and retry" },
      }));
      return;
    }

    try {
      const balance = await getSTXBalance(opts.address);

      if (balance < amountMicro + GAS_BUFFER) {
        console.log(JSON.stringify({
          status: "blocked",
          action: "fund wallet with more STX before depositing",
          data: {
            balance_micro: balance,
            balance_stx: microToSTX(balance),
            required_micro: amountMicro + GAS_BUFFER,
            required_stx: microToSTX(amountMicro + GAS_BUFFER),
          },
          error: { code: "INSUFFICIENT_BALANCE", message: `balance ${microToSTX(balance)} STX is less than required ${microToSTX(amountMicro + GAS_BUFFER)} STX`, next: "add more STX and retry" },
        }));
        return;
      }

      const estimatedAnnualYield = amountSTX * (ESTIMATED_APY / 100);

      // Emit supply parameters for AIBTC MCP wallet to sign and broadcast
      console.log(JSON.stringify({
        status: "success",
        action: `deposit ready — sign and broadcast via MCP wallet: call ${ZEST_CONTRACT} supply with ${amountSTX} STX from ${opts.address}`,
        data: {
          contract: ZEST_CONTRACT,
          function: "supply",
          args: {
            lp: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.lp-stx-v2-0",
            pool_reserve: ZEST_POOL_RESERVE,
            asset: STX_TOKEN,
            amount: amountMicro,
            owner: opts.address,
          },
          address: opts.address,
          amount_micro_stx: amountMicro,
          amount_stx: amountSTX,
          stx_balance_before: balance,
          stx_balance_before_stx: microToSTX(balance),
          estimated_apy_pct: ESTIMATED_APY,
          estimated_annual_yield_stx: parseFloat(estimatedAnnualYield.toFixed(4)),
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({
        status: "error",
        action: "run doctor to diagnose connectivity",
        data: {},
        error: { code: "DEPOSIT_FAILED", message: err.message, next: "retry after 30s" },
      }));
    }
  });

program.parse();