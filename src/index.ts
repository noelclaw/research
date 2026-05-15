#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://valuable-fish-533.convex.site";

const PRIVATE_KEY_RESPONSE = {
  content: [{
    type: "text" as const,
    text: "I don't have access to your private key. Your wallet is secured by Noelclaw's encrypted vault. Only you can manage it at noelclaw.xyz",
  }],
};

function containsSensitiveRequest(args: unknown): boolean {
  const text = JSON.stringify(args ?? "").toLowerCase();
  return text.includes("private key") || text.includes("seed phrase") || text.includes("mnemonic") || text.includes("privatekey");
}

async function callConvex(path: string, method: string, body?: unknown): Promise<any> {
  const url = `${CONVEX_SITE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Noelclaw API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function notifyTelegram(userId: string, message: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    return await callConvex("/user/telegram/notify", "POST", { userId, message });
  } catch {
    return { sent: false, reason: "error" };
  }
}

const TELEGRAM_SETUP_HINT =
  "\n\n⚙️ No Telegram configured. To receive results directly in Telegram:\n" +
  "1. Create a bot via @BotFather on Telegram → get a bot token\n" +
  "2. Get your chat ID from @userinfobot\n" +
  "3. Run the `set_telegram` tool with your userId, bot token, and chat ID";

const TOOLS: Tool[] = [
  {
    name: "get_market_data",
    description:
      "Get live crypto market data: top 20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL. Results are also sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "Your user ID — results will be sent to your Telegram bot if configured",
        },
        token: {
          type: "string",
          description: "Optional: specific token to focus on, e.g. 'BTC', 'ETH'",
        },
      },
      required: [],
    },
  },
  {
    name: "get_token_data",
    description:
      "Get market data for specific tokens. Returns price, 24h change, market cap, and volume. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Describe which tokens to look up, e.g. 'show me data for ETH, SOL, and ARB'",
        },
        userId: {
          type: "string",
          description: "Your user ID — results will be sent to your Telegram bot if configured",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "get_latest_signal",
    description:
      "Get the latest BTC and/or ETH 1H trading signals from Noel. Includes entry price, take profit targets, stop loss, confidence score, and reasoning. Generated daily at 08:00 UTC.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token to get signal for: 'BTC', 'ETH', or omit for both",
        },
      },
      required: [],
    },
  },
  {
    name: "get_signal_history",
    description: "Get signal history with win/loss record and winrate statistics.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "BTC or ETH" },
        days: { type: "number", description: "Number of days to look back (default: 7)" },
      },
      required: [],
    },
  },
  {
    name: "get_whale_alerts",
    description: "Get recent whale movement and smart money activity alerts for BTC and ETH.",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "How many hours back to look (default: 24)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_daily_recap",
    description: "Get today's trading performance recap with winrate, PnL stats, and AI review.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today UTC)",
        },
      },
      required: [],
    },
  },
  {
    name: "research",
    description:
      "Research any crypto topic on demand — like Perplexity but for crypto. Ask about a token, protocol, market event, or trend. Noel searches the web and returns a structured analysis with overview, key findings, market impact, affected tokens, sentiment, and what to watch.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Topic to research, e.g. 'Ethereum ETF approval impact', 'What is happening with SOL?', 'Latest news on Base ecosystem'",
        },
        userId: {
          type: "string",
          description: "Your user ID — results will be sent to your Telegram bot if configured",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_portfolio",
    description:
      "Get your Base wallet address and full token portfolio including all token balances with USD values. Auto-creates a secure encrypted wallet on first use.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "swap_tokens",
    description:
      "Swap tokens on Base mainnet via 0x Permit2. Supported: ETH, USDC, USDT, DAI, WETH. Amount in smallest unit (wei for ETH/WETH, 6 decimals for USDC/USDT, 18 for DAI). Auto-creates wallet on first use.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: {
          type: "string",
          description: "Amount in smallest unit (e.g. '1000000' = 1 USDC, '1000000000000000000' = 1 ETH)",
        },
      },
      required: ["userId", "fromToken", "toToken", "amount"],
    },
  },
  {
    name: "send_token",
    description: "Send ETH or ERC-20 tokens (USDC, USDT, DAI, WETH) to any address on Base mainnet.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
        token: { type: "string", description: "Token to send: ETH, USDC, USDT, DAI, WETH" },
        toAddress: { type: "string", description: "Destination address (0x...)" },
        amount: { type: "string", description: "Amount in smallest unit" },
      },
      required: ["userId", "token", "toAddress", "amount"],
    },
  },
  {
    name: "ask_noel",
    description:
      "Ask Noel AI for DeFi analysis, trade ideas, market outlook, and crypto research. Noel has live market context. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Your question or request for Noel",
        },
        messages: {
          type: "array",
          description: "Previous conversation messages for context (optional)",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
        userId: {
          type: "string",
          description: "Your user ID — the answer will be sent to your Telegram bot if configured",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "set_telegram",
    description:
      "Configure your personal Telegram bot token and chat ID for Noel notifications — signals, whale alerts, research reports, and market data.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID to configure Telegram for",
        },
        telegramBotToken: {
          type: "string",
          description: "Telegram bot token (get from @BotFather)",
        },
        telegramChatId: {
          type: "string",
          description: "Telegram chat ID to send messages to",
        },
      },
      required: ["userId"],
    },
  },
];

const server = new Server(
  { name: "noelclaw", version: "1.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (containsSensitiveRequest(args)) return PRIVATE_KEY_RESPONSE;

  try {
    switch (name) {
      case "get_market_data": {
        const a = (args ?? {}) as { userId?: string; token?: string };
        const tokenQ = a.token ? `?token=${encodeURIComponent(a.token)}` : "";
        const data = await callConvex(`/mcp/market${tokenQ}`, "GET");
        const lines: string[] = [`**Market Data** — ${data.fetchedAt ?? new Date().toISOString()}`, ""];

        if (data.keyPrices) {
          lines.push("**Key Prices**");
          for (const [coin, info] of Object.entries(data.keyPrices as Record<string, any>)) {
            const price = info.usd?.toLocaleString("en-US", { style: "currency", currency: "USD" });
            const change = info.usd_24h_change?.toFixed(2);
            const sign = (info.usd_24h_change ?? 0) >= 0 ? "+" : "";
            lines.push(`• ${coin.toUpperCase()}: ${price} (${sign}${change}%)`);
          }
          lines.push("");
        }

        if (data.trending?.length) {
          lines.push("**Trending** (top 10)");
          for (const c of data.trending) {
            const ch = c.change24h?.toFixed(2);
            const sign = (c.change24h ?? 0) >= 0 ? "+" : "";
            lines.push(`• ${c.name} (${c.symbol?.toUpperCase()}) — rank #${c.rank ?? "?"} ${ch != null ? `${sign}${ch}%` : ""}`);
          }
          lines.push("");
        }

        if (data.top20?.length) {
          lines.push("**Top 20 by Market Cap**");
          lines.push("| # | Name | Price | 24h% |");
          lines.push("|---|------|-------|------|");
          for (const c of data.top20) {
            const price = c.price?.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
            const ch = c.change24h?.toFixed(2);
            const sign = (c.change24h ?? 0) >= 0 ? "+" : "";
            lines.push(`| ${c.rank} | ${c.name} (${c.symbol?.toUpperCase()}) | ${price} | ${sign}${ch}% |`);
          }
        }

        let text = lines.join("\n");
        if (a.userId) {
          const tgMsg = `📊 Market Data — ${data.fetchedAt ?? new Date().toISOString()}\n\n` +
            lines.filter((l) => !l.startsWith("|") && !l.startsWith("**Top")).join("\n").slice(0, 3800) +
            "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") text += TELEGRAM_SETUP_HINT;
          else if (notif.sent) text += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text }] };
      }

      case "get_token_data": {
        const a = args as { question: string; userId?: string };
        const data = await callConvex("/mcp/chat", "POST", {
          question: a.question,
          agentId: "coingecko-default",
          messages: [],
        });
        let answer = data.answer ?? JSON.stringify(data);
        if (a.userId) {
          const tgMsg = `🔍 Token Data:\n\n${answer}`.slice(0, 4000) + "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") answer += TELEGRAM_SETUP_HINT;
          else if (notif.sent) answer += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text: answer }] };
      }

      case "get_latest_signal": {
        const a = (args ?? {}) as { token?: string };
        const tokenParam = a.token?.toUpperCase() ?? "both";
        const data = await callConvex(
          `/signals/latest${tokenParam !== "BOTH" && tokenParam !== "both" ? `?token=${encodeURIComponent(tokenParam)}` : ""}`,
          "GET"
        );
        const lines: string[] = ["**Latest Noel Signals**", ""];
        for (const [tok, sig] of Object.entries(data as Record<string, any>)) {
          if (!sig) { lines.push(`**${tok}:** No signal available`, ""); continue; }
          const emoji = sig.signalType === "BUY" ? "🟢" : sig.signalType === "SELL" ? "🔴" : "🟡";
          lines.push(
            `${emoji} **${tok}/USD — ${sig.signalType}**`,
            `Entry: $${sig.entryPrice?.toLocaleString()} | TP1: $${sig.target1?.toLocaleString()}${sig.target2 ? ` | TP2: $${sig.target2?.toLocaleString()}` : ""} | SL: $${sig.stopLoss?.toLocaleString()}`,
            `Confidence: ${sig.confidence}% | Status: ${sig.status}`,
            `📝 ${sig.reasoning}`,
            "",
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_signal_history": {
        const a = (args ?? {}) as { token?: string; days?: number };
        const token = a.token?.toUpperCase() ?? "BTC";
        const days = a.days ?? 7;
        const [hist, wr] = await Promise.all([
          callConvex(`/signals/history?token=${token}&days=${days}`, "GET"),
          callConvex(`/signals/winrate?token=${token}&days=${days}`, "GET"),
        ]);
        const lines: string[] = [
          `**${token} Signal History — Last ${days} days**`,
          `Total: ${wr.total} resolved | Wins: ${wr.wins} | Losses: ${wr.losses}`,
          `Winrate: ${wr.winrate}% | Avg PnL: ${Number(wr.avgPnl) >= 0 ? "+" : ""}${wr.avgPnl}%`,
          `Best: +${wr.bestPnl}% | Worst: ${wr.worstPnl}%`,
          "",
          "**Recent Signals:**",
        ];
        for (const sig of (hist.signals ?? []).slice(0, 5)) {
          const emoji = sig.signalType === "BUY" ? "🟢" : sig.signalType === "SELL" ? "🔴" : "🟡";
          const outcome = sig.isWin === true ? "✅" : sig.isWin === false ? "❌" : "⏳";
          const pnl = sig.pnlPercent != null ? ` (${sig.pnlPercent >= 0 ? "+" : ""}${sig.pnlPercent.toFixed(2)}%)` : "";
          lines.push(`${emoji} ${sig.token} ${sig.signalType} @ $${sig.entryPrice?.toLocaleString()} — ${outcome} ${sig.status}${pnl}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_whale_alerts": {
        const a = (args ?? {}) as { hours?: number };
        const hours = a.hours ?? 24;
        const data = await callConvex(`/whales/latest?hours=${hours}`, "GET");
        if (!data.count) return { content: [{ type: "text", text: `No whale alerts in the last ${hours}h.` }] };
        const lines: string[] = [`**Whale Alerts — Last ${hours}h** (${data.count} total)`, ""];
        for (const alert of (data.alerts ?? []).slice(0, 5)) {
          const sig = alert.significance === "HIGH" ? "🔴" : "🟡";
          lines.push(
            `${sig} **${alert.token} | ${alert.direction}**`,
            `${alert.description}`,
            `💡 ${alert.implication}`,
            "",
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_daily_recap": {
        const a = (args ?? {}) as { date?: string };
        const date = a.date ?? new Date().toISOString().slice(0, 10);
        let data: any;
        try {
          data = await callConvex("/recap/today", "GET");
        } catch {
          return { content: [{ type: "text", text: `No recap available for ${date}` }] };
        }
        if (data.error) return { content: [{ type: "text", text: data.error }] };
        const lines: string[] = [
          `**Noel Daily Recap — ${data.date ?? date}**`,
          "",
          `₿ **BTC** — ${data.btcWins}W / ${data.btcLosses}L | Winrate: ${data.btcWinrate?.toFixed(1)}%`,
          `Best: +${data.btcBestPnl?.toFixed(2)}% | Worst: ${data.btcWorstPnl?.toFixed(2)}%`,
          "",
          `Ξ **ETH** — ${data.ethWins}W / ${data.ethLosses}L | Winrate: ${data.ethWinrate?.toFixed(1)}%`,
          `Best: +${data.ethBestPnl?.toFixed(2)}% | Worst: ${data.ethWorstPnl?.toFixed(2)}%`,
          "",
          `**Overall:** ${data.totalWinrate?.toFixed(1)}% winrate | Avg PnL: ${Number(data.avgPnl) >= 0 ? "+" : ""}${data.avgPnl?.toFixed(2)}% per signal`,
          "",
          `🤖 AI Review:`,
          data.aiReview ?? "No review",
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "research": {
        const a = args as { query: string; userId?: string };
        const data = await callConvex("/mcp/research", "POST", { query: a.query });
        if (!data.success) {
          return { content: [{ type: "text", text: `Research failed: ${data.error ?? "unknown error"}` }] };
        }
        let text = data.text ?? "No results returned.";
        if (a.userId) {
          const tgMsg = `🔍 Research: ${a.query}\n\n${text}`.slice(0, 4000) + "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") text += TELEGRAM_SETUP_HINT;
          else if (notif.sent) text += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text }] };
      }

      case "get_portfolio": {
        const a = args as { userId: string };
        const data = await callConvex(`/mcp/defi/portfolio?userId=${encodeURIComponent(a.userId)}`, "GET");
        if (data.error) return { content: [{ type: "text", text: `Portfolio error: ${data.error}` }], isError: true };
        const lines = [
          `**Portfolio — Base Mainnet**`,
          `Address: \`${data.address}\``,
          ``,
          `**Balances**`,
        ];
        for (const b of (data.balances ?? [])) {
          lines.push(`• ${b.token}: ${b.balance}${b.valueUsd ? ` (~$${Number(b.valueUsd).toFixed(2)})` : ""}`);
        }
        lines.push(``, `**Total Value:** ~$${Number(data.totalValueUsd ?? 0).toFixed(2)}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "swap_tokens": {
        const a = args as { userId: string; fromToken: string; toToken: string; amount: string };
        const data = await callConvex("/mcp/defi/swap", "POST", a);
        if (data.error) return { content: [{ type: "text", text: `Swap failed: ${data.error}` }], isError: true };
        return {
          content: [{
            type: "text",
            text: [
              `✅ Swap executed!`,
              `${a.fromToken.toUpperCase()} → ${a.toToken.toUpperCase()}`,
              `Sold: ${a.amount} (smallest unit) | Bought: ${data.buyAmount ?? "?"}`,
              `Tx Hash: \`${data.txHash}\``,
              `https://basescan.org/tx/${data.txHash}`,
            ].join("\n"),
          }],
        };
      }

      case "send_token": {
        const a = args as { userId: string; token: string; toAddress: string; amount: string };
        const data = await callConvex("/mcp/defi/send", "POST", a);
        if (data.error) return { content: [{ type: "text", text: `Send failed: ${data.error}` }], isError: true };
        return {
          content: [{
            type: "text",
            text: [
              `✅ Transfer sent!`,
              `${a.token.toUpperCase()} → \`${a.toAddress}\``,
              `Amount: ${a.amount} (smallest unit)`,
              `Tx Hash: \`${data.txHash}\``,
              `https://basescan.org/tx/${data.txHash}`,
            ].join("\n"),
          }],
        };
      }

      case "ask_noel": {
        const a = args as { question: string; messages?: unknown[]; userId?: string };
        const data = await callConvex("/mcp/chat", "POST", {
          question: a.question,
          agentId: "noel-default",
          messages: a.messages ?? [],
        });
        let answer = data.answer ?? JSON.stringify(data);
        if (a.userId) {
          const tgMsg = `🤖 Noel:\n\n${answer}`.slice(0, 4000) + "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") answer += TELEGRAM_SETUP_HINT;
          else if (notif.sent) answer += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text: answer }] };
      }

      case "set_telegram": {
        const a = args as { userId: string; telegramBotToken?: string; telegramChatId?: string };
        await callConvex("/user/telegram", "POST", {
          userId: a.userId,
          telegramBotToken: a.telegramBotToken,
          telegramChatId: a.telegramChatId,
        });
        return {
          content: [{
            type: "text",
            text: [
              `✅ Telegram config saved for user ${a.userId}.`,
              a.telegramBotToken ? `Bot token: set` : ``,
              a.telegramChatId ? `Chat ID: ${a.telegramChatId}` : ``,
              ``,
              `Noel will now send research reports, signals, and whale alerts to your Telegram bot.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
