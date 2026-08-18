import { z } from 'zod';
import {
	DEVELOP_GROUP_NAMES,
	cloneDevelopSettings,
	defaultDevelopSettings,
	developSettingsKey,
	developSettingsSchema,
	type DevelopGroupName,
	type DevelopSettings
} from './develop-settings.ts';
import { entityId } from './entity-id.ts';
import { identifierSchema } from './library-schema.ts';

export const DEVELOP_GROUP_LABELS: Record<DevelopGroupName, string> = {
	light: 'Light',
	color: 'Color',
	curve: 'Curve',
	mixer: 'Mixer',
	grading: 'Grading',
	detail: 'Detail',
	effects: 'Effects'
};

export const presetSchema = z.object({
	id: identifierSchema,
	name: z.string().trim().min(1).max(60),
	normalizedName: z.string().min(1),
	groups: z.array(z.enum(DEVELOP_GROUP_NAMES)).min(1),
	settings: developSettingsSchema,
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime()
});

export type Preset = z.infer<typeof presetSchema>;

export function applyGroups(
	current: DevelopSettings,
	source: DevelopSettings,
	groups: readonly DevelopGroupName[]
): DevelopSettings {
	const applied = cloneDevelopSettings(current);
	const detached = cloneDevelopSettings(source);
	for (const group of groups) Object.assign(applied, { [group]: detached[group] });
	return applied;
}

export function changedGroups(settings: DevelopSettings): DevelopGroupName[] {
	const neutral = defaultDevelopSettings();
	return DEVELOP_GROUP_NAMES.filter(
		(group) => groupKey(settings, group) !== groupKey(neutral, group)
	);
}

export function normalizePresetName(name: string) {
	return name.normalize('NFKC').trim().toLocaleLowerCase();
}

export function createPreset(
	name: string,
	settings: DevelopSettings,
	groups: readonly DevelopGroupName[],
	now: string
): Preset {
	return presetSchema.parse({
		id: entityId('preset'),
		name,
		normalizedName: normalizePresetName(name),
		groups: [...groups],
		settings,
		createdAt: now,
		updatedAt: now
	});
}

export function presetNamed(presets: readonly Preset[], name: string): Preset | null {
	const normalizedName = normalizePresetName(name);
	return presets.find((preset) => preset.normalizedName === normalizedName) ?? null;
}

export function savedPreset(
	presets: readonly Preset[],
	name: string,
	settings: DevelopSettings,
	groups: readonly DevelopGroupName[],
	now: string
): Preset {
	const existing = presetNamed(presets, name);
	if (!existing) return createPreset(name, settings, groups, now);
	return presetSchema.parse({
		...existing,
		name,
		normalizedName: normalizePresetName(name),
		groups: [...groups],
		settings,
		updatedAt: now
	});
}

function groupKey(settings: DevelopSettings, group: DevelopGroupName) {
	return developSettingsKey({ ...defaultDevelopSettings(), [group]: settings[group] });
}
