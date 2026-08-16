import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserStorageService } from '../src/lib/browser-storage.ts';

function withNavigatorStorage<T>(storage: object, run: () => Promise<T>) {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { value: { storage }, configurable: true });
	return run().finally(() => {
		if (original) Object.defineProperty(globalThis, 'navigator', original);
		else delete (globalThis as { navigator?: unknown }).navigator;
	});
}

test('reports durability without consulting the storage estimate', async () => {
	let estimateCalls = 0;
	const status = await withNavigatorStorage(
		{
			persisted: async () => true,
			persist: async () => true,
			estimate: async () => {
				estimateCalls += 1;
				return { usage: 1, quota: 2 };
			}
		},
		() => new BrowserStorageService().status()
	);

	assert.equal(status.durability, 'persistent');
	assert.equal(status.persisted, true);
	assert.equal(estimateCalls, 0);
	assert.ok(!('originUsageBytes' in status));
	assert.ok(!('quotaBytes' in status));
});

test('reports best-effort durability when persistence was not granted', async () => {
	const status = await withNavigatorStorage(
		{ persisted: async () => false, persist: async () => false },
		() => new BrowserStorageService().status()
	);

	assert.equal(status.durability, 'best-effort');
	assert.equal(status.capabilities.persistence, true);
});
