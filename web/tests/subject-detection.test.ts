import assert from 'node:assert/strict';
import test from 'node:test';

import {
	detectedSubjectName,
	detectedSubjects,
	type RawDetection
} from '../src/lib/subject-detection.ts';

function person(box: RawDetection['box'], score = 0.9): RawDetection {
	return { label: 'person', score, box };
}

test('keeps confident subjects and normalizes their boxes', () => {
	const subjects = detectedSubjects(
		[
			person({ xmin: 250, ymin: 125, xmax: 750, ymax: 375 }),
			{ label: 'chair', score: 0.99, box: { xmin: 0, ymin: 0, xmax: 500, ymax: 500 } },
			person({ xmin: 600, ymin: 0, xmax: 700, ymax: 400 }, 0.3)
		],
		1000,
		500
	);

	assert.equal(subjects.length, 1);
	assert.deepEqual(subjects[0]!.box, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
});

test('orders subjects left to right and numbers shared labels', () => {
	const subjects = detectedSubjects(
		[
			person({ xmin: 700, ymin: 100, xmax: 900, ymax: 500 }),
			person({ xmin: 100, ymin: 100, xmax: 300, ymax: 500 }),
			{ label: 'dog', score: 0.8, box: { xmin: 400, ymin: 300, xmax: 600, ymax: 500 } }
		],
		1000,
		500
	);

	assert.deepEqual(
		subjects.map((subject, index) => detectedSubjectName(subjects, index)),
		['person 1', 'dog', 'person 2']
	);
});

test('drops duplicate detections of the same subject in favor of the confident one', () => {
	const subjects = detectedSubjects(
		[
			person({ xmin: 100, ymin: 100, xmax: 300, ymax: 500 }, 0.95),
			person({ xmin: 105, ymin: 105, xmax: 305, ymax: 500 }, 0.6)
		],
		1000,
		500
	);

	assert.equal(subjects.length, 1);
	assert.equal(subjects[0]!.score, 0.95);
});

test('keeps only the most confident subjects when a crowd exceeds the cap', () => {
	const crowd = Array.from({ length: 12 }, (_, index) =>
		person({ xmin: index * 80, ymin: 0, xmax: index * 80 + 60, ymax: 400 }, 0.5 + index * 0.04)
	);

	const subjects = detectedSubjects(crowd, 1000, 500);

	assert.equal(subjects.length, 8);
	assert.ok(subjects.every(({ score }) => score >= 0.5 + 4 * 0.04));
});
