import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultDevelopSettings,
	withAdjustment,
	type ScalarControlName,
	type ScalarGroupName
} from '../src/lib/develop-settings.ts';
import { PostframeWorkerClient } from '../src/lib/worker-client.ts';
import type { Request, Response } from '../src/lib/worker.ts';

const neutral = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };

const neutralEdge = { contrast: 0, feather: 0, shift: 0 };
const neutralColor = { temperature: 0, tint: 0, vibrance: 0, saturation: 0 };
const neutralAdjustments = defaultDevelopSettings();
const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

const adjusted = <Group extends ScalarGroupName>(
	group: Group,
	control: ScalarControlName<Group>,
	value: number
) => withAdjustment(neutralAdjustments, group, control, value);

function scopeTransfer() {
	return {
		histogram: new Uint32Array(4 * 256).buffer,
		waveform: new Uint16Array(3 * 512 * 256).buffer,
		waveformWidth: 512,
		waveformHeight: 256,
		sampleCount: 512
	};
}

class FakeWorker extends EventTarget {
	readonly messages: Request[] = [];
	readonly transfers: Transferable[][] = [];
	terminated = false;

	postMessage(message: Request, transfer: Transferable[] = []) {
		this.messages.push(message);
		this.transfers.push(transfer);
	}

	respond(response: Response) {
		this.dispatchEvent(new MessageEvent<Response>('message', { data: response }));
	}

	terminate() {
		this.terminated = true;
	}
}

function setup() {
	const workers: FakeWorker[] = [];
	const client = new PostframeWorkerClient(() => {
		const worker = new FakeWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	});
	return { client, workers };
}

test('reports document progress before resolving the developed preview', async () => {
	const { client, workers } = setup();
	const progress: Response[] = [];
	client.onProgress((message) => progress.push(message));

	const adjustments = adjusted('light', 'exposure', 1.25);
	const cache = { name: 'render-v1-photo-one.pfc' } as FileSystemFileHandle;
	const opened = client.openRawDocument([], cache, 2048, adjustments, null);
	assert.deepEqual(workers[0]?.messages, [
		{
			id: 1,
			type: 'open-raw',
			frames: [],
			cache,
			maxDimension: 2048,
			adjustments,
			crop: null
		}
	]);

	workers[0]?.respond({
		id: 1,
		type: 'progress',
		phase: 'rendering',
		bytesRead: 24,
		totalBytes: 24,
		framesDecoded: 1,
		totalFrames: 1,
		activeFrame: 1
	});
	workers[0]?.respond({
		id: 1,
		type: 'opened',
		image: new ArrayBuffer(12),
		mediaType: 'image/jpeg',
		scope: scopeTransfer(),
		boostStops: 1.5,
		width: 6240,
		height: 4160
	});

	assert.equal(progress.length, 1);
	const result = await opened;
	assert.equal(result.image.byteLength, 12);
	assert.equal(result.mediaType, 'image/jpeg');
	assert.equal(result.scope.histogram.length, 4 * 256);
	assert.equal(result.scope.waveform.length, 3 * 512 * 256);
	assert.equal(result.scope.sampleCount, 512);
	assert.equal(result.boostStops, 1.5);
	assert.equal(result.width, 6240);
	assert.equal(result.height, 4160);
	client.destroy();
});

test('reports worker performance measurements without consuming pending requests', async () => {
	const { client, workers } = setup();
	const measurements: Extract<Response, { type: 'performance' }>['measurement'][] = [];
	client.onPerformance((measurement) => measurements.push(measurement));
	const capabilities = client.capabilities();

	workers[0]?.respond({
		id: 0,
		type: 'performance',
		measurement: { stage: 'raw-decode', durationMs: 14.5, detail: 'portrait.raf' }
	});
	workers[0]?.respond({
		id: 1,
		type: 'capabilities',
		rawExtensions: ['raf'],
		threaded: true,
		threadCount: 4
	});

	assert.equal((await capabilities).rawExtensions[0], 'raf');
	assert.deepEqual(measurements, [
		{ stage: 'raw-decode', durationMs: 14.5, detail: 'portrait.raf' }
	]);
	assert.deepEqual(client.performanceReport(), {
		runtime: { threaded: true, threadCount: 4 },
		sampleCapacity: 256,
		totalSamples: 1,
		series: [
			{
				stage: 'raw-decode',
				detail: 'portrait.raf',
				samples: 1,
				minMs: 14.5,
				medianMs: 14.5,
				p95Ms: 14.5,
				meanMs: 14.5,
				maxMs: 14.5
			}
		]
	});
	client.destroy();
});

