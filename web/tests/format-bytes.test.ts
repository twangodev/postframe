import assert from 'node:assert/strict';
import test from 'node:test';

import { formatBytes } from '../src/lib/format-bytes.ts';

test('formats byte counts across units', () => {
	assert.equal(formatBytes(null), '—');
	assert.equal(formatBytes(undefined), '—');
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(512), '512 B');
	assert.equal(formatBytes(1536), '1.5 KB');
	assert.equal(formatBytes(10 * 1024 * 1024), '10 MB');
	assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB');
});
