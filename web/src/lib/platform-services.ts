import { AssetStore } from './asset-store.ts';
import { createDesktopLibraryBackend } from './desktop/library.ts';
import { createManagedDesktopLibrary, type ManagedLibrary } from './desktop/managed-library.ts';
import { isTauri, writeDesktopExport } from './desktop-api.ts';
import type { LibraryBackend, LocalLibraryReset } from './library-backend.ts';
import { LibraryService } from './library-service.ts';

export interface ExportSink {
	save(jpeg: ArrayBuffer, fileName: string): Promise<boolean>;
}

interface SharedPlatformServices {
	library: LibraryBackend | null;
	localLibraryReset: LocalLibraryReset | null;
	exportSink: ExportSink;
}

interface DesktopPlatformServices extends SharedPlatformServices {
	kind: 'desktop';
	library: LibraryBackend;
	localLibraryReset: null;
	managedLibrary: ManagedLibrary;
}

interface BrowserPlatformServices extends SharedPlatformServices {
	kind: 'browser';
	managedLibrary: null;
}

export type PlatformServices = DesktopPlatformServices | BrowserPlatformServices;

export function createPlatformServices(): PlatformServices {
	if (isTauri()) {
		const cache = new AssetStore();
		return {
			kind: 'desktop',
			library: createDesktopLibraryBackend(cache),
			localLibraryReset: null,
			managedLibrary: createManagedDesktopLibrary(cache),
			exportSink: { save: writeDesktopExport }
		};
	}
	const library = LibraryService.supported() ? new LibraryService() : null;
	return {
		kind: 'browser',
		library,
		localLibraryReset: library,
		managedLibrary: null,
		exportSink: new BrowserExportSink()
	};
}

class BrowserExportSink implements ExportSink {
	async save(jpeg: ArrayBuffer, fileName: string) {
		const url = URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		return true;
	}
}
