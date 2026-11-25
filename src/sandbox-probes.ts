/**
 * Sandbox checks: what the host's sandbox lets generated
 * code do. Uses @jetbrains/websandbox, the same library CopilotKit's
 * OpenGenerativeUIActivityRenderer uses, so a pass here transfers to it.
 */
import WebsandboxModule from "@jetbrains/websandbox";

type Status = "pass" | "fail" | "unsupported" | "info";
type SetFn = (id: string, status: Status, detail: string) => void;

const TIMEOUT_MS = 10_000;
const CDN = {
  cdnjs: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js",
  jsdelivr: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  unpkg: "https://unpkg.com/d3@7.9.0/dist/d3.min.js",
  esm: "https://esm.sh/three@0.170.0",
  undeclared: "https://code.jquery.com/jquery-3.7.1.min.js",
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS, what = "operation"): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ]);
}

/** Load a classic script; resolves with how long it took, rejects on error/CSP block. */
function loadScript(src: string): Promise<number> {
  const t0 = performance.now();
  return withTimeout(
    new Promise<number>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve(Math.round(performance.now() - t0));
      s.onerror = () => reject(new Error("script error (blocked by CSP or network)"));
      document.head.append(s);
    }),
    TIMEOUT_MS,
    "script load",
  );
}

// CSP violations give the clearest evidence; collect them for the details.
const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => {
  violations.push(`${e.violatedDirective} blocked ${e.blockedURI || "(inline)"}`);
});
const violationFor = (needle: string) => violations.find((v) => v.includes(needle));

