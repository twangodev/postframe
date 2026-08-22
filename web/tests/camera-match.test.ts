import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyCameraMatchSettings,
	cameraMatchChanges,
	cameraMatchMode,
	cameraMatchOpening,
	interpolateCameraMatchSettings
} from '../src/lib/camera-match.ts';
import { defaultDevelopSettings } from '../src/lib/develop-settings.ts';

test('asks, applies, or starts neutral only for an undecided RAW', () => {
	assert.equal(cameraMatchOpening('pending', 'ask'), 'prompt');
	assert.equal(cameraMatchOpening('pending', 'always'), 'apply');
	assert.equal(cameraMatchOpening('pending', 'never'), 'neutral');

	for (const status of ['legacy', 'dismissed', 'applied'] as const) {
		assert.equal(cameraMatchOpening(status, 'always'), 'unchanged');
		assert.equal(cameraMatchOpening(status, 'never'), 'unchanged');
	}
});

test('opens first-run prompts in derive-only mode', () => {
	assert.equal(cameraMatchMode('prompt'), 'derive');
	assert.equal(cameraMatchMode('apply'), 'apply');
	assert.equal(cameraMatchMode('neutral'), 'none');
	assert.equal(cameraMatchMode('unchanged'), 'none');
});

test('finds only the scalar controls and curve channels changed by the fit', () => {
	const baseline = defaultDevelopSettings();
	const matched = defaultDevelopSettings();
	matched.light.exposure = 0.75;
	matched.color.tint = -12;
	matched.curve.red = [
		{ x: 0, y: 0.05 },
		{ x: 1, y: 0.95 }
	];

	assert.deepEqual(cameraMatchChanges(baseline, matched), {
		light: ['exposure'],
		color: ['tint'],
		curve: ['red']
	});
});

test('interpolates the actual fitted settings without moving unrelated groups', () => {
	const baseline = defaultDevelopSettings();
	baseline.mixer.red.hue = 14;
	const matched = defaultDevelopSettings();
	matched.light.exposure = 2;
	matched.color.temperature = 40;
	matched.curve.luminance = [
		{ x: 0, y: 0 },
		{ x: 0.5, y: 0.75 },
		{ x: 1, y: 1 }
	];
	const destination = applyCameraMatchSettings(baseline, matched);

	const halfway = interpolateCameraMatchSettings(baseline, destination, 0.5);
	assert.equal(halfway.light.exposure, 1);
	assert.equal(halfway.color.temperature, 20);
	assert.equal(halfway.mixer.red.hue, 14);
	assert.equal(halfway.curve.luminance.length, 17);
	assert.deepEqual(interpolateCameraMatchSettings(baseline, destination, 0), baseline);
	assert.deepEqual(interpolateCameraMatchSettings(baseline, destination, 1), destination);
});
