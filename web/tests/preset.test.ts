import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEVELOP_GROUP_NAMES,
	defaultDevelopSettings,
	developSettingsKey,
	sameDevelopSettings,
	type DevelopGroupName,
	type DevelopSettings
} from '../src/lib/develop-settings.ts';
import {
	applyGroups,
	changedGroups,
	createPreset,
	presetSchema,
	savedPreset
} from '../src/lib/preset.ts';

function movedEverywhere(): DevelopSettings {
	const settings = defaultDevelopSettings();
	settings.light.exposure = 1.25;
	settings.color.temperature = 40;
	settings.curve.luminance = [
		{ x: 0, y: 0.1 },
		{ x: 1, y: 0.9 }
	];
	settings.mixer.blue.saturation = -30;
	settings.grading.shadows = { hue: 200, saturation: 40, luminance: 0 };
	settings.detail.clarity = 25;
	settings.effects.vignetteAmount = -35;
	return settings;
}

const groupKey = (settings: DevelopSettings, group: DevelopGroupName) =>
	developSettingsKey({ ...defaultDevelopSettings(), [group]: settings[group] });

test('applyGroups replaces exactly the named group', () => {
	const source = movedEverywhere();
	for (const group of DEVELOP_GROUP_NAMES) {
		const applied = applyGroups(defaultDevelopSettings(), source, [group]);
		for (const other of DEVELOP_GROUP_NAMES) {
			const expected = other === group ? source : defaultDevelopSettings();
			assert.equal(groupKey(applied, other), groupKey(expected, other), `${group} → ${other}`);
		}
	}
});

test('applyGroups over every group reproduces the source', () => {
	const source = movedEverywhere();
	assert.ok(
		sameDevelopSettings(applyGroups(defaultDevelopSettings(), source, DEVELOP_GROUP_NAMES), source)
	);
	assert.ok(sameDevelopSettings(applyGroups(source, defaultDevelopSettings(), []), source));
});

test('applyGroups returns detached clones of both inputs', () => {
	const current = defaultDevelopSettings();
	const source = movedEverywhere();
	const applied = applyGroups(current, source, ['light', 'curve']);
	applied.light.exposure = -2;
	applied.curve.luminance[0]!.y = 0.5;
	applied.color.tint = 77;
	assert.equal(source.light.exposure, 1.25);
	assert.equal(source.curve.luminance[0]!.y, 0.1);
	assert.equal(current.color.tint, 0);
	assert.equal(current.light.exposure, 0);
});

test('changedGroups is empty at the defaults and names a moved control by its group', () => {
	assert.deepEqual(changedGroups(defaultDevelopSettings()), []);
	for (const group of DEVELOP_GROUP_NAMES) {
		const settings = applyGroups(defaultDevelopSettings(), movedEverywhere(), [group]);
		assert.deepEqual(changedGroups(settings), [group]);
	}
	assert.deepEqual(changedGroups(movedEverywhere()), [...DEVELOP_GROUP_NAMES]);
});

test('presetSchema round-trips a created preset and rejects an empty group list', () => {
	const preset = createPreset(
		'  Warm Light ',
		movedEverywhere(),
		['light', 'color'],
		'2026-08-18T10:00:00.000Z'
	);
	assert.match(preset.id, /^preset-[a-z0-9-]+$/);
	assert.equal(preset.name, 'Warm Light');
	assert.equal(preset.normalizedName, 'warm light');
	assert.equal(preset.createdAt, preset.updatedAt);
	assert.deepEqual(presetSchema.parse(JSON.parse(JSON.stringify(preset))), preset);
	assert.equal(presetSchema.safeParse({ ...preset, groups: [] }).success, false);
	assert.equal(presetSchema.safeParse({ ...preset, name: '   ' }).success, false);
	assert.equal(presetSchema.safeParse({ ...preset, groups: ['optics'] }).success, false);
});

test('savedPreset overwrites the preset whose name clashes and keeps its identity', () => {
	const existing = createPreset('Warm', movedEverywhere(), ['light'], '2026-08-18T10:00:00.000Z');
	const updated = savedPreset(
		[existing],
		' warm ',
		defaultDevelopSettings(),
		['color'],
		'2026-08-18T11:00:00.000Z'
	);
	assert.equal(updated.id, existing.id);
	assert.equal(updated.name, 'warm');
	assert.equal(updated.createdAt, existing.createdAt);
	assert.equal(updated.updatedAt, '2026-08-18T11:00:00.000Z');
	assert.deepEqual(updated.groups, ['color']);
	assert.ok(sameDevelopSettings(updated.settings, defaultDevelopSettings()));

	const fresh = savedPreset(
		[existing],
		'Cool',
		defaultDevelopSettings(),
		['color'],
		'2026-08-18T11:00:00.000Z'
	);
	assert.notEqual(fresh.id, existing.id);
	assert.equal(fresh.createdAt, fresh.updatedAt);
});
