# flow-mcp

MCP server for [Eureka Flow](https://flow.eureka.codes) — manage visual workflows from Claude Desktop or any MCP client.

## Features

13 MCP tools for flow orchestration:

| Tool | Description |
|------|-------------|
| `block_list` | List available block types with ports and config schema |
| `flow_list` | List user's flows |
| `flow_load` | Load flow with full canvas state (nodes, edges, ports) |
| `flow_graph` | Visualize flow as Mermaid diagram with node status |
| `flow_create` | Create a new flow with nodes and edges |
| `flow_save` | Save flow (full replace of nodes + edges) |
| `flow_run` | Execute entire flow (WebSocket monitoring or sync fallback) |
| `node_run` | Execute a single node |
| `node_get_port` | Get port data (execution result) |
| `node_update` | Update node properties (config, label, position, etc.) |
| `node_delete` | Delete a node from a flow |
| `edge_create` | Create an edge (connection) between two nodes |
| `edge_delete` | Delete an edge from a flow |

## Setup

### Prerequisites

- Node.js >= 20
- Eureka Flows API URL and API key

### Install

```bash
npm install
npm run build
```

### Configure Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "npx",
      "args": ["-y", "@lemoncloud/flow-mcp"],
      "env": {
        "FLOW_API_URL": "https://your-flows-api.example.com",
        "FLOW_API_KEY": "your-api-key",
        "FLOW_WS_URL": "wss://your-websocket-url"
      }
    }
  }
}
```

Or with a local build:

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/flow-mcp/dist/stdio.js"],
      "env": {
        "FLOW_API_URL": "https://your-flows-api.example.com",
        "FLOW_API_KEY": "your-api-key",
        "FLOW_WS_URL": "wss://your-websocket-url"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLOW_API_URL` | No | `https://api.eureka.codes/flw-v1` | Eureka Flows API base URL |
| `FLOW_API_KEY` | Yes | — | API key for authentication |
| `FLOW_API_TIMEOUT` | No | `30000` | API request timeout in ms |
| `FLOW_WS_URL` | No | `wss://wss.eureka.codes/wss-v1` | WebSocket URL for real-time execution monitoring |

## Usage

Typical AI workflow:

1. `block_list` — discover available block types
2. `flow_create` — build a flow with nodes (edges auto-resolved)
3. `flow_run` or `node_run` — execute
4. `node_get_port` — inspect results

Always `flow_load` before `flow_save` to avoid data loss (full replace).

## Development

```bash
npm run dev      # Watch mode (tsc --watch)
npm run build    # Build
npm run lint     # Type check
npm test         # Run tests
```

## Architecture

```
stdio.ts (console suppression + JSON-RPC filter)
  -> server.ts (McpServer + tool registration)
    -> tools/*.ts (13 tool handlers)
      -> api-client.ts (Axios -> flows-api)
      -> ws-client.ts (WebSocket -> real-time execution events)
      -> config.ts (Zod env validation)
```

## License

MIT
