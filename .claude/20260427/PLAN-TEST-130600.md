# Test Plan: flow-mcp

> 9 MCP tools, 817 source lines, 0 existing tests → target: unit + integration coverage

## Test Stack

| Tool | Version | Purpose |
|------|---------|---------|
| vitest | ^3.0.0 | Test runner (already installed) |
| @vitest/coverage-v8 | latest | Coverage reporting (to install) |
| @modelcontextprotocol/sdk | ^1.29.0 | `InMemoryTransport`, `Client` for MCP protocol tests (already installed) |

**No additional mock libraries needed.** Use `vi.fn()` for API client mocks, `vi.spyOn` for axios interceptor tests. `InMemoryTransport` is built into the SDK.

## Architecture

```
tests/
  setup/
    global-setup.ts          # clearAllMocks, restoreAllMocks, console suppression
  helpers/
    mcp-test-client.ts       # McpServer + InMemoryTransport + Client wiring helper
    factories.ts              # Test data builders (flow, node, block, port, config)
  unit/
    helpers.test.ts           # toolJson, toolError
    config.test.ts            # getConfig, getConfigOrThrow (vi.resetModules per test)
    api-client.test.ts        # FlowApiClient methods + normalizeError via interceptor
    flow-tools.test.ts        # 6 flow handlers + resolveNodeId
    node-tools.test.ts        # 2 node handlers
    block-tools.test.ts       # block_list handler + summarizeBlock
  integration/
    mcp-protocol.test.ts      # Full MCP round-trip via InMemoryTransport
```

## Test Priorities

### P0 — Critical (must-have before ship)

#### 1. `tests/unit/helpers.test.ts` — 0 deps, fastest
- `toolJson(object)` → `{ content: [{ type: 'text', text: pretty-json }] }`
- `toolJson(null)` → handles null
- `toolError(Error)` → `{ isError: true, content: [{ type: 'text', text: message }] }`
- `toolError(string)` → converts via `String()`
- `toolError(number)` → converts via `String()`

#### 2. `tests/unit/config.test.ts` — env validation
- Valid env → returns parsed `FlowApiConfig`
- Missing `FLOW_API_URL` → returns null
- Invalid URL format → returns null
- Missing `FLOW_API_KEY` → returns null
- `FLOW_API_TIMEOUT` string "5000" → coerces to number
- `FLOW_API_TIMEOUT` absent → defaults to 30000
- Caching: second call returns same instance (no re-parse)
- `getConfigOrThrow()` → throws with descriptive message when invalid
- **Note:** `cached` is module-level. Use `vi.resetModules()` + re-import per test.

#### 3. `tests/unit/api-client.test.ts` — HTTP client
Mock strategy: `vi.spyOn(client['client'], 'get/post/delete')` or construct with mock axios instance.

**Method tests:**
- `listFlows()` → `GET /flows` no params
- `listFlows({ isPublic: true })` → `isPublic=1`
- `loadFlow(id)` → `GET /flows/{id}/load`
- `createFlow(body)` → `POST /flows/0`
- `saveFlow(id, body)` → `POST /flows/{id}/save`
- `deleteFlow(id)` → `DELETE /flows/{id}`
- `runFlow(id)` → `POST /flows/{id}/run?async=0` with empty body
- `runFlow(id, { config })` → passes config
- `runNode(id, { propagate: true })` → `propagate=1`
- `getPortData(nodeId, portId, dir)` → URL encodes `nodeId:portId@dir`
- `listBlocks()` → `GET /blocks/0/list?cores=1&limit=-1`

**Cache tests (vi.useFakeTimers):**
- `listBlocks()` → cached within 5 min TTL
- `listBlocks()` → re-fetches after TTL
- `listBlocks(true)` → bypasses cache

**Error normalization (trigger via interceptor):**
- ECONNABORTED → `FlowApiError('timeout', ...)`
- 401 → `FlowApiError('auth', ...)`
- 403 → `FlowApiError('auth', ...)`
- 404 → `FlowApiError('not_found', ...)`
- 500 → `FlowApiError('api', ...)`
- Network error (no response) → `FlowApiError('api', 'network')`
- Message extraction: `body.message` > `body.error` > `error.message`

#### 4. `tests/unit/flow-tools.test.ts` — 6 tools + resolveNodeId
Mock `FlowApiClient` via `vi.fn()` stubs. Capture handlers by calling `registerFlowTools` with mock `McpServer`.

