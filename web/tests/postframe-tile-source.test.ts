import assert from 'node:assert/strict';
import test from 'node:test';

import type OpenSeadragon from 'openseadragon';
import {
	PYRAMID_MAX_BIN,
	PYRAMID_TILE_OVERLAP,
	PYRAMID_TILE_SIZE,
	createPostframeTileSource,
	pyramidLevels,
	pyramidTileRegion,
	pyramidTileUrl
} from '../src/lib/postframe-tile-source.ts';

const image = { width: 6001, height: 4003 };
const settings = {
	exposure: 0,
	contrast: 0,
	highlights: 0,
	shadows: 0,
	whites: 0,
	blacks: 0
};
const color = { temperature: 0, tint: 0, vibrance: 0, saturation: 0 };

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

test('keys tile caches by photo and render revision', () => {
	assert.equal(pyramidTileUrl('photo one', 7, 13, 2, 4), 'postframe://photo%20one/7/13/2/4.bitmap');
});

class FakeTileSource {
	constructor(options: object) {
		Object.assign(this, options);
	}
}

function tileSource(renderTile: Parameters<typeof createPostframeTileSource>[1]['renderTile']) {
	return createPostframeTileSource(
		{ TileSource: FakeTileSource } as unknown as typeof OpenSeadragon,
		{
			photoId: 'photo-one',
			revision: 3,
			image,
			renderTile,
			settings,
			color,
			tone: true
		}
	) as OpenSeadragon.TileSource & {
		downloadTileStart: (job: OpenSeadragon.ImageJob) => void;
		downloadTileAbort: (job: OpenSeadragon.ImageJob) => void;
	};
}

function tileJob() {
	const calls = { finish: 0, fail: 0 };
	const job = {
		tile: { level: pyramidLevels(image).maxLevel, x: 0, y: 0 },
		userData: {},
		finish: () => {
			calls.finish += 1;
		},
		fail: () => {
			calls.fail += 1;
		}
	} as unknown as OpenSeadragon.ImageJob;
	return { calls, job };
}

test('aborting a tile job cancels its renderer and discards late output', async () => {
	let resolveTile: (bitmap: ImageBitmap) => void = () => {};
	const capturedSignal: { current?: AbortSignal } = {};
	const source = tileSource(
		(_photoId, _request, requestSignal) =>
			new Promise((resolve) => {
				capturedSignal.current = requestSignal;
				resolveTile = resolve;
			})
	);
	const { calls, job } = tileJob();

	source.downloadTileStart(job);
	source.downloadTileAbort(job);
	assert.equal(capturedSignal.current?.aborted, true);

	let closed = false;
	resolveTile({
		width: 512,
		height: 512,
		close: () => {
			closed = true;
		}
	} as ImageBitmap);
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(closed, true);
	assert.deepEqual(calls, { finish: 0, fail: 0 });
});

test('a completed tile job publishes its bitmap exactly once', async () => {
	const bitmap = { close: () => {} } as ImageBitmap;
	const source = tileSource(async () => bitmap);
	const { calls, job } = tileJob();

	source.downloadTileStart(job);
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(calls, { finish: 1, fail: 0 });
});
