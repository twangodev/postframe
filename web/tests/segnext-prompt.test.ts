import assert from 'node:assert/strict';
import test from 'node:test';

import { createSegNextPrompt } from '../src/lib/segnext-prompt.ts';

test('preserves the painted path as a dense foreground prompt', () => {
	const size = 32;
	const prompt = createSegNextPrompt(
		[
			{
				label: 'foreground',
				points: [
					{ x: 0.25, y: 0.5 },
					{ x: 0.75, y: 0.5 }
				]
			}
		],
		size
	);
	const foreground = prompt.subarray(size * size, size * size * 2);

	for (let x = 8; x <= 23; x += 1) assert.equal(foreground[16 * size + x], 1);
});

test('keeps foreground, background, and previous masks in separate channels', () => {
	const size = 8;
	const previous = new Float32Array(size * size);
	previous[0] = 0.75;
	const prompt = createSegNextPrompt(
		[
			{ label: 'foreground', points: [{ x: 0, y: 0 }] },
			{ label: 'background', points: [{ x: 1, y: 1 }] }
		],
		size,
		previous
	);

	assert.equal(prompt[0], 0.75);
	assert.equal(prompt[size * size], 1);
	assert.equal(prompt[size * size * 3 - 1], 1);
});

test('requires foreground guidance', () => {
	assert.throws(
		() => createSegNextPrompt([{ label: 'background', points: [{ x: 0.5, y: 0.5 }] }], 16),
		/Paint over an object/
	);
});
