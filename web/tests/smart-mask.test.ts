import assert from 'node:assert/strict';
import test from 'node:test';

import { SMART_MASK_PACK } from '../src/lib/smart-mask.ts';

test('pins the interactive object model to quantized SAM 2.1', () => {
	assert.deepEqual(SMART_MASK_PACK.object, {
		id: 'onnx-community/sam2.1-hiera-tiny-ONNX',
		revision: '814a066',
		license: 'Apache-2.0',
		dtype: 'q8'
	});
	assert.match(SMART_MASK_PACK.version, /^sam2\.1-hiera-tiny-/);
});
