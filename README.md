<p align="center">
  <img src="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/logo.png" alt="Eureka Flow" height="60" />
</p>

<h1 align="center">flow-mcp</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@lemoncloud/flow-mcp"><img src="https://img.shields.io/npm/v/@lemoncloud/flow-mcp?style=flat-square" alt="npm" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square" alt="TypeScript" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP_SDK-1.29-green?style=flat-square" alt="MCP SDK" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-yellow?style=flat-square" alt="License" /></a>
</p>

<p align="center">
  MCP server for <a href="https://flow.eureka.codes"><b>Eureka Flow</b></a> — manage visual workflows from any MCP-compatible AI client.<br/>
  Build, execute, and monitor data processing pipelines through natural language.
</p>

<p align="center">
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://cursor.com/install-mcp?name=flow-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsZW1vbmNsb3VkL2Zsb3ctbWNwIl19"><img src="https://img.shields.io/badge/Add_to-Cursor-0A0A0A?style=flat-square&logo=cursor&logoColor=white" alt="Add flow-mcp to Cursor" /></a>
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=flow-mcp&config=%7B%22name%22%3A%22flow-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40lemoncloud%2Fflow-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in-VS_Code-007ACC?style=flat-square" alt="Install flow-mcp in VS Code" /></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/images/screenshot-dark.jpg" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/images/screenshot-light.jpg" />
    <img src="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/images/screenshot-dark.jpg" alt="Eureka Flow" width="100%" />
  </picture>
</p>

## What You Can Do

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code (Continue/Cline)**, **Claude Code**, and any MCP-compatible client.

Just ask in natural language:

| What you want | Say this to Claude |
|---------------|-------------------|
| Sign in (no key to copy) | "Log in to Eureka" |
| List workflows | "Show my flows" |
| Create a workflow | "Create a flow: text input → buffer → preview" |
| Run a workflow | "Run flow 1004897" |
| Check results | "Show the preview node output" |
| Visualize | "Show graph for 1004897" |
| Rename a node | "Rename node 1009369 to EurekaFlow" |
| Add a node | "Add a text input block to this flow" |
| Connect nodes | "Connect the input node to the buffer" |
| Clean up | "Delete disconnected nodes" |

No code required. No tool names to remember. Just ask in natural language.

## Quick Start

> **You'll need:** the [**Claude Desktop**](https://claude.ai/download) app installed, and a free Eureka account (just sign in with Google — no signup form). Claude Desktop bundles its own Node.js runtime, so there's nothing else to install.

### 🚀 One-Click Install — Claude Desktop (recommended, no terminal)

