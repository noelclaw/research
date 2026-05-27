import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

export const NEWS_TOOLS: Tool[] = [];
export async function handleNewsTool(_name: string, _args: unknown): Promise<ToolResult | null> { return null; }
