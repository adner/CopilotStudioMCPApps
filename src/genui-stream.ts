/**
 * Maps the streamed generateSandboxedUi arguments (a growing JSON string) to
 * CopilotKit's OpenGenerativeUIContent, the way CopilotKit's own middleware does:
 * a field counts as complete once the next field (in the fixed parameter order) has started.
 *
 * The renderer injects jsFunctions once and runs each jsExpressions entry once,
 * so those are only handed over when complete.
 */
import { Allow, parse } from "partial-json";
import type { OpenGenerativeUIContent } from "./vendor/copilotkit-open-generative-ui.js";

export interface StreamView {
  content: OpenGenerativeUIContent;
  placeholders: string[];
  /** Which field is currently streaming, for the status line. */
  phase: string;
}

export function toContent(raw: string, done: boolean): StreamView {
  let obj: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      obj = (done ? JSON.parse(raw) : parse(raw, Allow.ALL)) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const has = (k: string) => k in obj;
  const c: OpenGenerativeUIContent = { generating: !done };
  let phase = "thinking";

  // A number can arrive half-written ("53" before "536"); trust it once the next key started.
  if (typeof obj.initialHeight === "number" && (done || has("placeholderMessages"))) {
    c.initialHeight = obj.initialHeight;
  }
  if (typeof obj.css === "string") {
    c.css = obj.css;
    c.cssComplete = done || has("html");
    phase = "styles";
  }
  if (typeof obj.html === "string") {
    c.html = [obj.html];
    c.htmlComplete = done || has("jsFunctions");
    phase = "markup";
  }
  if (typeof obj.jsFunctions === "string") {
    phase = "logic";
    if (done || has("jsExpressions")) {
      c.jsFunctions = obj.jsFunctions;
      c.jsFunctionsComplete = true;
    }
  }
  if (Array.isArray(obj.jsExpressions)) {
    phase = "wiring up";
    const ex = obj.jsExpressions.filter((s): s is string => typeof s === "string");
    c.jsExpressions = done ? ex : ex.slice(0, -1);
    c.jsExpressionsComplete = done;
  }
  if (done) phase = "done";
  const placeholders = Array.isArray(obj.placeholderMessages)
    ? obj.placeholderMessages.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  return { content: c, placeholders, phase };
}
