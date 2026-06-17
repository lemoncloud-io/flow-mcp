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
  <b><a href="https://flow.eureka.codes">Eureka Flow</a>를 AI에서 바로 사용할 수 있게 해주는 MCP 서버</b><br/>
  자연어로 워크플로우를 만들고, 실행하고, 결과를 확인하세요.
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/images/screenshot-dark.jpg" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/images/screenshot-light.jpg" />
    <img src="https://raw.githubusercontent.com/lemoncloud-io/flow-mcp/main/docs/images/screenshot-dark.jpg" alt="Eureka Flow" width="100%" />
  </picture>
</p>

## 이런 걸 할 수 있어요

**Claude Desktop**, **Cursor**, **Windsurf**, **VS Code (Continue/Cline)**, **Claude Code** 등 MCP를 지원하는 모든 AI 클라이언트에서 사용 가능합니다.

AI에게 이렇게 말하면 됩니다:

| 하고 싶은 일 | Claude에게 이렇게 말하세요 |
|-------------|------------------------|
| 워크플로우 목록 보기 | "내 flow 목록 보여줘" |
| 새 워크플로우 만들기 | "텍스트 입력 → 버퍼 → 미리보기 flow 만들어줘" |
| 워크플로우 실행 | "1004897 flow 실행해봐" |
| 실행 결과 확인 | "미리보기 노드의 출력값 보여줘" |
| 구조 시각화 | "1004897 그래프 보여줘" |
| 노드 수정 | "1009369 노드 이름을 EurekaFlow로 바꿔" |
| 노드 추가 | "이 flow에 텍스트 입력 블록 하나 추가해줘" |
| 연결 | "입력 노드와 버퍼 노드를 연결해줘" |
| 삭제 | "연결 안 된 노드 정리해줘" |

코드를 몰라도, 도구 이름을 몰라도 됩니다. 자연어로 요청하면 Claude가 알아서 처리합니다.

## 시작하기

