# Contributing

flow-mcp 개발 가이드.

## Prerequisites

- Node.js >= 20
- npm
- Eureka Flows API key (`FLOW_API_KEY`)

## Quick Start

```bash
git clone <repo-url>
cd flow-mcp
npm install
cp .env.example .env   # FLOW_API_KEY 설정
npm run build
```

## Project Structure

```
src/
├── config.ts           # Zod v4 환경변수 검증
├── logger.ts           # stderr 기반 로거 (stdio MCP 안전)
├── api-client.ts       # Axios HTTP 클라이언트 (eureka-flows-api)
├── ws-client.ts        # WebSocket 클라이언트 (실시간 실행 모니터링)
├── types.ts            # 도메인 타입 (FlowView, NodeData, EdgeData 등)
├── tools/
│   ├── helpers.ts      # toolJson(), toolError() 응답 헬퍼
│   ├── flow-tools.ts   # flow_list, flow_load, flow_graph, flow_create, flow_save, flow_run
│   ├── node-tools.ts   # node_run, node_get_port, node_update, node_delete, edge_create, edge_delete
│   ├── block-tools.ts  # block_list (5분 캐시)
│   └── index.ts        # barrel export
├── server.ts           # McpServer 설정 + 도구 등록
├── stdio.ts            # 엔트리포인트 (console 억제 + JSON-RPC 필터)
└── index.ts            # 라이브러리 export
tests/
├── setup/global-setup.ts   # 전역 mock 정리 + 로거 억제
├── helpers/factories.ts    # 테스트 데이터 팩토리 (makeFlow, makeNode 등)
├── unit/                   # 유닛 테스트
│   ├── config.test.ts
│   ├── api-client.test.ts
│   ├── helpers.test.ts
│   ├── flow-tools.test.ts
│   ├── node-tools.test.ts
│   └── block-tools.test.ts
└── integration/
    └── mcp-protocol.test.ts  # MCP 프로토콜 통합 테스트
```

## Development Commands

```bash
npm run dev      # Watch 모드 (tsc --watch) — 파일 변경 시 자동 컴파일
npm run build    # TypeScript 빌드 → dist/
npm run lint     # 타입 체크 (tsc --noEmit)
npm test         # 전체 테스트 실행
npm run test:watch  # 파일 변경 시 자동 테스트
```

## Testing

### Test Stack

- **Vitest** — 테스트 프레임워크
- **@vitest/coverage-v8** — 커버리지 (text + html 리포트)
- **InMemoryTransport** — MCP SDK 내장, 프로토콜 레벨 통합 테스트

### 테스트 실행

```bash
# 전체 테스트
npm test

# 특정 파일만
npx vitest run tests/unit/api-client.test.ts

# Watch 모드 (개발 중 추천)
npm run test:watch

# 커버리지 리포트
npx vitest run --coverage
# → coverage/ 디렉토리에 HTML 리포트 생성
```

### 테스트 구조

**Unit Tests** (`tests/unit/`) — 개별 모듈을 격리 테스트:

| 파일 | 대상 | 주요 검증 |
|------|------|-----------|
| `config.test.ts` | `config.ts` | 환경변수 파싱, 기본값, 캐싱, 유효성 검증 |
| `api-client.test.ts` | `api-client.ts` | HTTP 호출, 에러 정규화, 블록 캐시 TTL |
| `helpers.test.ts` | `tools/helpers.ts` | toolJson/toolError 응답 포맷 |
| `flow-tools.test.ts` | `tools/flow-tools.ts` | 6개 flow 도구 핸들러, resolveNodeId |
| `node-tools.test.ts` | `tools/node-tools.ts` | node_run, node_get_port 핸들러 |
| `block-tools.test.ts` | `tools/block-tools.ts` | summarizeBlock 필드 우선순위, 필터링 |

**Integration Tests** (`tests/integration/`) — MCP 프로토콜 라운드트립:

| 파일 | 주요 검증 |
|------|-----------|
| `mcp-protocol.test.ts` | 도구 목록 조회, 도구 호출, 에러 응답, 필터링 |

### 테스트 작성 컨벤션

```typescript
// AAA 패턴 (Arrange-Act-Assert)
it('should return cached data within TTL', async () => {
  // Arrange
  const { client, axiosInstance } = createClient();
  const data = makeListResult([makeBlock()]);
  const spy = vi.spyOn(axiosInstance, 'get').mockResolvedValue({ data });

  // Act
  await client.listBlocks();
  await client.listBlocks();

  // Assert
  expect(spy).toHaveBeenCalledTimes(1);
});
```

