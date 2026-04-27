// Domain types matching eureka-flows-api responses

export interface ListResult<T> {
    total: number;
    list: T[];
}

export interface FlowView {
    id: string;
    name?: string;
    stereo?: string;
    state?: 'draft' | 'active' | 'archived';
    status?: 'idle' | 'running' | 'completed' | 'error';
    title?: string;
    description?: string;
    thumbnail?: string;
    isPublic?: boolean;
    openToEdit?: boolean;
    activeRunId?: string;
    modifiedAt?: number;
    meta?: Record<string, unknown>;
}

export interface SaveFlowView extends FlowView {
    nodes?: NodeData[];
    edges?: EdgeData[];
    ports?: PortData[];
    isEditable?: boolean;
}

export interface NodeData {
    id?: string;
    type: string;
    blockId?: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
    customLabel?: string;
    description?: string;
    disabled?: boolean;
    config?: Record<string, string>;
    input?: Record<string, string>;
    output?: Record<string, string>;
    status?: string;
    error?: string;
    errorMessage?: string;
    inputData?: Record<string, DataPacket>;
    outputData?: Record<string, DataPacket>;
    executionStats?: ExecutionStats;
}

export interface EdgeData {
    id?: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    label?: string;
    lastTransferred?: { data: DataPacket; at: number };
}

export interface DataPacket {
    type: 'text' | 'image' | 'number' | 'json' | 'any';
    value?: string | number | Record<string, unknown>;
    timestamp?: number;
}

export interface ExecutionStats {
    startTime?: number;
    duration?: number;
    progress?: number;
}

export interface PortData {
    id?: string;
    nodeId?: string;
    portId?: string;
    direction?: 'in' | 'out';
    data?: DataPacket;
    error?: string;
}

export interface BlockView {
    id: string;
    name?: string;
    stereo?: 'input' | 'process' | 'output' | '' | '#';
    label?: string;
    icon?: string;
    description?: string;
    order?: number;
    isHidden?: boolean;
    isRunnable?: boolean;
    isFrontend?: boolean;
    processType?: string;
    $definition?: BlockDefinition;
    input$$?: PortDefinition[];
    output$$?: PortDefinition[];
    config$$?: ConfigField[];
}

export interface BlockDefinition {
    id?: string;
    type: string;
    label: string;
    icon?: string;
    description: string;
    order?: number;
    inputs: PortDefinition[];
    outputs: PortDefinition[];
    defaultConfig: Record<string, unknown>;
    configSchema?: ConfigField[];
    frontend?: boolean;
}

export interface PortDefinition {
    id: string;
    label?: string;
    type?: string;
    required?: boolean;
}

export interface ConfigField {
    key: string;
    type: string;
    label: string;
    short?: string;
    options?: Array<{ value: string; label: string }>;
    placeholder?: string;
    required?: boolean;
    default?: string;
}

export interface SaveFlowBody {
    name?: string;
    description?: string;
    title?: string;
    thumbnail?: string;
    isPublic?: boolean;
    openToEdit?: boolean;
    state?: 'draft' | 'active' | 'archived';
    meta?: Record<string, unknown>;
    nodes: Partial<NodeData>[];
    edges: Partial<EdgeData>[];
}

export interface NodeView {
    id: string;
    name?: string;
    stereo?: string;
    blockId?: string;
    flowId?: string;
    position?: { x: number; y: number };
    status?: string;
    error?: string;
    errorMessage?: string;
    timestamp?: number;
    modifiedAt?: number;
    progress?: number;
    executionStats?: ExecutionStats;
    $result?: Record<string, unknown>;
    $flow?: FlowView;
}

export interface ProfileView {
    sid: string;
    uid: string;
    geminiApiKey?: string;
    openaiApiKey?: string;
}

export const TERMINAL_STATES = new Set(['COMPLETED', 'ERROR', 'SKIPPED']);
