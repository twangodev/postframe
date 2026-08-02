import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultDevelopSettings,
	developSettingsSchema,
	developStorageName
} from '../src/lib/develop-settings.ts';

test('provides an independent versioned exposure snapshot', () => {
	assert.deepEqual(defaultDevelopSettings(), { version: 1, exposure: 0 });
	assert.notEqual(defaultDevelopSettings(), defaultDevelopSettings());
	assert.equal(developStorageName('photo-one'), 'photo-one.json');
});

test('rejects unsupported versions and out-of-range exposure', () => {
	assert.equal(developSettingsSchema.safeParse({ version: 2, exposure: 0 }).success, false);
	assert.equal(developSettingsSchema.safeParse({ version: 1, exposure: 4.1 }).success, false);
});
