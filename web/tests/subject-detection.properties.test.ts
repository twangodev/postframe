import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { detectedSubjects } from '../src/lib/subject-detection.ts';
import type { NormalizedRegion } from '../src/lib/edit-document.ts';

const SUBJECT_LABELS = new Set([
	'person',
	'cat',
	'dog',
	'bird',
	'horse',
	'sheep',
	'cow',
	'elephant',
	'bear',
	'zebra',
	'giraffe'
]);

const gridSpan = fc
	.integer({ min: 0, max: 8 })
	.chain((start) => fc.integer({ min: start + 1, max: 10 }).map((end) => [start, end] as const));

const sceneArbitrary = fc
	.record({
		width: fc.integer({ min: 40, max: 200 }),
		height: fc.integer({ min: 40, max: 200 }),
		anchors: fc.array(fc.record({ horizontal: gridSpan, vertical: gridSpan }), {
			minLength: 1,
			maxLength: 12
		})
	})
	.chain(({ width, height, anchors }) =>
		fc
			.array(
				fc.record({
					label: fc.constantFrom('person', 'cat', 'dog', 'zebra', 'car', 'chair', 'tree'),
					score: fc.constantFrom(0.3, 0.55, 0.7, 0.9, 0.95, 1),
					anchor: fc.integer({ min: 0, max: anchors.length - 1 }),
					jitter: fc.integer({ min: -12, max: 12 })
				}),
				{ minLength: 8, maxLength: 24 }
			)
			.map((picks) => ({
				width,
				height,
				detections: picks.map(({ label, score, anchor, jitter }) => {
					const { horizontal, vertical } = anchors[anchor]!;
					return {
						label,
						score,
						box: {
							xmin: (horizontal[0] * width) / 10 + jitter,
							xmax: (horizontal[1] * width) / 10 + jitter,
							ymin: (vertical[0] * height) / 10 + jitter,
							ymax: (vertical[1] * height) / 10 + jitter
						}
					};
				})
			}))
	);

function intersectionOverUnion(left: NormalizedRegion, right: NormalizedRegion) {
	const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
	const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
	if (width <= 0 || height <= 0) return 0;
	const intersection = width * height;
	return intersection / (left.width * left.height + right.width * right.height - intersection);
}

test('subjects are capped, confident, in unit bounds, and ordered left to right (seed 4401)', () => {
	fc.assert(
		fc.property(sceneArbitrary, ({ detections, width, height }) => {
			const subjects = detectedSubjects(detections, width, height);
			assert.ok(subjects.length <= 8);
			let previousCenter = -Infinity;
			for (const { label, score, box } of subjects) {
				assert.ok(SUBJECT_LABELS.has(label));
				assert.ok(score >= 0.5);
				assert.ok(box.x >= 0 && box.y >= 0);
				assert.ok(box.width > 0 && box.height > 0);
				assert.ok(box.x + box.width <= 1 && box.y + box.height <= 1);
				const center = box.x + box.width / 2;
				assert.ok(center >= previousCenter, 'subjects out of order');
				previousCenter = center;
			}
		}),
		{ seed: 4401, path: undefined }
	);
});

test('no two reported subjects overlap at or above the duplicate threshold (seed 4402)', () => {
	fc.assert(
		fc.property(sceneArbitrary, ({ detections, width, height }) => {
			const subjects = detectedSubjects(detections, width, height);
			for (let left = 0; left < subjects.length; left += 1) {
				for (let right = left + 1; right < subjects.length; right += 1) {
					const overlap = intersectionOverUnion(subjects[left]!.box, subjects[right]!.box);
					assert.ok(overlap < 0.7, `duplicate subjects with overlap ${overlap}`);
				}
			}
		}),
		{ seed: 4402, path: undefined }
	);
});
