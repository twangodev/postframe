import assert from 'node:assert/strict';
import test from 'node:test';

import { maskEdgePreview, maskPreviewMenu } from '../src/lib/mask-preview.ts';

test('isolates the visible transition around a mask boundary', () => {
	assert.deepEqual(
		maskEdgePreview(Uint8Array.from([0, 0, 255, 255, 255]), 5, 1),
		Uint8Array.from([0, 255, 255, 0, 0])
	);
});

test('the mask preview menu lists every mode, then off, checking the active one', () => {
	assert.deepEqual(maskPreviewMenu('matte'), [
		{ kind: 'action', label: 'overlay', action: 'overlay', checked: false },
		{ kind: 'action', label: 'matte', action: 'matte', checked: true },
		{ kind: 'action', label: 'edge', action: 'edge', checked: false },
		{ kind: 'separator' },
		{ kind: 'action', label: 'off', action: null, checked: false }
	]);
	assert.deepEqual(maskPreviewMenu(null).at(-1), {
		kind: 'action',
		label: 'off',
		action: null,
		checked: true
	});
});
