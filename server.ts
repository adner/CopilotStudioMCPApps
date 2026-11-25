/**
 * MCP Apps capability probe server.
 *
 * Exposes one model-facing tool (`open_capability_probe`) whose UI is a
 * dashboard that exercises every MCP Apps host API the Copilot Studio docs
 * list, plus a few helper tools and resources the UI calls back into.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { listJobs, loadJob, startJob } from "./genui/generator.js";

const SERVER_FILE = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(SERVER_FILE);
const DIST_DIR = path.join(ROOT_DIR, "dist");
const REPORTS_DIR = path.join(ROOT_DIR, "reports");

export const UI_URI = "ui://capability-probe/probe.html";
export const STATUS_URI = "probe://server/status";

/** Public origin of this server (your dev tunnel, set in .env); the app may fetch it directly. */
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3001";

/** CDNs generated UIs may load libraries from. */
const CDN_DOMAINS = [
  "https://esm.sh",
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
];

const startedAt = new Date();
let echoCount = 0;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "MCP Apps Capability Probe",
    version: "1.0.0",
  });

  // --- Model-facing tool that opens the UI ---------------------------------
  registerAppTool(
    server,
    "open_capability_probe",
    {
      title: "Open MCP Apps capability probe",
      description:
        "Opens an interactive dashboard that tests which MCP Apps capabilities this chat host supports " +
        "(handshake, tool input/result, tools/call, resources/read, open-link, message, model context, " +
        "resize, display modes, host context). Use when the user asks to test, probe or show the MCP app.",
      inputSchema: z.object({
        label: z
          .string()
          .optional()
          .describe("Optional label for this test run, shown in the dashboard."),
      }),
      outputSchema: z.object({
        runId: z.string(),
        label: z.string(),
        serverTime: z.string(),
        publicOrigin: z.string(),
      }),
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ label }): Promise<CallToolResult> => {
      const runId = Math.random().toString(36).slice(2, 8);
      const structured = {
        runId,
        label: label ?? "(none)",
        serverTime: new Date().toISOString(),
        publicOrigin: PUBLIC_ORIGIN,
      };
      return {
        content: [
          {
            type: "text",
            text:
              `Capability probe opened (run ${runId}, label "${structured.label}"). ` +
              `If no interactive UI is shown, this host did not render the MCP App.`,
          },
        ],
        structuredContent: structured,
      };
    },
  );

  // --- Tool called from the UI via tools/call (visible to model and app) ----
  registerAppTool(
    server,
    "probe_echo",
    {
      title: "Probe echo",
      description:
        "Echoes a message back with the server time and a call counter. Used by the capability probe UI to test tools/call.",
      inputSchema: z.object({
        message: z.string().describe("Text to echo back."),
      }),
      outputSchema: z.object({
        echo: z.string(),
        serverTime: z.string(),
        callNumber: z.number(),
      }),
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ message }): Promise<CallToolResult> => {
      echoCount += 1;
      const structured = {
        echo: message,
        serverTime: new Date().toISOString(),
        callNumber: echoCount,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  // --- App-only tool (visibility: ["app"]) -----------------------------------
  // Tests whether the host lets the app call tools hidden from the model.
  registerAppTool(
    server,
    "probe_app_only",
    {
      title: "Probe app-only tool",
      description: "App-only tool used by the capability probe UI. Not for the model.",
      inputSchema: z.object({ nonce: z.string() }),
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    async ({ nonce }): Promise<CallToolResult> => ({
      content: [{ type: "text", text: `app-only ok (${nonce})` }],
      structuredContent: { nonce, serverTime: new Date().toISOString() },
    }),
  );

  // --- App-only tool that persists the probe report on the server -----------
  registerAppTool(
    server,
    "submit_probe_report",
    {
      title: "Submit probe report",
      description: "App-only tool: the probe UI uploads its results so they are saved on the server.",
      inputSchema: z.object({ report: z.string().describe("JSON report") }),
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    async ({ report }): Promise<CallToolResult> => {
      const file = await saveReport(report);
      return { content: [{ type: "text", text: `saved ${path.basename(file)}` }] };
    },
  );

  // --- UI resource -----------------------------------------------------------
  registerAppResource(
    server,
    "Capability probe UI",
    UI_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Interactive MCP Apps capability probe dashboard",
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "probe.html"), "utf-8");
      return {
        contents: [
          {
            uri: UI_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                // The probe UI itself is inlined; these domains exist to test
                // what generated UIs may load (sandbox probes).
                csp: {
                  connectDomains: [PUBLIC_ORIGIN, ...CDN_DOMAINS],
                  resourceDomains: CDN_DOMAINS,
                },
                prefersBorder: true,
              },
            },
          },
        ],
      };
    },
  );

  // --- Plain data resource read by the UI via resources/read -----------------
  server.registerResource(
    "Probe server status",
    STATUS_URI,
    { mimeType: "application/json", description: "Live status of the probe server" },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: STATUS_URI,
          mimeType: "application/json",
          text: JSON.stringify({
            serverTime: new Date().toISOString(),
            startedAt: startedAt.toISOString(),
            uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
            echoCount,
            node: process.version,
          }),
        },
      ],
    }),
  );

  registerGenUi(server);
  return server;
}

