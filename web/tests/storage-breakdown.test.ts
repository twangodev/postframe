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
		usage({ originals: 500, thumbnails: 20, edits: 30, masks: 10, models: 200, derived: 80 }),
		{ originUsageBytes: 900, quotaBytes: 2000 }
	);

	assert.equal(segmentBytes(breakdown, 'photos'), 520);
	assert.equal(segmentBytes(breakdown, 'edits'), 40);
	assert.equal(segmentBytes(breakdown, 'models'), 200);
	assert.equal(segmentBytes(breakdown, 'cache'), 80);
	assert.equal(breakdown.appBytes, 840);
});

test('attributes origin usage beyond the app folders to other site data', () => {
	const breakdown = storageBreakdown(usage({ originals: 100 }), {
		originUsageBytes: 150,
		quotaBytes: 1000
	});

	assert.equal(segmentBytes(breakdown, 'other'), 50);
	assert.equal(breakdown.freeBytes, 850);
});

test('clamps other and free to zero when the estimate lags reality', () => {
	const breakdown = storageBreakdown(usage({ originals: 300 }), {
		originUsageBytes: 200,
		quotaBytes: 100
	});

	assert.equal(segmentBytes(breakdown, 'other'), 0);
	assert.equal(breakdown.freeBytes, 0);
});

test('omits estimate-derived numbers when the browser reports none', () => {
	const breakdown = storageBreakdown(usage({ originals: 100 }), {
		originUsageBytes: null,
		quotaBytes: null
	});

	assert.equal(breakdown.freeBytes, null);
	assert.ok(breakdown.segments.every((segment) => segment.id !== 'other'));
});

test('reports an empty store as zeroed segments', () => {
	const breakdown = storageBreakdown(usage(), { originUsageBytes: 0, quotaBytes: 1000 });

	assert.equal(breakdown.appBytes, 0);
	assert.equal(breakdown.freeBytes, 1000);
	assert.ok(breakdown.segments.every((segment) => segment.bytes === 0));
});
