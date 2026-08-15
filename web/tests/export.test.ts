import assert from 'node:assert/strict';
import test from 'node:test';

import {
	cropRegion,
	exportFileName,
	exportMetadataSource,
	exportProgressPercent,
	exportTiles,
	identityGeometry,
	rotatedBounds
} from '../src/lib/export.ts';

test('derives the export file name from the original stem', () => {
	assert.equal(exportFileName('IMG_1234.CR3'), 'IMG_1234-edit.jpg');
	assert.equal(exportFileName('sunset.with.dots.jpeg'), 'sunset.with.dots-edit.jpg');
	assert.equal(exportFileName('no-extension'), 'no-extension-edit.jpg');
	assert.equal(exportFileName('.hidden'), '.hidden-edit.jpg');
	assert.equal(exportFileName('  spaced.jpg  '), 'spaced-edit.jpg');
	assert.equal(exportFileName('   '), 'photograph-edit.jpg');
});

test('maps export phases onto one progress scale', () => {
	assert.equal(exportProgressPercent({ phase: 'decode', completed: 0, total: 1 }), 0);
	assert.equal(exportProgressPercent({ phase: 'decode', completed: 1, total: 1 }), 5);
	assert.equal(exportProgressPercent({ phase: 'develop', completed: 0, total: 8 }), 5);
	assert.equal(exportProgressPercent({ phase: 'develop', completed: 4, total: 8 }), 43);
	assert.equal(exportProgressPercent({ phase: 'develop', completed: 8, total: 8 }), 80);
	assert.equal(exportProgressPercent({ phase: 'encode', completed: 0, total: 1 }), 80);
	assert.equal(exportProgressPercent({ phase: 'encode', completed: 1, total: 1 }), 100);
});

test('clamps out-of-range progress counts', () => {
	assert.equal(exportProgressPercent({ phase: 'develop', completed: 12, total: 8 }), 80);
	assert.equal(exportProgressPercent({ phase: 'develop', completed: -2, total: 8 }), 5);
	assert.equal(exportProgressPercent({ phase: 'develop', completed: 0, total: 0 }), 5);
});

test('picks the metadata original from the reference frame', () => {
	assert.equal(exportMetadataSource([]), null);
	assert.equal(exportMetadataSource([{ raw: 'a.raf' }]), 'a.raf');
	assert.equal(exportMetadataSource([{ raw: 'a.raf', jpeg: 'a.jpg' }]), 'a.jpg');
	assert.equal(
		exportMetadataSource([
			{ raw: 'under.raf', jpeg: 'under.jpg' },
			{ raw: 'mid.raf', jpeg: 'mid.jpg' },
			{ raw: 'over.raf', jpeg: 'over.jpg' }
		]),
		'mid.jpg'
	);
	assert.equal(
		exportMetadataSource([{ raw: 'under.raf', jpeg: 'under.jpg' }, { raw: 'mid.raf' }]),
		'under.jpg'
	);
	assert.equal(exportMetadataSource([{ raw: 'under.raf' }, { raw: 'mid.raf' }]), 'mid.raf');
});

test('tiles the full image exactly once', () => {
	const tiles = exportTiles(2500, 1100, 1024);
	assert.equal(tiles.length, 6);
	assert.deepEqual(tiles[0], { x: 0, y: 0, width: 1024, height: 1024 });
	assert.deepEqual(tiles.at(-1), { x: 2048, y: 1024, width: 452, height: 76 });
	const area = tiles.reduce((total, tile) => total + tile.width * tile.height, 0);
	assert.equal(area, 2500 * 1100);
});

test('computes rotated canvas bounds', () => {
	assert.deepEqual(rotatedBounds(4000, 3000, 0), { width: 4000, height: 3000 });
	assert.deepEqual(rotatedBounds(4000, 3000, 90), { width: 3000, height: 4000 });
	assert.deepEqual(rotatedBounds(4000, 3000, -90), { width: 3000, height: 4000 });
	assert.deepEqual(rotatedBounds(1000, 1000, 45), { width: 1414, height: 1414 });
});

test('resolves the crop region in pixels', () => {
	assert.deepEqual(cropRegion(4000, 3000, null), { x: 0, y: 0, width: 4000, height: 3000 });
	assert.deepEqual(cropRegion(4000, 3000, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }), {
		x: 1000,
		y: 750,
		width: 2000,
		height: 1500
	});
	assert.deepEqual(cropRegion(100, 100, { x: 0.95, y: 0, width: 0.2, height: 1 }), {
		x: 95,
		y: 0,
		width: 5,
		height: 100
	});
	assert.deepEqual(cropRegion(100, 100, { x: 0.999, y: 0.999, width: 0.001, height: 0.001 }), {
		x: 99,
		y: 99,
		width: 1,
		height: 1
	});
});

test('detects identity geometry', () => {
	const identity = { rotation: 0, flipHorizontal: false, flipVertical: false, crop: null };
	assert.equal(identityGeometry(identity), true);
	assert.equal(identityGeometry({ ...identity, rotation: 0.5 }), false);
	assert.equal(identityGeometry({ ...identity, flipHorizontal: true }), false);
	assert.equal(identityGeometry({ ...identity, flipVertical: true }), false);
	assert.equal(identityGeometry({ ...identity, crop: { x: 0, y: 0, width: 1, height: 1 } }), false);
});
