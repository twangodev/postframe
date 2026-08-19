export interface ToolDefinition {
	id: string;
	label: string;
	shortcut?: string;
}

export interface ToolGroup {
	id: string;
	label: string;
	tools: readonly ToolDefinition[];
}

const GROUPS = [
	{
		id: 'view',
		label: 'move & view',
		tools: [
			{ id: 'move', label: 'move', shortcut: 'V' },
			{ id: 'hand', label: 'hand', shortcut: 'H' },
			{ id: 'zoom', label: 'zoom', shortcut: 'Z' },
			{ id: 'rotate-view', label: 'rotate view', shortcut: 'R' }
		]
	},
	{
		id: 'select',
		label: 'selection',
		tools: [
			{ id: 'object-select', label: 'object selection', shortcut: 'W' },
			{ id: 'quick-select', label: 'quick selection', shortcut: 'W' },
			{ id: 'magic-wand', label: 'magic wand', shortcut: 'W' },
			{ id: 'marquee', label: 'rectangular marquee', shortcut: 'M' },
			{ id: 'ellipse-marquee', label: 'elliptical marquee', shortcut: 'M' },
			{ id: 'single-row-marquee', label: 'single row marquee', shortcut: 'M' },
			{ id: 'single-column-marquee', label: 'single column marquee', shortcut: 'M' },
			{ id: 'lasso', label: 'lasso', shortcut: 'L' },
			{ id: 'polygon-lasso', label: 'polygonal lasso', shortcut: 'L' },
			{ id: 'magnetic-lasso', label: 'magnetic lasso', shortcut: 'L' }
		]
	},
	{
		id: 'crop',
		label: 'crop & frame',
		tools: [
			{ id: 'crop', label: 'crop', shortcut: 'C' },
			{ id: 'perspective-crop', label: 'perspective crop', shortcut: 'C' },
			{ id: 'slice', label: 'slice', shortcut: 'C' },
			{ id: 'slice-select', label: 'slice selection', shortcut: 'C' },
			{ id: 'frame', label: 'frame', shortcut: 'K' }
		]
	},
	{
		id: 'retouch',
		label: 'retouch',
		tools: [
			{ id: 'remove', label: 'remove' },
			{ id: 'spot-heal', label: 'spot healing brush' },
			{ id: 'healing-brush', label: 'healing brush' },
			{ id: 'patch', label: 'patch' },
			{ id: 'content-aware-move', label: 'content-aware move' },
			{ id: 'clone-stamp', label: 'clone stamp', shortcut: 'S' },
			{ id: 'red-eye', label: 'red eye' },
			{ id: 'blur', label: 'blur' },
			{ id: 'sharpen', label: 'sharpen' },
			{ id: 'smudge', label: 'smudge' },
			{ id: 'dodge', label: 'dodge', shortcut: 'O' },
			{ id: 'burn', label: 'burn', shortcut: 'O' },
			{ id: 'sponge', label: 'sponge', shortcut: 'O' },
			{ id: 'background-eraser', label: 'background eraser', shortcut: 'E' },
			{ id: 'magic-eraser', label: 'magic eraser', shortcut: 'E' }
		]
	},
	{
		id: 'paint',
		label: 'paint & fill',
		tools: [
			{ id: 'brush', label: 'brush', shortcut: 'B' },
			{ id: 'pencil', label: 'pencil', shortcut: 'B' },
			{ id: 'mixer-brush', label: 'mixer brush', shortcut: 'B' },
			{ id: 'color-replacement', label: 'color replacement', shortcut: 'B' },
			{ id: 'history-brush', label: 'history brush', shortcut: 'Y' },
			{ id: 'art-history-brush', label: 'art history brush', shortcut: 'Y' },
			{ id: 'eraser', label: 'eraser', shortcut: 'E' },
			{ id: 'gradient', label: 'gradient', shortcut: 'G' },
			{ id: 'paint-bucket', label: 'paint bucket', shortcut: 'G' },
			{ id: 'eyedropper', label: 'eyedropper', shortcut: 'I' },
			{ id: 'color-sampler', label: 'color sampler', shortcut: 'I' },
			{ id: 'pattern-stamp', label: 'pattern stamp', shortcut: 'S' }
		]
	},
	{
		id: 'draw',
		label: 'type & vector',
		tools: [
			{ id: 'pen', label: 'pen', shortcut: 'P' },
			{ id: 'freeform-pen', label: 'freeform pen', shortcut: 'P' },
			{ id: 'curvature-pen', label: 'curvature pen', shortcut: 'P' },
			{ id: 'add-anchor', label: 'add anchor point' },
			{ id: 'delete-anchor', label: 'delete anchor point' },
			{ id: 'convert-point', label: 'convert point' },
			{ id: 'path-select', label: 'path selection', shortcut: 'A' },
			{ id: 'type', label: 'horizontal type', shortcut: 'T' },
			{ id: 'vertical-type', label: 'vertical type', shortcut: 'T' },
			{ id: 'type-mask', label: 'type mask', shortcut: 'T' },
			{ id: 'shape', label: 'rectangle', shortcut: 'U' },
			{ id: 'ellipse-shape', label: 'ellipse', shortcut: 'U' },
			{ id: 'triangle-shape', label: 'triangle', shortcut: 'U' },
			{ id: 'polygon-shape', label: 'polygon', shortcut: 'U' },
			{ id: 'star-shape', label: 'star', shortcut: 'U' },
			{ id: 'line-shape', label: 'line', shortcut: 'U' },
			{ id: 'custom-shape', label: 'custom shape', shortcut: 'U' }
		]
	},
	{
		id: 'measure',
		label: 'measure',
		tools: [
			{ id: 'ruler', label: 'ruler', shortcut: 'I' },
			{ id: 'note', label: 'note' },
			{ id: 'count', label: 'count' }
		]
	},
	{
		id: 'generate',
		label: 'generative',
		tools: [
			{ id: 'generative-fill', label: 'generative fill' },
			{ id: 'content-aware-fill', label: 'content-aware fill' },
			{ id: 'remove-background', label: 'remove background' }
		]
	},
	{
		id: 'mask',
		label: 'masking',
		tools: [
			{ id: 'mask', label: 'mask brush', shortcut: 'Q' },
			{ id: 'mask-linear', label: 'linear gradient' },
			{ id: 'mask-radial', label: 'radial gradient' }
		]
	}
] as const;

