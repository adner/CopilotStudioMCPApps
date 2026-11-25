/**
 * Generated-UI app.
 * - create_ui / replay_ui → poll get_ui_progress, map the streamed arguments to
 *   CopilotKit content (genui-stream.ts) and render with CopilotKit's renderer.
 * - show_ui_sample → hand-written sample streamed locally (diagnostic).
 *
 * Demo mode (default): no ids or debug text; a themed "materializing" card until
 * CopilotKit's preview can start. Debug mode (GENUI_DEBUG=1 on the server, passed in
 * the tool result) adds a status line with phase, timing and size.
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import {
  OpenGenerativeUIActivityRenderer as GenUiRenderer,
  SandboxFunctionsContext,
  type OpenGenerativeUIContent as GenUiContent,
} from "./vendor/copilotkit-open-generative-ui.js";
import { StrictMode, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { SAMPLE } from "./genui-sample";
import { toContent } from "./genui-stream";
import { IMPORT_MAP_TAG } from "../genui/libraries";
import { bindBridge, ERROR_HOOK, reportEvent, SANDBOX_FUNCTIONS, setBridgeUiId } from "./genui-bridge";
import "./genui.css";

const DEFAULT_QUIPS = ["Conjuring your UI…", "Sketching ideas…", "Mixing the colors…"];

interface State {
  started: boolean;
  debug: boolean;
  /** Debug-only status text. */
  status: string;
  content?: GenUiContent;
  placeholders: string[];
  failed?: string;
  displayMode: string;
  canFullscreen: boolean;
}

// --- tiny store ---------------------------------------------------------------
let state: State = { started: false, debug: false, status: "connecting…", placeholders: [], displayMode: "inline", canFullscreen: false };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

