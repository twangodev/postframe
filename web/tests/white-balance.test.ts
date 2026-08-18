import assert from 'node:assert/strict';
import test from 'node:test';

import { EYEDROPPER_SAMPLE_RADIUS, sampleDisc } from '../src/lib/white-balance.ts';

function image(width: number, height: number, pixel: (x: number, y: number) => number[]) {
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			rgba.set(pixel(x, y), (y * width + x) * 4);
		}
	}
	return { width, height, rgba };
}

const checker = image(8, 8, (x, y) => ((x + y) % 2 === 0 ? [200, 100, 50, 255] : [0, 0, 0, 255]));

test('a radius of one reads only the centre pixel', () => {
	assert.deepEqual(sampleDisc(checker, { x: 0.5, y: 0.5 }, 1), [200 / 255, 100 / 255, 50 / 255]);
	assert.deepEqual(sampleDisc(checker, { x: 5.5 / 8, y: 0.5 }, 1), [0, 0, 0]);
});

test('the centre pixel is the one under the normalized point', () => {
	const gradient = image(16, 4, (x) => [x * 16, x * 16, x * 16, 255]);
	assert.deepEqual(sampleDisc(gradient, { x: 3.5 / 16, y: 0.5 }, 1), [
		48 / 255,
		48 / 255,
		48 / 255
	]);
	assert.deepEqual(sampleDisc(gradient, { x: 0.999, y: 0.999 }, 1), [
		240 / 255,
		240 / 255,
		240 / 255
	]);
});

test('a wider disc averages its opaque pixels', () => {
	const [red, green, blue] = sampleDisc(checker, { x: 0.5, y: 0.5 }, 2);
	assert.ok(red > 0 && red < 200 / 255, `red ${red}`);
	assert.ok(Math.abs(red / green - 2) < 1e-6);
	assert.ok(Math.abs(green / blue - 2) < 1e-6);
});

test('the disc is clipped at the image edge and points outside clamp to it', () => {
	const corner = image(4, 4, (x, y) =>
		x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]
	);
	assert.deepEqual(sampleDisc(corner, { x: -0.5, y: -2 }, 1), [1, 1, 1]);
	assert.deepEqual(sampleDisc(corner, { x: 0, y: 0 }, 1.5), [0.25, 0.25, 0.25]);
	assert.deepEqual(sampleDisc(corner, { x: 2, y: 2 }, 1), [0, 0, 0]);
});

test('radii below one still read the centre pixel', () => {
	assert.deepEqual(sampleDisc(checker, { x: 0.5, y: 0.5 }, 0), [200 / 255, 100 / 255, 50 / 255]);
	assert.deepEqual(sampleDisc(checker, { x: 0.5, y: 0.5 }, -3), [200 / 255, 100 / 255, 50 / 255]);
});

test('transparent pixels are left out of the average', () => {
	const veiled = image(3, 3, (x, y) => (x === 1 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
	assert.deepEqual(sampleDisc(veiled, { x: 0.5, y: 0.5 }, 5), [1, 1, 1]);
	assert.deepEqual(sampleDisc(veiled, { x: 0.1, y: 0.1 }, 1), [0, 0, 0]);
});

test('the eyedropper reads a small neighbourhood', () => {
	assert.ok(EYEDROPPER_SAMPLE_RADIUS >= 3 && EYEDROPPER_SAMPLE_RADIUS <= 8);
});
