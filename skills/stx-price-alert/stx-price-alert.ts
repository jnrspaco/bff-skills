import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";

const program = new Command();
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd";
const HISTORY_FILE = "stx-alert-history.json";

async function fetchSTXPrice(): Promise<number> {
  const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status} ${res.statusText}`);
  const json: any = await res.json();
  const price = json?.blockstack?.usd;
  if (typeof price !== "number") throw new Error("Unexpected API response shape");
  return price;
}

function loadHistory(): any[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try { return JSON.parse(readFileSync(HISTORY_FILE, "utf-8")); }
  catch { return []; }
}

function saveHistory(history: any[]) {
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

program.name("stx-price-alert").description("Fetches STX price and signals alerts on threshold crossings");

program.command("doctor").description("Check API connectivity").action(async () => {
  try {
    const price = await fetchSTXPrice();
    console.log(JSON.stringify({ status: "success", action: "environment ready — proceed to run", data: { api_reachable: true, sample_price_usd: price }, error: null }));
  } catch (err: any) {
    console.log(JSON.stringify({ status: "error", action: "check internet connection or CoinGecko API status", data: {}, error: { code: "API_UNREACHABLE", message: err.message, next: "retry after 30s" } }));
  }
});

program.command("status").description("Return current STX/USD price").action(async () => {
  try {
    const price = await fetchSTXPrice();
    console.log(JSON.stringify({ status: "success", action: "price retrieved — use run with a threshold to trigger alerts", data: { price_usd: price }, error: null }));
  } catch (err: any) {
    console.log(JSON.stringify({ status: "error", action: "check API connectivity", data: {}, error: { code: "FETCH_FAILED", message: err.message, next: "run doctor to diagnose" } }));
  }
});

program.command("run").description("Fetch price and evaluate threshold")
  .requiredOption("--threshold <number>", "Price threshold in USD")
  .requiredOption("--direction <above|below>", "Alert when price goes above or below threshold")
  .action(async (opts) => {
    const threshold = parseFloat(opts.threshold);
    const direction = opts.direction as "above" | "below";
    if (isNaN(threshold)) {
      console.log(JSON.stringify({ status: "error", action: "provide a valid numeric threshold", data: {}, error: { code: "INVALID_THRESHOLD", message: "threshold must be a number", next: "retry with --threshold 0.25" } }));
      return;
    }
    if (direction !== "above" && direction !== "below") {
      console.log(JSON.stringify({ status: "error", action: "provide direction as above or below", data: {}, error: { code: "INVALID_DIRECTION", message: "direction must be above or below", next: "retry with --direction above" } }));
      return;
    }
    try {
      const price = await fetchSTXPrice();
      const alert_triggered = direction === "above" ? price > threshold : price < threshold;
      const history = loadHistory();
      history.push({ timestamp: new Date().toISOString(), price_usd: price, threshold, direction, alert_triggered });
      saveHistory(history);
      const last_alert = history.filter((h) => h.alert_triggered).pop();
      console.log(JSON.stringify({
        status: "success",
        action: alert_triggered ? `ALERT: STX price ${direction === "above" ? "exceeded" : "dropped below"} $${threshold}` : "no alert — price within normal range, continue monitoring",
        data: { price_usd: price, threshold, direction, alert_triggered, history_count: history.length, last_alert_at: last_alert ? last_alert.timestamp : null },
        error: null,
      }));
    } catch (err: any) {
      console.log(JSON.stringify({ status: "error", action: "run doctor to diagnose connectivity", data: {}, error: { code: "FETCH_FAILED", message: err.message, next: "retry after 30s" } }));
    }
  });

program.parse();