import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shaderBindings, shaderStageCalls, uniformLayout } from '../src/lib/raw-tile-shader.ts';

const shader = readFileSync(new URL('../src/lib/raw-tile.wgsl', import.meta.url), 'utf8');

test('binds exactly the resources the renderer supplies', () => {
	assert.deepEqual(shaderBindings(shader), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('runs every develop stage, in the order the pipeline fixes', () => {
	assert.deepEqual(shaderStageCalls(shader), [
		'apply_balance',
		'apply_mixer',
		'apply_grading',
		'apply_chroma',
		'apply_dehaze',
		'apply_detail',
		'apply_vignette',
		'apply_light',
		'apply_channel_curves',
		'apply_grain'
	]);
});

test('lays the shared uniform block out where the renderer writes it', () => {
	const layout = uniformLayout(shader, 'Params');
	assert.equal(layout.offsets.adjustments_identity, 60);
	assert.equal(layout.offsets.curve_identity, 64);
	assert.equal(layout.offsets.detail_identity, 68);
	assert.equal(layout.offsets.mixer_identity, 88);
	assert.equal(layout.offsets.grading_identity, 92);
	assert.equal(layout.offsets.highlight_stops, 140);
	assert.equal(layout.size, 144);
});

test('lays the effects block out contiguously', () => {
	const layout = uniformLayout(shader, 'Effects');
	assert.deepEqual(layout.offsets, {
		origin: 0,
		image: 8,
		crop: 16,
		vignette: 32,
		grain: 48,
		bin: 56,
		identity: 60
	});
	assert.equal(layout.size, 64);
});

test('honours vec3 alignment, which is where hand-computed offsets go wrong', () => {
	const layout = uniformLayout('struct T { a: f32, b: vec3<f32>, c: u32, }', 'T');
	assert.deepEqual(layout.offsets, { a: 0, b: 16, c: 28 });
	assert.equal(layout.size, 32);
});
