import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const MARKET_TOOLS: Tool[] = [
  {
    name: "get_market_data",
    description: "Get live crypto market data: top 20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL. Results are also sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string", description: "Optional: specific token to focus on, e.g. 'BTC', 'ETH'" } },
      required: [],
    },
  },
  {
    name: "get_token_data",
    description: "Get market data for specific tokens. Returns price, 24h change, market cap, and volume. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "Describe which tokens to look up" } },
      required: ["question"],
    },
  },
];

const GetMarketDataSchema = z.object({ token: z.string().optional() });
const GetTokenDataSchema = z.object({ question: z.string().min(1) });

export async function handleMarketTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_market_data": {
      const parsed = GetMarketDataSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: token ${parsed.error.issues[0].message}` }], isError: true };
      const { token } = parsed.data;
      const symbols = token ? [token.toUpperCase()] : ["BTC", "ETH", "SOL"];
      const results = await Promise.all(
        symbols.map((s) => callConvex(`/swarm/memory/read?key=market/${s}`, "GET", undefined, "get_market_data"))
      );
      const lines: string[] = [`**Market Data** — ${new Date().toISOString()}`, ""];
      for (const d of results) {
        if (d.error) continue;
        const price = d.price_usd?.toLocaleString("en-US", { style: "currency", currency: "USD" });
        const ch = d.change_24h_pct?.toFixed(2);
        const sign = (d.change_24h_pct ?? 0) >= 0 ? "+" : "";
        lines.push(`• **${d.symbol}**: ${price} (${sign}${ch}%) — mcap $${(d.market_cap_usd / 1e9).toFixed(1)}B`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "get_token_data": {
      const parsed = GetTokenDataSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: question ${parsed.error.issues[0].message}` }], isError: true };
      const q = parsed.data.question.toUpperCase();
      const KNOWN = ["BTC","ETH","SOL","BNB","USDT","USDC","XRP","DOGE","ADA","AVAX","DOT","LINK","UNI","OP","ARB","HYPE","PEPE","SUI","APT","NEAR","INJ","TIA","MATIC","TON","SHIB","WIF","BONK"];
      const found = KNOWN.find((t) => new RegExp(`\\b${t}\\b`).test(q)) ?? "BTC";
      const data = await callConvex(`/swarm/memory/read?key=market/${found}`, "GET", undefined, "get_token_data");
      if (data.error) return { content: [{ type: "text", text: `Error fetching ${found}: ${data.error}` }], isError: true };
      const price = data.price_usd?.toLocaleString("en-US", { style: "currency", currency: "USD" });
      const ch = data.change_24h_pct?.toFixed(2);
      const sign = (data.change_24h_pct ?? 0) >= 0 ? "+" : "";
      const lines = [
        `**${data.symbol}** — ${data.fetchedAt}`,
        `Price: ${price} (${sign}${ch}% 24h)`,
        `Market Cap: $${(data.market_cap_usd / 1e9).toFixed(2)}B`,
        `Volume 24h: $${(data.volume_24h_usd / 1e9).toFixed(2)}B`,
        `Source: ${data.source}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
