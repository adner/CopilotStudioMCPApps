# Generative UI for Copilot Studio with MCP Apps

Ask a Copilot Studio agent for *"a calculator with a pumpkin theme"* or *"the moon orbiting the earth in 3D"*, and a
working, interactive UI builds itself right in the chat.

This repo is an MCP server that makes that happen:

- An **OpenAI** model writes each UI on the fly (CSS, HTML and JavaScript), using CopilotKit's generation format.
- **CopilotKit's Open Generative UI renderer** draws it live while it streams in, inside a sandbox.
- **[MCP Apps](https://github.com/modelcontextprotocol/ext-apps)** delivers it into Copilot Studio as an interactive
  component, and lets it talk back to the chat: a generated UI can post messages, share its state with the agent,
  open links and go fullscreen.

Generated UIs can use three.js, GSAP, D3 and Chart.js from public CDNs. Every UI is saved, so you can show it again or
ask for changes (*"make it spookier"*).

**How it works:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the components, how a request flows through
them, and where the code lives.

## Requirements

- Node.js 24 or later
- An OpenAI API key
- The [Dev Tunnels CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started) (`devtunnel`), so Copilot Studio can reach the server
- A Copilot Studio agent. MCP Apps render in the agent's test chat and in Microsoft 365 Copilot, not in Teams or web chat.

## Run

1. Install and build:

   ```powershell
   npm install
   npm run build      # typecheck + bundle the UIs into dist/
   ```

2. Create a dev tunnel once (replace `<tunnel-name>` with a name of your own). An anonymous tunnel expires after 30 days.

   ```powershell
   devtunnel create <tunnel-name> --allow-anonymous
   devtunnel port create <tunnel-name> -p 3001
   ```

3. Create a `.env` file next to `package.json`. It's gitignored.

   ```
   OPENAI_API_KEY=<your key>
   PUBLIC_ORIGIN=https://<tunnel-id>-3001.<region>.devtunnels.ms
   ```

4. Start the server, and in a second terminal, the tunnel:

   ```powershell
   npm run serve                    # http://localhost:3001/mcp
   devtunnel host <tunnel-name>     # → https://<tunnel-id>-3001.<region>.devtunnels.ms
   ```

The MCP URL is the tunnel URL plus `/mcp`.

> **Keep your server private.** With an anonymous tunnel, anyone who knows the URL can call your tools, and
> `create_ui` spends your OpenAI credit. Don't share the URL, stop the tunnel when you're done, or require an API key
> (see [Settings](#settings)).

### Settings

All settings go in `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Required for `create_ui` |
| `OPENAI_MODEL` | `gpt-6.2-sol` | Model that writes the UIs |
| `OPENAI_REASONING_EFFORT` | `medium` | Reasoning effort for that model |
| `PUBLIC_ORIGIN` | `http://localhost:3001` | The server's public URL (your tunnel) |
| `MCP_API_KEY` | none | If set, requests must send the header `x-api-key: <value>`. In Copilot Studio, choose API key authentication with header name `x-api-key`. |
| `PORT` | `3001` | Port the server listens on (on `127.0.0.1`) |
| `ALLOWED_HOSTS` | none | Comma-separated extra Host headers to accept, besides `localhost` and `*.devtunnels.ms` |
| `GENUI_DEBUG` | off | Set to `1` to show a status line in the UI |

## Connect in Copilot Studio

1. Open the agent, then go to **Build** → **Tools** → **Add tool** → **Add** → **Model Context Protocol (MCP)**.
2. Enter a name and description, your MCP URL, and the authentication you chose. Select **Add**, then **Save**.
3. Add instructions to the agent, so it uses `create_ui` instead of its built-in app-building skill:

   ```
   For any request to create, build, make, show, draw, design, visualise or animate something interactive or visual (an app, game, calculator, timer, animation, simulation, chart or diagram), always call the create_ui tool and pass the user's request word for word. Never use any other app-building, code or image capability for these requests. create_ui renders the UI directly in this chat.

   When the user asks for a change to a UI that was just shown, call create_ui with that UI's uiId and the requested change.
   When the user asks to see an earlier UI again, call replay_ui with its uiId. Use list_uis if you need to find the uiId.

   After calling create_ui or replay_ui, reply with one short, playful sentence. Don't describe or reproduce the UI in text; it appears on its own.

   Messages that start with 🪄 come from the UI itself. Respond to them in character, briefly.
   ```

4. Try it in the agent's test chat.

Copilot Studio caches a server's tools. If you change a tool's name, description or schema, remove the MCP server
from the agent and add it again.

## Things to try

- *"Create a cool calculator with a pumpkin theme. When I press equals, tell the chat the answer like a spooky fortune teller."*
- *"Show me how the moon orbits the earth in 3D, with a speed slider and an 'Explain this' button that asks you about the current phase."*
- *"Make a pizza builder where toppings rain from the sky and stick where they land. When I press Order, send my order to the chat."*
- Then: *"Make it spookier"*, *"List my UIs"*, *"Show the pumpkin calculator again"*.

A generation takes about a minute. A loading card covers the wait, then the UI streams in.

## Tools

| Tool | Visibility | Role |
| --- | --- | --- |
| `create_ui` | model | Generates a UI, or changes an earlier one when given its `uiId` |
| `replay_ui` | model | Shows a saved UI again, without calling OpenAI |
| `list_uis` | model | Lists saved UIs and their ids |
| `show_ui_sample` | model | Streams a hand-written sample UI, with no OpenAI call |
| `get_ui_progress` | app only | The UI polls this for the generation's streamed output |
| `report_ui_event` | app only | Logs calls and errors from generated UIs to the server log |

Generated UIs are saved in `generated/<uiId>.json`, and every JSON-RPC call is logged to `logs/server.log`. Both are gitignored.

## Capability probe

The server also includes a small diagnostic MCP App that checks which MCP Apps features a host supports: tool calls
from the app, resource reads, messages to the chat, model context, links, display modes and resizing, and what the
host's sandbox allows generated code to load. It's handy when you try a new host.

- Ask the agent to *"Open the MCP Apps capability probe"*. Checks without visible side effects run on their own;
  the rest have buttons.
- The results are saved to `reports/report-<runId>.json` (gitignored).
- Tools: `open_capability_probe`, `probe_echo`, and the app-only `probe_app_only` and `submit_probe_report`.
- `scripts/check-basic-host.mjs` runs the probe in headless Edge against the ext-apps
  [`examples/basic-host`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) reference host on port 8080.

## Credits

- Generated UIs are rendered with [CopilotKit](https://github.com/CopilotKit/CopilotKit)'s Open Generative UI
  renderer (vendored in `src/vendor/`), and the generator prompt is adapted from CopilotKit's
  [Open Intelligent UI](https://github.com/CopilotKit/OpenIntelligentUI). Both are MIT-licensed; see
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- Built on the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) SDK and the MCP TypeScript SDK.

Microsoft and Copilot Studio are trademarks of Microsoft. This project isn't affiliated with or endorsed by Microsoft or CopilotKit.

## License

[MIT](LICENSE)