**`resolveNodeId` (needs export or test via handler):**
- `"0"` + `[{id:'real-0'}]` → `"real-0"`
- `"1"` + `[{id:'a'},{id:'b'}]` → `"b"`
- `"99"` + `[{id:'a'}]` → `"99"` (out of bounds)
- `"abc-123"` → passthrough (non-numeric)
- `"01"` → passthrough (`String(1) !== "01"`)
- `"0"` + `[{id: undefined}]` → `"0"` (nullish fallback)

**Handler tests:** Each handler: happy path + API error → `toolError`.

**`flow_create` special cases:**
- No nodes/edges → single `saveFlow('0', ...)` call
- With nodes, no edges → single call, no second save
- With edges → two-step: create then resolve edge indices
- API error on first save → `toolError`
- API error on second save → `toolError`

### P1 — Important

#### 5. `tests/unit/node-tools.test.ts`
- `node_run` default `propagate: false`
- `node_run` with `propagate: true`, `config`
- `node_get_port` calls `getPortData` correctly
- Error paths

#### 6. `tests/unit/block-tools.test.ts`
- `summarizeBlock` field precedence: `processType ?? $definition.type`, `label ?? name`, etc.
- `block_list` filters `isHidden: true`
- `block_list` stereo filter (`input`, `process`, `output`)
- Error path

#### 7. `tests/integration/mcp-protocol.test.ts` — full round-trip
Uses `InMemoryTransport` + `Client` from MCP SDK.

```ts
// Pattern:
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(serverTransport);
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(clientTransport);

const res = await client.callTool({ name: 'flow_list', arguments: {} });
```

**Scenarios:**
- `listTools` returns all 9 tools with correct names
- `flow_list` returns valid JSON response
- `block_list` with stereo filter works through protocol
- Error response has `isError: true`
- **Note:** Fresh `McpServer` per test (SDK single-use restriction). Close order: client first, then server.

### P2 — Nice-to-have (defer)

- `server.ts` wiring test
- `stdio.ts` stdout filter (extract predicate as pure function)
- stdio subprocess spawn + shutdown test

## Test Helpers

### `tests/helpers/factories.ts`
```ts
// Builder pattern with sensible defaults
export const makeFlow = (overrides?: Partial<FlowView>): FlowView => ({ ... })
export const makeSaveFlow = (overrides?: Partial<SaveFlowView>): SaveFlowView => ({ ... })
export const makeNode = (overrides?: Partial<NodeData>): NodeData => ({ ... })
export const makeBlock = (overrides?: Partial<BlockView>): BlockView => ({ ... })
export const makePort = (overrides?: Partial<PortData>): PortData => ({ ... })
export const makeConfig = (overrides?: Partial<FlowApiConfig>): FlowApiConfig => ({ ... })
```

### `tests/helpers/mcp-test-client.ts`
```ts
// Wires McpServer + InMemoryTransport + Client, returns { server, client, cleanup }
export const createTestMcp = async (apiClient: FlowApiClient) => { ... }
```

### `tests/setup/global-setup.ts`
```ts
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
// Suppress console in tests
```

## Vitest Config

```ts
// vitest.config.ts
{
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/global-setup.ts'],
    pool: 'threads',           // required for InMemoryTransport
    isolate: true,
    teardownTimeout: 1000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'tests/', 'dist/', 'refer/', '**/*.d.ts'],
    },
  },
}
```

## Implementation Considerations

### Internal Function Access
- `resolveNodeId` (flow-tools.ts) and `summarizeBlock` (block-tools.ts) are not exported
- **Option A:** Export them for direct testing (recommended — they are pure functions)
- **Option B:** Test indirectly through handler behavior

### Config Module Caching
- `cached` variable persists across tests in same module instance
- Must use `vi.resetModules()` + dynamic `import()` per test case

### McpServer Single-Use
- SDK enforces one `connect()` per instance
- Create fresh `McpServer` in every `beforeEach`
- Close order: `client.close()` → `server.close()`

## Dependencies to Install

```bash
npm install -D @vitest/coverage-v8
```

## Estimated Test Count

| File | Tests |
|------|-------|
| helpers.test.ts | ~5 |
| config.test.ts | ~9 |
| api-client.test.ts | ~25 |
| flow-tools.test.ts | ~20 |
| node-tools.test.ts | ~6 |
| block-tools.test.ts | ~10 |
| mcp-protocol.test.ts | ~6 |
| **Total** | **~81** |

## Execution Order

1. Setup: vitest.config.ts + global-setup.ts + factories
2. P0: helpers → config → api-client → flow-tools
3. P1: node-tools → block-tools → mcp-protocol
4. Verify: `npm test`, `npm run test -- --coverage`

---

Plan complete -> Next: `/nodejs-05-test` (implement tests)
