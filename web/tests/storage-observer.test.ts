import assert from 'node:assert/strict';
import test from 'node:test';

import { StorageObserver } from '../src/lib/storage-observer.ts';

// A hand-driven clock keeps the coalescing deterministic and instant.
function clock() {
	let now = 0;
	const timers = new Map<number, { at: number; fire: () => void }>();
	let nextId = 1;
	return {
		set: (fire: () => void, delay: number) => {
			const id = nextId++;
			timers.set(id, { at: now + delay, fire });
			return id;
		},
		clear: (id: number) => void timers.delete(id),
		advance(ms: number) {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at <= now) {
					timers.delete(id);
					timer.fire();
				}
			}
		}
	};
}

function observer(refresh: () => Promise<void>) {
	const time = clock();
	return {
		time,
		observer: new StorageObserver(refresh, { quietMs: 600, set: time.set, clear: time.clear })
	};
}

test('one write refreshes once the storage goes quiet', async () => {
	let refreshes = 0;
	const { time, observer: storage } = observer(async () => void (refreshes += 1));

	storage.wrote();
	assert.equal(refreshes, 0, 'nothing happens while writes may still be landing');
	time.advance(599);
	assert.equal(refreshes, 0);
	time.advance(1);
	assert.equal(refreshes, 1);
});

test('a burst of writes collapses into a single refresh', async () => {
	let refreshes = 0;
	const { time, observer: storage } = observer(async () => void (refreshes += 1));

	for (let index = 0; index < 20; index += 1) {
		storage.wrote();
		time.advance(100);
	}
	assert.equal(refreshes, 0, 'each write pushes the quiet window out');
	time.advance(600);
	assert.equal(refreshes, 1);
});

test('a write during a refresh schedules exactly one more', async () => {
	let refreshes = 0;
	let release!: () => void;
	const { time, observer: storage } = observer(
		() =>
			new Promise<void>((resolve) => {
				refreshes += 1;
				release = resolve;
			})
	);

	storage.wrote();
	time.advance(600);
	assert.equal(refreshes, 1);
	storage.wrote();
	storage.wrote();
	time.advance(600);
	assert.equal(refreshes, 1, 'the in-flight refresh must finish before another starts');
	release();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(refreshes, 2, 'the writes that landed mid-refresh are not lost');
});

test('a refresh that fails does not stop the next write from refreshing', async () => {
	let attempts = 0;
	const { time, observer: storage } = observer(async () => {
		attempts += 1;
		throw new Error('quota probe failed');
	});

	storage.wrote();
	time.advance(600);
	await Promise.resolve();
	storage.wrote();
	time.advance(600);
	await Promise.resolve();
	assert.equal(attempts, 2);
});

test('stopping cancels a pending refresh', () => {
	let refreshes = 0;
	const { time, observer: storage } = observer(async () => void (refreshes += 1));

	storage.wrote();
	storage.stop();
	time.advance(1000);
	assert.equal(refreshes, 0);
});