test('restarting cancels stale work and accepts requests on a fresh worker', async () => {
	const { client, workers } = setup();
	const pending = client.capabilities();
	const rejected = assert.rejects(pending, /Document changed/);

	client.restart('Document changed');

	await rejected;
	assert.equal(workers[0]?.terminated, true);
	assert.equal(workers.length, 2);

	const capabilities = client.capabilities();
	workers[1]?.respond({
		id: 2,
		type: 'capabilities',
		rawExtensions: ['dng', 'raf'],
		threaded: false,
		threadCount: 1
	});
	assert.deepEqual(await capabilities, {
		id: 2,
		type: 'capabilities',
		rawExtensions: ['dng', 'raf'],
		threaded: false,
		threadCount: 1
	});
	client.destroy();
});

test('requests a lossless source tile at the selected bin', async () => {
	const { client, workers } = setup();
	const request = {
		x: 1024,
		y: 512,
		width: 1024,
		height: 1024,
		bin: 2,
		adjustments: neutralAdjustments,
		crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
		tone: true
	};
	const tile = client.renderTile(request);

	assert.deepEqual(workers[0]?.messages, [{ id: 1, type: 'tile', ...request }]);
	const bitmap = { width: 512, height: 512 } as ImageBitmap;
	workers[0]?.respond({ id: 1, type: 'tile', bitmap });
	assert.equal(await tile, bitmap);
	client.destroy();
});

test('cancels stale tile requests and closes their late bitmaps', async () => {
	const { client, workers } = setup();
	const controller = new AbortController();
	const request = {
		x: 0,
		y: 0,
		width: 512,
		height: 512,
		bin: 1,
		adjustments: neutralAdjustments,
		crop: null,
		tone: true
	};
	const tile = client.renderTile(request, controller.signal);

	controller.abort();
	await assert.rejects(tile, /Tile rendering cancelled/);

	let closed = false;
	const bitmap = {
		width: 512,
		height: 512,
		close: () => {
			closed = true;
		}
	} as ImageBitmap;
	workers[0]?.respond({ id: 1, type: 'tile', bitmap });
	assert.equal(closed, true);
	client.destroy();
});

test('copies and transfers persistent masks without detaching document state', async () => {
	const { client, workers } = setup();
	const alpha = new Uint8Array([0, 64, 128, 255]);
	const mask = {
		id: 'subject',
		width: 2,
		height: 2,
		alpha: alpha.buffer,
		edge: neutralEdge,
		settings: { light: { ...neutral, exposure: 0.5 }, color: { ...neutralColor, tint: -20 } }
	};
	const updated = client.setMasks([mask]);

	const request = workers[0]?.messages[0];
	assert.equal(request?.type, 'set-masks');
	if (request?.type !== 'set-masks') throw new Error('Expected a mask request');
	assert.notEqual(request.masks[0]?.alpha, mask.alpha);
	assert.deepEqual(new Uint8Array(request.masks[0]?.alpha ?? new ArrayBuffer()), alpha);
	assert.equal(mask.alpha.byteLength, 4);
	assert.deepEqual(workers[0]?.transfers, [[request.masks[0]?.alpha as ArrayBuffer]]);

	workers[0]?.respond({ id: 1, type: 'masks-set' });
	await updated;
	client.destroy();
});

