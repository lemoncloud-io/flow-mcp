# Contributing

Thank you for your interest in contributing to flow-mcp!

## Prerequisites

- Node.js >= 20
- npm
- Eureka Flows API key (`FLOW_API_KEY`)

## Quick Start

```bash
git clone https://github.com/lemoncloud-io/flow-mcp.git
cd flow-mcp
npm install
cp .env.example .env   # Set FLOW_API_KEY
npm run build
```

## Project Structure

```
src/
├── config.ts           # Zod v4 env validation
├── logger.ts           # stderr-based logger (stdio MCP safe)
├── api-client.ts       # Axios HTTP client (eureka-flows-api)
├── ws-client.ts        # WebSocket client (real-time execution monitoring)
├── types.ts            # Domain types (FlowView, NodeData, EdgeData, etc.)
├── tools/
│   ├── helpers.ts      # toolJson(), toolError() response helpers
│   ├── flow-tools.ts   # flow_list, flow_load, flow_graph, flow_create, flow_save, flow_run
│   ├── node-tools.ts   # node_run, node_get_port, node_update, node_delete, edge_create, edge_delete
│   ├── block-tools.ts  # block_list (5-min cache)
│   └── index.ts        # barrel export
├── server.ts           # McpServer setup + tool registration
├── stdio.ts            # Entry point (console suppression + JSON-RPC filter)
└── index.ts            # Library exports
tests/
├── setup/global-setup.ts   # Global mock cleanup + logger suppression
├── helpers/factories.ts    # Test data factories (makeFlow, makeNode, etc.)
├── unit/                   # Unit tests
└── integration/            # MCP protocol round-trip tests
```

## Development Commands

```bash
npm run dev         # Watch mode (tsc --watch)
npm run build       # TypeScript build -> dist/
npm run lint        # ESLint
npm run lint:type   # Type check (tsc --noEmit)
npm run format      # Prettier format
npm test            # Run all tests
npm run test:watch  # Watch mode tests
```

## Testing

### Run Tests

```bash
npm test                                        # All tests
npx vitest run tests/unit/api-client.test.ts    # Single file
npm run test:watch                              # Watch mode
npx vitest run --coverage                       # Coverage report -> coverage/
```

### Test Conventions

- **AAA pattern**: Arrange → Act → Assert
- **Naming**: `should [action] when [condition]`
- **Factories**: Use `makeFlow()`, `makeNode()`, `makeBlock()`, etc. from `tests/helpers/factories.ts`
- **No throws**: Tool handlers return `{ isError: true }`, never throw

### Adding a New Tool — Test Checklist

1. Add unit tests in `tests/unit/<tool-category>.test.ts`
2. Update tool count in `tests/integration/mcp-protocol.test.ts`
3. Add factories in `tests/helpers/factories.ts` if needed
4. Add mock methods to `makeApiClient` and integration test `mockApi`

## Local Verification

### MCP Inspector

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/stdio.js
```

Set `FLOW_API_KEY` in the Inspector environment, then test each tool.

### Claude Desktop

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/flow-mcp/dist/stdio.js"],
      "env": { "FLOW_API_KEY": "your-api-key" }
    }
  }
}
```

Restart Claude Desktop and try: "Show my flows".

## Code Conventions

- Named exports only (no `export default`)
- `const` + arrow functions
- Zod v4: `import * as z from 'zod/v4'`
- Tool handlers return `{ isError: true, content: [...] }`, never throw
- Port ref format: `{nodeId}:{portId}@{direction}`
- Max 80 lines per function body

## Pull Request Process

1. Fork the repo and create a feature branch from `develop`
2. Make your changes with tests
3. Run `npm test && npm run build` — all must pass
4. Submit a PR to `develop`
5. After review + merge to `develop`, a separate PR to `main` triggers npm publish

## Adding a New Tool

1. Register with `server.registerTool()` in `src/tools/<category>-tools.ts`
2. Add API method in `src/api-client.ts` if needed
3. Add types in `src/types.ts`
4. Write tests (see checklist above)
5. Run `npm test && npm run build`
