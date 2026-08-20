import { DesktopLibraryService } from './desktop-library-service.ts';
import { isTauri, writeDesktopExport } from './desktop-api.ts';
import type { LibraryBackend } from './library-backend.ts';
import { LibraryService } from './library-service.ts';

export interface ExportSink {
	save(jpeg: ArrayBuffer, fileName: string): Promise<boolean>;
}

export interface PlatformServices {
	desktop: boolean;
	library: LibraryBackend | null;
	desktopLibrary: DesktopLibraryService | null;
	exportSink: ExportSink;
}

export function createPlatformServices(): PlatformServices {
	if (isTauri()) {
		const library = new DesktopLibraryService();
		return {
			desktop: true,
			library,
			desktopLibrary: library,
			exportSink: { save: writeDesktopExport }
		};
	}
	return {
		desktop: false,
		library: LibraryService.supported() ? new LibraryService() : null,
		desktopLibrary: null,
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
