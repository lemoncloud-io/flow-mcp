/** MCP tool response helpers + utilities */

/** Strip undefined values from an object — useful for building partial update bodies */
export const filterDefined = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export const toolJson = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

export const toolError = (error: unknown) => ({
    isError: true as const,
    content: [
        {
            type: 'text' as const,
            text: error instanceof Error ? error.message : String(error),
        },
    ],
});