> **준비물:** [**Claude Desktop**](https://claude.ai/download) 앱 설치, 그리고 무료 Eureka 계정(Google 로그인만 하면 됨 — 별도 가입 양식 없음).

### 🚀 원클릭 설치 — Claude Desktop (추천, 터미널 불필요)

1. **무료 API 키 발급.** **[flow.eureka.codes](https://flow.eureka.codes)** 접속 후 **Google로 로그인**. 바로 **Create Key**(키 생성) 페이지로 이동됩니다 — **Create Key** 클릭 후 **Copy**(복사). 키는 `ec-…` 형태입니다. **지금 바로 안전한 곳(메모 앱 등)에 붙여넣어 두세요** — 한 번만 표시되지만, 잃어버리면 새로 만들면 됩니다.
2. **확장 파일 다운로드.** [**Releases 페이지**](https://github.com/lemoncloud-io/flow-mcp/releases/latest)에서 **Assets** 항목을 열고 **`flow-mcp.mcpb`** 를 다운로드. *("Source code" 파일들은 무시 — 필요 없습니다.)*
3. **설치.** **`flow-mcp.mcpb`** 더블클릭 → Claude Desktop에 **설치 창**이 열림 → API 키 붙여넣기 → **Install** 클릭.
   - *Mac이 "확인되지 않은 개발자" 경고?* 파일 우클릭 → **열기** → **열기**. 다운로드 파일에선 정상입니다.
   - *설치 창이 안 뜨면?* Claude Desktop → **설정 → 확장(Extensions)** 에서 파일을 끌어다 놓으세요.
4. **작동 확인.** Claude에게 *"내 flow 목록 보여줘"*. 뭐라도 답하면 — *"flow가 없습니다"* 라고 해도 — 연결 성공! 🎉 이어서 *"플로우 만들어줘"* 또는 *"내 크레딧 잔액 확인해줘"*.

> 키 하나로 **플로우 + 크레딧(빌링)** 모두 사용 가능. 편집할 설정 파일도, 어려운 것도 없습니다.

### 다른 클라이언트 (Cursor · Windsurf · VS Code · Claude Code)

<details>
<summary><b>수동 설치</b> (npm + 설정 파일)</summary>

**1. 설치**

```bash
npm install -g @lemoncloud/flow-mcp
```

**2. API 키 발급** — [flow.eureka.codes](https://flow.eureka.codes) → Google 로그인 → **Create Key** → **Copy** (`ec-…`, 한 번만 표시)

**3. 클라이언트 MCP 설정에 추가.** Claude Desktop 파일: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "npx",
      "args": ["-y", "@lemoncloud/flow-mcp"],
      "env": {
        "FLOW_API_KEY": "ec-발급받은-키"
      }
    }
  }
}
```

- **Cursor / Windsurf / VS Code (Continue/Cline):** IDE의 MCP 설정에 동일한 `mcpServers` 블록 추가.
- **Claude Code:** `claude mcp add flow-mcp -e FLOW_API_KEY=ec-발급받은-키 -- npx -y @lemoncloud/flow-mcp`

**4. 재시작** 후 **"내 flow 목록 보여줘"** 라고 말해보세요.

**환경변수** — `FLOW_API_KEY`만 필수, 나머지는 기본값 있음:

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|:---:|--------|------|
| `FLOW_API_KEY` | O | — | API 인증 키 |
| `FLOW_API_URL` | | `https://api.eureka.codes/flw-v1` | API 서버 주소 |
| `FLOW_API_TIMEOUT` | | `30000` | API 요청 타임아웃 (ms) |
| `FLOW_WS_URL` | | `wss://wss.eureka.codes/wss-v1` | WebSocket 주소 (실시간 진행상황 모니터링) |

</details>

## 사용 예시

### 워크플로우 만들기

```
"사용 가능한 블록 보여줘"
→ 입력/처리/출력 블록 목록 표시

"텍스트 입력, 3초 버퍼, 미리보기로 연결된 flow 만들어줘"
→ 노드 3개 + 엣지 2개 자동 생성

"만든 flow 실행해봐"
→ 실시간 진행상황 표시 → 결과 반환
```

### 기존 워크플로우 수정

```
"1004897 flow 로드해줘"
→ 노드, 엣지, 포트 데이터 표시

"입력 노드의 텍스트를 Hello Eureka로 바꿔"
→ config.text 변경

"여기에 출력 블록 하나 더 추가하고 연결해줘"
→ 새 노드 추가 + 연결

"그래프 보여줘"
→ Mermaid 다이어그램 표시
```

### 실행 결과 분석

```
"전체 실행해봐"
→ 각 노드별 진행상황 + 완료 여부 표시

"미리보기 노드의 출력값은?"
→ 포트 데이터 (값, 타입, 타임스탬프)
```

### 크레딧 관리

```
"내 크레딧 잔액 확인해줘"
→ 전체 / 사용 가능 / 보류 크레딧

"크레딧 팩 보여줘"
→ 구매 가능한 팩 + USD 가격

"1,000 크레딧 충전해줘"
→ 등록된 카드로 결제 (카드 없으면 billing.eureka.codes에서 등록)

"내 크레딧 사용 내역 보여줘"
→ 충전/사용 내역 (최신순)
```

### 플로우 공개

```
"1004897 플로우 공개해줘"        → public으로 전환
"1004897 플로우 비공개로 바꿔"   → 비공개로 전환
```

## 28개 도구

자연어로 요청하면 Claude가 자동으로 적절한 도구를 선택합니다.

| 도구 | 하는 일 |
|------|--------|
| `profile_get` | API 키 + AI 제공자 설정 상태 확인 |
| `block_list` | 사용 가능한 블록 종류 조회 |
| `block_get` | 블록 상세 조회 (ID 또는 이름) |
| `flow_list` | 내 워크플로우 목록 (페이지네이션 지원) |
| `flow_load` | 워크플로우 상세 로드 (노드, 엣지, 포트) |
| `flow_graph` | Mermaid 다이어그램 시각화 |
| `flow_create` | 새 워크플로우 생성 (노드+엣지 한 번에) |
| `flow_update` | 워크플로우 이름/설명 변경 |
| `flow_publish` | 워크플로우 공개 전환 (또는 비공개로) |
| `flow_save` | 전체 재구성 (주의: 기존 노드 ID 변경됨) |
| `flow_clone` | 워크플로우 복제 |
| `flow_export` | 워크플로우 JSON 내보내기 |
| `flow_run` | 워크플로우 실행 + 실시간 모니터링 |
| `flow_run_from` | 특정 노드부터 실행 |
| `node_get` | 단일 노드 상세 조회 |
| `node_create` | 기존 flow에 노드 추가 |
| `node_run` | 단일 노드 실행 |
| `node_get_port` | 노드 입출력 데이터 조회 |
| `node_update` | 노드 설정/라벨/위치 등 수정 |
| `node_delete` | 노드 삭제 |
| `edge_create` | 두 노드 연결 |
| `edge_delete` | 연결 제거 |
| `run_list` | 실행 이력 조회 (토큰 사용량 포함) |
| `run_get` | 실행 상세 조회 |
| `credit_balance` | 크레딧 잔액 확인 (총/가용/홀드) |
| `credit_packs` | 구매 가능한 크레딧 팩 + USD 가격 조회 |
| `credit_purchase` | 등록된 카드로 크레딧 충전 (브라우저 불필요) |
| `credit_history` | 크레딧 내역 조회 (충전 + 사용) |

---

<details>
<summary><b>개발자 가이드</b></summary>

### 설치 및 빌드

```bash
git clone https://github.com/lemoncloud-io/flow-mcp.git
cd flow-mcp
npm install
npm run build
```

### 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run build` | TypeScript 컴파일 |
| `npm run dev` | Watch 모드 |
| `npm run lint` | ESLint |
| `npm run lint:type` | 타입 체크 (`tsc --noEmit`) |
| `npm run format` | Prettier 포맷 |
| `npm start` | MCP 서버 실행 (stdio) |
| `npm test` | 테스트 |

### 로컬 빌드로 연결

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

### 아키텍처

```
stdio.ts (console suppression + JSON-RPC filter)
  -> server.ts (McpServer + 28 tools)
    -> tools/*.ts (tool handlers)
      -> api-client.ts (Axios -> flows-api REST)
      -> ws-client.ts (WebSocket -> real-time execution events)
      -> config.ts (Zod v4 env validation)
```

### WebSocket 실행 흐름

```
1. WS 연결 (info= 파라미터 → connectionId 수신)
2. 실행 트리거 (POST /nodes/:id/run?connection=<connId>)
3. 이벤트 모니터링 (노드 상태 + 포트 업데이트)
4. 완료 감지 (전체 terminal 또는 1.5초 quiet period)
5. 전체 이벤트 로그 포함하여 결과 반환
```

### npm publish

```bash
npm run build
npm publish --access public
```

</details>

## 관련 프로젝트

- [Eureka Flow](https://github.com/lemoncloud-io/eureka-flow) — 비주얼 워크플로우 에디터 (프론트엔드)

## 라이선스

Apache-2.0 -- [LemonCloud](https://lemoncloud.io)
