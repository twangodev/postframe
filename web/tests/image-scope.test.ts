import assert from 'node:assert/strict';
import test from 'node:test';

import { imageScopeFromRgba, imageScopeFromTransfer } from '../src/lib/image-scope.ts';

test('measures tonal and spatial density from display pixels', () => {
	const scope = imageScopeFromRgba(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);

	for (let channel = 0; channel < 4; channel += 1) {
		assert.equal(scope.histogram[channel * 256], 1);
		assert.equal(scope.histogram[channel * 256 + 255], 1);
	}
	assert.equal(scope.waveform.length, 3 * 512 * 256);
	assert.equal(scope.sampleCount, 2);
});

test('ignores fully transparent display pixels', () => {
	const scope = imageScopeFromRgba(new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 255]), 2, 1);

	assert.equal(scope.sampleCount, 1);
	assert.equal(scope.histogram[255], 0);
	assert.equal(scope.histogram[256 + 255], 1);
});

test('restores transferred histogram and waveform buffers', () => {
	const histogram = new Uint32Array(4 * 256);
	const waveform = new Uint16Array(3 * 16 * 8);
	histogram[255] = 12;
	waveform[15] = 7;

	const scope = imageScopeFromTransfer({
		histogram: histogram.buffer,
		waveform: waveform.buffer,
		waveformWidth: 16,
		waveformHeight: 8,
		sampleCount: 42
	});

	assert.equal(scope.histogram[255], 12);
	assert.equal(scope.waveform[15], 7);
	assert.equal(scope.sampleCount, 42);
});

test('rejects malformed scope transfers', () => {
	assert.throws(
		() =>
			imageScopeFromTransfer({
				histogram: new ArrayBuffer(0),
				waveform: new ArrayBuffer(0),
				waveformWidth: 0,
				waveformHeight: 0,
				sampleCount: 0
			}),
		/unexpected size/
	);
	assert.throws(() => imageScopeFromRgba(new Uint8ClampedArray(4), 2, 1), /unexpected size/);
});
