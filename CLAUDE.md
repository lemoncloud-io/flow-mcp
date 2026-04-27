# CLAUDE.md

## Project Overview

flow-mcp is an MCP (Model Context Protocol) server that provides AI assistants with tools to manage Eureka Flow visual workflows. It acts as a stateless proxy between MCP clients (Claude Desktop) and the eureka-flows-api backend.

## Architecture

```
src/
├── config.ts           # Zod v4 env validation (FLOW_API_URL, FLOW_API_KEY)
├── logger.ts           # stderr-based logger (safe for stdio MCP)
├── api-client.ts       # Axios client for eureka-flows-api + block cache
├── types.ts            # Domain types (FlowView, NodeData, EdgeData, etc.)
├── tools/
│   ├── helpers.ts      # toolJson(), toolError() response helpers
│   ├── flow-tools.ts   # 6 flow tools (list/load/create/save/delete/run)
│   ├── node-tools.ts   # 2 node tools (run/get_port)
│   ├── block-tools.ts  # 1 block tool (list with cache)
│   └── index.ts        # barrel export
├── server.ts           # McpServer setup + registerTool
├── stdio.ts            # Entry point: 2-layer console suppression + JSON-RPC filter
└── index.ts            # Library exports
```

## Key Patterns

- **MCP SDK v1.29** with v2 API (`McpServer` + `registerTool`)
- **Zod v4** for input schemas (`import * as z from 'zod/v4'`)
- **Error handling**: tool handlers return `{ isError: true, content: [...] }`, never throw
- **Stdio safety**: 2-layer protection (console suppression + stdout JSON-RPC filter)
- **Block cache**: 5-min TTL in `FlowApiClient.listBlocks()`

## Common Commands

```bash
npm run build    # TypeScript compilation
npm run lint     # Type check (tsc --noEmit)
npm run dev      # Watch mode
npm start        # Run MCP server (stdio)
npm test         # Run tests
```

## API Endpoints Called

| Tool | Endpoint |
|------|----------|
| flow_list | `GET /flows` |
| flow_load | `GET /flows/:id/load` |
| flow_create | `POST /flows/0/save` (two-step if edges provided) |
| flow_save | `POST /flows/:id/save` |
| flow_delete | `DELETE /flows/:id` |
| flow_run | `POST /flows/:id/run?async=0` |
| node_run | `POST /nodes/:id/run?async=0` |
| node_get_port | `GET /nodes/:nodeId\::portId@:dir/port` |
| block_list | `GET /blocks/0/list?cores=1` |

## Conventions

- Named exports only
- `const` + arrow functions
- Port ref format: `{nodeId}:{portId}@{direction}`
- `SaveFlowBody.nodes/edges` uses `Partial<>` to accept Zod-inferred types
