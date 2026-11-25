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

## How generated UIs talk to the chat

A generated UI runs in a sandbox and can't reach the chat or the agent directly. Instead, it can call a small set of
**host functions**. The UI's own frame ([`src/genui-bridge.ts`](src/genui-bridge.ts)) carries each call to Copilot Studio
as an MCP Apps request.

| Function | What happens in Copilot Studio | MCP Apps request |
| --- | --- | --- |
| `say(text)` | `text` is posted to the chat as your message, starting with 🪄, and the agent replies to it | `ui/message` |
| `remember(text, data?)` | The agent quietly learns the UI's current state. Nothing appears in the chat. | `ui/update-model-context` |
| `openLink(url)` | Opens an https link in a new browser tab | `ui/open-link` |
| `fullscreen(mode?)` | Moves the UI to the side pane next to the chat, or back inline | `ui/request-display-mode` |

### Asking for them in a prompt

You don't call these functions yourself. The model that writes the UI decides when to use them, based on your
request. It follows rules in the generator prompt ([`genui/prompt.ts`](genui/prompt.ts)):

- **`say`** is used when the request asks the UI to *tell*, *ask*, *send* or *report* something to the chat, or when a
  choice should continue the conversation (a story, a game turn, an "Explain this" button). It's only used for
  meaningful moments, never when the UI loads, on a timer or for ordinary input.
  - *"…When I press equals, tell the chat the answer like a spooky fortune teller."*
  - *"…When I press Order, send my order to the chat."*
  - *"…with an 'Explain this' button that asks you about the current phase."*
- **`remember`** is used when the UI tracks something you might ask the agent about later: a score, progress, a
  selection. Ask for it with words like *track*, *keep count* or *remember*, then ask the agent about it in the chat.
  - *"Build a pomodoro timer that tracks my completed sessions."* Later: *"How productive have I been?"*
  - *"Chart coffee against bugs fixed across a week."* Click a day, then: *"Which day should this developer be worried about?"*
- **`fullscreen`** is offered as a small button in 3D scenes, games and big visuals. Every generated UI also gets a
  round **⤢** button in the bottom-right corner when you hover over it.
- **`openLink`** is used when the request asks for links, such as *"…with a 'Learn more' button for each planet."*

If the model doesn't use a function you expected, say so explicitly in the prompt: *"send it to the chat"* or
*"remember my score so you can tell me later"*.

### Details

- **`say(text)`** posts the message as if you had typed it, so the agent answers it like any other message. The 🪄
  prefix marks it as coming from the UI. The agent instructions above tell the agent to reply to these messages in
  character. In fullscreen, the UI stays visible next to the chat while the agent replies.
- **`remember(text, data?)`** gives the agent the text `State of generated UI <uiId>: <text>`, plus `data` as
  structured content if it's a plain object. Each call **replaces** what was remembered before, so the UI sends its
  whole current state each time, not just what changed. The agent sees it when you send your next message.
- All four functions return a Promise. `say` and `openLink` resolve to `{ ok: boolean }`, `remember` to `{ ok: true }`,
  and `fullscreen` to `{ mode }` with the mode the host switched to. Text is cut off at 4,000 characters.
- Inside the generated code, the functions are called through the sandbox's RPC channel:

  ```js
  // In a generated UI's JavaScript
  async function order() {
    orderButton.disabled = true;
    await Websandbox.connection.remote.say(`I'd like a pizza with ${toppings.join(", ")}!`);
    orderButton.disabled = false;
  }
  Websandbox.connection.remote.remember(`Completed sessions: ${sessions}`, { sessions });
  ```

- Errors in generated code are forwarded to `logs/server.log` automatically through a hidden fifth function,
  `reportError`, so a broken UI can be diagnosed without browser developer tools.

### Adding your own function

1. Add an entry `{ name, handler }` to `SANDBOX_FUNCTIONS` in [`src/genui-bridge.ts`](src/genui-bridge.ts). The
   handler receives the arguments the generated code passes, and can use any method of the MCP Apps `App` object,
   such as calling one of your server's tools with `app.callServerTool(...)`.
2. Describe it, and when to use it, in the **Host functions** section of [`genui/prompt.ts`](genui/prompt.ts), so the
   model knows it exists.
3. Run `npm run build`, and restart the server for the prompt change.

Keep `SANDBOX_FUNCTIONS` a constant list: CopilotKit's renderer recreates the sandbox whenever the list changes.

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
