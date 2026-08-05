import assert from 'node:assert/strict';
import test from 'node:test';

import { SmartMaskClient } from '../src/lib/smart-mask-client.ts';
import type { SmartMaskRequest, SmartMaskResponse } from '../src/lib/smart-mask.ts';

class FakeWorker extends EventTarget {
	readonly messages: SmartMaskRequest[] = [];
	terminated = false;

	postMessage(message: SmartMaskRequest) {
		this.messages.push(message);
	}

	respond(response: SmartMaskResponse) {
		this.dispatchEvent(new MessageEvent<SmartMaskResponse>('message', { data: response }));
	}

	terminate() {
		this.terminated = true;
	}
}

function setup() {
	const workers: FakeWorker[] = [];
	const client = new SmartMaskClient(() => {
		const worker = new FakeWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	});
	return { client, workers };
}

test('prepares a photo before requesting prompted masks', async () => {
	const { client, workers } = setup();
	const progress: string[] = [];
	client.onProgress(({ detail }) => progress.push(detail));
	const image = new Blob(['preview'], { type: 'image/jpeg' });
	const preparing = client.prepare('photo-one', image);
	assert.deepEqual(workers[0]?.messages, [{ id: 1, type: 'prepare', photoId: 'photo-one', image }]);
	workers[0]?.respond({
		id: 1,
		type: 'progress',
		phase: 'encoding',
		progress: null,
		detail: 'analyzing photo'
	});
	workers[0]?.respond({
		id: 1,
		type: 'prepared',
		modelVersion: client.modelVersion,
		device: 'wasm'
	});
	assert.equal((await preparing).device, 'wasm');
	assert.deepEqual(progress, ['analyzing photo']);

	const selecting = client.selectObject('photo-one', 'selection-one', [
		{ label: 'foreground', points: [{ x: 0.25, y: 0.75 }] }
	]);
	assert.deepEqual(workers[0]?.messages[1], {
		id: 2,
		type: 'object',
		photoId: 'photo-one',
		selectionId: 'selection-one',
		strokes: [{ label: 'foreground', points: [{ x: 0.25, y: 0.75 }] }]
	});
	workers[0]?.respond({
		id: 2,
		type: 'mask',
		modelVersion: client.modelVersion,
		width: 2,
		height: 2,
		alpha: new Uint8Array([0, 255, 255, 0]).buffer
	});
	assert.deepEqual((await selecting).alpha, new Uint8Array([0, 255, 255, 0]));
	client.destroy();
});

test('restarting rejects stale inference and creates an isolated worker', async () => {
	const { client, workers } = setup();
	const pending = client.prepare('photo-one', new Blob());
	const rejected = assert.rejects(pending, /Photo changed/);
	client.restart('Photo changed');
	await rejected;
	assert.equal(workers[0]?.terminated, true);
	assert.equal(workers.length, 2);
	client.destroy();
});