// --- MCP App ------------------------------------------------------------------
const app = new App({ name: "Generated UI", version: "0.3.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
bindBridge(app, (mode) => update({ displayMode: mode }));

/**
 * Host additions to generated content: the import map (bare "three", "gsap", "d3",
 * "chart.js" imports) in <head>, and the sandbox error hook in front of jsFunctions.
 */
function withHost(c: GenUiContent): GenUiContent {
  let out = c;
  if (c.html?.length) {
    const html = c.html.join("");
    const injected = /<head[\s>]/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1>${IMPORT_MAP_TAG}`)
      : `<head>${IMPORT_MAP_TAG}</head>${html}`;
    out = { ...out, html: [injected] };
  }
  if (c.jsFunctions) out = { ...out, jsFunctions: ERROR_HOOK + c.jsFunctions };
  return out;
}

app.ontoolresult = (result) => {
  // Copilot Studio re-mounts earlier app frames and re-sends their tool result;
  // each mount starts fresh, and a finished UI re-renders from the saved output.
  if (state.started) return;
  const sc = result.structuredContent as
    | { uiId?: string; request?: string; sample?: boolean; replay?: boolean; basedOn?: string | null; debug?: boolean }
    | undefined;
  if (sc?.sample) {
    update({ started: true, debug: !!sc.debug, status: "sample" });
    void streamSample();
  } else if (sc?.uiId) {
    setBridgeUiId(sc.uiId);
    const kind = sc.replay ? "replay" : sc.basedOn ? `change of ${sc.basedOn}` : "new";
    update({ started: true, debug: !!sc.debug, status: `ui ${sc.uiId} · ${kind}` });
    void pollRender(sc.uiId, `ui ${sc.uiId} · ${kind}`);
  }
};
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.displayMode) update({ displayMode: ctx.displayMode });
};

/** Feeds the sample into the renderer the way a stream would. */
async function streamSample() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  update({ placeholders: SAMPLE.placeholderMessages });
  let c: GenUiContent = { initialHeight: SAMPLE.initialHeight, generating: true };
  update({ content: c });
  await wait(1500);
  c = { ...c, css: SAMPLE.css, cssComplete: true, html: [] };
  for (const chunk of SAMPLE.htmlChunks) {
    await wait(450);
    c = { ...c, html: [...(c.html ?? []), chunk] };
    update({ content: c });
  }
  await wait(400);
  c = { ...c, htmlComplete: true, jsFunctions: ERROR_HOOK + SAMPLE.jsFunctions, jsFunctionsComplete: true };
  update({ content: c });
  await wait(300);
  update({ content: { ...c, jsExpressions: SAMPLE.jsExpressions, jsExpressionsComplete: true, generating: false } });
}

const POLL_MS = 300;

/** Polls the generation and feeds CopilotKit's renderer as the arguments stream in. */
async function pollRender(uiId: string, label: string) {
  let cursor = 0;
  let raw = "";
  let polls = 0;
  for (;;) {
    let p: { status: string; chunk: string; cursor: number; elapsedMs: number; error: string | null };
    try {
      const r = await app.callServerTool({ name: "get_ui_progress", arguments: { uiId, cursor } });
      if (r.isError) throw new Error(JSON.stringify(r.content));
      p = r.structuredContent as typeof p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      update({ failed: "The UI couldn't be loaded. Please ask again.", status: `poll failed: ${msg}` });
      reportEvent("error", `poll failed: ${msg}`);
      return;
    }
    polls++;
    raw += p.chunk;
    cursor = p.cursor;
    const done = p.status === "done";
    const view = toContent(raw, done);
    update({
      content: withHost(view.content),
      placeholders: view.placeholders.length ? view.placeholders : state.placeholders,
      failed: p.status === "error" ? "This one fizzled. Please ask again." : undefined,
      status: `${label} · ${p.status === "error" ? `error: ${p.error}` : view.phase} · ${(p.elapsedMs / 1000).toFixed(1)}s · ${raw.length} chars`,
    });
    if (done || p.status === "error") {
      reportEvent(p.status, `${raw.length} chars, ${polls} polls, ${(p.elapsedMs / 1000).toFixed(1)}s`);
      return;
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

async function toggleFullscreen() {
  const mode = state.displayMode === "fullscreen" ? "inline" : "fullscreen";
  const r = await app.requestDisplayMode({ mode });
  update({ displayMode: r.mode });
}

// --- UI -----------------------------------------------------------------------

/** CopilotKit shows a preview once css is complete and some html exists. */
const hasPreview = (c?: GenUiContent) => !!c?.cssComplete && !!c.html?.join("").trim();

/** Rotates through the placeholder messages while waiting. */
function useQuip(quips: string[], active: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, [active]);
  const list = quips.length ? quips : DEFAULT_QUIPS;
  return list[i % list.length];
}

function Materializing({ quip, height }: { quip: string; height: number }) {
  return (
    <div className="materializing" style={{ height }}>
      <div className="orb" aria-hidden="true">
        <span className="ring r1" />
        <span className="ring r2" />
        <span className="core" />
      </div>
      <p className="quip" key={quip} role="status">
        {quip}
      </p>
      <p className="credit">Generative UI · rendered with CopilotKit</p>
      <div className="sparkles" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.43) % 3}s` }} />
        ))}
      </div>
    </div>
  );
}

function Root() {
  const s = useSyncExternalStore(subscribe, () => state);
  const generating = s.started && s.content?.generating !== false && !s.failed;
  const preview = hasPreview(s.content);
  const quip = useQuip(s.placeholders, generating);
  const fullscreen = s.displayMode === "fullscreen";
  const height = Math.min(s.content?.initialHeight ?? 360, 560);

  return (
    <main className={fullscreen ? "fullscreen" : ""}>
      <div className="stage">
        {s.failed ? (
          <div className="materializing failed" style={{ height: 160 }}>
            <p className="quip">{s.failed}</p>
          </div>
        ) : preview ? (
          <SandboxFunctionsContext.Provider value={SANDBOX_FUNCTIONS}>
            <GenUiRenderer content={s.content!} />
          </SandboxFunctionsContext.Provider>
        ) : (
          s.started && <Materializing quip={quip} height={height} />
        )}
        {preview && generating && (
          <div className="quip-pill" key={quip}>
            ✨ {quip}
          </div>
        )}
        {s.canFullscreen && !generating && !s.failed && (
          <button
            className="fs-fab"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? "⤡" : "⤢"}
          </button>
        )}
      </div>
      {s.debug && <p className="status">{s.status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  update({
    status: "connected, waiting for tool result…",
    displayMode: ctx?.displayMode ?? "inline",
    canFullscreen: !!ctx?.availableDisplayModes?.includes("fullscreen"),
  });
});
