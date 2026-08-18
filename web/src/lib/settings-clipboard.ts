import {
	cloneDevelopSettings,
	type DevelopGroupName,
	type DevelopSettings
} from './develop-settings.ts';

export interface SettingsClipboard {
	settings: DevelopSettings;
	groups: DevelopGroupName[];
}

export function copiedSettings(
	settings: DevelopSettings,
	groups: readonly DevelopGroupName[]
): SettingsClipboard {
	return { settings: cloneDevelopSettings(settings), groups: [...groups] };
}
