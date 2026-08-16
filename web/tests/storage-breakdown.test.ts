import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssetUsage } from '../src/lib/asset-store.ts';
import { segmentBytes, storageBreakdown } from '../src/lib/storage-breakdown.ts';

function usage(overrides: Partial<AssetUsage> = {}): AssetUsage {
	return {
		originals: 0,
		thumbnails: 0,
		edits: 0,
		derived: 0,
		models: 0,
		masks: 0,
		...overrides
	};
}

test('rolls asset folders into user-facing segments', () => {
	const breakdown = storageBreakdown(
		usage({ originals: 500, thumbnails: 20, edits: 30, masks: 10, models: 200, derived: 80 })
	);

	assert.equal(segmentBytes(breakdown, 'photos'), 520);
	assert.equal(segmentBytes(breakdown, 'edits'), 40);
	assert.equal(segmentBytes(breakdown, 'models'), 200);
	assert.equal(segmentBytes(breakdown, 'cache'), 80);
});

test('totals only what the app stores', () => {
	const breakdown = storageBreakdown(usage({ originals: 300, models: 200, derived: 80 }));

	assert.equal(breakdown.totalBytes, 580);
	assert.deepEqual(
		breakdown.segments.map((segment) => segment.id),
		['photos', 'edits', 'models', 'cache']
	);
});

test('reports an empty library as zero', () => {
	const breakdown = storageBreakdown(usage());

	assert.equal(breakdown.totalBytes, 0);
	assert.ok(breakdown.segments.every((segment) => segment.bytes === 0));
});
