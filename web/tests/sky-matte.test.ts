import assert from 'node:assert/strict';
import test from 'node:test';

import { skySegmentAlpha, type SkySegment } from '../src/lib/sky-matte.ts';

function segment(label: string | null, pixels: number[], width = 2, height = 2): SkySegment {
	return { label, mask: { width, height, data: Uint8Array.from(pixels) } };
}

test('unions every sky segment into a single binary matte', () => {
	const alpha = skySegmentAlpha(
		[segment('sky-other', [255, 0, 0, 0]), segment('clouds', [0, 255, 0, 0])],
		2,
		2
	);

	assert.deepEqual([...alpha!], [255, 255, 0, 0]);
});

test('reads sky through the unmapped merged panoptic label', () => {
	const alpha = skySegmentAlpha([segment('LABEL_187', [0, 255, 255, 0])], 2, 2);

	assert.deepEqual([...alpha!], [0, 255, 255, 0]);
});

test('ignores segments that are not sky', () => {
	const alpha = skySegmentAlpha(
		[
			segment('sky-other', [255, 0, 0, 0]),
			segment('skyscraper', [0, 255, 0, 0]),
			segment('LABEL_193', [0, 0, 255, 0]),
			segment(null, [0, 0, 0, 255])
		],
		2,
		2
	);

	assert.deepEqual([...alpha!], [255, 0, 0, 0]);
});

test('reports a skyless photo as null', () => {
	assert.equal(skySegmentAlpha([segment('grass', [255, 255, 255, 255])], 2, 2), null);
	assert.equal(skySegmentAlpha([], 2, 2), null);
});

test('rejects sky segments that do not match the photo dimensions', () => {
	assert.throws(() => skySegmentAlpha([segment('sky-other', [255, 0], 2, 1)], 2, 2), /dimensions/);
});
