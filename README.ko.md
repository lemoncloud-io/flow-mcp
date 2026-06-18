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
  <b><a href="https://flow.eureka.codes">Eureka Flow</a>를 AI에서 바로 쓸 수 있는 MCP 서버</b><br/>
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

## 이런 게 됩니다

**Claude Desktop**, **Cursor**, **Windsurf**, **VS Code (Continue/Cline)**, **Claude Code** 등 MCP를 지원하는 AI 클라이언트라면 어디서든 쓸 수 있습니다.

그냥 말하면 됩니다:

| 하고 싶은 일 | 이렇게 말하세요 |
|-------------|----------------|
| 로그인 (키 복붙 없음) | "Eureka 로그인해줘" |
| 워크플로우 목록 보기 | "내 flow 목록 보여줘" |
| 새 워크플로우 만들기 | "텍스트 입력 → 버퍼 → 미리보기 flow 만들어줘" |
| 워크플로우 실행 | "1004897 flow 실행해봐" |
| 실행 결과 확인 | "미리보기 노드의 출력값 보여줘" |
| 구조 시각화 | "1004897 그래프 보여줘" |
| 노드 수정 | "1009369 노드 이름을 EurekaFlow로 바꿔" |
| 노드 추가 | "이 flow에 텍스트 입력 블록 하나 추가해줘" |
| 연결 | "입력 노드와 버퍼 노드를 연결해줘" |
| 삭제 | "연결 안 된 노드 정리해줘" |

코드도, 도구 이름도 몰라도 됩니다. 자연어로 요청하면 Claude가 알아서 처리합니다.

## 시작하기

