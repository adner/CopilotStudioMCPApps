# Architecture: generative UI in Copilot Studio

You ask a Copilot Studio agent for something like *"a calculator with a pumpkin theme"*, and a working, interactive
UI builds itself in the chat. This document explains how that works and which frameworks are involved.

The short version: **MCP Apps** gets the UI into Copilot Studio and lets it talk back to the chat. **OpenAI** writes the
UI, using **CopilotKit's** generation format. **CopilotKit's renderer** draws it live as it streams in, inside a sandbox.

## The pieces

| Layer | Framework / library | What it does here |
| --- | --- | --- |
| Protocol | **MCP TypeScript SDK 2.x** (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`) | The MCP server: tools, resources, JSON-RPC over Streamable HTTP. |
| UI standard | **MCP Apps** (`@modelcontextprotocol/ext-apps` 2.0.4) | On the server, links a tool to a `ui://` HTML resource. In the UI, the `App` class talks to the host (Copilot Studio). |
| Web server | **Express 5** + **Dev Tunnels** | Express serves `/mcp` on `localhost:3001`. A dev tunnel gives it a public HTTPS URL that Copilot Studio can reach. |
| UI generation | **OpenAI API** (`openai` SDK, Responses API) | A model writes the UI as CSS, HTML and JavaScript, streamed. |
| Generation format | **CopilotKit's `generateSandboxedUi` contract** | The tool schema and description are copied from `@copilotkit/shared`, so the model produces exactly what CopilotKit's renderer expects. |
| Rendering | **CopilotKit Open Generative UI renderer** (vendored from `@copilotkit/react-core` 1.90.2) | Draws the UI progressively while it streams, then runs its JavaScript in a sandbox. |
| Sandbox | **@jetbrains/websandbox** (used by the renderer) | Runs the generated code in a nested iframe, with an RPC channel to the page around it. |
| Streaming glue | **partial-json** | Parses the half-finished JSON from OpenAI, so CSS and HTML can be shown before generation ends. |
| App shell | **React 19**, built with **Vite** + **vite-plugin-singlefile** | The frame around the generated UI (loading card, fullscreen button), compiled into one self-contained HTML file. |
| Libraries for generated UIs | **three.js, GSAP, D3, Chart.js** from esm.sh | Generated code imports them through an import map. Copilot Studio allows them because the resource declares the CDN domains in `_meta.ui.csp`. |

What this project does **not** use: CopilotKit's runtime, agents or AG-UI, the Open Intelligent UI app itself, or A2UI.
It takes only CopilotKit's renderer and generation format. The renderer is vendored because importing
`@copilotkit/react-core` pulls in CopilotKit's whole chat stack (a 17 MB bundle).

## What happens when you ask for a UI

```
 You ─► Copilot Studio agent ─► create_ui (MCP server) ─► OpenAI (background job, streaming)
                                    │                          │
                                    ▼                          ▼
                      ui://genui/app.html            generated/<uiId>.json
                      mounted in the chat                      ▲
                                    │                          │
                                    └── polls get_ui_progress ─┘
```

1. **You type** *"Create a pumpkin calculator…"* in Copilot Studio.
2. **The agent calls the MCP tool `create_ui`**. The call goes through the dev tunnel to Express and the MCP SDK.
3. **`create_ui` starts a background job and returns at once with a `uiId`.**
   - The job ([`genui/generator.ts`](../genui/generator.ts)) calls OpenAI with streaming on, forcing a single
     `generateSandboxedUi` function call.
   - It returns at once because Copilot Studio gives up on a tool call after 120 seconds, and a generation takes 40–90 seconds.
4. **Copilot Studio loads the UI resource.**
   - The tool's result carries `_meta.ui.resourceUri = ui://genui/app.html`.
   - Copilot Studio fetches that resource with `resources/read` and mounts it in an iframe in the chat.
   - The resource is the single-file React app. Its `_meta.ui.csp` lists the CDN domains the generated code may use.
5. **The app connects** with the MCP Apps `App` class (`ui/initialize`) and receives the tool result with the `uiId`.
6. **The app polls** the app-only tool `get_ui_progress` every 0.3 seconds (`app.callServerTool`) and gets each new
   piece of the model's streamed JSON.
7. **partial-json turns the partial JSON into CopilotKit's content shape**
   ([`src/genui-stream.ts`](../src/genui-stream.ts)), including flags that say which fields are complete.
8. **CopilotKit's renderer draws it.**
   - CSS first, then the HTML streams in. This is the "it's building itself" moment.
   - Once the JavaScript is complete, it runs inside the websandbox iframe.
   - An import map is injected, so `import * as THREE from "three"` just works.
9. **The generated UI talks back to the chat.** It calls a few host functions. CopilotKit's `SandboxFunctionsContext`
   carries those calls out of the sandbox to the bridge ([`src/genui-bridge.ts`](../src/genui-bridge.ts)), which maps
   them to MCP Apps host calls:

   | Function in generated code | MCP Apps call | Effect in Copilot Studio |
   | --- | --- | --- |
   | `say(text)` | `ui/message` | A 🪄 message appears in the chat, and the agent replies. |
   | `remember(text, data)` | `ui/update-model-context` | The agent knows the UI's current state without being told. |
   | `openLink(url)` | `ui/open-link` | Opens a link in a new tab. |
   | `fullscreen(mode)` | `ui/request-display-mode` | Moves the UI to the side pane next to the chat. |

10. **The finished generation is saved** to `generated/<uiId>.json`. That's what makes replays (`replay_ui`) and
    change requests (*"make it spookier"*, `create_ui` with an earlier `uiId`) possible.

## Frames inside frames

```
Copilot Studio chat
└─ MCP App iframe           MCP Apps App class + the React shell
   └─ websandbox iframe     CopilotKit's renderer runs the generated code here
      └─ three.js, GSAP, D3 or Chart.js from esm.sh (allowed by _meta.ui.csp)
```

The generated code never touches the chat directly. It can only call the functions listed above, and the shell
decides what each one does.

## Tools

| Tool | Visibility | Role |
| --- | --- | --- |
| `create_ui` | model | Starts a generation, or a change to an earlier UI when given its `uiId`. Opens the generative UI app. |
| `replay_ui` | model | Shows a saved UI again, without calling OpenAI. |
| `list_uis` | model | Lists saved UIs and their ids. |
| `show_ui_sample` | model | Streams a hand-written sample UI, with no OpenAI call. Useful for testing the frame. |
| `get_ui_progress` | app only | Returns the next piece of a generation's output. Polled by the app. |
| `report_ui_event` | app only | Logs bridge calls and errors from the generated UI to the server log. |

Copilot Studio doesn't hide app-only tools from the agent, so their descriptions are written to be safe for it to read.
Copilot Studio also caches tool names and schemas until you remove and re-add the MCP server, so changing a tool
means re-adding the server.

## Where the code lives

| Path | What's in it |
| --- | --- |
| [`main.ts`](../main.ts) | Express server, Host header check, optional API key, JSON-RPC logging |
| [`server.ts`](../server.ts) | Tool and resource registration, including the CSP metadata |
| [`genui/generator.ts`](../genui/generator.ts) | Background jobs, the OpenAI streaming call, saving to `generated/` |
| [`genui/prompt.ts`](../genui/prompt.ts) | The generator's system prompt (adapted from CopilotKit's Open Intelligent UI) |
| [`genui/copilotkit-contract.ts`](../genui/copilotkit-contract.ts) | CopilotKit's `generateSandboxedUi` description and schema |
| [`genui/libraries.ts`](../genui/libraries.ts) | Pinned CDN library versions and the import map |
| [`src/genui-app.tsx`](../src/genui-app.tsx) | The React shell: polling, loading card, fullscreen button |
| [`src/genui-stream.ts`](../src/genui-stream.ts) | Partial JSON to CopilotKit content |
| [`src/genui-bridge.ts`](../src/genui-bridge.ts) | Host functions (`say`, `remember`, `openLink`, `fullscreen`) and error reporting |
| [`src/vendor/`](../src/vendor/) | CopilotKit's renderer, vendored verbatim with its MIT notice |
