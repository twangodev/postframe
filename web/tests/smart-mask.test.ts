import assert from 'node:assert/strict';
import test from 'node:test';

import { SMART_MASK_PACK } from '../src/lib/smart-mask.ts';

test('pins the interactive object model to the validated SAM 2.1 export', () => {
	assert.deepEqual(SMART_MASK_PACK.object, {
		id: 'onnx-community/sam2.1-hiera-tiny-ONNX',
		revision: '814a066640debee5a91e70aa401fb8e17e030503',
		license: 'Apache-2.0',
		dtype: 'fp32'
	});
	assert.match(SMART_MASK_PACK.version, /^sam2\.1-hiera-tiny-/);
});

test('pins the detector that finds individual subjects', () => {
	assert.deepEqual(SMART_MASK_PACK.detector, {
		id: 'Xenova/detr-resnet-50',
		revision: 'main',
		license: 'Apache-2.0',
		dtype: 'q8'
	});
});

test('pins the panoptic model that isolates the sky', () => {
	assert.deepEqual(SMART_MASK_PACK.sky, {
		id: 'Xenova/detr-resnet-50-panoptic',
		revision: 'ea24b2d4e0bfae31f0a1299ba3fb892a2df064de',
		license: 'Apache-2.0',
		dtype: 'fp16'
	});
	assert.match(SMART_MASK_PACK.version, /-skypan-ea24b2d-fp16$/);
});
