import assert from 'node:assert/strict';
import test from 'node:test';

import { PostframeWorkerClient } from '../src/lib/worker-client.ts';
import type { Request, Response } from '../src/lib/worker.ts';

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

	const opened = client.openDocument([], 2048);
	assert.deepEqual(workers[0]?.messages, [{ id: 1, type: 'open', frames: [], maxDimension: 2048 }]);

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
		jpeg: new ArrayBuffer(12),
		boostStops: 1.5,
		width: 6240,
		height: 4160
	});

	assert.equal(progress.length, 1);
	assert.deepEqual(await opened, {
		jpeg: new ArrayBuffer(12),
		boostStops: 1.5,
		width: 6240,
		height: 4160
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
		ev: 0,
		tone: true
	};
	const tile = client.renderTile(request);

	assert.deepEqual(workers[0]?.messages, [{ id: 1, type: 'tile', ...request }]);
	workers[0]?.respond({ id: 1, type: 'tile', png: new ArrayBuffer(24) });
	assert.deepEqual(await tile, new ArrayBuffer(24));
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
