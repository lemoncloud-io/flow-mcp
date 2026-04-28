import * as z from 'zod/v4';

/** Accepts any object shape — used for tools with complex/variable output */
export const PassthroughSchema = z.object({}).passthrough();

// --- Profile ---
export const ProfileOutputSchema = z.object({
    sid: z.string(),
    uid: z.string(),
    hasGeminiApiKey: z.boolean(),
    hasOpenaiApiKey: z.boolean(),
});

// --- Flow List ---
export const FlowListOutputSchema = z.object({
    total: z.number(),
    limit: z.optional(z.number()),
    offset: z.optional(z.number()),
    flows: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
});

// --- Flow Graph ---
export const FlowGraphOutputSchema = z.object({
    flowId: z.string(),
    mermaid: z.string(),
});

// --- Flow Export ---
export const FlowExportOutputSchema = z.object({
    name: z.optional(z.string()),
    description: z.optional(z.string()),
    nodes: z.array(PassthroughSchema),
    edges: z.array(PassthroughSchema),
});

// --- Flow / Node Run ---
export const FlowRunOutputSchema = z
    .object({
        flowId: z.string(),
        status: z.string(),
        duration: z.number(),
        nodes: z.array(z.object({ id: z.string(), status: z.string() }).passthrough()),
    })
    .passthrough();

export const NodeRunOutputSchema = z
    .object({
        nodeId: z.string(),
        flowId: z.string(),
        status: z.string(),
        duration: z.number(),
    })
    .passthrough();

// --- Block List ---
export const BlockListOutputSchema = z.object({
    total: z.number(),
    blocks: z.array(PassthroughSchema),
});

// --- Run List ---
export const RunListOutputSchema = z.object({
    total: z.number(),
    limit: z.optional(z.number()),
    offset: z.optional(z.number()),
    runs: z.array(PassthroughSchema),
});
