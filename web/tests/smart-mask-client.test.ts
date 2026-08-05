import assert from 'node:assert/strict';
import test from 'node:test';

import { SmartMaskClient } from '../src/lib/smart-mask-client.ts';
import type { SmartMaskRequest, SmartMaskResponse } from '../src/lib/smart-mask.ts';

class FakeWorker extends EventTarget {
	readonly messages: SmartMaskRequest[] = [];
	readonly transfers: Transferable[][] = [];
	terminated = false;

	postMessage(message: SmartMaskRequest, transfer: Transferable[] = []) {
		this.messages.push(message);
		this.transfers.push(transfer);
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

test('transfers a copied mask for localized edge refinement', async () => {
	const { client, workers } = setup();
	const alpha = Uint8Array.from([0, 255, 255, 0]);
	const refining = client.refineEdge(
		'photo-one',
		{ width: 2, height: 2, alpha },
		{ points: [{ x: 0.5, y: 0.5 }], radius: 0.1 }
	);
	const request = workers[0]?.messages[0];
	assert.equal(request?.type, 'refine-edge');
	if (request?.type !== 'refine-edge') throw new Error('Expected edge refinement');
	assert.notEqual(request.alpha, alpha.buffer);
	assert.deepEqual(workers[0]?.transfers, [[request.alpha]]);
	assert.equal(alpha.byteLength, 4);

	workers[0]?.respond({
		id: 1,
		type: 'mask',
		modelVersion: client.modelVersion,
		width: 2,
		height: 2,
		alpha: Uint8Array.of(0, 0, 255, 255).buffer
	});
	assert.deepEqual((await refining).alpha, Uint8Array.of(0, 0, 255, 255));
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
