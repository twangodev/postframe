import {
	BrowserStorageService,
	storageErrorMessage,
	type BrowserStorageStatus
} from './browser-storage';
import { storageBreakdown, type StorageBreakdown } from './storage-breakdown';
import type { LibraryService } from './library-service';

export interface StorageOverviewHost {
	browserStorageStatus: BrowserStorageStatus | null;
	browserStorageBreakdown: StorageBreakdown | null;
	browserStorageError: string | null;
}

export class StorageOverview {
	private readonly browserStorage = new BrowserStorageService();

	constructor(
		private readonly service: LibraryService | null,
		private readonly host: StorageOverviewHost
	) {}

	async refresh() {
		this.host.browserStorageError = null;
		try {
			const [status, usage] = await Promise.all([
				this.browserStorage.status(),
				this.service?.storageUsage() ?? null
			]);
			this.host.browserStorageStatus = status;
			this.host.browserStorageBreakdown = usage ? storageBreakdown(usage) : null;
		} catch (error) {
			this.host.browserStorageError = storageErrorMessage(error);
			throw error;
		}
	}

	async requestPersistence() {
		this.host.browserStorageError = null;
		try {
			const result = await this.browserStorage.requestPersistence();
			this.host.browserStorageStatus = result.status;
		} catch (error) {
			this.host.browserStorageError = storageErrorMessage(error);
			throw error;
		}
	}
}
