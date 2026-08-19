import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buttonClass,
	destructiveButtonClass,
	primaryButtonClass,
	secondaryButtonClass
} from '../src/lib/button.ts';

test('every recipe shares the dialog action base', () => {
	for (const variant of ['primary', 'secondary', 'destructive'] as const) {
		const classes = buttonClass(variant);
		assert.match(classes, /cursor-pointer/);
		assert.match(classes, /rounded/);
		assert.match(classes, /px-3 py-2/);
		assert.match(classes, /text-\[11px\]/);
	}
});

test('variants keep their own surface and disabled treatment', () => {
	assert.match(buttonClass('primary'), /bg-text/);
	assert.match(buttonClass('primary'), /disabled:opacity-35/);
	assert.match(buttonClass('secondary'), /border-subtle/);
	assert.match(buttonClass('secondary'), /disabled:opacity-40/);
	assert.match(buttonClass('destructive'), /bg-negative/);
	assert.match(buttonClass('destructive'), /disabled:opacity-45/);
});

test('busy swaps the disabled cursor from not-allowed to wait', () => {
	assert.match(buttonClass('primary'), /disabled:cursor-not-allowed/);
	assert.match(buttonClass('primary', { busy: true }), /disabled:cursor-wait/);
	assert.doesNotMatch(buttonClass('primary', { busy: true }), /disabled:cursor-not-allowed/);
});

test('constants are the plain recipes', () => {
	assert.equal(primaryButtonClass, buttonClass('primary'));
	assert.equal(secondaryButtonClass, buttonClass('secondary'));
	assert.equal(destructiveButtonClass, buttonClass('destructive'));
});