> **준비물:** [**Claude Desktop**](https://claude.ai/download) 설치, 무료 Eureka 계정(Google 로그인만 하면 됨 — 별도 가입 양식 없음). Claude Desktop에 Node.js 런타임이 내장돼 있어 따로 설치할 건 없습니다.

### 🚀 원클릭 설치 — Claude Desktop (추천, 터미널 불필요)

1. **확장 파일 다운로드.** [**Releases 페이지**](https://github.com/lemoncloud-io/flow-mcp/releases/latest)에서 **Assets**를 열고 **`flow-mcp.mcpb`** 다운로드. *("Source code" 파일은 무시 — 필요 없습니다.)*
2. **설치.** **`flow-mcp.mcpb`** 더블클릭 → Claude Desktop **설치 창**이 열림 → **API 키 칸은 비워두고**(다음 단계에서 챗으로 로그인) **Install** 클릭.
   - *Mac이 "확인되지 않은 개발자" 경고?* 파일 우클릭 → **열기** → **열기**. 다운로드한 파일에서는 정상입니다.
   - *설치 창이 안 뜨면?* Claude Desktop → **설정 → 확장(Extensions)** 에서 파일을 드래그하세요.
3. **로그인 — 키 복붙 없음.** Claude에게 **"Eureka 로그인해줘"** 라고 하면 구글 로그인 브라우저 창이 열립니다. 로그인만 완료하면 Claude가 API 키를 자동 발급·저장합니다. *(직접 키를 쓰고 싶다면 [flow.eureka.codes](https://flow.eureka.codes) → 로그인 → Create Key → Copy 후 2단계의 API 키 칸에 붙여넣으세요.)*
4. **작동 확인.** Claude에게 *"내 flow 목록 보여줘"* — *"flow가 없습니다"* 라도 뜨면 연결 성공! 🎉 이어서 *"플로우 만들어줘"* 또는 *"내 크레딧 잔액 확인해줘"*.
   - *빨간 오류나 "server disconnected"가 보이면?* **설정 → 확장(Extensions)** 에서 flow-mcp가 켜져 있는지 확인하고 Claude에게 다시 *"로그인해줘"* 해보세요.

> 로그인 한 번으로 **플로우 + 크레딧(빌링)** 모두 사용 가능. 키 복붙도, 설정 파일 편집도 없습니다.

### 다른 클라이언트 (Cursor · Windsurf · VS Code · Claude Code)

<details>
<summary><b>수동 설치</b> (npm + 설정 파일)</summary>

**1. 설치**

```bash
npm install -g @lemoncloud/flow-mcp
```

**2. 클라이언트 MCP 설정에 추가** — API 키 없어도 됩니다. Claude Desktop 설정 파일: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "flow-mcp": {
      "command": "npx",
      "args": ["-y", "@lemoncloud/flow-mcp"]
    }
  }
}
```

- **Cursor / Windsurf / VS Code (Continue/Cline):** IDE의 MCP 설정에 동일한 `mcpServers` 블록 추가.
- **Claude Code:** `claude mcp add flow-mcp -- npx -y @lemoncloud/flow-mcp`

**3. 재시작** 후 **"Eureka 로그인해줘"** — 브라우저 구글 로그인으로 키가 자동 발급됩니다. 이어서 **"내 flow 목록 보여줘"**.

> 고정 키를 쓰고 싶다면? [flow.eureka.codes](https://flow.eureka.codes)에서 발급(로그인 → **Create Key** → **Copy**) 후 위 설정에 `"env": { "FLOW_API_KEY": "ec-…" }` 를 추가하면 로그인 없이 바로 동작합니다.

**환경변수** — 모두 선택사항. `FLOW_API_KEY`는 챗 로그인을 건너뛸 때만 필요합니다:

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|:---:|--------|------|
| `FLOW_API_KEY` | | — | API 키 (선택 — `auth` 툴이 브라우저 로그인으로 발급) |
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

> **처음 충전하시나요?** 먼저 **[billing.eureka.codes](https://billing.eureka.codes)** 에서 카드를 등록하세요. 잔액·팩·내역은 카드 없이도 조회되지만, 결제에는 등록된 카드가 필요합니다.

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

## 5개 도구, 31개 액션

flow-mcp는 도구가 **5개**뿐입니다 — 권한 승인을 31번이 아니라 몇 번만 하면 됩니다. 도메인(flow / credit) × 접근(**read** 읽기 / **do** 쓰기)으로 나뉘고, 로그인용 **auth** 도구가 별도로 있습니다. 읽기 도구는 read-only로 표시되며, ⚠️ 변경·결제는 `*_do` 도구에만 모여 있습니다. 도구 이름을 직접 부를 일은 없습니다 — Claude에게 그냥 말하면("로그인", "플로우 공개해줘", "크레딧 확인") 알맞은 액션을 자동으로 선택합니다.

### `flow_read` — 플로우 읽기 (read-only)

`{ action, params }` · 액션:
`profile_get` · `flow_list` · `flow_load` · `flow_graph` · `flow_export` · `node_get` · `node_get_port` · `block_get` · `block_list` · `run_list` · `run_get`

### `flow_do` — 플로우 수정 & 실행 ⚠️

`{ action, params }` · 액션:
`flow_create` · `flow_update` · `flow_publish` · `flow_save` · `flow_clone` · `flow_run` · `flow_run_from` · `node_create` · `node_run` · `node_update` · `node_delete` · `edge_create` · `edge_delete`

### `credit_read` — 크레딧 읽기 (read-only)

`{ action, params }` · 액션:
`credit_balance` · `credit_packs` · `credit_history`

### `credit_do` — 크레딧 충전 ⚠️

`{ action, params }` · 액션:
`credit_purchase`

### `auth` — 로그인 / 로그아웃

`{ action, params }` · 액션:
`login` · `status` · `logout`

> `login`은 구글 로그인 브라우저를 열어 API 키를 자동 발급·저장합니다 — 복붙 불필요. 도구마다 **"Always allow" 한 번**씩이면 끝. 읽기 도구 2개는 read-only라 부담 없이 허용할 수 있고, 데이터를 변경하거나 카드를 결제하는 건 `*_do` 도구뿐입니다.

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
  -> server.ts (McpServer + 5 dispatch tools -> 31 actions)
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
