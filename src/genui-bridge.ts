/**
 * Host functions for generated UIs.
 *
 * Passed to CopilotKit's renderer through SandboxFunctionsContext; generated code
 * calls them as Websandbox.connection.remote.<name>(...), which returns a Promise.
 * The list must stay referentially stable: the renderer recreates its sandbox
 * whenever the functions change.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import type { SandboxFunction } from "./vendor/copilotkit-open-generative-ui.js";

let app: App | undefined;
let uiId = "sample";
let onDisplayMode: (mode: string) => void = () => {};

export function bindBridge(a: App, setMode: (mode: string) => void) {
  app = a;
  onDisplayMode = setMode;
}
export function setBridgeUiId(id: string) {
  uiId = id;
}

/** Sends a line to logs/server.log via the app-only report_ui_event tool. */
export function reportEvent(event: string, detail: string) {
  app?.callServerTool({ name: "report_ui_event", arguments: { uiId, event, detail: detail.slice(0, 1000) } }).catch(() => {});
}

const str = (v: unknown, max = 4000) => String(v ?? "").slice(0, max);

export const SANDBOX_FUNCTIONS: SandboxFunction[] = [
  {
    // Posts a message into the chat as the user; the agent answers it.
    name: "say",
    handler: async (text: unknown) => {
      const msg = `🪄 ${str(text)}`;
      reportEvent("bridge", `say ${msg}`);
      const r = await app!.sendMessage({ role: "user", content: [{ type: "text", text: msg }] });
      return { ok: !r.isError };
    },
  },
  {
    // Quietly updates what the agent knows. Replaces what was remembered before.
    name: "remember",
    handler: async (text: unknown, data?: unknown) => {
      const t = `State of generated UI ${uiId}: ${str(text)}`;
      reportEvent("bridge", `remember ${t} ${data ? JSON.stringify(data).slice(0, 300) : ""}`);
      await app!.updateModelContext({
        content: [{ type: "text", text: t }],
        ...(data && typeof data === "object" ? { structuredContent: data as Record<string, unknown> } : {}),
      });
      return { ok: true };
    },
  },
  {
    name: "openLink",
    handler: async (url: unknown) => {
      reportEvent("bridge", `openLink ${str(url, 300)}`);
      const r = await app!.openLink({ url: str(url, 2000) });
      return { ok: !r.isError };
    },
  },
  {
    // Toggles fullscreen unless a mode is given ("fullscreen" | "inline").
    name: "fullscreen",
    handler: async (mode?: unknown) => {
      const current = app!.getHostContext()?.displayMode;
      const want = mode === "inline" || mode === "fullscreen" ? mode : current === "fullscreen" ? "inline" : "fullscreen";
      reportEvent("bridge", `fullscreen → ${want}`);
      const r = await app!.requestDisplayMode({ mode: want });
      onDisplayMode(r.mode);
      return { mode: r.mode };
    },
  },
  {
    // Used by ERROR_HOOK below.
    name: "reportError",
    handler: async (message: unknown) => {
      reportEvent("error", str(message, 1000));
      return { ok: true };
    },
  },
];

/**
 * Prepended to generated jsFunctions: forwards runtime errors inside the sandbox
 * to the server log. jsFunctions runs before jsExpressions, so it catches
 * initialisation errors too.
 */
export const ERROR_HOOK = `(function(){
  function send(m){ try { Websandbox.connection.remote.reportError(String(m).slice(0,900)); } catch (_) {} }
  window.addEventListener('error', function(e){ send((e.message||'error') + (e.lineno ? ' @' + e.lineno + ':' + e.colno : '')); });
  window.addEventListener('unhandledrejection', function(e){ send('unhandled rejection: ' + (e.reason && (e.reason.message || e.reason))); });
})();
`;
