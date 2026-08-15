import assert from 'node:assert/strict';
import test from 'node:test';

import { adjustMaskEdges } from '../src/lib/mask-edge-adjustment.ts';
import { defaultMaskEdgeSettings, isNeutralMaskEdge } from '../src/lib/mask-edge-settings.ts';

const raster = (alpha: number[], width = alpha.length) => ({
	width,
	height: alpha.length / width,
	alpha: Uint8Array.from(alpha)
});

test('preserves mask values with neutral edge settings', () => {
	const source = raster([0, 64, 128, 255]);
	const adjusted = adjustMaskEdges(source, defaultMaskEdgeSettings());
	assert.deepEqual(adjusted, source);
	assert.notEqual(adjusted.alpha, source.alpha);
});

test('treats edge settings as neutral only when every control is zero', () => {
	assert.equal(isNeutralMaskEdge(defaultMaskEdgeSettings()), true);
	assert.equal(isNeutralMaskEdge({ contrast: 1, feather: 0, shift: 0 }), false);
	assert.equal(isNeutralMaskEdge({ contrast: 0, feather: 1, shift: 0 }), false);
	assert.equal(isNeutralMaskEdge({ contrast: 0, feather: 0, shift: -1 }), false);
});

test('expands and contracts a mask by source pixels', () => {
	const source = raster([0, 0, 255, 0, 0]);
	assert.deepEqual(
		adjustMaskEdges(source, { contrast: 0, feather: 0, shift: 1 }).alpha,
		Uint8Array.from([0, 255, 255, 255, 0])
	);
	assert.deepEqual(
		adjustMaskEdges(source, { contrast: 0, feather: 0, shift: -1 }).alpha,
		new Uint8Array(5)
	);
});

test('feathers a hard boundary and contrast restores edge definition', () => {
	const source = raster([0, 0, 0, 255, 255, 255, 255]);
	const feathered = adjustMaskEdges(source, { contrast: 0, feather: 2, shift: 0 });
	const defined = adjustMaskEdges(source, { contrast: 100, feather: 2, shift: 0 });
	assert.ok(feathered.alpha[2]! > 0 && feathered.alpha[2]! < 128);
	assert.ok(feathered.alpha[3]! > 128 && feathered.alpha[3]! < 255);
	assert.ok(defined.alpha[2]! < feathered.alpha[2]!);
	assert.ok(defined.alpha[3]! > feathered.alpha[3]!);
});
