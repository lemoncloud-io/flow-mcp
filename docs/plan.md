# Plan: flow-mcp — MCP Server for Eureka Flow

**Date:** 2026-04-27
**Size:** M (3-10 files)
**Reference:** `refer/n8n-mcp/`

---

## 0. Rethink

**What the user actually wants:**
Claude Desktop (or other MCP clients) 에서 Eureka Flow의 워크플로우를 조회/생성/수정/실행할 수 있는 MCP 서버.

**Why MCP?**
- AI agent가 flow를 직접 조작 → 자연어로 워크플로우 빌드 가능
- n8n-mcp처럼 Claude Desktop에 연결하여 "flow 만들어줘" 식의 대화형 워크플로우 관리

**Scope 제한:**
- Phase 1: Stdio transport만 (Claude Desktop 연동)
- HTTP/SSE transport는 Phase 2 (이번 플랜 범위 밖)
- WebSocket 실시간 모니터링은 제외 (polling으로 대체)

---

## 1. Architecture

```
flow-mcp/
├── src/
│   ├── index.ts                  # Library export
│   ├── stdio.ts                  # Stdio entry point (bin)
│   ├── server.ts                 # McpServer setup + tool registration
│   ├── config.ts                 # Zod env config (FLOW_API_URL, FLOW_API_KEY)
│   ├── api-client.ts             # Axios client for eureka-flows-api
│   ├── tools/
│   │   ├── index.ts              # barrel export
│   │   ├── flow-tools.ts         # flow CRUD tools
│   │   ├── node-tools.ts         # node execution tools
│   │   └── block-tools.ts        # block listing tools
│   └── types.ts                  # Domain types (FlowView, NodeData, etc.)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

**Layers:**
```
stdio.ts (console suppression + transport)
  → server.ts (McpServer + registerTool)
    → tools/*.ts (tool handlers)
      → api-client.ts (Axios → flows-api)
        → config.ts (Zod env validation)
```

---

## 2. MCP SDK Version Decision

**Use `@modelcontextprotocol/sdk` v2 (latest)**
- `McpServer` class (not raw `Server`)
- `server.registerTool(name, config, handler)` API
- `inputSchema: z.object({...})` — **must use `import * as z from 'zod/v4'`** (Zod 3.25+ ships v4 as subpath export, required for Standard Schema)
- Error handling: return `{ isError: true, content: [...] }` in handlers

**n8n-mcp는 v1 API 사용 중** (raw `Server` + `setRequestHandler` + `zod` 3.24). 우리는 v2로 가되, 패턴(stdio wrapper, config validation, error handling)은 차용.

> **주의:** `import { z } from 'zod'` (v3 API) 가 아니라 `import * as z from 'zod/v4'` 사용. MCP SDK v2의 `registerTool`이 Standard Schema를 요구하며, Zod v4만 이를 지원.

---

## 3. Tool Definitions (9 tools)

### Flow Tools

| Tool | Description | API Endpoint |
|------|------------|-------------|
| `flow_list` | List user's flows. Use this first to see available flows. | `GET /flows` |
| `flow_load` | Load flow with full canvas state (nodes, edges, ports). Use to inspect a flow's structure before modifying. | `GET /flows/:id/load` |
| `flow_create` | Create a new flow with nodes and edges. Use block_list first to discover available block types. If edges are provided, handler internally does two-step: create nodes → resolve IDs → save edges. | `POST /flows/0/save` (×2 if edges) |
| `flow_save` | Save flow (full replace of nodes + edges). Always flow_load first to get current state. **Destructive: overwrites all existing nodes/edges.** | `POST /flows/:id/save` |
| `flow_delete` | Delete a flow permanently. | `DELETE /flows/:id` |
| `flow_run` | Execute entire flow synchronously. For long-running flows, timeout may occur (30s default). | `POST /flows/:id/run?async=0` |

### Node Tools

| Tool | Description | API Endpoint |
|------|------------|-------------|
| `node_run` | Execute a single node. Use node_get_port after to check results. | `POST /nodes/:id/run?async=0&propagate=0` |
| `node_get_port` | Get port data (execution result) for a node's input or output. | `GET /nodes/:id\::portId@:dir/port` |

### Block Tools

| Tool | Description | API Endpoint |
|------|------------|-------------|
| `block_list` | List all available block definitions with ports and config schema. Call this before creating flows to know what blocks exist and how to configure them. | `GET /blocks/0/list?cores=1` |

> `session_info` 제거 — 디버깅용이며 사용자 가치 없음. 도구 수를 줄여 AI의 도구 선택 정확도 향상.

---

## 4. Tool Input/Output Schemas

### `flow_list`
```ts
input: z.object({
  isPublic: z.boolean().optional().describe('Filter public flows only'),
})
output: text → JSON list of { id, name, state, status, isPublic, modifiedAt }
```

### `flow_load`
```ts
input: z.object({
  flowId: z.string().describe('Flow ID to load'),
})
output: text → JSON { id, name, nodes[], edges[], ports[], isEditable }
```

### `flow_create`
```ts
// NodeData minimal schema — AI가 올바른 JSON을 생성하도록 구조 가이드 제공
const NodeDataSchema = z.object({
  type: z.string().describe('Block process type (e.g., "input-text", "text-transform"). Get from block_list.'),
  position: z.object({ x: z.number(), y: z.number() }).describe('Canvas position'),
  config: z.record(z.string()).optional().describe('Node config key-value pairs. Keys from block configSchema.'),
  customLabel: z.string().optional(),
});

const EdgeDataSchema = z.object({
  sourceNodeId: z.string().describe('Source node ID (returned after save)'),
  sourcePortId: z.string().describe('Source port ID (e.g., "out"). Get from block outputs.'),
  targetNodeId: z.string().describe('Target node ID'),
  targetPortId: z.string().describe('Target port ID (e.g., "in"). Get from block inputs.'),
});

input: z.object({
  name: z.string().describe('Flow name'),
  description: z.string().optional(),
  nodes: z.array(NodeDataSchema).optional().describe('Initial nodes.'),
  edges: z.array(EdgeDataSchema).optional().describe('Connections between nodes. Node IDs use array index references (e.g., "0", "1") which are resolved to real IDs internally.'),
})
output: text → JSON created flow with node IDs

// [Eng Review 1B] flow_create handler 내부 로직:
// 1. edges가 없으면: POST /flows/0/save { name, nodes } → 1회 호출
// 2. edges가 있으면:
//    a. POST /flows/0/save { name, nodes } → 노드 생성, 실제 ID 반환
//    b. edges의 sourceNodeId/targetNodeId를 배열 인덱스 → 실제 ID로 매핑
//    c. POST /flows/{id}/save { nodes, edges } → 엣지 포함 저장
// AI가 두 번 호출할 필요 없이 한 번에 처리
```

### `flow_save`
```ts
input: z.object({
  flowId: z.string().describe('Flow ID. Use flow_load first to get current state.'),
  name: z.string().optional(),
  description: z.string().optional(),
  nodes: z.array(NodeDataSchema).describe('Full node list (replaces ALL existing nodes)'),
  edges: z.array(EdgeDataSchema).describe('Full edge list (replaces ALL existing edges)'),
})
// [Eng Review 2B] destructiveHint annotation
annotations: { destructiveHint: true, idempotentHint: true }
output: text → JSON saved flow
```

### `flow_delete`
```ts
input: z.object({
  flowId: z.string().describe('Flow ID to delete'),
})
output: text → confirmation
```

### `flow_run`
```ts
input: z.object({
  flowId: z.string().describe('Flow ID to execute'),
  config: z.record(z.string()).optional().describe('Config overrides'),
})
output: text → JSON execution result
```

### `node_run`
```ts
input: z.object({
  nodeId: z.string().describe('Node ID to execute'),
  propagate: z.boolean().optional().default(false).describe('Propagate to downstream nodes'),
  config: z.record(z.string()).optional(),
})
output: text → JSON node execution result
```

### `node_get_port`
```ts
input: z.object({
  nodeId: z.string().describe('Node ID'),
  portId: z.string().describe('Port ID (e.g., "out")'),
  direction: z.enum(['in', 'out']).describe('Port direction'),
})
output: text → JSON port data { type, value, timestamp }
```

### `block_list`
```ts
input: z.object({
  stereo: z.enum(['input', 'process', 'output']).optional().describe('Filter by category'),
})
output: text → JSON list of block definitions
```

### Shared Schemas (types.ts에 정의)
```ts
// NodeData, EdgeData 스키마는 flow_create, flow_save에서 재사용
// block_list 응답의 $definition.inputs/outputs/configSchema가 각 블록의 포트/설정 구조를 제공
// AI workflow: block_list → 블록 구조 파악 → flow_create로 노드 배치 → flow_save로 엣지 연결
```

---

## 5. Config Schema

```ts
// src/config.ts
const configSchema = z.object({
  FLOW_API_URL: z.string().url().describe('Eureka Flows API base URL'),
  FLOW_API_KEY: z.string().min(1).describe('API key for authentication'),
  FLOW_API_TIMEOUT: z.coerce.number().positive().default(30000),
});
```

**.env.example:**
```
FLOW_API_URL=https://your-flows-api.example.com
FLOW_API_KEY=your-api-key-here
FLOW_API_TIMEOUT=30000
```

---

## 6. API Client Design

```ts
// src/api-client.ts
class FlowApiClient {
  private client: AxiosInstance;

  constructor(config: FlowApiConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
    });
    // Response interceptor: normalize errors
  }

  // Flow operations
  listFlows(params?: { isPublic?: boolean }): Promise<ListResult<FlowView>>
  loadFlow(id: string): Promise<SaveFlowView>
  createFlow(body: { name: string; description?: string }): Promise<FlowView>
  saveFlow(id: string, body: SaveFlowBody): Promise<SaveFlowView>
  deleteFlow(id: string): Promise<void>
  runFlow(id: string, body?: { config?: Record<string, string> }): Promise<FlowView>

  // Node operations
  runNode(id: string, options?: { propagate?: boolean; config?: Record<string, string> }): Promise<NodeView>
  getPortData(nodeId: string, portId: string, direction: string): Promise<PortData>

  // Block operations
  listBlocks(): Promise<ListResult<BlockView>>

}
```

**Error Handling Pattern:**
- API 에러 → `{ isError: true, content: [{ type: 'text', text: error.message }] }` 반환
- Network 에러 → 같은 패턴, connection refused 등 구분
- 인증 에러 (401/403) → "API key가 유효하지 않습니다" 메시지
- **[Eng Review 3A] Timeout 에러** → Axios `ECONNABORTED` 감지 시:
  `"Execution timed out (${timeout}ms). The flow may still be running on the server. Use flow_load to check status, or increase FLOW_API_TIMEOUT."` 메시지 반환

---

## 7. Stdio Wrapper (Critical)

n8n-mcp의 3-layer protection 패턴 적용:

```ts
// src/stdio.ts
// Layer 1: env flag
process.env.MCP_MODE = 'stdio';

// Layer 2: console.* suppression
console.log = () => {};
console.error = () => {};
// ... all methods

// Layer 3: stdout.write intercept (JSON-RPC only)
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  if (str.trimStart().startsWith('{') && str.includes('"jsonrpc"')) {
    return originalWrite(chunk, ...rest);
  }
  return process.stderr.write(chunk, ...rest);
};

// Import AFTER suppression
import('./server.js').then(m => m.createServer().run());
```

---

## 8. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^2.0.0",
    "zod": "^3.25.0",
    "axios": "^1.14.0",
    "dotenv": "^16.5.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@types/node": "^22.0.0",
    "vitest": "^3.0.0"
  }
}
```

---

## 9. Implementation Order

### Step 1: Project Scaffold
- [ ] `package.json` (name, bin, main, scripts, dependencies)
- [ ] `tsconfig.json` (ES2020, commonjs, strict)
- [ ] `.env.example`

### Step 2: Config + Types
- [ ] `src/config.ts` — Zod env validation
- [ ] `src/types.ts` — FlowView, NodeData, EdgeData, PortData, BlockView 타입

### Step 3: API Client
- [ ] `src/api-client.ts` — Axios wrapper with all endpoints

### Step 4: Tool Handlers
- [ ] `src/tools/flow-tools.ts` — flow_list, flow_load, flow_create, flow_save, flow_delete, flow_run
- [ ] `src/tools/node-tools.ts` — node_run, node_get_port
- [ ] `src/tools/block-tools.ts` — block_list
- [ ] `src/tools/index.ts` — barrel export

### Step 5: Server + Entry Point
- [ ] `src/server.ts` — McpServer setup, registerTool for all tools
- [ ] `src/stdio.ts` — Stdio wrapper with console suppression
- [ ] `src/index.ts` — Library export

### Step 6: Build & Test
- [ ] Build (`tsc`)
- [ ] Manual test with Claude Desktop config
- [ ] README.md (설치/설정 가이드)

---

## 10. Claude Desktop Config (최종 결과물)

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "node",
      "args": ["/path/to/flow-mcp/dist/stdio.js"],
      "env": {
        "FLOW_API_URL": "https://your-flows-api.example.com",
        "FLOW_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## 11. Checklist

- [x] Endpoints defined (method, path, request/response)
- [x] Input validation schemas defined (Zod)
- [x] Error cases identified (auth, network, not found)
- [x] Auth requirements specified (x-api-key header)
- [x] Service layer responsibilities clear (ApiClient → Tool Handler → McpServer)
- [x] Test strategy: manual Claude Desktop test (Phase 1)
- [ ] DB schema — N/A (stateless proxy)
- [ ] Caching — block_list만 in-memory cache (변경 빈도 낮음)
- [ ] Rate limiting — N/A (flows-api에서 처리)

---

## Boundaries

### Do
- Layered: stdio.ts → server.ts → tools/ → api-client.ts → config.ts
- Input validation at tool boundary (Zod inputSchema)
- Centralized error handling (try-catch → isError response)
- Named exports only

### Ask First
- Adding WebSocket support (Phase 2)
- Adding HTTP/SSE transport (Phase 2)
- Adding block definition caching strategy

### Don't
- DB/storage layer (stateless proxy)
- Frontend code
- Direct DynamoDB access (API를 통해서만)

---

## CEO Review (2026-04-27)

**Rating:** 6-star → 7-star (after revision)
**Verdict:** REVISE → APPROVED (after applying fixes below)

**Applied:**
- [x] `z.any()` → `NodeDataSchema`, `EdgeDataSchema` 최소 타입 정의
- [x] `session_info` 제거 (10 → 9 tools)
- [x] 도구 description에 사용 시점 + 선후관계 힌트 추가
- [x] `block_list` description에 "flow 생성 전 반드시 호출" 명시

**Deferred (Phase 2):**
- `block_describe` 별도 도구 → `block_list?cores=1`이 이미 `$definition` (ports, configSchema) 포함하므로 Phase 1에서는 불필요. 블록 수가 많아져 응답이 커지면 Phase 2에서 분리
- 동기 실행 타임아웃 → `FLOW_API_TIMEOUT` 설정으로 조절 가능. 에러 메시지에 안내 포함
- 단위 테스트 → Phase 2에서 API client mock 테스트 추가

---

## Eng Review (2026-04-27)

**Scope:** ACCEPTED (10 files, 1 class, under thresholds)

**Applied (1B, 2B, 3A):**
- [x] **1B** `flow_create` 내부 two-step: edges 포함 시 자동으로 nodes 먼저 저장 → ID 매핑 → edges 저장. AI는 한 번만 호출.
- [x] **2B** `flow_save`에 `destructiveHint: true` annotation 추가. MCP 클라이언트가 확인 표시 가능.
- [x] **3A** `flow_run`, `node_run` timeout 시 구체적 에러 메시지 반환 (ECONNABORTED 감지).
- [x] **Zod v4 import** 명시: `import * as z from 'zod/v4'` (MCP SDK v2 Standard Schema 요구사항)

---

**Plan complete → Next: `/nodejs-02-implement`**
