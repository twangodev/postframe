import assert from 'node:assert/strict';
import test from 'node:test';

import { parseShortcut, shortcutText } from '../src/lib/shortcut.ts';

test('splits modifier glyphs from the key', () => {
	assert.deepEqual(parseShortcut('⇧⌘E'), {
		control: false,
		alt: false,
		shift: true,
		mod: true,
		key: 'E'
	});
	assert.deepEqual(parseShortcut('⌥⌘C'), {
		control: false,
		alt: true,
		shift: false,
		mod: true,
		key: 'C'
	});
	assert.deepEqual(parseShortcut('T'), {
		control: false,
		alt: false,
		shift: false,
		mod: false,
		key: 'T'
	});
});

test('keeps multi-character and symbol keys intact', () => {
	assert.equal(parseShortcut('⇧F6').key, 'F6');
	assert.equal(parseShortcut('⌘−').key, '−');
	assert.equal(parseShortcut('⌘0').key, '0');
});

test('spells shortcuts out for non-apple platforms', () => {
	assert.equal(shortcutText('⇧⌘E'), 'Ctrl+Shift+E');
	assert.equal(shortcutText('⌥⌘C'), 'Ctrl+Alt+C');
	assert.equal(shortcutText('⌘Z'), 'Ctrl+Z');
	assert.equal(shortcutText('⇧F6'), 'Shift+F6');
	assert.equal(shortcutText('T'), 'T');
});
