/**
 * MCP Apps capability probe — runs in the host's sandboxed iframe.
 *
 * Each row in the table maps to a capability in the Copilot Studio
 * "Supported MCP apps capabilities" table. Non-intrusive probes run
 * automatically after the handshake; ones with visible side effects
 * (open link, message, display mode, download) run on button click.
 * Results are uploaded to the server via the app-only `submit_probe_report`
 * tool, so they land in ./reports on the dev machine.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import "./probe.css";
import { runSandboxProbes } from "./sandbox-probes";

const STATUS_URI = "probe://server/status";
const REQUEST_TIMEOUT_MS = 15_000;

type Status = "pending" | "waiting" | "pass" | "fail" | "unsupported" | "info";

interface Probe {
  id: string;
  label: string;
  docs: string;
  status: Status;
  detail: string;
  at?: string;
}

const PROBES: Probe[] = [
  ["handshake", "ui/initialize + initialized", "Supported"],
  ["tool-input", "Tool input notification", "Supported"],
  ["tool-result", "Tool result notification", "Supported"],
  ["tool-cancelled", "Tool cancellation notification", "Not supported"],
  ["tool-input-partial", "ui/notifications/tool-input-partial", "Not supported"],
  ["tools-call", "tools/call", "Supported"],
  ["tools-call-app-only", "tools/call (visibility: app)", "—"],
  ["resources-read", "resources/read", "Supported"],
  ["resources-list", "resources/list", "—"],
  ["open-link", "ui/open-link (https)", "Supported"],
  ["open-link-bad", "ui/open-link (non-http)", "Rejected"],
  ["message", "ui/message", "Supported"],
  ["model-context", "ui/update-model-context", "Supported"],
  ["size-changed", "ui/notifications/size-changed", "Supported"],
  ["display-mode", "Display modes", "Limited"],
  ["host-context", "Host context", "Partial"],
  ["host-context-changed", "host-context-changed notification", "—"],
  ["download", "ui/download-file", "Not supported"],
  ["logging", "notifications/message (logging)", "Not supported"],
  ["teardown", "ui/resource-teardown", "—"],
  // --- Sandbox checks: what the sandbox lets generated code do ---
  ["sb-host-csp", "Host-approved CSP (sandbox.csp)", "Declared"],
  ["sb-inline-script", "Dynamically inserted inline script", "Spec: allowed"],
  ["sb-eval", "eval / new Function", "Spec: blocked"],
  ["sb-cdnjs", "Script from cdnjs (declared)", "Declared"],
  ["sb-jsdelivr", "Script from jsdelivr (declared)", "Declared"],
  ["sb-unpkg", "Script from unpkg (declared)", "Declared"],
  ["sb-esm", "import() from esm.sh (declared)", "Declared"],
  ["sb-undeclared", "Script from undeclared domain (control)", "Should block"],
  ["sb-fetch-cdn", "fetch() esm.sh (connectDomains)", "Declared"],
  ["sb-fetch-tunnel", "fetch() our tunnel (connectDomains)", "Declared"],
  ["sb-nested", "Nested srcdoc iframe (websandbox)", "Unknown"],
  ["sb-nested-cdn", "CDN script inside nested iframe", "Unknown"],
].map(([id, label, docs]) => ({ id, label, docs, status: "pending", detail: "" }));

const probes = new Map(PROBES.map((p) => [p.id, p]));
const events: string[] = [];
let runId = Math.random().toString(36).slice(2, 8);
let publicOrigin: string | undefined;
let sizeNotifications = 0;
let lastSize = "";
let hostContextChanges = 0;
let codeWord = "";

// ---------------------------------------------------------------------------
// Rendering

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rowsEl = $("probe-rows");

function render() {
  rowsEl.replaceChildren(
    ...PROBES.map((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><code></code></td><td></td><td><span class="status ${p.status}"></span></td><td></td>`;
      tr.children[0].firstElementChild!.textContent = p.label;
      tr.children[1].textContent = p.docs;
      tr.children[2].firstElementChild!.textContent = statusText(p.status);
      tr.children[3].textContent = p.detail;
      return tr;
    }),
  );
  const counts = { pass: 0, fail: 0, unsupported: 0 };
  for (const p of PROBES) if (p.status in counts) counts[p.status as keyof typeof counts]++;
  $("summary").innerHTML =
    `<span class="status pass">✔ ${counts.pass}</span>` +
    `<span class="status fail">✖ ${counts.fail}</span>` +
    `<span class="status unsupported">⚠ ${counts.unsupported}</span>`;
}

function statusText(s: Status) {
  return {
    pending: "not run",
    waiting: "waiting…",
    pass: "✔ works",
    fail: "✖ failed",
    unsupported: "⚠ unsupported",
    info: "ℹ info",
  }[s];
}

function set(id: string, status: Status, detail: string) {
  const p = probes.get(id)!;
  p.status = status;
  p.detail = detail;
  p.at = new Date().toISOString();
  log(`${id}: ${status} — ${detail}`);
  render();
  scheduleReport();
}

function log(msg: string) {
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
  events.push(line);
  console.info("[probe]", msg);
  const li = document.createElement("li");
  li.textContent = line;
  $("log").append(li);
}

const short = (v: unknown, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a host request, classifying errors as fail / unsupported. */
async function attempt(id: string, fn: () => Promise<string>) {
  set(id, "waiting", "");
  try {
    set(id, "pass", await fn());
  } catch (e) {
    const msg = errText(e);
    const unsupported = /not (found|supported|implemented)|unknown method|-32601|timed? ?out/i.test(msg);
    set(id, unsupported ? "unsupported" : "fail", msg);
  }
}

