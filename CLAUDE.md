# CLAUDE.md

## Project Overview

flow-mcp is an MCP (Model Context Protocol) server that provides AI assistants with tools to manage Eureka Flow visual workflows. It acts as a stateless proxy between MCP clients (Claude Desktop, Cursor, etc.) and the eureka-flows-api backend.

## Architecture

```
src/
├── config.ts           # Zod v4 env validation (FLOW_API_URL, FLOW_API_KEY)
├── logger.ts           # stderr-based logger (safe for stdio MCP)
├── api-client.ts       # Axios client for eureka-flows-api + block cache
├── types.ts            # Domain types (FlowView, NodeData, EdgeData, etc.)
├── tools/
│   ├── helpers.ts      # toolJson(), toolError() response helpers
│   ├── flow-tools.ts   # 11 flow tools (profile/list/load/graph/create/update/save/run/clone/export/run_from)
│   ├── node-tools.ts   # 8 tools (get/create/run/get_port/update/delete, edge_create/delete)
│   ├── block-tools.ts  # 2 block tools (get/list with cache)
│   ├── run-tools.ts    # 2 run tools (list/get execution history)
│   └── index.ts        # barrel export
├── ws-client.ts        # WebSocket client for real-time execution monitoring + progress callbacks
├── server.ts           # McpServer setup + registerTool
├── stdio.ts            # Entry point: --help flag + 2-layer console suppression + JSON-RPC filter
└── index.ts            # Library exports
```

## Key Patterns

- **MCP SDK v1.29** with v2 API (`McpServer` + `registerTool`)
- **Zod v4** for input schemas (`import * as z from 'zod/v4'`)
- **Error handling**: tool handlers return `{ isError: true, content: [...] }`, never throw
- **Stdio safety**: 2-layer protection (console suppression + stdout JSON-RPC filter)
- **Block cache**: 5-min TTL in `FlowApiClient.listBlocks()`
- **WebSocket**: Per-call temporary connection for real-time execution monitoring (`ws-client.ts`)
- **Progress**: `onProgress` callback in WS client → MCP `notifications/progress` via `extra.sendNotification`
- **Fallback**: If `FLOW_WS_URL` not set, uses sync `async=0` execution

## Common Commands

```bash
npm run build    # TypeScript compilation
npm run lint     # ESLint
npm run lint:type # Type check (tsc --noEmit)
npm run dev      # Watch mode
npm start        # Run MCP server (stdio)
npm test         # Run tests
```

## API Endpoints Called

| Tool | Endpoint |
|------|----------|
| profile_get | `GET /flows/0/profile` |
| flow_list | `GET /flows` or `GET /public/flows` |
| flow_load | `GET /flows/:id/load` |
| flow_graph | Uses `flow_load` data to generate Mermaid diagram |
| flow_create | `POST /flows/0/save` (two-step if edges) |
| flow_clone | `GET /flows/:id/load` + `POST /flows/0/save` (two-step) |
| flow_export | `GET /flows/:id/load` (returns clean JSON) |
| flow_update | `POST /flows/:id/upsert` (metadata only) |
| flow_save | `POST /flows/:id/save` (full replace — use with caution) |
| flow_run | Start nodes with `POST /nodes/:id/run?propagate=1` + WebSocket |
| flow_run_from | `POST /nodes/:id/run?propagate=1` from specific node + WebSocket |
| node_get | `GET /nodes/:id` |
| node_create | `POST /nodes/0/upsert?flowId=:flowId` |
| node_run | `POST /nodes/:id/run` + WebSocket monitoring |
| node_get_port | `GET /nodes/:nodeId\::portId@:dir/port` |
| node_update | `POST /nodes/:id/upsert?flowId=:flowId` |
| node_delete | `POST /flows/:id/upsert` with `#` prefix |
| edge_create | `POST /flows/:id/upsert` |
| edge_delete | `POST /flows/:id/upsert` with `#` prefix |
| block_get | `GET /blocks/:id` (by ID or name) |
| block_list | `GET /blocks/0/list?cores=1` (cached 5min) |
| run_list | `GET /runs` (execution history) |
| run_get | `GET /runs/:id` (run details + token usage) |

## Conventions

- Named exports only
- `const` + arrow functions
- Port ref format: `{nodeId}:{portId}@{direction}`
- `SaveFlowBody.nodes/edges` uses `Partial<>` to accept Zod-inferred types
