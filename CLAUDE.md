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
│   ├── helpers.ts      # toolResult(), toolError(), mcpLog() response/logging helpers
│   ├── schemas.ts      # Zod output schemas for structuredContent validation
│   ├── completions.ts  # completable() auto-completion for flowId, blockType, stereo, productId
│   ├── flow-tools.ts   # 12 flow tools (profile/list/load/graph/create/update/publish/save/run/clone/export/run_from)
│   ├── node-tools.ts   # 8 tools (get/create/run/get_port/update/delete, edge_create/delete)
│   ├── block-tools.ts  # 2 block tools (get/list with cache)
│   ├── run-tools.ts    # 2 run tools (list/get execution history)
│   ├── credit-tools.ts # 4 credit tools (balance/packs/purchase/history)
│   ├── dispatch.ts     # registers the public surface: flow_read/flow_do/credit_read/credit_do (route action→captured handler)
│   └── index.ts        # barrel export
├── ws-client.ts        # WebSocket client for real-time execution monitoring + progress callbacks
├── server.ts           # McpServer setup + registerTool
├── stdio.ts            # Entry point: --help flag + 2-layer console suppression + JSON-RPC filter
└── index.ts            # Library exports
```

## Key Patterns

- **4-tool public surface**: `server.ts` registers only `flow_read` (11 read actions), `flow_do` (13 write/run actions), `credit_read` (3 read actions), and `credit_do` (1 purchase action) via `registerDispatchTools` — split by **domain × access** so users approve 4 tools, not 28, and the read tools carry `readOnlyHint`. The 28 granular `registerXTools` still define the real handlers + Zod schemas; `dispatch.ts` registers them against a fake server to **capture** their `{meta, handler}`, then routes `{action, params}` → the captured handler (params re-validated against the original schema; logging delegated to the real server). `FLOW_READ_ACTIONS`/`FLOW_DO_ACTIONS`/`CREDIT_READ_ACTIONS`/`CREDIT_DO_ACTIONS` must stay in sync with the granular tools and be pairwise disjoint — `dispatch.test.ts` enforces this. (Only the `*_read` tools are `readOnlyHint`; the `*_do` tools mutate/charge.)
- **MCP SDK v1.29** with v2 API (`McpServer` + `registerTool`)
- **Zod v4** for input schemas (`import * as z from 'zod/v4'`)
- **Error handling**: tool handlers return `{ isError: true, content: [...], structuredContent: { error, code? } }`, never throw
- **Structured output**: all tools declare `outputSchema` + return `structuredContent` via `toolResult()`
- **Auto-completion**: `completable()` on flowId (30s cache), blockType (uses block cache), stereo fields
- **Server logging**: `mcpLog()` sends `notifications/message` to MCP client during execution tools
- **Stdio safety**: 2-layer protection (console suppression + stdout JSON-RPC filter)
- **Block cache**: 5-min TTL in `FlowApiClient.listBlocks()`
- **WebSocket**: Per-call temporary connection for real-time execution monitoring (`ws-client.ts`)
- **Progress**: `onProgress` callback in WS client → MCP `notifications/progress` via `extra.sendNotification`
- **Fallback**: If `FLOW_WS_URL` not set, uses sync `async=0` execution

## Common Commands

```bash
npm run build    # TypeScript compilation
npm run bundle   # Build + pack Claude Desktop extension (flow-mcp.mcpb)
npm run lint     # ESLint
npm run lint:type # Type check (tsc --noEmit)
npm run dev      # Watch mode
npm start        # Run MCP server (stdio)
npm test         # Run tests
```

## Distribution

- **npm**: `@lemoncloud/flow-mcp` (ships `dist/` only) — for `npx`/manual MCP config.
- **Desktop Extension**: `manifest.json` (MCPB spec v0.3) → `npm run bundle` packs `flow-mcp.mcpb` for one-click Claude Desktop install with a GUI API-key prompt (`user_config.api_key` → `FLOW_API_KEY`). CI (`release.yml`) prunes devDeps, syncs the manifest version (`scripts/sync-manifest.mjs`), and attaches the `.mcpb` to each GitHub release.
- **Auth/onboarding**: one `ec-…` key authenticates flows + credits. Users get it at flow.eureka.codes → Google sign-in → Create Key → Copy (shown once).

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
| flow_publish | `POST /flows/:id/upsert` with `{ isPublic }` (open as public / private) |
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
| credit_balance | `GET /wallets/0/balance` (current wallet) |
| credit_packs | `GET /public/products/0/list?limit=100` (public, no key) |
| credit_purchase | `POST /credits/0/purchase` with `{ productId, requestId }` (card on file) |
| credit_history | `GET /transactions/0/list` (credit ledger) |

> Credit endpoints share the same eureka-flows-api base + `x-api-key` (`/_api_` prefix); `products` is served from `/public`. Note: backend does NOT auto-deduct credits on flow/node run today — running is currently free server-side; `credit_history` reflects charges once the backend wires run billing.

## Conventions

- Named exports only
- `const` + arrow functions
- Port ref format: `{nodeId}:{portId}@{direction}`
- `SaveFlowBody.nodes/edges` uses `Partial<>` to accept Zod-inferred types
