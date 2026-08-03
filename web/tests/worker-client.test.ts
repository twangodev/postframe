import assert from 'node:assert/strict';
import test from 'node:test';

import { PostframeWorkerClient } from '../src/lib/worker-client.ts';
import type { Request, Response } from '../src/lib/worker.ts';

const neutral = {
	exposure: 0,
	contrast: 0,
	highlights: 0,
	shadows: 0,
	whites: 0,
	blacks: 0
};

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

	const settings = { ...neutral, exposure: 1.25 };
	const cache = { name: 'render-v1-photo-one.pfc' } as FileSystemFileHandle;
	const opened = client.openRawDocument([], cache, 2048, settings);
	assert.deepEqual(workers[0]?.messages, [
		{ id: 1, type: 'open-raw', frames: [], cache, maxDimension: 2048, settings }
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
	workers[0]?.respond({ id: 1, type: 'capabilities', rawExtensions: ['raf'] });

	assert.equal((await capabilities).rawExtensions[0], 'raf');
	assert.deepEqual(measurements, [
		{ stage: 'raw-decode', durationMs: 14.5, detail: 'portrait.raf' }
	]);
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
	workers[1]?.respond({ id: 2, type: 'capabilities', rawExtensions: ['dng', 'raf'] });
	assert.deepEqual(await capabilities, {
		id: 2,
		type: 'capabilities',
		rawExtensions: ['dng', 'raf']
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
		settings: neutral,
		tone: true
	};
	const tile = client.renderTile(request);

	assert.deepEqual(workers[0]?.messages, [{ id: 1, type: 'tile', ...request }]);
	const bitmap = { width: 512, height: 512 } as ImageBitmap;
	workers[0]?.respond({ id: 1, type: 'tile', bitmap });
	assert.equal(await tile, bitmap);
	client.destroy();
});

test('opens display documents through the same rendered document contract', async () => {
	const { client, workers } = setup();
	const source = { name: 'portrait.png' } as FileSystemFileHandle;
	const opened = client.openDisplayDocument(source, 1600, neutral);

	assert.deepEqual(workers[0]?.messages, [
		{ id: 1, type: 'open-display', source, maxDimension: 1600, settings: neutral }
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
	const firstSettings = { ...neutral, contrast: 10 };
	const secondSettings = { ...neutral, contrast: 20 };
	const latestSettings = { ...neutral, contrast: 30 };
	const first = client.preview(firstSettings, true);
	const second = client.preview(secondSettings, true);
	const latest = client.preview(latestSettings, true);

	assert.deepEqual(workers[0]?.messages, [
		{ id: 1, type: 'preview', settings: firstSettings, tone: true }
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
		settings: latestSettings,
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
	const scope = client.scope(neutral, true, 150_000);

	assert.deepEqual(workers[0]?.messages, [
		{ id: 1, type: 'scope', settings: neutral, tone: true, sampleTarget: 150_000 }
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