// ---------------------------------------------------------------------------
// App + handlers (all registered before connect)

const app = new App(
  { name: "MCP Apps Capability Probe", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true },
);

// Count automatic size notifications by wrapping the instance method.
const originalSendSizeChanged = app.sendSizeChanged.bind(app);
app.sendSizeChanged = (params) => {
  sizeNotifications++;
  lastSize = `${params.width}×${params.height}`;
  // Update quietly (no log line): logging would grow the page and trigger
  // another size notification, i.e. a feedback loop.
  const p = probes.get("size-changed")!;
  p.status = "pass";
  p.detail = `sent ${sizeNotifications} notification(s), last ${lastSize}px — verify the frame actually resized`;
  render();
  scheduleReport();
  return originalSendSizeChanged(params);
};

app.ontoolinput = (params) => {
  set("tool-input", "pass", `arguments: ${short(params.arguments ?? {})}`);
  updateToolData("input", params);
};

app.ontoolinputpartial = (params) => {
  set("tool-input-partial", "pass", `partial args received: ${short(params.arguments ?? {})}`);
};

app.ontoolresult = (result) => {
  const sc = result.structuredContent as { runId?: string; label?: string; publicOrigin?: string } | undefined;
  if (sc?.runId) runId = sc.runId;
  if (sc?.publicOrigin) publicOrigin = sc.publicOrigin;
  $("subtitle").textContent = `Run ${runId}${sc?.label && sc.label !== "(none)" ? ` · ${sc.label}` : ""}`;
  set(
    "tool-result",
    "pass",
    `${result.isError ? "isError, " : ""}content: ${short(result.content?.[0] && "text" in result.content[0] ? result.content[0].text : result.content, 80)}; structured: ${short(result.structuredContent ?? null, 100)}`,
  );
  updateToolData("result", result);
};

app.ontoolcancelled = (params) => {
  set("tool-cancelled", "pass", `cancelled: ${params.reason ?? "(no reason)"}`);
};

