export const selectionTools = new Set([
	'object-select',
	'quick-select',
	'magic-wand',
	'marquee',
	'ellipse-marquee',
	'single-row-marquee',
	'single-column-marquee',
	'lasso',
	'polygon-lasso',
	'magnetic-lasso'
]);

export const cropTools = new Set(['crop', 'perspective-crop', 'slice', 'slice-select', 'frame']);

export const retouchTools = new Set([
	'remove',
	'spot-heal',
	'healing-brush',
	'patch',
	'content-aware-move',
	'clone-stamp',
	'red-eye',
	'blur',
	'sharpen',
	'smudge',
	'dodge',
	'burn',
	'sponge',
	'background-eraser',
	'magic-eraser'
]);

export const paintTools = new Set([
	'brush',
	'pencil',
	'mixer-brush',
	'color-replacement',
	'history-brush',
	'art-history-brush',
	'eraser',
	'gradient',
	'paint-bucket',
	'eyedropper',
	'color-sampler',
	'pattern-stamp'
]);

export const vectorTools = new Set([
	'pen',
	'freeform-pen',
	'curvature-pen',
	'add-anchor',
	'delete-anchor',
	'convert-point',
	'path-select',
	'shape',
	'ellipse-shape',
	'triangle-shape',
	'polygon-shape',
	'star-shape',
	'line-shape',
	'custom-shape'
]);

export const typeTools = new Set(['type', 'vertical-type', 'type-mask']);

export const measureTools = new Set(['ruler', 'note', 'count']);

export const generativeTools = new Set([
	'generative-fill',
	'content-aware-fill',
	'remove-background'
]);

type ToolChoice = [tool: string, label: string];

type ToolShortcut =
	| { kind: 'select'; tool: string; label: string }
	| { kind: 'cycle'; tools: ToolChoice[] };

const select = (tool: string, label: string): ToolShortcut => ({ kind: 'select', tool, label });
const cycle = (tools: ToolChoice[]): ToolShortcut => ({ kind: 'cycle', tools });

const toolShortcuts: Record<string, ToolShortcut> = {
	v: select('move', 'move'),
	h: select('hand', 'hand'),
	z: select('zoom', 'zoom'),
	r: select('rotate-view', 'rotate view'),
	w: cycle([
		['object-select', 'object selection'],
		['quick-select', 'quick selection'],
		['magic-wand', 'magic wand']
	]),
	m: cycle([
		['marquee', 'rectangular marquee'],
		['ellipse-marquee', 'elliptical marquee'],
		['single-row-marquee', 'single row marquee'],
		['single-column-marquee', 'single column marquee']
	]),
	l: cycle([
		['lasso', 'lasso'],
		['polygon-lasso', 'polygonal lasso'],
		['magnetic-lasso', 'magnetic lasso']
	]),
	c: cycle([
		['crop', 'crop'],
		['perspective-crop', 'perspective crop'],
		['slice', 'slice'],
		['slice-select', 'slice selection'],
		['frame', 'frame']
	]),
	j: cycle([
		['remove', 'remove'],
		['spot-heal', 'spot healing brush'],
		['healing-brush', 'healing brush'],
		['patch', 'patch'],
		['content-aware-move', 'content-aware move']
	]),
	s: cycle([
		['clone-stamp', 'clone stamp'],
		['pattern-stamp', 'pattern stamp']
	]),
	o: cycle([
		['dodge', 'dodge'],
		['burn', 'burn'],
		['sponge', 'sponge']
	]),
	b: cycle([
		['brush', 'brush'],
		['pencil', 'pencil'],
		['mixer-brush', 'mixer brush'],
		['color-replacement', 'color replacement']
	]),
	e: cycle([
		['eraser', 'eraser'],
		['background-eraser', 'background eraser'],
		['magic-eraser', 'magic eraser']
	]),
	y: cycle([
		['history-brush', 'history brush'],
		['art-history-brush', 'art history brush']
	]),
	g: cycle([
		['gradient', 'gradient'],
		['paint-bucket', 'paint bucket']
	]),
	i: cycle([
		['eyedropper', 'eyedropper'],
		['color-sampler', 'color sampler'],
		['ruler', 'ruler']
	]),
	p: cycle([
		['pen', 'pen'],
		['freeform-pen', 'freeform pen'],
		['curvature-pen', 'curvature pen']
	]),
	a: select('path-select', 'path selection'),
	t: cycle([
		['type', 'horizontal type'],
		['vertical-type', 'vertical type'],
		['type-mask', 'type mask']
	]),
	u: cycle([
		['shape', 'rectangle'],
		['ellipse-shape', 'ellipse'],
		['triangle-shape', 'triangle'],
		['polygon-shape', 'polygon'],
		['star-shape', 'star'],
		['line-shape', 'line'],
		['custom-shape', 'custom shape']
	]),
	q: select('mask', 'mask brush')
};

export function toolShortcutHandlers(
	currentTool: () => string,
	choose: (tool: string, label: string) => void
): Record<string, (event: KeyboardEvent) => void> {
	const handler = (shortcut: ToolShortcut) => (event: KeyboardEvent) => {
		event.preventDefault();
		if (shortcut.kind === 'select') {
			choose(shortcut.tool, shortcut.label);
			return;
		}
		const current = shortcut.tools.findIndex(([tool]) => tool === currentTool());
		const [tool, label] = shortcut.tools[(current + 1) % shortcut.tools.length];
		choose(tool, label);
	};
	return Object.fromEntries(
		Object.entries(toolShortcuts).map(([key, shortcut]) => [key, handler(shortcut)])
	);
}
