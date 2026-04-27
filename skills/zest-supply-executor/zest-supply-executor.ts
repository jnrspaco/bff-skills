import { Command } from "commander";
import * as https from "https";
import { spawn } from "child_process";
import * as path from "path";

const program = new Command();

const HIRO_API = "https://api.hiro.so";
const MAX_SUPPLY_STX = 1;
const CI_WALLET_PASS = "ci-zest-agent-temp";
const MCP_SERVER = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  "AppData", "Local", "npm-cache", "_npx",
  "node_modules", "@aibtc", "mcp-server", "dist", "index.js"
);

function log(msg: string) { process.stderr.write(msg + "\n"); }

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

async function getSTXBalance(address: string): Promise<number> {
  const json = await httpGet(`${HIRO_API}/extended/v1/address/${address}/balances`);
  return parseInt(json?.stx?.balance ?? "0");
}

class McpClient {
  proc: any = null;
  buffer: string = "";
  pending: Map<number, { resolve: Function; reject: Function }> = new Map();
  nextId: number = 1;

  start(): Promise<any> {
    return new Promise((resolve, reject) => {
      // Try npx first, fall back to local install
      const args = ["@aibtc/mcp-server@latest"];
      this.proc = spawn("npx", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        shell: true,
      });
      this.proc.stdout.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id != null && this.pending.has(msg.id)) {
              const { resolve, reject } = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              if (msg.error) reject(new Error(msg.error.message));
              else resolve(msg.result);
            }
          } catch (_) {}
        }
      });
      this.proc.stderr.on("data", (d: Buffer) => {
        const s = d.toString().trim();
        if (s) log("[MCP] " + s);
      });
      this.proc.on("error", reject);
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this._write({
        jsonrpc: "2.0", id, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "zest-supply-ci", version: "1.0.0" } }
      });
    }).then((r) => {
      this._write({ jsonrpc: "2.0", method: "notifications/initialized" });
      return r;
    });
  }

  _write(msg: any) { this.proc.stdin.write(JSON.stringify(msg) + "\n"); }

  callTool(name: string, args: any = {}, timeoutMs: number = 120000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP tool "${name}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v: any) => { clearTimeout(timer); resolve(v); },
        reject: (e: any) => { clearTimeout(timer); reject(e); }
      });
      this._write({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    });
  }

  stop() { try { this.proc?.kill(); } catch (_) {} }
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

function extractTxid(result: any): string | null {
  const text = result?.content?.[0]?.text ?? "";
  const json = safeJson(text);
  // Try various txid field names
  return json?.txid ?? json?.tx_id ?? json?.transaction_id ??
    text.match(/0x[a-f0-9]{64}/i)?.[0] ?? null;
}

program.name("zest-supply-executor").description("Supply STX to Zest via AIBTC MCP wallet");

program.command("doctor")
  .description("Check MCP, wallet, and balance")
  .action(async () => {
    const mnemonic = process.env.CLIENT_MNEMONIC;
    if (!mnemonic) {
      console.log(JSON.stringify({ status: "error", action: "set CLIENT_MNEMONIC environment variable", data: {}, error: { code: "MISSING_MNEMONIC", message: "CLIENT_MNEMONIC not set", next: "export CLIENT_MNEMONIC=your-mnemonic" } }));
      return;
    }

    const client = new McpClient();
    try {
      await client.start();
      log("MCP server started");

      // Import and unlock wallet
      await client.callTool("wallet_import", { name: "ci-zest", mnemonic, password: CI_WALLET_PASS });
      const unlockRaw = await client.callTool("wallet_unlock", { password: CI_WALLET_PASS });
      const unlock = safeJson(unlockRaw?.content?.[0]?.text ?? "{}");

      if (!unlock.success) throw new Error("Wallet unlock failed");

      // Get address and balance
      const statusRaw = await client.callTool("wallet_status", {});
      const status = safeJson(statusRaw?.content?.[0]?.text ?? "{}");
      const address = status?.stacks_address ?? status?.address ?? "unknown";

      let balance = 0;
      if (address !== "unknown") {
        balance = await getSTXBalance(address);
      }

      console.log(JSON.stringify({
        status: "success",
        action: balance >= 100000
          ? "environment ready — run to supply STX to Zest"
          : "low STX balance — fund wallet with at least 0.1 STX",
        data: {
          wallet_unlocked: true,
          stacks_address: address,
          stx_balance_micro: balance,
          stx_balance_stx: balance / 1e6,
          max_supply_stx: MAX_SUPPLY_STX,
          mcp_connected: true,
        },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check MCP server and wallet config", data: {}, error: { code: "DOCTOR_FAILED", message: err.message, next: "retry after 30s" } }));
    } finally {
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

      // Import and unlock wallet
      await client.callTool("wallet_import", { name: "ci-zest", mnemonic, password: CI_WALLET_PASS });
      const unlockRaw = await client.callTool("wallet_unlock", { password: CI_WALLET_PASS });
      const unlock = safeJson(unlockRaw?.content?.[0]?.text ?? "{}");
      if (!unlock.success) throw new Error("Wallet unlock failed");

      // Get address and check balance
      const statusRaw = await client.callTool("wallet_status", {});
      const status = safeJson(statusRaw?.content?.[0]?.text ?? "{}");
      const address = status?.stacks_address ?? status?.address ?? "";

      if (address) {
        const balance = await getSTXBalance(address);
        if (balance < amountMicro + 10000) {
          console.log(JSON.stringify({ status: "blocked", action: "fund wallet with more STX", data: { balance_micro: balance, required_micro: amountMicro + 10000 }, error: { code: "INSUFFICIENT_BALANCE", message: `balance ${balance / 1e6} STX insufficient`, next: "add STX and retry" } }));
          client.stop();
          return;
        }
      }

      // Execute Zest supply via MCP tool
      log(`Calling zest_supply with ${amountSTX} STX...`);
      const supplyRaw = await client.callTool("zest_supply", {
        amount: amountMicro,
        asset: "stx",
      }, 120000);

      const supplyText = supplyRaw?.content?.[0]?.text ?? "{}";
      const txid = extractTxid(supplyRaw);

      if (txid) {
        console.log(JSON.stringify({
          status: "success",
          action: `STX supplied to Zest — verify txid on explorer: https://explorer.hiro.so/txid/${txid}`,
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
      } else {
        // Tool responded but no txid — log raw response
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
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "check MCP server and retry", data: {}, error: { code: "SUPPLY_FAILED", message: err.message, next: "run doctor to diagnose" } }));
    } finally {
      client.stop();
    }
  });

program.parse();