app.onhostcontextchanged = (ctx) => {
  hostContextChanges++;
  applyContext(ctx);
  const keys = Object.keys(ctx);
  const detail = `${hostContextChanges} change(s); last keys: ${keys.join(", ")}`;
  if (keys.length === 1 && keys[0] === "containerDimensions") {
    // Resize echoes are frequent; update quietly to avoid a log/resize loop.
    const p = probes.get("host-context-changed")!;
    p.status = "pass";
    p.detail = detail;
    render();
  } else {
    set("host-context-changed", "pass", detail);
  }
  showHostContext();
  if (ctx.displayMode) {
    document.body.classList.toggle("fullscreen", ctx.displayMode === "fullscreen");
  }
};

app.onteardown = async () => {
  set("teardown", "pass", "host sent ui/resource-teardown");
  await flushReport();
  return {};
};

app.onerror = (e) => log(`app error: ${errText(e)}`);

const toolData: Record<string, unknown> = {};
function updateToolData(kind: string, data: unknown) {
  toolData[kind] = data;
  $("tool-data").textContent = JSON.stringify(toolData, null, 2);
}

function applyContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const s = ctx.safeAreaInsets;
    $("main").style.padding = `${s.top + 12}px ${s.right + 14}px ${s.bottom + 16}px ${s.left + 14}px`;
  }
}

function showHostContext() {
  $("host-context").textContent = JSON.stringify(app.getHostContext() ?? null, null, 2);
}

// ---------------------------------------------------------------------------
// Probes

const opts = () => ({ timeout: REQUEST_TIMEOUT_MS });

const actions: Record<string, () => Promise<void>> = {
  "tools-call": () =>
    attempt("tools-call", async () => {
      const r = await app.callServerTool(
        { name: "probe_echo", arguments: { message: `hello from app ${runId}` } },
        opts(),
      );
      if (r.isError) throw new Error(`isError: ${short(r.content)}`);
      return `probe_echo → ${short(r.structuredContent ?? r.content)}`;
    }),

  "tools-call-app-only": () =>
    attempt("tools-call-app-only", async () => {
      const nonce = Math.random().toString(36).slice(2, 7);
      const r = await app.callServerTool({ name: "probe_app_only", arguments: { nonce } }, opts());
      if (r.isError) throw new Error(`isError: ${short(r.content)}`);
      return `probe_app_only → ${short(r.structuredContent ?? r.content)}`;
    }),

  "resources-read": () =>
    attempt("resources-read", async () => {
      const r = await app.readServerResource({ uri: STATUS_URI }, opts());
      const c = r.contents?.[0];
      return `${STATUS_URI} → ${short(c && "text" in c ? c.text : c)}`;
    }),

  "resources-list": () =>
    attempt("resources-list", async () => {
      const r = await app.listServerResources(undefined, opts());
      if (r.resources.length === 0) {
        // The server exposes 2 resources, so an empty list means the host answered without forwarding.
        throw new Error("not supported: host returned an empty list (server exposes 2 resources)");
      }
      return `${r.resources.length} resource(s): ${r.resources.map((x) => x.uri).join(", ")}`;
    }),

  "open-link": () =>
    attempt("open-link", async () => {
      const url = "https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/mcp-apps";
      const r = await app.openLink({ url }, opts());
      if (r.isError) throw new Error("host returned isError (denied)");
      return `host accepted ${url}`;
    }),

  "open-link-bad": () =>
    attempt("open-link-bad", async () => {
      // Docs: only HTTP/HTTPS are handled. Expect a rejection.
      let rejected = false;
      let how = "";
      try {
        const r = await app.openLink({ url: "mailto:probe@example.com" }, opts());
        rejected = !!r.isError;
        how = rejected ? "isError: true" : "accepted";
      } catch (e) {
        rejected = true;
        how = `error: ${errText(e)}`;
      }
      if (!rejected) throw new Error("host accepted a mailto: link (docs say http/https only)");
      return `rejected as documented (${how})`;
    }),

  message: () =>
    attempt("message", async () => {
      const text = `MCP Apps probe (run ${runId}): this message was sent from inside the app via ui/message. Reply with "ui/message received".`;
      const r = await app.sendMessage({ role: "user", content: [{ type: "text", text }] }, opts());
      if (r.isError) throw new Error("host returned isError");
      return "host accepted message — check the conversation for it";
    }),

  "model-context": () =>
    attempt("model-context", async () => {
      codeWord = `${["amber", "cobalt", "jade", "scarlet", "violet"][Math.floor(Math.random() * 5)]}-${Math.floor(Math.random() * 900 + 100)}`;
      await app.updateModelContext(
        {
          content: [
            {
              type: "text",
              text: `The MCP Apps probe code word for run ${runId} is "${codeWord}".`,
            },
          ],
          structuredContent: { runId, codeWord, probesPassed: PROBES.filter((p) => p.status === "pass").length },
        },
        opts(),
      );
      return `accepted. Verify: ask the agent "What is the probe code word?" — expect "${codeWord}"`;
    }),

  resize: async () => {
    const compact = document.body.classList.toggle("compact");
    const h = document.documentElement.scrollHeight;
    const max = (app.getHostContext()?.containerDimensions as { maxHeight?: number } | undefined)?.maxHeight;
    log(`compact ${compact ? "on" : "off"}: content height ${h}px, host maxHeight ${max ?? "?"}px`);
  },

  fullscreen: () => requestMode("fullscreen"),
  inline: () => requestMode("inline"),
  pip: () => requestMode("pip"),

  download: () =>
    attempt("download", async () => {
      const r = await app.downloadFile(
        {
          contents: [
            {
              type: "resource",
              resource: {
                uri: `file:///probe-report-${runId}.json`,
                mimeType: "application/json",
                text: JSON.stringify(buildReport(), null, 2),
              },
            },
          ],
        },
        opts(),
      );
      if (r.isError) {
        const advertised = !!app.getHostCapabilities()?.downloadFile;
        throw new Error(`not supported: host returned isError (downloadFile ${advertised ? "advertised" : "not advertised"})`);
      }
      return "host accepted the download request";
    }),

  log: async () => {
    const advertised = !!app.getHostCapabilities()?.logging;
    try {
      await app.sendLog({ level: "info", logger: "probe", data: `probe log from run ${runId}` });
      set(
        "logging",
        advertised ? "pass" : "unsupported",
        `notification sent (no ack in protocol); host ${advertised ? "advertises" : "does NOT advertise"} logging capability`,
      );
    } catch (e) {
      set("logging", "fail", errText(e));
    }
  },
};

