import assert from 'node:assert/strict';
import test from 'node:test';

import { SMART_MASK_PACK } from '../src/lib/smart-mask.ts';

test('pins the interactive object model to the validated SegNext export', () => {
	assert.deepEqual(SMART_MASK_PACK.object, {
		host: 'https://huggingface.co/twangodev/segnext-vitb-sa2-hqseg44k-onnx/resolve/8a9b6fb7d796e4add92e666d76a2f86b636ae268',
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
