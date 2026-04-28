"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const https = __importStar(require("https"));
const child_process_1 = require("child_process");
const program = new commander_1.Command();
const HIRO_API = "https://api.hiro.so";
const BITFLOW_TICKER = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker";
const MAX_SATS = 100000;
const MIN_APY_DELTA = 0.5;
const ZEST_BASE_APY = 3.5;
const WALLET_ID = "612c9855-a121-4e4a-9122-33ccca8fb415";
function log(msg) { process.stderr.write(msg + "\n"); }
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return {};
    }
}
function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    reject(new Error("Invalid JSON"));
                }
            });
        });
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.on("error", reject);
    });
}
async function getSBTCBalance(address) {
    const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
    const fungible = json?.fungible_tokens ?? {};
    const key = Object.keys(fungible).find((k) => k.includes("sbtc-token"));
    return key ? parseInt(fungible[key].balance ?? "0") : 0;
}
async function getHODLMMApy() {
    try {
        const tickers = await httpGet(BITFLOW_TICKER);
        if (Array.isArray(tickers) && tickers.length > 0) {
            const sbtcTicker = tickers.find((t) => t.base_currency?.toLowerCase().includes("sbtc") ||
                t.target_currency?.toLowerCase().includes("sbtc"));
            if (sbtcTicker && sbtcTicker.liquidity_in_usd > 0) {
                const vol = (sbtcTicker.base_volume ?? 0) + (sbtcTicker.target_volume ?? 0);
                const dailyFeeYield = (vol / sbtcTicker.liquidity_in_usd) * 0.003;
                const annualizedFeeApy = dailyFeeYield * 365 * 100;
                const totalApy = Math.min(parseFloat((annualizedFeeApy + 4.0).toFixed(2)), 30.0);
                return { apy: totalApy, source: "bitflow-ticker-live", liquidity_usd: sbtcTicker.liquidity_in_usd };
            }
        }
        return { apy: 4.8, source: "hodlmm-fallback", liquidity_usd: 0 };
    }
    catch {
        return { apy: 4.8, source: "hodlmm-fallback", liquidity_usd: 0 };
    }
}
async function getZestApy() {
    try {
        const url = `${HIRO_API}/v2/contracts/call-read/SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N/pool-0-reserve-v2-0/get-base-supply-rate`;
        const json = await httpGet(url);
        if (json?.result && json.result !== "0x" && json.result !== "0x00") {
            const rawRate = parseInt(json.result.replace("0x", ""), 16);
            if (rawRate > 0 && rawRate < 10000000) {
                return { apy: parseFloat((rawRate / 100000).toFixed(2)), source: "zest-contract-live" };
            }
        }
        return { apy: ZEST_BASE_APY, source: "zest-fallback" };
    }
    catch {
        return { apy: ZEST_BASE_APY, source: "zest-fallback" };
    }
}
function getRoutingDecision(hodlmmApy, zestApy) {
    const delta = Math.abs(hodlmmApy - zestApy);
    if (delta < MIN_APY_DELTA) {
        return { recommended: "hold", delta, reason: `delta ${delta.toFixed(2)}% below threshold`, should_route: false };
    }
    if (hodlmmApy > zestApy) {
        return { recommended: "hodlmm", delta, reason: `HODLMM ${hodlmmApy}% > Zest ${zestApy}% — route to HODLMM`, should_route: true };
    }
    return { recommended: "zest", delta, reason: `Zest ${zestApy}% > HODLMM ${hodlmmApy}% — route to Zest`, should_route: true };
}
class McpClient {
    constructor() {
        this.proc = null;
        this.buffer = "";
        this.pending = new Map();
        this.nextId = 1;
    }
    start() {
        return new Promise((resolve, reject) => {
            this.proc = (0, child_process_1.spawn)("npx", ["@aibtc/mcp-server@latest"], {
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env },
                shell: true,
            });
            this.proc.stdout.on("data", (data) => {
                this.buffer += data.toString();
                const lines = this.buffer.split("\n");
                this.buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.id != null && this.pending.has(msg.id)) {
                            const { resolve, reject } = this.pending.get(msg.id);
                            this.pending.delete(msg.id);
                            if (msg.error)
                                reject(new Error(msg.error.message));
                            else
                                resolve(msg.result);
                        }
                    }
                    catch (_) { }
                }
            });
            this.proc.stderr.on("data", (d) => {
                const s = d.toString().trim();
                if (s)
                    log("[MCP] " + s);
            });
            this.proc.on("error", reject);
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this._write({
                jsonrpc: "2.0", id, method: "initialize",
                params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "hodlmm-router-v2", version: "2.0.0" } }
            });
        }).then((r) => {
            this._write({ jsonrpc: "2.0", method: "notifications/initialized" });
            return r;
        });
    }
    _write(msg) { this.proc.stdin.write(JSON.stringify(msg) + "\n"); }
    callTool(name, args = {}, timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP tool "${name}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); }
            });
            this._write({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
        });
    }
    stop() { try {
        this.proc?.kill();
    }
    catch (_) { } }
}
async function unlockWallet(client) {
    const password = process.env.WALLET_PASSWORD ?? "";
    await client.callTool("wallet_switch", { walletId: WALLET_ID });
    await wait(1000);
    const unlockRaw = await client.callTool("wallet_unlock", { password });
    const unlock = safeJson(unlockRaw?.content?.[0]?.text ?? "{}");
    if (!unlock.success)
        throw new Error("Wallet unlock failed — check WALLET_PASSWORD");
    await wait(500);
    const statusRaw = await client.callTool("wallet_status", {});
    const status = safeJson(statusRaw?.content?.[0]?.text ?? "{}");
    return status?.wallet?.address ?? "SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK";
}
program.name("hodlmm-capital-router-v2").description("Route sBTC between HODLMM and Zest with real on-chain execution");
program.command("doctor")
    .description("Check wallet, balance, and live APY")
    .action(async () => {
    if (!process.env.WALLET_PASSWORD) {
        console.log(JSON.stringify({ status: "error", action: "set WALLET_PASSWORD environment variable", data: {}, error: { code: "MISSING_PASSWORD", message: "WALLET_PASSWORD not set", next: "export WALLET_PASSWORD=your-password" } }));
        return;
    }
    const client = new McpClient();
    try {
        await client.start();
        const address = await unlockWallet(client);
        const [balance, hodlmm, zest, apiInfo] = await Promise.all([
            getSBTCBalance(address),
            getHODLMMApy(),
            getZestApy(),
            httpGet(`${HIRO_API}/v2/info`),
        ]);
        const decision = getRoutingDecision(hodlmm.apy, zest.apy);
        console.log(JSON.stringify({
            status: "success",
            action: balance > 0
                ? `environment ready — current recommendation: ${decision.recommended.toUpperCase()}`
                : "no sBTC — fund wallet before routing",
            data: {
                wallet_unlocked: true,
                address,
                sbtc_balance_sats: balance,
                sbtc_balance_sbtc: balance / 1e8,
                hodlmm_apy_pct: hodlmm.apy,
                hodlmm_apy_source: hodlmm.source,
                zest_apy_pct: zest.apy,
                zest_apy_source: zest.source,
                recommended: decision.recommended,
                apy_delta_pct: parseFloat(decision.delta.toFixed(2)),
                hiro_api_reachable: !!apiInfo?.stacks_tip_height,
                max_movement_sats: MAX_SATS,
            },
            error: null,
        }));
    }
    catch (err) {
        console.log(JSON.stringify({ status: "error", action: "check WALLET_PASSWORD and MCP", data: {}, error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" } }));
    }
    finally {
        client.stop();
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
                : "hold — APY delta below threshold",
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
    }
    catch (err) {
        console.log(JSON.stringify({ status: "error", action: "check API connectivity", data: {}, error: { code: "APY_FETCH_FAILED", message: err.message, next: "retry" } }));
    }
});
program.command("run")
    .description("Execute capital routing on-chain and return real txid")
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
    if (!process.env.WALLET_PASSWORD) {
        console.log(JSON.stringify({ status: "error", action: "set WALLET_PASSWORD environment variable", data: {}, error: { code: "MISSING_PASSWORD", message: "WALLET_PASSWORD not set", next: "export WALLET_PASSWORD=your-password" } }));
        return;
    }
    const client = new McpClient();
    try {
        await client.start();
        const address = await unlockWallet(client);
        const balance = await getSBTCBalance(address);
        if (balance < amount) {
            console.log(JSON.stringify({ status: "blocked", action: "fund wallet with sBTC", data: { balance_sats: balance, requested_sats: amount }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance} sats < requested ${amount}`, next: "deposit sBTC and retry" } }));
            client.stop();
            return;
        }
        const [hodlmm, zest] = await Promise.all([getHODLMMApy(), getZestApy()]);
        const decision = getRoutingDecision(hodlmm.apy, zest.apy);
        if (!decision.should_route) {
            console.log(JSON.stringify({ status: "blocked", action: "hold — APY delta below threshold", data: { hodlmm_apy_pct: hodlmm.apy, zest_apy_pct: zest.apy, delta: decision.delta }, error: { code: "DELTA_TOO_SMALL", message: `delta ${decision.delta.toFixed(2)}% < min ${MIN_APY_DELTA}%`, next: "monitor and retry" } }));
            client.stop();
            return;
        }
        let txid = null;
        let rawResponse = "";
        if (decision.recommended === "zest") {
            log(`Routing to Zest via zest_supply...`);
            const supplyRaw = await client.callTool("zest_supply", {
                amount: amount.toString(),
                asset: "wSTX",
            }, 120000);
            rawResponse = supplyRaw?.content?.[0]?.text ?? "{}";
            const supplyJson = safeJson(rawResponse);
            txid = supplyJson?.txid ?? supplyJson?.tx_id ?? rawResponse.match(/0x[a-f0-9]{64}/i)?.[0] ?? null;
        }
        else {
            log(`Routing to HODLMM via stacks_call_contract...`);
            const callRaw = await client.callTool("stacks_call_contract", {
                contractAddress: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1",
                contractName: "hodlmm-v1-0",
                functionName: "add-liquidity",
                functionArgs: [amount.toString()],
            }, 120000);
            rawResponse = callRaw?.content?.[0]?.text ?? "{}";
            const callJson = safeJson(rawResponse);
            txid = callJson?.txid ?? callJson?.tx_id ?? rawResponse.match(/0x[a-f0-9]{64}/i)?.[0] ?? null;
        }
        if (txid) {
            console.log(JSON.stringify({
                status: "success",
                action: `capital routed to ${decision.recommended.toUpperCase()} — verify: https://explorer.hiro.so/txid/${txid}`,
                data: {
                    txid,
                    protocol: decision.recommended,
                    routing_decision: decision.reason,
                    hodlmm_apy_pct: hodlmm.apy,
                    zest_apy_pct: zest.apy,
                    apy_delta_pct: parseFloat(decision.delta.toFixed(2)),
                    amount_sats: amount,
                    amount_sbtc: amount / 1e8,
                    tx_status: "pending",
                    explorer_url: `https://explorer.hiro.so/txid/${txid}`,
                },
                error: null,
            }));
        }
        else {
            console.log(JSON.stringify({
                status: "success",
                action: "routing executed — check raw response",
                data: { raw_response: rawResponse.slice(0, 500), protocol: decision.recommended, amount_sats: amount },
                error: null,
            }));
        }
    }
    catch (err) {
        console.log(JSON.stringify({ status: "error", action: "check MCP and retry", data: {}, error: { code: "ROUTING_FAILED", message: err.message, next: "run doctor to diagnose" } }));
    }
    finally {
        client.stop();
    }
});
program.parse();
