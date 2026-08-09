import assert from 'node:assert/strict';
import test from 'node:test';

import { createSam2PointPrompt } from '../src/lib/sam2-prompt.ts';

test('turns a painted path into sparse points instead of a raster mask', () => {
	const prompt = createSam2PointPrompt(
		[
			{
				label: 'foreground',
				points: Array.from({ length: 101 }, (_, index) => ({ x: index / 100, y: 0.5 }))
			}
		],
		1000,
		500
	);

	assert.equal(prompt.points.length, 5);
	assert.deepEqual(prompt.points.map(({ label }) => label), [1, 1, 1, 1, 1]);
	assert.deepEqual(prompt.coordinates[0]?.[0]?.at(0), [0, 249.5]);
	assert.ok(Math.abs(prompt.coordinates[0]![0]!.at(-1)![0] - 999) < 1e-9);
	assert.equal(prompt.coordinates[0]![0]!.at(-1)![1], 249.5);
});

test('preserves foreground and background corrections within the prompt budget', () => {
	const strokes = Array.from({ length: 20 }, (_, index) => ({
		label: index === 0 ? ('foreground' as const) : ('background' as const),
		points: [{ x: index / 20, y: index / 20 }]
	}));
	const prompt = createSam2PointPrompt(strokes, 100, 100);

	assert.equal(prompt.points.length, 16);
	assert.ok(prompt.points.some(({ label }) => label === 1));
	assert.ok(prompt.points.some(({ label }) => label === 0));
});

test('requires at least one included point', () => {
	assert.throws(
		() =>
			createSam2PointPrompt(
				[{ label: 'background', points: [{ x: 0.5, y: 0.5 }] }],
				100,
				100
			),
		/Paint over the object/
	);
});
