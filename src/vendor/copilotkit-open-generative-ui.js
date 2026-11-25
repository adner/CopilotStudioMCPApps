/*! @license MIT (CopilotKit, Copyright (c) Atai Barkai). Full text below.
 * CopilotKit Open Generative UI renderer, vendored verbatim from
 * @copilotkit/react-core@1.90.2 (dist/copilotkit-D_C40ReR.mjs, regions
 * src/v2/providers/SandboxFunctionsContext.ts, src/v2/lib/processPartialHtml.ts
 * and src/v2/components/OpenGenerativeUIRenderer.tsx up to the activity renderer).
 *
 * Why vendored: importing it from the package pulls in CopilotKit's whole chat
 * stack (a 17 MB single-file bundle). This code needs only React,
 * @jetbrains/websandbox and zod. Only the import lines and the export block were added.
 *
 * The MIT License
 *
 * Copyright (c) Atai Barkai
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
/* eslint-disable */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { z } from "zod";

//#region src/v2/providers/SandboxFunctionsContext.ts
const SandboxFunctionsContext = createContext([]);
function useSandboxFunctions() {
	return useContext(SandboxFunctionsContext);
}

//#endregion
//#region src/v2/lib/processPartialHtml.ts
/**
* Extracts all complete `<style>` blocks from the raw HTML.
* Returns the concatenated style tags, suitable for injection into `<head>`.
*/
function extractCompleteStyles(html) {
	const matches = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
	return matches ? matches.join("") : "";
}
/**
* Processes raw accumulated HTML for safe preview via innerHTML injection.
* Pure function, no DOM dependencies.
*
* Pipeline (order matters):
* 1. Strip incomplete tag at end
* 2. Strip complete <style>, <script>, and <head> blocks
* 3. Strip incomplete <style>/<script>/<head> blocks
* 4. Strip incomplete HTML entities
* 5. Extract body content (or use full string if no <body>)
*/
function processPartialHtml(html) {
	let result = html;
	result = result.replace(/<[^>]*$/, "");
	result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
	result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*$/gi, "");
	result = result.replace(/&[a-zA-Z0-9#]*$/, "");
	const bodyMatch = result.match(/<body[^>]*>([\s\S]*)/i);
	if (bodyMatch) {
		result = bodyMatch[1];
		result = result.replace(/<\/body>[\s\S]*/i, "");
	}
	return result;
}

//#endregion
//#region src/v2/components/OpenGenerativeUIRenderer.tsx
const OpenGenerativeUIActivityType = "open-generative-ui";
const OpenGenerativeUIContentSchema = z.object({
	initialHeight: z.number().optional(),
	generating: z.boolean().optional(),
	css: z.string().optional(),
	cssComplete: z.boolean().optional(),
	html: z.array(z.string()).optional(),
	htmlComplete: z.boolean().optional(),
	jsFunctions: z.string().optional(),
	jsFunctionsComplete: z.boolean().optional(),
	jsExpressions: z.array(z.string()).optional(),
	jsExpressionsComplete: z.boolean().optional()
});
/**
* Schema for the generateSandboxedUi tool call arguments.
* Used by the frontend tool renderer to display placeholder messages.
*/
const GenerateSandboxedUiArgsSchema = z.object({
	initialHeight: z.number().optional(),
	placeholderMessages: z.array(z.string()).optional(),
	css: z.string().optional(),
	html: z.string().optional(),
	jsFunctions: z.string().optional(),
	jsExpressions: z.array(z.string()).optional()
});
const THROTTLE_MS = 1e3;
/**
* Returns true when the inner component should re-render immediately
* (no throttle delay).
*/
function shouldFlushImmediately(prev, next) {
	if (next.cssComplete && (!prev || !prev.cssComplete)) return true;
	if (next.htmlComplete) return true;
	if (next.generating === false) return true;
	if (next.jsFunctions && (!prev || !prev.jsFunctions)) return true;
	if ((next.jsExpressions?.length ?? 0) > (prev?.jsExpressions?.length ?? 0)) return true;
	if (next.html?.length && (!prev || !prev.html?.length)) return true;
	return false;
}
/**
* Outer wrapper — absorbs every parent re-render but only forwards
* throttled content snapshots to the memoized inner component.
*/
const OpenGenerativeUIActivityRenderer = function OpenGenerativeUIActivityRenderer({ content }) {
	const latestContentRef = useRef(content);
	latestContentRef.current = content;
	const [throttledContent, setThrottledContent] = useState(content);
	const throttledContentRef = useRef(throttledContent);
	const timerRef = useRef(null);
	if (throttledContentRef.current !== content) {
		if (shouldFlushImmediately(throttledContentRef.current, content)) {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			throttledContentRef.current = content;
			setThrottledContent(content);
		}
	}
	const flush = useCallback(() => {
		timerRef.current = null;
		const latest = latestContentRef.current;
		throttledContentRef.current = latest;
		setThrottledContent(latest);
	}, []);
	useEffect(() => {
		if (throttledContentRef.current === content) return;
		if (timerRef.current === null) timerRef.current = setTimeout(flush, THROTTLE_MS);
	}, [content, flush]);
	useEffect(() => {
		return () => {
			if (timerRef.current !== null) clearTimeout(timerRef.current);
		};
	}, []);
	return /* @__PURE__ */ jsx(OpenGenerativeUIActivityRendererInner, { content: throttledContent });
};
function ensureHead(html) {
	if (/<head[\s>]/i.test(html)) return html;
	return `<head></head>${html}`;
}
function injectCssIntoHtml(html, css) {
	const headCloseIdx = html.indexOf("</head>");
	if (headCloseIdx !== -1) return html.slice(0, headCloseIdx) + `<style>${css}</style>` + html.slice(headCloseIdx);
	return `<head><style>${css}</style></head>${html}`;
}
const OpenGenerativeUIActivityRendererInner = React.memo(function OpenGenerativeUIActivityRendererInner({ content }) {
	const initialHeight = content.initialHeight ?? 200;
	const [autoHeight, setAutoHeight] = useState(null);
	const sandboxFunctions = useSandboxFunctions();
	const localApi = useMemo(() => {
		const api = {};
		for (const fn of sandboxFunctions) api[fn.name] = fn.handler;
		return api;
	}, [sandboxFunctions]);
	const fullHtml = content.htmlComplete && content.html?.length ? content.html.join("") : void 0;
	const css = content.cssComplete ? content.css : void 0;
	const cssReady = !!content.cssComplete;
	const partialHtml = !content.htmlComplete && content.html?.length ? content.html.join("") : void 0;
	const previewBody = partialHtml ? processPartialHtml(partialHtml) : void 0;
	const previewStyles = partialHtml ? extractCompleteStyles(partialHtml) : "";
	const hasPreview = cssReady && !!previewBody?.trim();
	const hasVisibleSandbox = !!fullHtml || hasPreview;
	const containerRef = useRef(null);
	const sandboxRef = useRef(null);
	const previewSandboxRef = useRef(null);
	const previewReadyRef = useRef(false);
	const sandboxReadyRef = useRef(false);
	const executedIndexRef = useRef(0);
	const pendingQueueRef = useRef([]);
	const jsFunctionsInjectedRef = useRef(false);
	useEffect(() => {
		const container = containerRef.current;
		if (!container || fullHtml || !hasPreview || previewSandboxRef.current) return;
		let cancelled = false;
		import("@jetbrains/websandbox").then((mod) => {
			if (cancelled) return;
			const sandbox = (mod.default?.default ?? mod.default).create({}, {
				frameContainer: container,
				frameContent: "<head></head><body></body>",
				allowAdditionalAttributes: ""
			});
			previewSandboxRef.current = sandbox;
			sandbox.iframe.style.width = "100%";
			sandbox.iframe.style.height = "100%";
			sandbox.iframe.style.border = "none";
			sandbox.iframe.style.backgroundColor = "transparent";
			sandbox.promise.then(() => {
				if (cancelled) return;
				previewReadyRef.current = true;
				sandbox.run(`
            var s = document.createElement('style');
            s.textContent = 'html, body { overflow: hidden !important; }';
            document.head.appendChild(s);
          `);
				const headParts = [];
				if (css) headParts.push(`<style>${css}</style>`);
				if (previewStyles) headParts.push(previewStyles);
				if (headParts.length) sandbox.run(`document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`);
				if (previewBody) sandbox.run(`document.body.innerHTML = ${JSON.stringify(previewBody)}`);
			});
		}).catch((err) => {
			console.error("[OpenGenerativeUI] Failed to load sandbox module:", err);
		});
		return () => {
			cancelled = true;
		};
	}, [hasPreview, fullHtml]);
	useEffect(() => {
		if (!previewSandboxRef.current || !previewReadyRef.current) return;
		const headParts = [];
		if (css) headParts.push(`<style>${css}</style>`);
		if (previewStyles) headParts.push(previewStyles);
		if (headParts.length) previewSandboxRef.current.run(`document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`);
		if (!previewBody) return;
		previewSandboxRef.current.run(`document.body.innerHTML = ${JSON.stringify(previewBody)}`);
	}, [
		previewBody,
		previewStyles,
		css
	]);
	useEffect(() => {
		const container = containerRef.current;
		if (!container || !fullHtml) return;
		if (previewSandboxRef.current) {
			previewSandboxRef.current.destroy();
			previewSandboxRef.current = null;
			previewReadyRef.current = false;
		}
		let cancelled = false;
		executedIndexRef.current = 0;
		jsFunctionsInjectedRef.current = false;
		sandboxReadyRef.current = false;
		pendingQueueRef.current = [];
		const htmlContent = css ? injectCssIntoHtml(fullHtml, css) : fullHtml;
		import("@jetbrains/websandbox").then((mod) => {
			if (cancelled) return;
			const sandbox = (mod.default?.default ?? mod.default).create(localApi, {
				frameContainer: container,
				frameContent: ensureHead(htmlContent),
				allowAdditionalAttributes: ""
			});
			sandboxRef.current = sandbox;
			sandbox.iframe.style.width = "100%";
			sandbox.iframe.style.height = "100%";
			sandbox.iframe.style.border = "none";
			sandbox.iframe.style.backgroundColor = "transparent";
			sandbox.promise.then(() => {
				if (cancelled) return;
				sandboxReadyRef.current = true;
				sandbox.run(`
            var s = document.createElement('style');
            s.textContent = 'html, body { overflow: hidden !important; }';
            document.head.appendChild(s);
          `);
				const queue = pendingQueueRef.current;
				pendingQueueRef.current = [];
				for (const code of queue) sandbox.run(code);
			});
		}).catch((err) => {
			console.error("[OpenGenerativeUI] Failed to load sandbox module:", err);
		});
		return () => {
			cancelled = true;
			if (previewSandboxRef.current) {
				previewSandboxRef.current.destroy();
				previewSandboxRef.current = null;
				previewReadyRef.current = false;
			}
			if (sandboxRef.current) {
				sandboxRef.current.destroy();
				sandboxRef.current = null;
			}
			sandboxReadyRef.current = false;
			setAutoHeight(null);
		};
	}, [
		fullHtml,
		css,
		localApi
	]);
	useEffect(() => {
		if (!content.jsFunctions || jsFunctionsInjectedRef.current) return;
		jsFunctionsInjectedRef.current = true;
		const sandbox = sandboxRef.current;
		if (sandboxReadyRef.current && sandbox) sandbox.run(content.jsFunctions);
		else pendingQueueRef.current.push(content.jsFunctions);
	}, [content.jsFunctions]);
	useEffect(() => {
		const expressions = content.jsExpressions;
		if (!expressions || expressions.length === 0) return;
		const startIndex = executedIndexRef.current;
		if (startIndex >= expressions.length) return;
		const newExprs = expressions.slice(startIndex);
		executedIndexRef.current = expressions.length;
		const sandbox = sandboxRef.current;
		if (sandboxReadyRef.current && sandbox) (async () => {
			for (const expr of newExprs) await sandbox.run(expr);
		})();
		else pendingQueueRef.current.push(...newExprs);
	}, [content.jsExpressions?.length]);
	const generationDone = content.generating === false;
	useEffect(() => {
		const sandbox = sandboxRef.current;
		if (!generationDone || !sandbox) return;
		let handled = false;
		const onMessage = (e) => {
			if (handled) return;
			if (e.source === sandbox.iframe.contentWindow && e.data?.type === "__ck_resize") {
				handled = true;
				setAutoHeight(e.data.height);
				window.removeEventListener("message", onMessage);
			}
		};
		window.addEventListener("message", onMessage);
		const measureOnce = `
        (function() {
          var s = document.createElement('style');
          s.textContent = 'body { height: auto !important; min-height: 0 !important; }';
          document.head.appendChild(s);
          var h = document.body.scrollHeight;
          var cs = getComputedStyle(document.body);
          h += parseFloat(cs.marginTop) || 0;
          h += parseFloat(cs.marginBottom) || 0;
          s.remove();
          parent.postMessage({ type: "__ck_resize", height: Math.ceil(h) }, "*");
        })();
      `;
		if (sandboxReadyRef.current) sandbox.run(measureOnce);
		else pendingQueueRef.current.push(measureOnce);
		return () => {
			window.removeEventListener("message", onMessage);
		};
	}, [generationDone]);
	const height = autoHeight ?? initialHeight;
	const isGenerating = content.generating !== false;
	return /* @__PURE__ */ jsx("div", {
		ref: containerRef,
		style: {
			position: "relative",
			width: "100%",
			height: `${height}px`,
			borderRadius: "8px",
			backgroundColor: hasVisibleSandbox ? "transparent" : "#f5f5f5",
			border: hasVisibleSandbox ? "none" : "1px solid #e0e0e0",
			display: hasVisibleSandbox ? "block" : "flex",
			alignItems: hasVisibleSandbox ? void 0 : "center",
			justifyContent: hasVisibleSandbox ? void 0 : "center",
			overflow: "hidden"
		},
		children: isGenerating && /* @__PURE__ */ jsxs("div", {
			style: {
				position: "absolute",
				inset: 0,
				zIndex: 10,
				pointerEvents: "all",
				backgroundColor: "rgba(255, 255, 255, 0.5)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center"
			},
			children: [/* @__PURE__ */ jsxs("svg", {
				width: "48",
				height: "48",
				viewBox: "0 0 24 24",
				fill: "none",
				style: { animation: "ck-spin 1s linear infinite" },
				children: [/* @__PURE__ */ jsx("circle", {
					cx: "12",
					cy: "12",
					r: "10",
					stroke: "#e0e0e0",
					strokeWidth: "3"
				}), /* @__PURE__ */ jsx("path", {
					d: "M12 2a10 10 0 0 1 10 10",
					stroke: "#999",
					strokeWidth: "3",
					strokeLinecap: "round"
				})]
			}), /* @__PURE__ */ jsx("style", { children: `@keyframes ck-spin { to { transform: rotate(360deg) } }` })]
		})
	});
}, (prev, next) => prev.content === next.content);

export {
	OpenGenerativeUIActivityRenderer,
	OpenGenerativeUIActivityType,
	OpenGenerativeUIContentSchema,
	GenerateSandboxedUiArgsSchema,
	SandboxFunctionsContext,
	processPartialHtml,
};
