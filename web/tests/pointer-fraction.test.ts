import assert from 'node:assert/strict';
import test from 'node:test';

import { pointerFraction } from '../src/lib/pointer-fraction.ts';

function element(left: number, top: number, width: number, height: number) {
	return { getBoundingClientRect: () => ({ left, top, width, height }) } as Element;
}

test('reads the pointer as fractions of the element box', () => {
	const event = { clientX: 150, clientY: 130 } as PointerEvent;
	assert.deepEqual(pointerFraction(event, element(100, 100, 200, 40)), { x: 0.25, y: 0.75 });
});

test('runs past the edges instead of clamping, like the drags it serves', () => {
	const event = { clientX: 90, clientY: 160 } as PointerEvent;
	assert.deepEqual(pointerFraction(event, element(100, 100, 200, 40)), { x: -0.05, y: 1.5 });
});
