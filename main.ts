/**
 * Streamable HTTP entry point (stateless). Run with `npm run serve`.
 *
 * Env vars:
 *   PORT           Port to listen on (default 3001)
 *   MCP_API_KEY    If set, requests must send header `x-api-key: <value>`
 *                  (configure as "API key" auth in Copilot Studio).
 *   ALLOWED_HOSTS  Comma-separated extra Host header values to accept.
 */
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

// Mirror console output to logs/server.log so later sessions can read it.
const logFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "logs", "server.log");
fs.mkdirSync(path.dirname(logFile), { recursive: true });
for (const level of ["log", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    const line = args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack : JSON.stringify(a))).join(" ");
    fs.appendFile(logFile, `${new Date().toISOString().slice(0, 10)} ${line}\n`, () => {});
  };
}

const port = parseInt(process.env.PORT ?? "3001", 10);
const apiKey = process.env.MCP_API_KEY;
const extraHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

// Bind to localhost only; the dev tunnel forwards to it. DNS rebinding
// protection: accept only localhost, dev tunnel hostnames, and ALLOWED_HOSTS.
const app = express();
app.use((req: Request, res: Response, next: NextFunction) => {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  const ok =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".devtunnels.ms") ||
    extraHosts.includes(host);
  if (!ok) {
    console.log(`${ts()} rejected Host header "${host}"`);
    res.status(403).send("Forbidden host");
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("MCP Apps Capability Probe. MCP endpoint: /mcp");
});

// Log every JSON-RPC call so we can see exactly what the host sends.
app.use("/mcp", (req: Request, _res: Response, next: NextFunction) => {
  const msgs = Array.isArray(req.body) ? req.body : req.body ? [req.body] : [];
  const ua = req.headers["user-agent"] ?? "-";
  if (msgs.length === 0) {
    console.log(`${ts()} ${req.method} /mcp (no body) ua="${ua}"`);
  }
  for (const m of msgs) {
    const detail =
      m.method === "tools/call"
        ? ` tool=${m.params?.name} args=${truncate(JSON.stringify(m.params?.arguments ?? {}))}`
        : m.method === "resources/read"
          ? ` uri=${m.params?.uri}`
          : m.method === "initialize"
            ? ` client=${JSON.stringify(m.params?.clientInfo)} proto=${m.params?.protocolVersion} caps=${JSON.stringify(m.params?.capabilities)}`
            : "";
    console.log(`${ts()} ${req.method} ${m.method ?? "(response)"}${detail} ua="${ua}"`);
  }
  next();
});

if (apiKey) {
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-api-key"] !== apiKey) {
      console.log(`${ts()} rejected: bad or missing x-api-key`);
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });
}

app.all("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const httpServer = app.listen(port, "127.0.0.1", (err?: Error) => {
  if (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
  console.log(`MCP server listening on http://localhost:${port}/mcp`);
  console.log(apiKey ? "API key auth: ON (header x-api-key)" : "API key auth: OFF");
});

const shutdown = () => httpServer.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function ts() {
  return new Date().toISOString().slice(11, 23);
}
function truncate(s: string, n = 200) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