export type ToolId = (typeof GROUPS)[number]['tools'][number]['id'];

export const TOOL_GROUPS: readonly ToolGroup[] = GROUPS;

const INTERNAL_TOOLS: readonly ToolDefinition[] = [{ id: 'mask-refine', label: 'refine edge' }];

const REGISTERED_TOOLS: readonly ToolDefinition[] = TOOL_GROUPS.flatMap((group) => group.tools);

const TOOL_LABELS = new Map(
	[...REGISTERED_TOOLS, ...INTERNAL_TOOLS].map((tool) => [tool.id, tool.label])
);

export function toolLabel(id: string): string {
	return TOOL_LABELS.get(id) ?? id;
}

export function toolsIn(groupId: string): ReadonlySet<string> {
	const group = TOOL_GROUPS.find((candidate) => candidate.id === groupId);
	return new Set(group?.tools.map((tool) => tool.id));
}

export const selectionTools = toolsIn('select');
export const cropTools = toolsIn('crop');
export const retouchTools = toolsIn('retouch');
export const paintTools = toolsIn('paint');
export const typeTools: ReadonlySet<string> = new Set(['type', 'vertical-type', 'type-mask']);
export const vectorTools: ReadonlySet<string> = new Set(
	[...toolsIn('draw')].filter((id) => !typeTools.has(id))
);
export const measureTools = toolsIn('measure');
export const generativeTools = toolsIn('generate');

function shortcutCycles(): Map<string, ToolDefinition[]> {
	const cycles = new Map<string, ToolDefinition[]>();
	for (const tool of REGISTERED_TOOLS) {
		if (!tool.shortcut) continue;
		const key = tool.shortcut.toLowerCase();
		cycles.set(key, [...(cycles.get(key) ?? []), tool]);
	}
	return cycles;
}

export function toolShortcutHandlers(
	currentTool: () => string,
	choose: (tool: string) => void
): Record<string, (event: KeyboardEvent) => void> {
	const handler = (tools: ToolDefinition[]) => (event: KeyboardEvent) => {
		event.preventDefault();
		const current = tools.findIndex((tool) => tool.id === currentTool());
		choose(tools[(current + 1) % tools.length]!.id);
	};
	return Object.fromEntries([...shortcutCycles()].map(([key, tools]) => [key, handler(tools)]));
}
