import assert from 'node:assert/strict';
import test from 'node:test';
import { fileName, fileSize, readFile, sourceFile } from '../src/lib/worker-files.ts';

test('reads an opaque desktop asset source with progress', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2]));
					controller.enqueue(new Uint8Array([3, 4]));
					controller.close();
				}
			}),
			{ status: 200 }
		);
	try {
		const source = {
			kind: 'url' as const,
			url: 'postframe-asset://localhost/originals/photo.raw',
			name: 'photo.raw',
			size: 4
		};
		const progress: number[] = [];
		assert.equal(await fileSize(source), 4);
		assert.equal(fileName(source), 'photo.raw');
		assert.deepEqual(
			new Uint8Array(await readFile(source, 4, (value) => progress.push(value))),
			new Uint8Array([1, 2, 3, 4])
		);
		assert.deepEqual(progress, [4]);
		const file = await sourceFile(source);
		assert.equal(file.name, 'photo.raw');
		assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('rejects a desktop asset whose bytes disagree with the catalog', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
	try {
		await assert.rejects(
			readFile(
				{ kind: 'url', url: 'postframe-asset://localhost/photo', name: 'photo.raw', size: 2 },
				2,
				() => undefined
			),
			/larger than its catalog record/
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
