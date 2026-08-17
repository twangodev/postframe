import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clampToDisc,
	hueSaturationToPoint,
	pointToHueSaturation
} from '../src/lib/grading-wheel.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
	assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

test('round-trips every hue and saturation through the disc', () => {
	for (let hue = 0; hue < 360; hue += 3) {
		for (const saturation of [1, 25, 60, 100]) {
			const wheel = pointToHueSaturation(hueSaturationToPoint(hue, saturation));
			close(wheel.hue, hue, 1e-4);
			close(wheel.saturation, saturation, 1e-4);
		}
	}
});

test('places hue zero at the top and runs clockwise', () => {
	const top = hueSaturationToPoint(0, 100);
	close(top.x, 0);
	close(top.y, -1);
	const right = hueSaturationToPoint(90, 100);
	close(right.x, 1);
	close(right.y, 0);
	close(pointToHueSaturation({ x: -1, y: 0 }).hue, 270);
});

test('wraps the angle rather than reporting a negative hue', () => {
	const { hue } = pointToHueSaturation({ x: -0.02, y: -1 });
	assert.ok(hue > 358 && hue < 360, `hue ${hue} did not wrap`);
	close(pointToHueSaturation(hueSaturationToPoint(-30, 50)).hue, 330, 1e-4);
	close(pointToHueSaturation(hueSaturationToPoint(390, 50)).hue, 30, 1e-4);
});

test('clamps a drag outside the disc to its edge without turning it', () => {
	const outside = { x: 3, y: -3 };
	const clamped = clampToDisc(outside);
	close(Math.hypot(clamped.x, clamped.y), 1);
	close(pointToHueSaturation(clamped).hue, pointToHueSaturation(outside).hue);
	close(pointToHueSaturation(clamped).saturation, 100);

	const inside = { x: 0.3, y: 0.4 };
	assert.deepEqual(clampToDisc(inside), inside);
});

test('reads the center as unsaturated', () => {
	const { saturation } = pointToHueSaturation({ x: 0, y: 0 });
	close(saturation, 0);
	const center = hueSaturationToPoint(200, 0);
	close(center.x, 0);
	close(center.y, 0);
});
