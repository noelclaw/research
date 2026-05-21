import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const FRAMEWORK_TOOLS: Tool[] = [
  {
    name: "create_task_packet",
    description:
      "Define a scoped task for Noel Framework. Converts plain-English intent into a " +
      "structured Task Packet (territory, permissions, doNotDo constraints). " +
      "Sentinel validates before any agent action. " +
      "Example: 'buy ETH when it drops 5%, max $20, don't touch my USDC'.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What you want the agents to do, in plain English.",
        },
        name: {
          type: "string",
          description: "Optional short name for this task (max 5 words).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "list_task_packets",
    description: "List all your Task Packets — draft, active, completed, and blocked.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_playbooks",
    description:
      "List available Noel Framework playbooks — predefined multi-step agent workflows. " +
      "Includes 4 system playbooks (Daily Market Scan, DCA Setup, Portfolio Rebalance Check, " +
      "Swarm Intel Sweep) plus any you've created. Each step is Sentinel-gated.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "run_playbook",
    description:
      "Execute a Noel Framework playbook. Each step runs through Sentinel before the " +
      "appropriate swarm agent executes it (Scout → market-monitor, Tinker → workflow-executor, " +
      "Skeptic → risk-verifier, Memory → memory-manager). " +
      "Playbook halts immediately if Sentinel blocks a step.",
    inputSchema: {
      type: "object",
      properties: {
        playbook_name: {
          type: "string",
          description: "Exact name of the playbook. Use list_playbooks to see available ones.",
        },
        task_description: {
          type: "string",
          description: "Optional context passed as overrideParams to the playbook run.",
        },
      },
      required: ["playbook_name"],
    },
  },
  {
    name: "get_noel_ledger",
    description:
      "Get the Noel Framework audit trail — every Sentinel gate decision " +
      "(approved / blocked / warned), which checks ran, duration, and reason. " +
      "Full transparency on what agents are and aren't allowed to do.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_sentinel_rules",
    description:
      "Get Sentinel rules for each swarm agent and each playbook role — " +
      "territory, permissions, blocked actions, and value caps. " +
      "Shows exactly what each agent is and isn't allowed to do.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function handleFrameworkTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as Record<string, any>;

  switch (name) {
    // ── create_task_packet ──────────────────────────────────────────────────
    case "create_task_packet": {
      if (!a.task) {
        return { content: [{ type: "text", text: "task is required" }], isError: true };
      }
      const result = await callConvex("/framework/task", "POST", {
        naturalLanguage: a.task,
        name: a.name,
      }, "create_task_packet");

      if (result.error) {
        return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
      }

      const p = result.packet ?? {};
      const lines = [
        `✅ **Task Packet created**`,
        ``,
        `**Name:** ${p.name ?? "—"}`,
        `**Task:** ${p.task ?? a.task}`,
        `**Territory:** ${(p.territory ?? []).join(", ") || "—"}`,
        `**Permissions:** ${(p.permissions ?? []).join(", ") || "—"}`,
        `**Blocked:** ${(p.doNotDo ?? []).join(", ") || "none"}`,
        `**Max value:** ${p.maxValueUsd != null ? `$${p.maxValueUsd}` : "no limit"}`,
        ``,
        `ID: \`${result.id}\``,
        `Ready to run a playbook with this task scope.`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    // ── list_task_packets ───────────────────────────────────────────────────
    case "list_task_packets": {
      const result = await callConvex("/framework/tasks", "GET", undefined, "list_task_packets");
      const tasks: any[] = result.tasks ?? [];
      if (tasks.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No task packets yet. Use create_task_packet to define your first task.",
          }],
        };
      }
      const list = tasks
        .map((t: any) => `• **${t.name}** [${t.status}]\n  ${t.task}`)
        .join("\n\n");
      return { content: [{ type: "text", text: `**Your Task Packets**\n\n${list}` }] };
    }

    // ── list_playbooks ──────────────────────────────────────────────────────
    case "list_playbooks": {
      const result = await callConvex("/framework/playbooks", "GET", undefined, "list_playbooks");
      const pbs: any[] = result.playbooks ?? [];
      if (pbs.length === 0) {
        return { content: [{ type: "text", text: "No playbooks found." }] };
      }
      const list = pbs
        .map((p: any) => {
          const steps = (() => {
            try { return JSON.parse(p.steps).length; } catch { return "?"; }
          })();
          return `• **${p.name}**${p.isPublic ? " 🌐" : " 👤"} — ${steps} steps\n  ${p.description}\n  Used ${p.usageCount} times`;
        })
        .join("\n\n");
      return { content: [{ type: "text", text: `**Available Playbooks**\n\n${list}` }] };
    }

    // ── run_playbook ────────────────────────────────────────────────────────
    case "run_playbook": {
      if (!a.playbook_name) {
        return { content: [{ type: "text", text: "playbook_name is required" }], isError: true };
      }

      // Resolve playbook ID by name
      const pbList = await callConvex("/framework/playbooks", "GET", undefined, "run_playbook");
      const playbook = (pbList.playbooks ?? []).find(
        (p: any) => p.name.toLowerCase() === String(a.playbook_name).toLowerCase(),
      );
      if (!playbook) {
        return {
          content: [{
            type: "text",
            text: `Playbook "${a.playbook_name}" not found. Use list_playbooks to see available ones.`,
          }],
          isError: true,
        };
      }

      const result = await callConvex("/framework/playbook/run", "POST", {
        playbookId: playbook._id,
        overrideParams: a.task_description,
      }, "run_playbook");

      if (result.error) {
        return { content: [{ type: "text", text: `Run failed: ${result.error}` }], isError: true };
      }

      if (result.blocked) {
        return {
          content: [{
            type: "text",
            text: [
              `🛡️ **Sentinel blocked playbook at step ${result.step}**`,
              ``,
              `**Tool:** ${result.tool}`,
              `**Reason:** ${result.reason}`,
              ``,
              `This is a mechanical safety gate. The action violates the agent's permission boundary.`,
              `Completed steps before block: ${result.results?.length ?? 0}`,
            ].join("\n"),
          }],
        };
      }

      const steps: any[] = result.results ?? [];
      const succeeded = steps.filter(r => r.success).length;
      const stepLines = steps.map((r: any) =>
        `${r.success ? "✅" : "❌"} Step ${r.step} [${r.role}]: ${r.tool}${r.error ? ` — ${r.error}` : ""}`,
      );

      return {
        content: [{
          type: "text",
          text: [
            `✅ **Playbook "${a.playbook_name}" completed**`,
            ``,
            `${succeeded}/${steps.length} steps successful`,
            `Run ID: \`${result.runId}\``,
            ``,
            ...stepLines,
          ].join("\n"),
        }],
      };
    }

    // ── get_noel_ledger ─────────────────────────────────────────────────────
    case "get_noel_ledger": {
      const result = await callConvex("/swarm/ledger", "GET", undefined, "get_noel_ledger");
      const entries: any[] = result.entries ?? [];
      if (entries.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No ledger entries yet. Run a playbook to see Sentinel decisions.",
          }],
        };
      }
      const lines = entries.map((e: any) => {
        const icon = e.decision === "approved" ? "✅" : e.decision === "blocked" ? "🚫" : "⚠️";
        return `${icon} **${e.agentId}** → \`${e.action}\`\n  ${e.reason} (${e.durationMs}ms)`;
      });
      return {
        content: [{
          type: "text",
          text: `**Noel Ledger** (last ${entries.length} decisions)\n\n${lines.join("\n\n")}`,
        }],
      };
    }

    // ── get_sentinel_rules ──────────────────────────────────────────────────
    case "get_sentinel_rules": {
      const rules: Record<string, {
        territory: string[];
        permissions: string[];
        doNotDo: string[];
        maxValueUsd: number;
        note?: string;
      }> = {
        "market-monitor":   { territory: ["market_data", "price_check", "market"], permissions: ["read:market", "write:memory"], doNotDo: ["swap", "send", "transfer", "buy", "sell", "drain"], maxValueUsd: 0 },
        "sentiment-tracker":{ territory: ["sentiment", "news_analysis", "news"], permissions: ["read:market", "read:social", "write:memory"], doNotDo: ["swap", "send", "transfer", "buy", "sell"], maxValueUsd: 0 },
        "workflow-executor":{ territory: ["swap", "send", "automation"], permissions: ["read:market", "write:tx", "write:memory"], doNotDo: ["delete_wallet", "change_keys", "drain_wallet"], maxValueUsd: 500 },
        "memory-manager":   { territory: ["memory_compress", "memory_prune", "memory"], permissions: ["read:memory", "write:memory", "delete:memory"], doNotDo: ["swap", "send", "transfer"], maxValueUsd: 0 },
        "risk-verifier":    { territory: ["risk_check", "verify", "risk"], permissions: ["read:market", "read:memory"], doNotDo: ["swap", "send", "transfer", "modify_rules"], maxValueUsd: 0 },
        "playbook:scout":   { territory: ["get", "read", "list", "market", "signal", "portfolio", "insight", "research", "data", "recap", "whale", "score", "execution", "memory", "noel", "swarm", "smart"], permissions: ["read:market", "read:signals", "read:portfolio", "read:memory", "write:memory"], doNotDo: ["send_token", "deploy_token", "mint_nft", "claim_fees", "swap_tokens", "delete_automation", "stop_swarm"], maxValueUsd: 0, note: "Playbook read-only scout role" },
        "playbook:tinker":  { territory: ["create", "write", "start", "run", "swap", "send", "deploy", "mint", "claim", "automation", "memory", "swarm"], permissions: ["write:tx", "write:memory", "execute:automation", "swap:token", "deploy:token"], doNotDo: ["delete_wallet", "drain_wallet"], maxValueUsd: 100, note: "Playbook execution role" },
        "playbook:skeptic": { territory: ["get", "read", "ask", "analyze", "verify", "research", "check", "market", "signal", "execution", "score", "portfolio", "memory", "noel", "insight"], permissions: ["read:market", "read:signals", "read:portfolio", "read:memory"], doNotDo: ["send_token", "deploy_token", "mint_nft", "claim_fees", "swap_tokens", "delete"], maxValueUsd: 0, note: "Playbook analysis/verification role" },
        "playbook:memory":  { territory: ["memory", "write", "read", "compress", "prune", "summarize"], permissions: ["read:memory", "write:memory", "delete:memory"], doNotDo: ["send_token", "swap_tokens", "deploy_token", "mint_nft", "claim_fees"], maxValueUsd: 0, note: "Playbook memory management role" },
      };

      const sections = [
        "**Sentinel Rules**",
        "",
        "**Swarm Agents (DEFAULT_RULES)**",
        ...["market-monitor", "sentiment-tracker", "workflow-executor", "memory-manager", "risk-verifier"].map(agent => {
          const r = rules[agent];
          return `\n**${agent}**\n  Territory: ${r.territory.join(", ")}\n  Permissions: ${r.permissions.join(", ")}\n  Blocked: ${r.doNotDo.join(", ")}\n  Max value: $${r.maxValueUsd}`;
        }),
        "",
        "**Playbook Roles (DB rules — seeded at deploy)**",
        ...["playbook:scout", "playbook:tinker", "playbook:skeptic", "playbook:memory"].map(agent => {
          const r = rules[agent];
          return `\n**${agent}** _(${r.note})_\n  Territory: ${r.territory.slice(0, 6).join(", ")}…\n  Blocked: ${r.doNotDo.join(", ")}\n  Max value: $${r.maxValueUsd}`;
        }),
      ];

      return { content: [{ type: "text", text: sections.join("\n") }] };
    }

    default:
      return null;
  }
}