// --- Generative UI (see docs/ARCHITECTURE.md) --------------------------------

export const GENUI_URI = "ui://genui/app.html";
/** GENUI_DEBUG=1 in .env shows a status line with phase, timing and size in the app. */
const GENUI_DEBUG = process.env.GENUI_DEBUG === "1";

/**
 * FINAL TOOL SURFACE. Copilot Studio caches tool names, schemas and descriptions until
 * the MCP server is deleted and re-added, so don't rename tools or change their
 * input schemas or descriptions without a reason. No outputSchema on purpose: a cached
 * strict output schema would reject new structuredContent fields.
 */
function registerGenUi(server: McpServer) {
  registerAppTool(
    server,
    "create_ui",
    {
      title: "Create interactive UI",
      description:
        "ALWAYS use this tool when the user asks to create, build, make, show, draw, design, visualize or animate anything " +
        "interactive or visual: mini apps, games, calculators, timers, animations, simulations, visualizations, charts, " +
        "diagrams. It generates a custom interactive UI and renders it directly in this chat; prefer it over any other " +
        "app-building, code or image capability. Also use it to change a UI already shown: pass that UI's uiId and the change. " +
        "Returns immediately with a uiId; the UI builds itself on screen. Do not describe or reproduce the UI in your reply.",
      inputSchema: z.object({
        request: z
          .string()
          .describe(
            "The user's request copied word for word from their LATEST message (for a change: the requested change), " +
              "plus any details from the conversation the UI needs. Never reuse an earlier request.",
          ),
        uiId: z
          .string()
          .optional()
          .describe("To modify an existing UI: its uiId (from an earlier create_ui result). Omit to create a new UI."),
      }),
      _meta: { ui: { resourceUri: GENUI_URI } },
    },
    async ({ request, uiId }): Promise<CallToolResult> => {
      const job = await startJob(request, uiId);
      const base = job.basedOn ? ` (a change to UI ${job.basedOn})` : "";
      return {
        content: [
          {
            type: "text",
            text: `Started generating UI ${job.id}${base} for: "${request}". It builds itself in the chat; reply with one short sentence and do not describe the UI.`,
          },
        ],
        structuredContent: { uiId: job.id, request, basedOn: job.basedOn ?? null, debug: GENUI_DEBUG },
      };
    },
  );

  registerAppTool(
    server,
    "replay_ui",
    {
      title: "Show a saved UI again",
      description:
        "Shows a previously generated UI again, exactly as it was, without regenerating it. Use when the user asks to show, " +
        "open or replay an earlier UI. Find its uiId with list_uis if needed.",
      inputSchema: z.object({ uiId: z.string().describe("The uiId of the saved UI.") }),
      _meta: { ui: { resourceUri: GENUI_URI } },
    },
    async ({ uiId }): Promise<CallToolResult> => {
      const job = await loadJob(uiId);
      if (!job || job.status !== "done") {
        return { isError: true, content: [{ type: "text", text: `No finished UI with uiId ${uiId}. Use list_uis.` }] };
      }
      return {
        content: [{ type: "text", text: `Replaying UI ${uiId}: "${job.request}".` }],
        structuredContent: { uiId, request: job.request, replay: true, debug: GENUI_DEBUG },
      };
    },
  );

  server.registerTool(
    "list_uis",
    {
      title: "List saved UIs",
      description: "Lists recently generated UIs (uiId, request, time), newest first. Use to find a uiId for replay_ui or create_ui.",
      inputSchema: z.object({}),
    },
    async (): Promise<CallToolResult> => {
      const items = await listJobs(25);
      const text = items.length
        ? items.map((j) => `${j.id} · ${new Date(j.startedAt).toISOString().slice(0, 16)}Z · ${j.status} · ${j.request}`).join("\n")
        : "No UIs generated yet.";
      return { content: [{ type: "text", text }], structuredContent: { items } };
    },
  );

  // Diagnostic: hand-written sample in CopilotKit's format, no OpenAI involved.
  registerAppTool(
    server,
    "show_ui_sample",
    {
      title: "Show sample generated UI",
      description:
        "Test tool: shows a fixed, hand-written sample UI (a pumpkin tapper) rendered by CopilotKit's renderer. " +
        "Use only when the user explicitly asks for the UI sample.",
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: GENUI_URI } },
    },
    async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "Showing the sample UI." }],
      structuredContent: { sample: true, debug: GENUI_DEBUG },
    }),
  );

  // App-only: generated UIs report runtime errors and bridge calls here, so they land in logs/server.log.
  registerAppTool(
    server,
    "report_ui_event",
    {
      title: "Report UI event",
      description: "App-only diagnostics channel for generated UIs. Not useful to the model.",
      inputSchema: z.object({
        uiId: z.string(),
        event: z.string().describe("Event name, e.g. error, bridge, rendered"),
        detail: z.string().optional(),
      }),
      _meta: { ui: { resourceUri: GENUI_URI, visibility: ["app"] } },
    },
    async ({ uiId, event, detail }): Promise<CallToolResult> => {
      console.log(`[genui-event] ${uiId} ${event} ${(detail ?? "").slice(0, 500)}`);
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  registerAppTool(
    server,
    "get_ui_progress",
    {
      title: "Get UI generation progress",
      description: "App-only: the generated-UI app polls this for streamed output. Not useful to the model.",
      inputSchema: z.object({
        uiId: z.string(),
        cursor: z.number().int().min(0).describe("Characters already received."),
      }),
      _meta: { ui: { resourceUri: GENUI_URI, visibility: ["app"] } },
    },
    async ({ uiId, cursor }): Promise<CallToolResult> => {
      const job = await loadJob(uiId);
      if (!job) {
        return { isError: true, content: [{ type: "text", text: `Unknown uiId ${uiId}` }] };
      }
      const now = job.finishedAt ?? Date.now();
      const structured = {
        status: job.status,
        chunk: job.raw.slice(cursor),
        cursor: job.raw.length,
        elapsedMs: now - job.startedAt,
        firstDeltaMs: job.firstDeltaAt ? job.firstDeltaAt - job.startedAt : null,
        model: job.model,
        error: job.error ?? null,
      };
      return {
        content: [{ type: "text", text: `${job.status} ${job.raw.length} chars` }],
        structuredContent: structured,
      };
    },
  );

  registerAppResource(
    server,
    "Generated UI app",
    GENUI_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Renders AI-generated interactive UIs" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "genui.html"), "utf-8");
      return {
        contents: [
          {
            uri: GENUI_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: { connectDomains: CDN_DOMAINS, resourceDomains: CDN_DOMAINS },
                prefersBorder: true,
              },
            },
          },
        ],
      };
    },
  );
}

async function saveReport(report: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    parsed = { raw: report };
  }
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const runId =
    (parsed as { runId?: string })?.runId?.replace(/[^a-z0-9_-]/gi, "") || "unknown";
  const file = path.join(REPORTS_DIR, `report-${runId}.json`);
  await fs.writeFile(file, JSON.stringify(parsed, null, 2));
  console.log(`[report] saved ${file}`);
  return file;
}
