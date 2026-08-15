export interface ShortcutKeys {
	control: boolean;
	alt: boolean;
	shift: boolean;
	mod: boolean;
	key: string;
}

const MODIFIERS: Record<string, keyof Omit<ShortcutKeys, 'key'>> = {
	'⌃': 'control',
	'⌥': 'alt',
	'⇧': 'shift',
	'⌘': 'mod'
};

export function parseShortcut(shortcut: string): ShortcutKeys {
	const keys: ShortcutKeys = { control: false, alt: false, shift: false, mod: false, key: '' };
	for (const glyph of shortcut) {
		const modifier = MODIFIERS[glyph];
		if (modifier && !keys.key) keys[modifier] = true;
		else keys.key += glyph;
	}
	return keys;
}

export function shortcutText(shortcut: string): string {
	const keys = parseShortcut(shortcut);
	return [(keys.control || keys.mod) && 'Ctrl', keys.alt && 'Alt', keys.shift && 'Shift', keys.key]
		.filter(Boolean)
		.join('+');
}
