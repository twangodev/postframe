import assert from 'node:assert/strict';
import test from 'node:test';

import {
	histogramPoints,
	histogramProfile,
	imageScopeFromRgba,
	imageScopeFromTransfer,
	HISTOGRAM_BINS,
	HISTOGRAM_CHANNEL,
	HISTOGRAM_CHANNELS
} from '../src/lib/image-scope.ts';

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

test('scales a histogram against its interior so a clipping spike cannot flatten it', () => {
	const histogram = new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS);
	const luma = 3 * HISTOGRAM_BINS;
	histogram[luma] = 1_000_000; // every shadow pixel crushed to black
	histogram[luma + 128] = 100;

	const profile = histogramProfile(histogram, 'luma');

	assert.equal(profile.length, HISTOGRAM_BINS);
	assert.equal(profile[128], 1, 'the tallest interior bin fills the plot');
	assert.equal(profile[0], 1, 'the clipping spike is capped rather than scaled against');
	assert.equal(profile[200], 0);
});

test('reads an empty histogram without dividing by zero', () => {
	const profile = histogramProfile(new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS), 'red');
	assert.ok(profile.every((height) => height === 0));
});

test('compresses tall bins so quiet tones stay visible', () => {
	const histogram = new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS);
	histogram[100] = 10_000;
	histogram[101] = 100;

	const profile = histogramProfile(histogram, 'red');

	assert.equal(profile[100], 1);
	assert.ok(profile[101] > 0.05, 'a bin a hundredth as tall is still drawn');
});

test('names the packed histogram channels once', () => {
	assert.deepEqual(HISTOGRAM_CHANNEL, { red: 0, green: 1, blue: 2, luma: 3 });
});

test('histogram points scale every channel against the tallest bin on a log curve', () => {
	const histogram = new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS);
	histogram[HISTOGRAM_CHANNEL.red * HISTOGRAM_BINS + 10] = 99;
	histogram[HISTOGRAM_CHANNEL.luma * HISTOGRAM_BINS + 10] = 99;

	const points = histogramPoints(histogram);

	assert.equal(points.length, HISTOGRAM_BINS);
	assert.deepEqual(points[10], { bin: 10, red: 1, green: 0, blue: 0, luma: 1 });
	assert.deepEqual(points[11], { bin: 11, red: 0, green: 0, blue: 0, luma: 0 });
});