test('adjusts mask edges without detaching the persistent source', async () => {
	const { client, workers } = setup();
	const alpha = new Uint8Array([0, 255, 255, 0]);
	const adjusted = client.adjustMask({
		width: 2,
		height: 2,
		alpha: alpha.buffer,
		edge: { contrast: 25, feather: 2, shift: -1 }
	});

	const request = workers[0]?.messages[0];
	assert.equal(request?.type, 'adjust-mask');
	if (request?.type !== 'adjust-mask') throw new Error('Expected a mask adjustment request');
	assert.notEqual(request.alpha, alpha.buffer);
	assert.deepEqual(workers[0]?.transfers, [[request.alpha]]);
	assert.equal(alpha.byteLength, 4);

	workers[0]?.respond({ id: 1, type: 'mask-adjusted', alpha: Uint8Array.of(0, 0, 0, 0).buffer });
	assert.deepEqual(await adjusted, new Uint8Array(4));
	client.destroy();
});

test('opens display documents through the same rendered document contract', async () => {
	const { client, workers } = setup();
	const source = { name: 'portrait.png' } as FileSystemFileHandle;
	const opened = client.openDisplayDocument(source, 1600, neutralAdjustments, null);

	assert.deepEqual(workers[0]?.messages, [
		{
			id: 1,
			type: 'open-display',
			source,
			maxDimension: 1600,
			adjustments: neutralAdjustments,
			crop: null
		}
	]);
	workers[0]?.respond({
		id: 1,
		type: 'opened',
		image: new ArrayBuffer(16),
		mediaType: 'image/png',
		scope: scopeTransfer(),
		boostStops: null,
		width: 800,
		height: 600
	});

	const result = await opened;
	assert.equal(result.mediaType, 'image/png');
	assert.equal(result.boostStops, null);
	client.destroy();
});

test('keeps one preview in flight and coalesces queued settings to the latest', async () => {
	const { client, workers } = setup();
	const firstSettings = adjusted('light', 'contrast', 10);
	const secondSettings = adjusted('light', 'contrast', 20);
	const latestSettings = adjusted('color', 'saturation', 15);
	const first = client.preview(firstSettings, null, true);
	const second = client.preview(secondSettings, null, true);
	const latest = client.preview(latestSettings, crop, true);

	assert.deepEqual(workers[0]?.messages, [
		{ id: 1, type: 'preview', adjustments: firstSettings, crop: null, tone: true }
	]);
	workers[0]?.respond({
		id: 1,
		type: 'preview',
		image: new ArrayBuffer(10),
		mediaType: 'image/jpeg'
	});
	await first;
	await new Promise((resolve) => queueMicrotask(resolve));
	assert.deepEqual(workers[0]?.messages[1], {
		id: 2,
		type: 'preview',
		adjustments: latestSettings,
		crop,
		tone: true
	});

	workers[0]?.respond({
		id: 2,
		type: 'preview',
		image: new ArrayBuffer(20),
		mediaType: 'image/jpeg'
	});
	assert.equal((await second).image.byteLength, 20);
	assert.equal((await latest).image.byteLength, 20);
	client.destroy();
});

test('requests scopes independently from interactive preview images', async () => {
	const { client, workers } = setup();
	const scope = client.scope(neutralAdjustments, null, true, 150_000);

	assert.deepEqual(workers[0]?.messages, [
		{
			id: 1,
			type: 'scope',
			adjustments: neutralAdjustments,
			crop: null,
			tone: true,
			sampleTarget: 150_000
		}
	]);
	workers[0]?.respond({ id: 1, type: 'scope', scope: scopeTransfer() });

	assert.equal((await scope).sampleCount, 512);
	client.destroy();
});

test('transfers one-shot validation buffers to the worker', async () => {
	const { client, workers } = setup();
	const raw = new ArrayBuffer(16);
	const validated = client.validateRaw(raw);

	assert.deepEqual(workers[0]?.transfers, [[raw]]);
	workers[0]?.respond({ id: 1, type: 'validated' });
	await validated;
	client.destroy();
});

