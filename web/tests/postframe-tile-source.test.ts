import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PYRAMID_MAX_BIN,
	PYRAMID_TILE_OVERLAP,
	PYRAMID_TILE_SIZE,
	pyramidLevels,
	pyramidTileRegion
} from '../src/lib/postframe-tile-source.ts';

const image = { width: 6001, height: 4003 };

test('limits the client-rendered pyramid to supported power-of-two bins', () => {
	const levels = pyramidLevels(image);
	assert.deepEqual(levels, { minLevel: 7, maxLevel: 13 });
	assert.equal(2 ** (levels.maxLevel - levels.minLevel), PYRAMID_MAX_BIN);
});

test('adds a one-pixel gutter to adjacent full-resolution tiles', () => {
	const { maxLevel } = pyramidLevels(image);
	const first = pyramidTileRegion(image, maxLevel, maxLevel, 0, 0);
	const interior = pyramidTileRegion(image, maxLevel, maxLevel, 1, 1);

	assert.deepEqual(first, {
		x: 0,
		y: 0,
		width: PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP,
		height: PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP,
		bin: 1,
		outputWidth: PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP,
		outputHeight: PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP
	});
	assert.equal(interior.x, PYRAMID_TILE_SIZE - PYRAMID_TILE_OVERLAP);
	assert.equal(interior.y, PYRAMID_TILE_SIZE - PYRAMID_TILE_OVERLAP);
	assert.equal(interior.outputWidth, PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP * 2);
	assert.equal(interior.outputHeight, PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP * 2);
});

test('keeps binned edge tiles inside the source image', () => {
	const { maxLevel } = pyramidLevels(image);
	const level = maxLevel - 2;
	const bin = 4;
	const columns = Math.ceil(Math.ceil(image.width / bin) / PYRAMID_TILE_SIZE);
	const rows = Math.ceil(Math.ceil(image.height / bin) / PYRAMID_TILE_SIZE);
	const edge = pyramidTileRegion(image, maxLevel, level, columns - 1, rows - 1);

	assert.equal(edge.bin, bin);
	assert.equal(edge.x + edge.width, image.width);
	assert.equal(edge.y + edge.height, image.height);
	assert.equal(edge.outputWidth, Math.ceil(edge.width / bin));
	assert.equal(edge.outputHeight, Math.ceil(edge.height / bin));
	assert.ok(edge.outputWidth <= PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP * 2);
	assert.ok(edge.outputHeight <= PYRAMID_TILE_SIZE + PYRAMID_TILE_OVERLAP * 2);
});

test('rejects levels outside the supported render pyramid', () => {
	const { maxLevel } = pyramidLevels(image);
	assert.throws(() => pyramidTileRegion(image, maxLevel, maxLevel - 7, 0, 0), RangeError);
	assert.throws(() => pyramidTileRegion(image, maxLevel, maxLevel, 20, 0), RangeError);
});
