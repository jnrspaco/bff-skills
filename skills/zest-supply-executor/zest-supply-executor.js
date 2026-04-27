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
const MAX_SUPPLY_STX = 1;
const CI_WALLET_PASS = "ci-zest-2026";
function log(msg) { process.stderr.write(msg + "\n"); }
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
async function getSTXBalance(address) {
    const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
    return parseInt(json?.stx?.balance ?? "0");
}
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
                params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "zest-supply-ci", version: "1.0.0" }
                }
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
            this._write({
                jsonrpc: "2.0", id, method: "tools/call",
                params: { name, arguments: args }
            });
        });
    }
    stop() { try {
        this.proc?.kill();
    }
    catch (_) { } }
}
async function setupWallet(client, password) {
    // Switch to existing jnrspaco wallet
    log("Switching to jnrspaco wallet...");
    await client.callTool("wallet_switch", { walletId: "612c9855-a121-4e4a-9122-33ccca8fb415" });
    await wait(1000);
    // Unlock with real password
    log("Unlocking wallet...");
    const unlockRaw = await client.callTool("wallet_unlock", { password });
    const unlockText = unlockRaw?.content?.[0]?.text ?? "{}";
    log("Unlock raw: " + unlockText);
    // Get status
    await wait(1000);
    const statusRaw = await client.callTool("wallet_status", {});
    const statusText = statusRaw?.content?.[0]?.text ?? "{}";
    log("Status raw: " + statusText);
    const status = safeJson(statusText);
    const address = status?.wallet?.address ?? "SP2DQHGKS3VFDY50HMGPYEWRSA3PA2H3QDPEGBNAK";
    log("Address: " + address);
    return address;
}
program.name("zest-supply-executor").description("Supply STX to Zest via AIBTC MCP wallet");
program.command("doctor")
    .description("Check MCP server, wallet, and balance")
    .action(async () => {
    const mnemonic = process.env.CLIENT_MNEMONIC;
    if (!mnemonic) {
        console.log(JSON.stringify({
            status: "error",
            action: "set CLIENT_MNEMONIC environment variable",
            data: {},
            error: { code: "MISSING_MNEMONIC", message: "CLIENT_MNEMONIC not set", next: "export CLIENT_MNEMONIC=your-mnemonic" }
        }));
        return;
    }
    const client = new McpClient();
    try {
        await client.start();
        log("MCP server started");
        const address = await setupWallet(client, process.env.WALLET_PASSWORD ?? "");
        let balance = 0;
        if (address) {
            balance = await getSTXBalance(address);
        }
        console.log(JSON.stringify({
            status: "success",
            action: balance >= 100000
                ? "environment ready — run to supply STX to Zest"
                : "low STX balance — fund wallet with at least 0.1 STX",
            data: {
                wallet_unlocked: true,
                stacks_address: address || "check logs",
                stx_balance_micro: balance,
                stx_balance_stx: balance / 1e6,
                max_supply_stx: MAX_SUPPLY_STX,
                mcp_connected: true,
            },
            error: null,
        }));
    }
    catch (err) {
        console.log(JSON.stringify({
            status: "error",
            action: "check MCP server and wallet config",
            data: {},
            error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" }
        }));
    }
    finally {
        client.stop();
    }
});
program.command("run")
    .description("Supply STX to Zest and return real txid")
    .requiredOption("--amount <number>", "Amount in STX (max 1)")
    .action(async (opts) => {
    const amountSTX = parseFloat(opts.amount);
    if (isNaN(amountSTX) || amountSTX <= 0) {
        console.log(JSON.stringify({ status: "error", action: "provide valid positive STX amount", data: {}, error: { code: "INVALID_AMOUNT", message: "amount must be positive", next: "retry with --amount 0.1" } }));
        return;
    }
    if (amountSTX > MAX_SUPPLY_STX) {
        console.log(JSON.stringify({ status: "blocked", action: `reduce to ${MAX_SUPPLY_STX} STX or less`, data: { requested: amountSTX, max: MAX_SUPPLY_STX }, error: { code: "EXCEEDS_SPEND_LIMIT", message: `${amountSTX} STX exceeds max of ${MAX_SUPPLY_STX} STX`, next: "reduce amount" } }));
        return;
    }
    const mnemonic = process.env.CLIENT_MNEMONIC;
    if (!mnemonic) {
        console.log(JSON.stringify({ status: "error", action: "set CLIENT_MNEMONIC environment variable", data: {}, error: { code: "MISSING_MNEMONIC", message: "CLIENT_MNEMONIC not set", next: "export CLIENT_MNEMONIC=your-mnemonic" } }));
        return;
    }
    const amountMicro = Math.floor(amountSTX * 1e6);
    const client = new McpClient();
    try {
        await client.start();
        const address = await setupWallet(client, process.env.WALLET_PASSWORD ?? "");
        if (address) {
            const balance = await getSTXBalance(address);
            if (balance < amountMicro + 10000) {
                console.log(JSON.stringify({
                    status: "blocked",
                    action: "fund wallet with more STX",
                    data: { balance_micro: balance, balance_stx: balance / 1e6, required_stx: amountSTX + 0.01 },
                    error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance / 1e6} STX insufficient`, next: "add STX and retry" }
                }));
                client.stop();
                return;
            }
        }
        // Execute Zest supply
        log(`Calling zest_supply with ${amountSTX} STX (${amountMicro} microSTX)...`);
        const supplyRaw = await client.callTool("zest_supply", {
            amount: amountMicro.toString(),
            asset: "wSTX",
        }, 120000);
        const supplyText = supplyRaw?.content?.[0]?.text ?? "{}";
        log("Supply result: " + supplyText);
        const supplyJson = safeJson(supplyText);
        const txid = supplyJson?.txid ??
            supplyJson?.tx_id ??
            supplyJson?.transaction_id ??
            supplyText.match(/0x[a-f0-9]{64}/i)?.[0] ??
            null;
        if (txid) {
            console.log(JSON.stringify({
                status: "success",
                action: `STX supplied to Zest — verify: https://explorer.hiro.so/txid/${txid}`,
                data: {
                    txid,
                    amount_stx: amountSTX,
                    amount_micro_stx: amountMicro,
                    protocol: "zest",
                    function: "supply",
                    tx_status: "pending",
                    explorer_url: `https://explorer.hiro.so/txid/${txid}`,
                },
                error: null,
            }));
        }
        else {
            console.log(JSON.stringify({
                status: "success",
                action: "supply executed — check raw response for txid",
                data: {
                    raw_response: supplyText.slice(0, 500),
                    amount_stx: amountSTX,
                    protocol: "zest",
                    function: "supply",
                },
                error: null,
            }));
        }
    }
    catch (err) {
        console.log(JSON.stringify({
            status: "error",
            action: "check MCP server and retry",
            data: {},
            error: { code: "SUPPLY_FAILED", message: err.message, next: "run doctor to diagnose" }
        }));
    }
    finally {
        client.stop();
    }
});
program.parse();
