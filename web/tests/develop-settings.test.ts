import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultDevelopSettings,
	defaultLightSettings,
	developSettingsSchema,
	developStorageName
} from '../src/lib/develop-settings.ts';

test('provides an independent neutral light snapshot', () => {
	assert.deepEqual(defaultDevelopSettings(), {
		version: 1,
		exposure: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		whites: 0,
		blacks: 0
	});
	assert.notEqual(defaultDevelopSettings(), defaultDevelopSettings());
	assert.deepEqual(defaultLightSettings(), {
		exposure: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		whites: 0,
		blacks: 0
	});
	assert.equal(developStorageName('photo-one'), 'photo-one.json');
});

test('rejects unsupported, incomplete, and out-of-range snapshots', () => {
	const neutral = defaultDevelopSettings();
	assert.equal(developSettingsSchema.safeParse({ ...neutral, version: 2 }).success, false);
	assert.equal(developSettingsSchema.safeParse({ version: 1, exposure: 0 }).success, false);
	assert.equal(developSettingsSchema.safeParse({ ...neutral, exposure: 4.1 }).success, false);
	assert.equal(developSettingsSchema.safeParse({ ...neutral, highlights: -101 }).success, false);
});
