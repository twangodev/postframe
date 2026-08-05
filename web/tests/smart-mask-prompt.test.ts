import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareSmartMaskPrompt,
	selectedMaskInput,
	selectPromptedMask
} from '../src/lib/smart-mask-prompt.ts';

test('condenses painted strokes into a bounded foreground and background prompt', () => {
	const line = Array.from({ length: 100 }, (_, index) => ({ x: index / 100, y: 0.5 }));
	const prompt = prepareSmartMaskPrompt(
		[
			{ label: 'foreground', points: line },
			{ label: 'background', points: line.map(({ x }) => ({ x, y: 0.75 })) }
		],
		101,
		51
	);

	assert.equal(prompt.points.filter(({ label }) => label === 'foreground').length, 4);
	assert.equal(prompt.points.filter(({ label }) => label === 'background').length, 4);
	assert.deepEqual(prompt.inputLabels, [1, 1, 1, 1, 0, 0, 0, 0]);
	assert.ok(prompt.inputPoints.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 50));
});

test('prefers a candidate that follows foreground and background guidance', () => {
	const prompt = prepareSmartMaskPrompt(
		[
			{ label: 'foreground', points: [{ x: 0, y: 0 }] },
			{ label: 'background', points: [{ x: 1, y: 0 }] }
		],
		4,
		1
	);
	const selection = selectPromptedMask(
		new Float32Array([1, 1, 1, 1, 1, 1, -1, -1]),
		[1, 2, 1, 4],
		new Float32Array([0.99, 0.6]),
		prompt
	);

	assert.equal(selection?.index, 1);
	assert.deepEqual(selection?.alpha, new Uint8Array([255, 255, 0, 0]));
});

test('removes disconnected neighboring objects from the selected mask', () => {
	const prompt = prepareSmartMaskPrompt([{ label: 'foreground', points: [{ x: 0, y: 0 }] }], 5, 1);
	const selection = selectPromptedMask(
		new Float32Array([1, 1, -1, 1, 1]),
		[1, 1, 1, 5],
		new Float32Array([0.9]),
		prompt
	);

	assert.deepEqual(selection?.alpha, new Uint8Array([255, 255, 0, 0, 0]));
});

test('preserves the selected low-resolution logits for iterative refinement', () => {
	const input = selectedMaskInput(new Float32Array([1, 2, 3, 4, 5, 6]), [1, 1, 2, 1, 3], 1);

	assert.deepEqual(input.dimensions, [1, 1, 1, 3]);
	assert.deepEqual(input.data, new Float32Array([4, 5, 6]));
});
