<p align="center">
  <img src="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/eurekaflow%20logo.png" alt="Eureka Flow" height="60" />
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

### Step 1: Install

```bash
npm install -g @lemoncloud/flow-mcp
```

### Step 2: Get an API Key

Get your API key from [Eureka Codes Console](https://console.eureka.codes).

### Step 3: Configure Your MCP Client

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "npx",
      "args": ["-y", "@lemoncloud/flow-mcp"],
      "env": {
        "FLOW_API_KEY": "your-api-key"
      }
    }
  }
}
```

**Cursor / Windsurf** — add the same `mcpServers` config to your IDE's MCP settings.

### Step 4: Go!

Restart your client and say **"Show my flows"**.

> **Note:** Only `FLOW_API_KEY` is required. API URL has a sensible default.

### Configuration

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `FLOW_API_KEY` | Yes | — | API authentication key |
| `FLOW_API_URL` | | `https://api.eureka.codes/flw-v1` | API server URL |
| `FLOW_API_TIMEOUT` | | `30000` | Request timeout (ms) |
| `FLOW_WS_URL` | | — | WebSocket URL for real-time execution monitoring |

> **Tip:** Set `FLOW_WS_URL` to enable live progress tracking during `flow_run` and `node_run`.

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

## 16 Tools

Claude automatically selects the right tool based on your request.

| Tool | What it does |
|------|-------------|
| `profile_get` | Check API key configuration status |
| `block_list` | List available block types |
| `flow_list` | List your workflows |
| `flow_load` | Load full flow state (nodes, edges, ports) |
| `flow_graph` | Mermaid diagram visualization |
| `flow_create` | Create new flow (nodes + edges at once) |
| `flow_update` | Update flow name / description |
| `flow_save` | Full rebuild (caution: reassigns node IDs) |
| `flow_run` | Execute flow + real-time monitoring |
| `flow_delete` | Delete a flow |
| `node_create` | Add node to existing flow |
| `node_run` | Execute single node |
| `node_get_port` | Inspect node input/output data |
| `node_update` | Update node config / label / position |
| `node_delete` | Delete a node |
| `edge_create` | Connect two nodes |
| `edge_delete` | Remove a connection |

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
  -> server.ts (McpServer + 16 tools)
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
