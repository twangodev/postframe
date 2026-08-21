import type { AssetStore } from '../asset-store.ts';
import {
	createDesktopLibrary,
	desktopStatus,
	openDesktopLibrary,
	revealDesktopLibrary,
	type DesktopStatus
} from '../desktop-api.ts';

export interface ManagedLibrary {
	status(): Promise<DesktopStatus>;
	create(): Promise<string | null>;
	open(): Promise<string | null>;
	reveal(): Promise<void>;
	clearCaches(): Promise<void>;
}

export function createManagedDesktopLibrary(cache: AssetStore): ManagedLibrary {
	return {
		status: desktopStatus,
		create: createDesktopLibrary,
		open: openDesktopLibrary,
		reveal: revealDesktopLibrary,
		clearCaches: () => cache.clearCaches()
	};
}
