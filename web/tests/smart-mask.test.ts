import assert from 'node:assert/strict';
import test from 'node:test';

import { SMART_MASK_PACK } from '../src/lib/smart-mask.ts';

test('pins the interactive object model to the validated SegNext export', () => {
	assert.deepEqual(SMART_MASK_PACK.object, {
		source: 'https://github.com/uncbiag/SegNext',
		revision: '4c45ce8bfa8d3121d36d71f0ff263555805dad89',
		license: 'MIT',
		precision: 'fp32',
		inputSize: 1024,
		files: {
			encoder: 'encoder.fp32.onnx',
			decoder: 'decoder.fp32.onnx'
		}
	});
	assert.match(SMART_MASK_PACK.version, /^segnext-vitb-/);
});