async function requestMode(mode: "inline" | "fullscreen" | "pip") {
  const available = app.getHostContext()?.availableDisplayModes;
  set("display-mode", "waiting", `requesting ${mode}…`);
  try {
    const r = await app.requestDisplayMode({ mode }, opts());
    document.body.classList.toggle("fullscreen", r.mode === "fullscreen");
    set(
      "display-mode",
      r.mode === mode ? "pass" : "info",
      `requested ${mode} → host set ${r.mode}; available: ${available?.join(", ") ?? "(not provided)"}`,
    );
  } catch (e) {
    set("display-mode", "fail", `${mode}: ${errText(e)}; available: ${available?.join(", ") ?? "(not provided)"}`);
  }
}

function probeHostContext() {
  const ctx = app.getHostContext();
  showHostContext();
  if (!ctx) {
    set("host-context", "fail", "no host context in initialize result");
    return;
  }
  const want = ["theme", "locale", "displayMode"] as const;
  const extra = [
    "availableDisplayModes",
    "timeZone",
    "platform",
    "containerDimensions",
    "styles",
    "userAgent",
    "deviceCapabilities",
    "safeAreaInsets",
    "toolInfo",
  ];
  const present = Object.keys(ctx);
  const missing = want.filter((k) => ctx[k] === undefined);
  const parts = [
    `theme=${ctx.theme ?? "?"}`,
    `locale=${ctx.locale ?? "?"}`,
    `displayMode=${ctx.displayMode ?? "?"}`,
    `also: ${extra.filter((k) => present.includes(k)).join(", ") || "none"}`,
  ];
  if (ctx.styles?.variables) parts.push(`${Object.keys(ctx.styles.variables).length} style vars`);
  set("host-context", missing.length ? "fail" : "pass", `${parts.join("; ")}${missing.length ? `; MISSING ${missing.join(", ")}` : ""}`);
}

