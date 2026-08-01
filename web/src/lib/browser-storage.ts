const DEFAULT_APP_DIRECTORY = 'postframe';

export type BrowserStorageErrorCode =
	'storage-unavailable' | 'status-unavailable' | 'persistence-unavailable' | 'persistence-failed';

export type StorageDurability = 'persistent' | 'best-effort' | 'unavailable';

export interface BrowserStorageCapabilities {
	storage: boolean;
	opfs: boolean;
	estimate: boolean;
	persistence: boolean;
}

export interface BrowserStorageStatus {
	capabilities: BrowserStorageCapabilities;
	durability: StorageDurability;
	persisted: boolean | null;
	appUsageBytes: number | null;
	originUsageBytes: number | null;
	quotaBytes: number | null;
	updatedAt: number;
}

export interface PersistenceRequestResult {
	granted: boolean;
	status: BrowserStorageStatus;
}

export class BrowserStorageError extends Error {
	readonly code: BrowserStorageErrorCode;
	readonly cause?: unknown;

	constructor(code: BrowserStorageErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'BrowserStorageError';
		this.code = code;
		this.cause = cause;
	}
}

export class BrowserStorageService {
	readonly appDirectory: string;

	constructor(appDirectory = DEFAULT_APP_DIRECTORY) {
		this.appDirectory = appDirectory;
	}

	capabilities(): BrowserStorageCapabilities {
		const storage = typeof navigator !== 'undefined' && navigator.storage !== undefined;
		const manager = storage ? navigator.storage : null;

		return {
			storage,
			opfs: typeof manager?.getDirectory === 'function',
			estimate: typeof manager?.estimate === 'function',
			persistence:
				typeof manager?.persisted === 'function' && typeof manager?.persist === 'function'
		};
	}

	async status(): Promise<BrowserStorageStatus> {
		const capabilities = this.capabilities();
		if (!capabilities.storage) {
			return unavailableStatus(capabilities);
		}

		try {
			const [estimate, persisted, appUsageBytes] = await Promise.all([
				capabilities.estimate ? navigator.storage.estimate() : null,
				capabilities.persistence ? navigator.storage.persisted() : null,
				capabilities.opfs ? this.measureAppUsage() : null
			]);

			return {
				capabilities,
				durability: persisted === null ? 'unavailable' : persisted ? 'persistent' : 'best-effort',
				persisted,
				appUsageBytes,
				originUsageBytes: finiteBytes(estimate?.usage),
				quotaBytes: finiteBytes(estimate?.quota),
				updatedAt: Date.now()
			};
		} catch (error) {
			throw new BrowserStorageError(
				'status-unavailable',
				'Unable to inspect browser storage',
				error
			);
		}
	}

	async requestPersistence(): Promise<PersistenceRequestResult> {
		const capabilities = this.capabilities();
		if (!capabilities.persistence) {
			throw new BrowserStorageError(
				'persistence-unavailable',
				'This browser does not support persistent storage requests'
			);
		}

		try {
			const granted = await navigator.storage.persist();
			return { granted, status: await this.status() };
		} catch (error) {
			throw new BrowserStorageError(
				'persistence-failed',
				'Unable to request persistent browser storage',
				error
			);
		}
	}

	private async measureAppUsage() {
		const root = await navigator.storage.getDirectory();

		try {
			const directory = await root.getDirectoryHandle(this.appDirectory);
			return directorySize(directory);
		} catch (error) {
			if (isNotFoundError(error)) return 0;
			throw error;
		}
	}
}

export function storageErrorMessage(error: unknown) {
	return error instanceof BrowserStorageError ? error.message : 'Unable to manage browser storage';
}

async function directorySize(directory: FileSystemDirectoryHandle): Promise<number> {
	let bytes = 0;

	for await (const handle of directory.values()) {
		bytes +=
			handle.kind === 'file'
				? (await (handle as FileSystemFileHandle).getFile()).size
				: await directorySize(handle as FileSystemDirectoryHandle);
	}

	return bytes;
}

function unavailableStatus(capabilities: BrowserStorageCapabilities): BrowserStorageStatus {
	return {
		capabilities,
		durability: 'unavailable',
		persisted: null,
		appUsageBytes: null,
		originUsageBytes: null,
		quotaBytes: null,
		updatedAt: Date.now()
	};
}

function finiteBytes(value: number | undefined) {
	return Number.isFinite(value) && value !== undefined ? Math.max(0, value) : null;
}

function isNotFoundError(error: unknown) {
	return error instanceof DOMException && error.name === 'NotFoundError';
}
