import assert from 'node:assert/strict';
import test from 'node:test';

import { TransferRate } from '../src/lib/transfer-rate.ts';

function clock() {
	let now = 0;
	return { now: () => now, advance: (ms: number) => (now += ms) };
}

test('holds the readout until half a second of samples exist', () => {
	const time = clock();
	const rate = new TransferRate(time.now);

	assert.equal(rate.sample(0, 1000), null);
	time.advance(200);
	assert.equal(rate.sample(20, 1000), null);
	time.advance(300);
	assert.deepEqual(rate.sample(50, 1000), { bytesPerSecond: 100, secondsLeft: 9.5 });
});

test('holds the previous readout between refreshes', () => {
	const time = clock();
	const rate = new TransferRate(time.now);

	rate.sample(0, 1000);
	time.advance(500);
	const first = rate.sample(50, 1000);
	time.advance(100);
	assert.equal(rate.sample(500, 1000), first);
	time.advance(400);
	assert.deepEqual(rate.sample(900, 1000), { bytesPerSecond: 900, secondsLeft: 100 / 900 });
});

test('clears the readout once every byte has arrived', () => {
	const time = clock();
	const rate = new TransferRate(time.now);

	rate.sample(0, 1000);
	time.advance(500);
	assert.notEqual(rate.sample(500, 1000), null);
	time.advance(100);
	assert.equal(rate.sample(1000, 1000), null);
});

test('averages over a sliding window so old speeds fall away', () => {
	const time = clock();
	const rate = new TransferRate(time.now);
	let loaded = 0;

	rate.sample(loaded, 10_000);
	for (let step = 0; step < 30; step += 1) {
		time.advance(100);
		loaded += 10;
		rate.sample(loaded, 10_000);
	}
	for (let step = 0; step < 35; step += 1) {
		time.advance(100);
		loaded += 50;
		rate.sample(loaded, 10_000);
	}

	assert.equal(rate.sample(loaded, 10_000)?.bytesPerSecond, 500);
});

test('reports no time left when nothing is moving', () => {
	const time = clock();
	const rate = new TransferRate(time.now);

	rate.sample(100, 1000);
	time.advance(600);
	assert.deepEqual(rate.sample(100, 1000), { bytesPerSecond: 0, secondsLeft: null });
});