function probeCapabilityAdvertisement() {
  const caps = app.getHostCapabilities();
  $("host-caps").textContent = JSON.stringify(caps ?? null, null, 2);
  // Passive rows: mark what the host advertises before the user clicks anything.
  const dl = probes.get("download")!;
  if (dl.status === "pending") {
    dl.detail = `host ${caps?.downloadFile ? "advertises" : "does not advertise"} downloadFile — click "Download file" to test`;
  }
  const lg = probes.get("logging")!;
  if (lg.status === "pending") {
    lg.detail = `host ${caps?.logging ? "advertises" : "does not advertise"} logging — click "Send log" to test`;
  }
  for (const id of ["tool-cancelled", "tool-input-partial", "host-context-changed", "teardown"]) {
    const p = probes.get(id)!;
    if (p.status === "pending") p.detail = "passive — not observed yet";
  }
  for (const id of ["open-link", "open-link-bad", "message", "model-context", "display-mode"]) {
    const p = probes.get(id)!;
    if (p.status === "pending") p.detail = "click the button above to test";
  }
  render();
}

// ---------------------------------------------------------------------------
// Report upload (app-only tool → ./reports on the server)

function buildReport() {
  return {
    runId,
    generatedAt: new Date().toISOString(),
    host: app.getHostVersion() ?? null,
    hostCapabilities: app.getHostCapabilities() ?? null,
    hostContext: app.getHostContext() ?? null,
    userAgent: navigator.userAgent,
    sizeNotifications,
    lastSize,
    codeWord: codeWord || null,
    toolData,
    probes: PROBES,
    events,
  };
}

let reportTimer: ReturnType<typeof setTimeout> | undefined;
let connected = false;
function scheduleReport() {
  if (!connected) return;
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => void flushReport(), 1500);
}

async function flushReport() {
  if (!connected) return;
  clearTimeout(reportTimer);
  try {
    await app.callServerTool(
      { name: "submit_probe_report", arguments: { report: JSON.stringify(buildReport()) } },
      opts(),
    );
  } catch (e) {
    console.warn("[probe] report upload failed:", errText(e));
  }
}

// ---------------------------------------------------------------------------
// Wire up buttons and connect

document.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await actions[btn.dataset.action!]();
    } finally {
      btn.disabled = false;
    }
  });
});

render();
log("connecting (ui/initialize)…");
const t0 = performance.now();

app
  .connect()
  .then(async () => {
    connected = true;
    const host = app.getHostVersion();
    set(
      "handshake",
      "pass",
      `host ${host?.name ?? "?"} ${host?.version ?? ""} in ${Math.round(performance.now() - t0)} ms`,
    );
    $("subtitle").textContent = `Run ${runId} · host ${host?.name ?? "unknown"}`;
    const ctx = app.getHostContext();
    if (ctx) applyContext(ctx);
    probeHostContext();
    probeCapabilityAdvertisement();
    // Non-intrusive probes run automatically.
    await actions["tools-call"]();
    await actions["tools-call-app-only"]();
    await actions["resources-read"]();
    await actions["resources-list"]();
    // Sandbox checks. Wait briefly for the tool result (carries publicOrigin).
    for (let i = 0; i < 25 && !publicOrigin; i++) await new Promise((r) => setTimeout(r, 200));
    await runSandboxProbes(set, app.getHostCapabilities()?.sandbox?.csp, publicOrigin);
    // Give tool input/result notifications a moment, then note if missing.
    setTimeout(() => {
      for (const id of ["tool-input", "tool-result"]) {
        const p = probes.get(id)!;
        if (p.status === "pending") set(id, "fail", "not received within 10 s of initialize");
      }
    }, 10_000);
  })
  .catch((e) => {
    set("handshake", "fail", errText(e));
    $("subtitle").textContent = "Handshake failed";
  });
