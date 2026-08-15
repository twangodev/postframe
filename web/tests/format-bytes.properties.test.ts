import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { formatBytes } from '../src/lib/format-bytes.ts';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

const byteCount = fc.double({ min: 0, max: 2 ** 50, noNaN: true }).map(Math.floor);

function displayedMagnitude(formatted: string) {
	const [value, unit] = formatted.split(' ');
	const exponent = UNITS.indexOf(unit!);
	assert.ok(exponent >= 0, `unknown unit in ${formatted}`);
	return Number.parseFloat(value!) * 1024 ** exponent;
}

test('positive byte counts format as a rounded value within 10% of reality (seed 7701)', () => {
	fc.assert(
		fc.property(
			byteCount.filter((bytes) => bytes >= 1),
			(bytes) => {
				const formatted = formatBytes(bytes);
				assert.match(formatted, /^\d+(\.\d)? (B|KB|MB|GB|TB)$/);
				const magnitude = displayedMagnitude(formatted);
				assert.ok(magnitude >= bytes * 0.9 && magnitude <= bytes * 1.1, formatted);
			}
		),
		{ seed: 7701, path: undefined }
	);
});

test('displayed magnitude never decreases as byte counts grow (seed 7702)', () => {
	fc.assert(
		fc.property(byteCount, byteCount, (first, second) => {
			const [smaller, larger] = first <= second ? [first, second] : [second, first];
			assert.ok(
				displayedMagnitude(formatBytes(smaller)) <= displayedMagnitude(formatBytes(larger)),
				`${formatBytes(smaller)} above ${formatBytes(larger)}`
			);
		}),
		{ seed: 7702, path: undefined }
	);
});
