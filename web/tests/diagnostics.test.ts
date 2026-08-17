import assert from 'node:assert/strict';
import test from 'node:test';

import { formatError } from '../src/lib/diagnostics.ts';

test('keeps the stack, which is what names the failing call', () => {
	const error = new Error('attempted to take ownership of Rust value while it was borrowed');
	const report = formatError('worker request "tile" failed', error);

	assert.match(report, /worker request "tile" failed/);
	assert.match(report, /attempted to take ownership/);
	assert.ok(report.includes(error.stack!));
});

test('falls back to the name and message when a stack is missing', () => {
	const error = new Error('no stack here');
	error.stack = undefined;

	assert.equal(formatError('open-raw failed', error), 'open-raw failed\nError: no stack here');
});

test('reports values thrown that were never errors', () => {
	assert.equal(formatError('tile failed', 'a bare string'), 'tile failed\na bare string');
	assert.equal(formatError('tile failed', undefined), 'tile failed\nundefined');
});