1. **Download the extension.** On the [**Releases page**](https://github.com/lemoncloud-io/flow-mcp/releases/latest), open the **Assets** section and download **`flow-mcp.mcpb`**. *(Ignore the "Source code" files — you don't need those.)*
2. **Install it.** Double-click **`flow-mcp.mcpb`**. Claude Desktop opens an **install window** — **leave the API Key field blank** (you'll log in from chat in the next step) and click **Install**.
   - *Mac says "unidentified developer"?* Right-click the file → **Open** → **Open**. That's normal for downloads.
   - *No install window appeared?* Open Claude Desktop → **Settings → Extensions** and drag the file in.
3. **Log in — no key to copy.** In Claude, just say **"Log in to Eureka."** A browser window opens for **Google sign-in** — finish there, and Claude provisions and stores your API key automatically. *(Prefer to paste a key yourself? Get one at [flow.eureka.codes](https://flow.eureka.codes) → sign in → Create Key → Copy, and put it in the API Key field at step 2 instead.)*
4. **Check it works.** Ask Claude *"Show my flows"*. If it answers at all — even *"you have no flows yet"* — you're connected! 🎉 Then try *"Create a flow"* or *"Check my credit balance"*.
   - *See a red error or "server disconnected" instead?* Open **Settings → Extensions** and confirm flow-mcp is enabled, then ask Claude to *"log in"* again.

> One login unlocks everything — **flows** and **billing credits**. No key to copy, nothing technical to edit.

### Other clients (Cursor · Windsurf · VS Code · Claude Code)

**One-click:** use the [**Add to Cursor**](https://cursor.com/install-mcp?name=flow-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsZW1vbmNsb3VkL2Zsb3ctbWNwIl19) / [**Install in VS Code**](https://insiders.vscode.dev/redirect/mcp/install?name=flow-mcp&config=%7B%22name%22%3A%22flow-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40lemoncloud%2Fflow-mcp%22%5D%7D) badges at the top — they auto-add the `npx` config below. Then say **"Log in to Eureka"**. Or configure it manually:

<details>
<summary><b>Manual install</b> (npm + config file)</summary>

**1. Install**

```bash
npm install -g @lemoncloud/flow-mcp
```

**2. Add to your client's MCP config** — no API key needed. Claude Desktop file: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "npx",
      "args": ["-y", "@lemoncloud/flow-mcp"]
    }
  }
}
```

- **Cursor / Windsurf / VS Code (Continue/Cline):** add the same `mcpServers` block to the IDE's MCP settings.
- **Claude Code:** `claude mcp add flow-mcp -- npx -y @lemoncloud/flow-mcp`

**3. Restart** your client and say **"Log in to Eureka"** — a browser opens for Google sign-in and your key is provisioned automatically. Then try **"Show my flows"**.

> Prefer a fixed key? Get one at [flow.eureka.codes](https://flow.eureka.codes) (sign in → **Create Key** → **Copy**) and add `"env": { "FLOW_API_KEY": "ec-…" }` to the config above instead of logging in.

**Environment variables** — all optional; `FLOW_API_KEY` is only needed if you skip the in-chat login:

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `FLOW_API_KEY` | | — | API key (optional — the `auth` tool mints one via browser login) |
| `FLOW_API_URL` | | `https://api.eureka.codes/flw-v1` | API server URL |
| `FLOW_API_TIMEOUT` | | `30000` | Request timeout (ms) |
| `FLOW_WS_URL` | | `wss://wss.eureka.codes/wss-v1` | WebSocket URL for real-time execution monitoring |

</details>

## Flow Templates

Not sure where to start? flow-mcp ships **guided templates** that walk Claude through a complete workflow. In clients that support MCP prompts (Claude Desktop, Cursor), type `/` and pick one — or just ask for it by name:

| Template | What it does |
|----------|--------------|
| **quick-flow** | Builds and runs a text input → buffer → preview flow (great first run) |
| **etl-pipeline** | Builds a multi-step Extract → Transform → Load flow from your description |
| **debug-execution** | Runs a flow, then inspects each node and port to find where it failed |
| **publish-flow** | Creates (or takes an existing) flow and publishes it as a public template |

Each template just steers Claude through the right `flow_read` / `flow_do` actions — no new permissions to approve.

## Examples

### Create & Run

```
"Show available blocks"
→ Lists input / process / output block types

"Create a flow with text input, 3s buffer, and preview connected together"
→ Creates 3 nodes + 2 edges automatically

"Run the flow"
→ Shows real-time progress → returns results
```

### Modify Existing Flows

```
"Load flow 1004897"
→ Shows nodes, edges, port data

"Change the input text to Hello Eureka"
→ Updates config.text

"Add another output block and connect it"
→ Creates node + edge

"Show graph"
→ Mermaid diagram
```

### Inspect Results

```
"Run the whole flow"
→ Per-node progress + completion status

"What's the preview node output?"
→ Port data (value, type, timestamp)
```

### Manage Credits

> **First top-up?** Add a card at **[billing.eureka.codes](https://billing.eureka.codes)** first. Balance, packs, and history work without one — but a purchase needs a card on file.

```
"Check my credit balance"
→ Total / available / held credits

"Show credit packs"
→ Purchasable packs with USD prices

"Top up 1,000 credits"
→ Charges the card on file (enroll one at billing.eureka.codes if you haven't)

"Show my credit history"
→ Top-ups and usage, newest first
```

### Publish a Flow

```
"Publish flow 1004897"        → opens it to the public
"Make flow 1004897 private"   → unpublishes it
```

## 5 Tools, 31 Actions

flow-mcp exposes just **five** tools — so you approve permissions a handful of times, not 31. They split by domain (flow / credit) and by access (**read** vs **do**), plus an **auth** tool for sign-in. The read tools are marked read-only; the "do" tools are where the ⚠️ writes and charges live. You never call them by name; just talk to Claude ("log in", "publish my flow", "check my credits") and it picks the right action.

### `flow_read` — read flows (read-only)

`{ action, params }` · Actions:
`profile_get` · `flow_list` · `flow_load` · `flow_graph` · `flow_export` · `node_get` · `node_get_port` · `block_get` · `block_list` · `run_list` · `run_get`

### `flow_do` — edit & run flows ⚠️

`{ action, params }` · Actions:
`flow_create` · `flow_update` · `flow_publish` · `flow_save` · `flow_clone` · `flow_run` · `flow_run_from` · `node_create` · `node_run` · `node_update` · `node_delete` · `edge_create` · `edge_delete`

### `credit_read` — read credits (read-only)

`{ action, params }` · Actions:
`credit_balance` · `credit_packs` · `credit_history`

### `credit_do` — purchase credits ⚠️

`{ action, params }` · Actions:
`credit_purchase`

### `auth` — sign in / out

`{ action, params }` · Actions:
`login` · `status` · `logout`

> `login` opens a browser for Google sign-in and provisions + stores your API key — no copy-paste. Click **"Always allow"** once for each tool you use and you're set. The two read tools are read-only and safe to allow; the `*_do` tools are the only ones that change anything or charge your card.

---

<details>
<summary><b>Developer Guide</b></summary>

### Build from Source

```bash
git clone https://github.com/lemoncloud-io/flow-mcp.git
cd flow-mcp
npm install
npm run build
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | TypeScript compilation |
| `npm run dev` | Watch mode |
| `npm run lint` | ESLint |
| `npm run lint:type` | Type check (`tsc --noEmit`) |
| `npm run format` | Prettier format |
| `npm start` | Run MCP server (stdio) |
| `npm test` | Run tests |

### Local Build Config

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/flow-mcp/dist/stdio.js"],
      "env": {
        "FLOW_API_KEY": "your-api-key",
        "FLOW_WS_URL": "wss://wss.eureka.codes/wss-v1"
      }
    }
  }
}
```

### Architecture

```
stdio.ts (console suppression + JSON-RPC filter)
  -> server.ts (McpServer + 5 dispatch tools -> 31 actions)
    -> tools/*.ts (tool handlers)
      -> api-client.ts (Axios -> flows-api REST)
      -> ws-client.ts (WebSocket -> real-time execution events)
      -> config.ts (Zod v4 env validation)
```

### WebSocket Execution Flow

```
1. Connect WS (info= param -> connectionId)
2. Trigger run (POST /nodes/:id/run?connection=<connId>)
3. Monitor events (node status + port updates)
4. Settle on completion (all terminal) or quiet period (1.5s)
5. Return result with full event log
```

### Publish

```bash
npm run build
npm publish --access public
```

</details>

## Related Projects

- [Eureka Flow](https://github.com/lemoncloud-io/eureka-flow) — Visual workflow editor (frontend)

## License

Apache-2.0 -- [LemonCloud](https://lemoncloud.io)
