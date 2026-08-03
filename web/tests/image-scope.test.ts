import assert from 'node:assert/strict';
import test from 'node:test';

import { imageScopeFromTransfer } from '../src/lib/image-scope.ts';

test('restores transferred histogram and waveform buffers', () => {
	const histogram = new Uint32Array(4 * 256);
	const waveform = new Uint16Array(4 * 16 * 8);
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
});