- **네이밍**: `should [동작] when [조건]`
- **팩토리 사용**: `makeFlow()`, `makeNode()`, `makeBlock()` 등 (`tests/helpers/factories.ts`)
- **Mock API 클라이언트**: `makeApiClient()` — 모든 API 메서드가 `vi.fn()`
- **글로벌 setup**: `tests/setup/global-setup.ts`에서 mock 정리 + 로거 자동 억제
- **모듈 캐시 테스트**: `vi.resetModules()` + dynamic `import()` 사용 (config.test.ts 참고)

### 새 도구 추가 시 테스트 체크리스트

1. `tests/unit/<tool-category>.test.ts`에 유닛 테스트 추가
2. `tests/integration/mcp-protocol.test.ts`의 도구 목록 assertion 업데이트
3. `tests/helpers/factories.ts`에 필요한 팩토리 추가
4. mock API client에 새 메서드 추가 (`makeApiClient`, integration test의 `mockApi`)

## Local Verification with MCP Inspector

빌드 후 [MCP Inspector](https://github.com/modelcontextprotocol/inspector)로 실제 API 호출 테스트:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/stdio.js
```

Inspector에서 환경변수 설정:
- `FLOW_API_KEY` — 필수 (API 인증)
- `FLOW_API_URL` — 선택 (기본: `https://api.eureka.codes/flw-v1`)
- `FLOW_WS_URL` — 선택 (기본: `wss://wss.eureka.codes/wss-v1`)

### Inspector 검증 체크리스트

| # | 테스트 | 방법 |
|---|--------|------|
| 1 | 도구 목록 | List Tools → 13개 도구 확인 |
| 2 | block_list | 블록 타입 목록 반환 확인 |
| 3 | block_list (필터) | `stereo: "input"` → 입력 블록만 반환 |
| 4 | flow_list | 플로우 목록 반환 확인 |
| 5 | flow_list (public) | `isPublic: true` → 공개 플로우 반환 |
| 6 | flow_load | 기존 플로우 ID로 캔버스 데이터 확인 |
| 7 | flow_graph | 기존 플로우 ID로 Mermaid 다이어그램 반환 |
| 8 | flow_create | `name` 입력 → 새 플로우 생성 |
| 9 | flow_save | `flow_load` 결과 수정 후 저장 |
| 10 | flow_run | 플로우 실행 → 상태 확인 |
| 11 | node_run | 특정 노드 실행 |
| 12 | node_get_port | 실행된 노드의 포트 데이터 조회 |
| 13 | node_update | 노드 속성 변경 |
| 14 | node_delete | 노드 삭제 확인 |
| 15 | edge_create | 두 노드 간 엣지 생성 |
| 16 | edge_delete | 엣지 삭제 확인 |
| 17 | 에러 처리 | 잘못된 ID → isError 응답 |
| 18 | 인증 에러 | 잘못된 API key → auth 에러 |

## Claude Desktop Integration Test

로컬 빌드로 Claude Desktop에서 테스트:

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/flow-mcp/dist/stdio.js"],
      "env": {
        "FLOW_API_KEY": "your-api-key"
      }
    }
  }
}
```

Claude Desktop 재시작 후 대화에서 확인:
- "어떤 블록 타입이 있어?" → `block_list` 호출
- "내 플로우 목록 보여줘" → `flow_list` 호출
- "플로우 {id} 실행해줘" → `flow_run` 호출

## Code Conventions

- Named exports only (no `export default`)
- `const` + arrow functions
- Zod v4: `import * as z from 'zod/v4'`
- 도구 핸들러는 `{ isError: true, content: [...] }` 반환, throw 금지
- Port ref format: `{nodeId}:{portId}@{direction}`
- 함수 본문 80줄 이하

## Adding a New Tool

1. `src/tools/<category>-tools.ts`에 `server.registerTool()` 추가
2. 필요 시 `src/api-client.ts`에 API 메서드 추가
3. `src/types.ts`에 타입 추가
4. 테스트 작성 (위 체크리스트 참고)
5. `CLAUDE.md` 엔드포인트 테이블 업데이트
6. `npm test && npm run build` 확인
