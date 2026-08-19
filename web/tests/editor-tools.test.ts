import assert from 'node:assert/strict';
import test from 'node:test';

import {
	cropTools,
	generativeTools,
	measureTools,
	paintTools,
	retouchTools,
	selectionTools,
	TOOL_GROUPS,
	toolLabel,
	toolShortcutHandlers,
	toolsIn,
	typeTools,
	vectorTools
} from '../src/lib/editor-tools.ts';

function pressing(key: string, currentTool: string) {
	let chosen: string | null = null;
	let prevented = false;
	const handlers = toolShortcutHandlers(
		() => currentTool,
		(tool) => (chosen = tool)
	);
	handlers[key]?.({ preventDefault: () => (prevented = true) } as unknown as KeyboardEvent);
	return { chosen, prevented };
}

test('every tool id appears once across the registry', () => {
	const ids = TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.id));
	assert.equal(new Set(ids).size, ids.length);
});

test('labels come from the registry, internal entries included', () => {
	assert.equal(toolLabel('move'), 'move');
	assert.equal(toolLabel('object-select'), 'object selection');
	assert.equal(toolLabel('mask-linear'), 'linear gradient');
	assert.equal(toolLabel('mask-refine'), 'refine edge');
	assert.equal(toolLabel('never-registered'), 'never-registered');
});

test('toolsIn exposes a group as an id set', () => {
	assert.ok(toolsIn('paint').has('brush'));
	assert.ok(!toolsIn('paint').has('crop'));
	assert.equal(toolsIn('missing').size, 0);
});

test('the named category sets keep their membership', () => {
	assert.ok(selectionTools.has('magic-wand'));
	assert.ok(cropTools.has('perspective-crop'));
	assert.ok(retouchTools.has('background-eraser'));
	assert.ok(paintTools.has('pattern-stamp'));
	assert.ok(typeTools.has('type-mask'));
	assert.ok(vectorTools.has('path-select'));
	assert.ok(!vectorTools.has('type'));
	assert.ok(measureTools.has('ruler'));
	assert.ok(generativeTools.has('remove-background'));
});

test('single-tool shortcuts select their tool and consume the event', () => {
	assert.deepEqual(pressing('v', 'hand'), { chosen: 'move', prevented: true });
	assert.deepEqual(pressing('q', 'move'), { chosen: 'mask', prevented: true });
});

test('shared shortcuts cycle through their tools in registry order', () => {
	assert.equal(pressing('w', 'move').chosen, 'object-select');
	assert.equal(pressing('w', 'object-select').chosen, 'quick-select');
	assert.equal(pressing('w', 'magic-wand').chosen, 'object-select');
});

test('shortcuts cross groups in registry order', () => {
	assert.equal(pressing('s', 'move').chosen, 'clone-stamp');
	assert.equal(pressing('s', 'clone-stamp').chosen, 'pattern-stamp');
	assert.equal(pressing('i', 'color-sampler').chosen, 'ruler');
});

test('frame answers to k, not to the crop cycle', () => {
	assert.equal(pressing('k', 'move').chosen, 'frame');
	assert.equal(pressing('c', 'slice-select').chosen, 'crop');
});
