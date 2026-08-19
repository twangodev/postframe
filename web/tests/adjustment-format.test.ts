import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAdjustment } from '../src/lib/adjustment-format.ts';

test('signs positive values only when asked', () => {
	assert.equal(formatAdjustment(35, { signed: true }), '+35');
	assert.equal(formatAdjustment(-28, { signed: true }), '-28');
	assert.equal(formatAdjustment(0, { signed: true }), '0');
	assert.equal(formatAdjustment(35, { signed: false }), '35');
});

test('fixed decimals pad the way the slider readout does', () => {
	assert.equal(formatAdjustment(0.5, { signed: true, decimals: 2, suffix: ' EV' }), '+0.50 EV');
	assert.equal(formatAdjustment(0, { signed: true, decimals: 2, suffix: ' EV' }), '0.00 EV');
	assert.equal(formatAdjustment(-16, { signed: true, decimals: 0 }), '-16');
});

test('free-form values trim the way history labels do', () => {
	assert.equal(formatAdjustment(1.25, { signed: true, suffix: ' EV' }), '+1.25 EV');
	assert.equal(formatAdjustment(1.5, { signed: true }), '+1.5');
	assert.equal(formatAdjustment(2, { signed: true }), '+2');
	assert.equal(formatAdjustment(90.25, { signed: false, suffix: '°' }), '90.25°');
	assert.equal(formatAdjustment(-0.6, { signed: true }), '-0.6');
});
