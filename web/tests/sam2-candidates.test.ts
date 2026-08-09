import assert from 'node:assert/strict';
import test from 'node:test';

import {
	rankSam2MaskCandidates,
	usableSam2Mask,
	type Sam2MaskCandidate
} from '../src/lib/sam2-candidates.ts';
import type { Sam2PromptPoint } from '../src/lib/sam2-prompt.ts';

const prompts: Sam2PromptPoint[] = [
	{ x: 0.25, y: 0.5, label: 1 },
	{ x: 0.9, y: 0.5, label: 0 }
];

test('ranks candidates using the model score and user corrections', () => {
	const missesPrompt = candidate((x) => x > 4, 0.95);
	const followsPrompt = candidate((x) => x < 4, 0.85);
	const ranked = rankSam2MaskCandidates([missesPrompt, followsPrompt], prompts);

	assert.equal(ranked[0]?.index, 1);
});

test('rejects point-shaped and non-finite model output', () => {
	const dot = candidate((x, y) => x === 2 && y === 4, 0.99);
	const invalid = candidate(() => true, 0.99);
	invalid.logits[0] = Number.NaN;

	assert.equal(usableSam2Mask(dot, prompts), false);
	assert.equal(usableSam2Mask(invalid, prompts), false);
});

test('accepts an object-sized candidate that obeys included and excluded points', () => {
	assert.equal(
		usableSam2Mask(
			candidate((x) => x < 5, 0.9),
			prompts
		),
		true
	);
});

function candidate(
	selected: (x: number, y: number) => boolean,
	predictedIou: number
): Sam2MaskCandidate {
	const width = 10;
	const height = 8;
	return {
		width,
		height,
		logits: Float32Array.from({ length: width * height }, (_, index) =>
			selected(index % width, Math.floor(index / width)) ? 6 : -6
		),
		predictedIou,
		objectScore: 6
	};
}
