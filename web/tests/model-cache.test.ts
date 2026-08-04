import assert from 'node:assert/strict';
import test from 'node:test';

import { modelCacheName } from '../src/lib/model-cache.ts';

test('maps model resources to stable storage-safe names', async () => {
	const first = await modelCacheName('https://models.postframe.twango.dev/slimsam/model.onnx');
	const second = await modelCacheName('https://models.postframe.twango.dev/slimsam/model.onnx');
	assert.equal(first, second);
	assert.match(first, /^[a-f0-9]{64}$/);
	assert.notEqual(first, await modelCacheName('https://models.postframe.twango.dev/u2net/model.onnx'));
});