export async function runSandboxProbes(set: SetFn, hostCsp: unknown, publicOrigin: string | undefined) {
  // Host-approved CSP
  set(
    "sb-host-csp",
    hostCsp ? "pass" : "info",
    hostCsp ? `host reports: ${JSON.stringify(hostCsp)}` : "host reports no sandbox.csp (may still enforce the declared one)",
  );

  // Inline script inserted at runtime
  {
    const w = window as unknown as { __inlineOk?: boolean };
    const s = document.createElement("script");
    s.textContent = "window.__inlineOk = true;";
    document.head.append(s);
    await new Promise((r) => setTimeout(r, 50));
    set(
      "sb-inline-script",
      w.__inlineOk ? "pass" : "fail",
      w.__inlineOk ? "runs" : `did not run ${violationFor("inline") ?? violationFor("script-src") ?? ""}`,
    );
  }

  // eval
  try {
    const v = new Function("return 6 * 7")();
    set("sb-eval", "info", `allowed (returned ${v}) — host CSP includes 'unsafe-eval' or none`);
  } catch (e) {
    set("sb-eval", "info", `blocked as expected: ${errText(e)}`);
  }

  // Declared CDNs (classic scripts)
  const globals: Record<string, () => unknown> = {
    cdnjs: () => (window as unknown as { gsap?: { version: string } }).gsap?.version,
    jsdelivr: () => (window as unknown as { Chart?: { version: string } }).Chart?.version,
    unpkg: () => (window as unknown as { d3?: { version: string } }).d3?.version,
  };
  for (const key of ["cdnjs", "jsdelivr", "unpkg"] as const) {
    const id = `sb-${key}`;
    try {
      const ms = await loadScript(CDN[key]);
      set(id, "pass", `loaded in ${ms} ms, version ${String(globals[key]())}`);
    } catch (e) {
      set(id, "fail", `${errText(e)} ${violationFor(new URL(CDN[key]).host) ?? ""}`.trim());
    }
  }

  // ES module dynamic import from esm.sh (what OIUI's importmap relies on)
  try {
    const t0 = performance.now();
    const mod = (await withTimeout(import(/* @vite-ignore */ CDN.esm), TIMEOUT_MS, "import()")) as { REVISION?: string };
    set("sb-esm", "pass", `three r${mod.REVISION} in ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    set("sb-esm", "fail", `${errText(e)} ${violationFor("esm.sh") ?? ""}`.trim());
  }

  // Control: an undeclared domain must be blocked, proving the CSP is enforced
  try {
    await loadScript(CDN.undeclared);
    set("sb-undeclared", "info", "LOADED — host does not enforce domain restrictions (CSP passes are not meaningful)");
  } catch (e) {
    set("sb-undeclared", "pass", `blocked as expected ${violationFor("code.jquery.com") ?? errText(e)}`);
  }

  // fetch() to declared connect domains
  try {
    const r = await withTimeout(fetch(CDN.esm), TIMEOUT_MS, "fetch");
    set("sb-fetch-cdn", "pass", `HTTP ${r.status}, ${(await r.text()).length} bytes`);
  } catch (e) {
    set("sb-fetch-cdn", "fail", `${errText(e)} ${violationFor("esm.sh") ?? ""}`.trim());
  }
  if (publicOrigin) {
    try {
      const r = await withTimeout(
        fetch(`${publicOrigin}/`, { headers: { "X-Tunnel-Skip-AntiPhishing-Page": "true" } }),
        TIMEOUT_MS,
        "fetch",
      );
      const text = await r.text();
      set("sb-fetch-tunnel", r.ok ? "pass" : "fail", `HTTP ${r.status}: ${text.slice(0, 60)}`);
    } catch (e) {
      set("sb-fetch-tunnel", "fail", `${errText(e)} ${violationFor(new URL(publicOrigin).host) ?? ""}`.trim());
    }
  } else {
    set("sb-fetch-tunnel", "info", "skipped: no publicOrigin in tool result");
  }

  await probeNestedSandbox(set);
}

/** The CopilotKit renderer path: websandbox nested srcdoc iframe + inline code + CDN inside it. */
async function probeNestedSandbox(set: SetFn) {
  const container = document.getElementById("sandbox-frame")!;
  container.hidden = false;
  const Websandbox = ((WebsandboxModule as unknown as { default?: unknown }).default ?? WebsandboxModule) as {
    create: (api: object, opts: object) => { promise: Promise<unknown>; run: (code: string) => Promise<unknown> };
  };
  let report!: (msg: string) => void;
  const reported = new Promise<string>((resolve) => (report = resolve));
  let cdnReport!: (msg: string) => void;
  const cdnReported = new Promise<string>((resolve) => (cdnReport = resolve));

  try {
    const sandbox = Websandbox.create(
      { report: (m: string) => report(m), cdnReport: (m: string) => cdnReport(m) },
      {
        frameContainer: container,
        frameContent: "<head></head><body><p style='font:12px sans-serif;margin:4px'>nested sandbox frame</p></body>",
        allowAdditionalAttributes: "",
      },
    );
    await withTimeout(sandbox.promise, TIMEOUT_MS, "nested frame init");
    await sandbox.run(
      "Websandbox.connection.remote.report('inline code ran in nested frame, origin=' + location.origin);",
    );
    set("sb-nested", "pass", await withTimeout(reported, TIMEOUT_MS, "nested report"));

    await sandbox.run(`
      var s = document.createElement('script');
      s.src = ${JSON.stringify(CDN.cdnjs)};
      s.onload = function () { Websandbox.connection.remote.cdnReport('gsap ' + (window.gsap && window.gsap.version)); };
      s.onerror = function () { Websandbox.connection.remote.cdnReport('ERROR'); };
      document.head.appendChild(s);
    `);
    const msg = await withTimeout(cdnReported, TIMEOUT_MS, "nested CDN load");
    set("sb-nested-cdn", msg === "ERROR" ? "fail" : "pass", msg === "ERROR" ? "script blocked inside nested frame" : `loaded ${msg}`);
  } catch (e) {
    const v = violations.filter((x) => x.includes("frame") || x.includes("srcdoc")).join("; ");
    set("sb-nested", "fail", `${errText(e)} ${v}`.trim());
    set("sb-nested-cdn", "info", "skipped: nested frame unavailable");
  }
}
