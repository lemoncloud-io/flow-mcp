import type {
  FlowView,
  SaveFlowView,
  NodeData,
  EdgeData,
  BlockView,
  BlockDefinition,
  PortData,
  PortDefinition,
  NodeView,
  RunView,
  ListResult,
} from '../../src/types';
import { type FlowApiConfig, DEFAULT_WS_URL } from '../../src/config';

export const makeConfig = (overrides?: Partial<FlowApiConfig>): FlowApiConfig => ({
  FLOW_API_URL: 'https://api.example.com',
  FLOW_API_KEY: 'test-key-123',
  FLOW_API_TIMEOUT: 30000,
  FLOW_WS_URL: DEFAULT_WS_URL,
  ...overrides,
});

export const makeFlow = (overrides?: Partial<FlowView>): FlowView => ({
  id: 'flow-1',
  name: 'Test Flow',
  state: 'draft',
  status: 'idle',
  isPublic: false,
  modifiedAt: 1700000000000,
  ...overrides,
});

export const makeNode = (overrides?: Partial<NodeData>): NodeData => ({
  id: 'node-1',
  type: 'input-text',
  position: { x: 100, y: 200 },
  ...overrides,
});

export const makeEdge = (overrides?: Partial<EdgeData>): EdgeData => ({
  sourceNodeId: 'node-1',
  sourcePortId: 'out',
  targetNodeId: 'node-2',
  targetPortId: 'in',
  ...overrides,
});

export const makeSaveFlow = (overrides?: Partial<SaveFlowView>): SaveFlowView => ({
  ...makeFlow(),
  nodes: [makeNode()],
  edges: [],
  ...overrides,
});

export const makeNodeView = (overrides?: Partial<NodeView>): NodeView => ({
  id: 'node-1',
  name: 'Test Node',
  blockId: 'block-1',
  flowId: 'flow-1',
  status: 'COMPLETED',
  ...overrides,
});

export const makePortDef = (overrides?: Partial<PortDefinition>): PortDefinition => ({
  id: 'in',
  label: 'Input',
  type: 'text',
  ...overrides,
});

export const makeBlockDef = (overrides?: Partial<BlockDefinition>): BlockDefinition => ({
  type: 'input-text',
  label: 'Text Input',
  description: 'A text input block',
  inputs: [makePortDef({ id: 'in' })],
  outputs: [makePortDef({ id: 'out', label: 'Output' })],
  defaultConfig: {},
  ...overrides,
});

export const makeBlock = (overrides?: Partial<BlockView>): BlockView => ({
  id: 'block-1',
  name: 'input-text',
  stereo: 'input',
  label: 'Text Input',
  description: 'A text input block',
  isHidden: false,
  isRunnable: true,
  isFrontend: false,
  processType: 'input-text',
  $definition: makeBlockDef(),
  ...overrides,
});

export const makeRun = (overrides?: Partial<RunView>): RunView => ({
  id: 'run-1',
  flowId: 'flow-1',
  nodeId: 'node-1',
  model: 'gemini-2.0-flash',
  usage$: { inputToken: 100, outputToken: 50, totalToken: 150 },
  executedAt: 1700000000000,
  finishedAt: 1700000001000,
  elapsedMs: 1000,
  ...overrides,
});

export const makePortData = (overrides?: Partial<PortData>): PortData => ({
  id: 'port-1',
  nodeId: 'node-1',
  portId: 'out',
  direction: 'out',
  data: { type: 'text', value: 'hello' },
  ...overrides,
});

export const makeListResult = <T>(list: T[], total?: number): ListResult<T> => ({
  total: total ?? list.length,
  list,
});

export const makeApiClient = () => ({
  getProfile: vi.fn(),
  listFlows: vi.fn(),
  loadFlow: vi.fn(),
  saveFlow: vi.fn(),
  upsertFlow: vi.fn(),
  runFlow: vi.fn(),
  getNode: vi.fn(),
  runNode: vi.fn(),
  upsertNode: vi.fn(),
  getPortData: vi.fn(),
  getBlock: vi.fn(),
  listBlocks: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
});

export type MockApiClient = ReturnType<typeof makeApiClient>;