test('exports through the worker with staged progress and detached masks', async () => {
	const { client, workers } = setup();
	const progress: { phase: string; completed: number; total: number }[] = [];
	const alpha = new Uint8Array([1, 2, 3, 4]).buffer;
	const geometry = {
		rotation: 90,
		flipHorizontal: true,
		flipVertical: false,
		crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
	};
	const exported = client.exportPhoto(
		{
			adjustments: adjusted('color', 'temperature', 30),
			masks: [
				{
					id: 'mask-1',
					width: 2,
					height: 2,
					alpha,
					edge: { ...neutralEdge },
					settings: { light: { ...neutral }, color: { ...neutralColor, saturation: 25 } }
				}
			],
			geometry,
			quality: 88
		},
		(update) => progress.push(update)
	);

	const message = workers[0]?.messages[0];
	if (message?.type !== 'export') throw new Error('expected an export request');
	assert.equal(message.quality, 88);
	assert.deepEqual(message.geometry, geometry);
	assert.notEqual(message.geometry, geometry);
	assert.notEqual(message.geometry.crop, geometry.crop);
	assert.notEqual(message.masks[0]?.alpha, alpha);
	assert.deepEqual(workers[0]?.transfers[0], [message.masks[0]?.alpha]);

	workers[0]?.respond({ id: 1, type: 'export-progress', phase: 'decode', completed: 1, total: 1 });
	workers[0]?.respond({ id: 1, type: 'export-progress', phase: 'develop', completed: 2, total: 4 });
	workers[0]?.respond({ id: 1, type: 'export-progress', phase: 'encode', completed: 0, total: 1 });
	workers[0]?.respond({ id: 1, type: 'export', jpeg: new ArrayBuffer(9) });

	assert.deepEqual(progress, [
		{ phase: 'decode', completed: 1, total: 1 },
		{ phase: 'develop', completed: 2, total: 4 },
		{ phase: 'encode', completed: 0, total: 1 }
	]);
	assert.equal((await exported).byteLength, 9);
	client.destroy();
});

test('asks the worker for a white balance from a sample or the whole image', async () => {
	const { client, workers } = setup();
	const sampled = client.autoBalance({ x: 0.25, y: 0.75, radius: 5 });
	const whole = client.autoBalance();

	assert.deepEqual(workers[0]?.messages, [
		{ id: 1, type: 'auto-balance', sample: { x: 0.25, y: 0.75, radius: 5 } },
		{ id: 2, type: 'auto-balance' }
	]);
	workers[0]?.respond({ id: 1, type: 'auto-balance', temperature: 12.5, tint: -4 });
	workers[0]?.respond({ id: 2, type: 'auto-balance', temperature: -30, tint: 8 });
	assert.deepEqual(await sampled, { temperature: 12.5, tint: -4 });
	assert.deepEqual(await whole, { temperature: -30, tint: 8 });
	client.destroy();
});

test('asks the worker for auto tone light settings', async () => {
	const { client, workers } = setup();
	const tone = client.autoTone();
	assert.deepEqual(workers[0]?.messages, [{ id: 1, type: 'auto-tone' }]);
	const light = { ...neutral, exposure: 0.35, blacks: -12, whites: 20 };
	workers[0]?.respond({ id: 1, type: 'auto-tone', light });
	assert.deepEqual(await tone, light);
	client.destroy();
});

test('carries clipping indicators to the tile renderer as a plain copy', async () => {
	const { client, workers } = setup();
	const clipping = { highlights: true, shadows: false };
	const tile = client.renderTile({
		x: 0,
		y: 0,
		width: 512,
		height: 512,
		bin: 1,
		adjustments: neutralAdjustments,
		crop: null,
		tone: true,
		clipping
	});
	const message = workers[0]?.messages[0];
	if (message?.type !== 'tile') throw new Error('expected a tile request');
	assert.deepEqual(message.clipping, clipping);
	assert.notEqual(message.clipping, clipping);
	workers[0]?.respond({ id: 1, type: 'tile', bitmap: {} as ImageBitmap });
	await tile;
	client.destroy();
});
