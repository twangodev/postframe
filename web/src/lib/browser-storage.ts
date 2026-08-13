export type BrowserStorageErrorCode =
	'storage-unavailable' | 'status-unavailable' | 'persistence-unavailable' | 'persistence-failed';

export type StorageDurability = 'persistent' | 'best-effort' | 'unavailable';

export interface BrowserStorageCapabilities {
	storage: boolean;
	estimate: boolean;
	persistence: boolean;
}

export interface BrowserStorageStatus {
	capabilities: BrowserStorageCapabilities;
	durability: StorageDurability;
	persisted: boolean | null;
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
	capabilities(): BrowserStorageCapabilities {
		const storage = typeof navigator !== 'undefined' && navigator.storage !== undefined;
		const manager = storage ? navigator.storage : null;

		return {
			storage,
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
			const [estimate, persisted] = await Promise.all([
				capabilities.estimate ? navigator.storage.estimate() : null,
				capabilities.persistence ? navigator.storage.persisted() : null
			]);

			return {
				capabilities,
				durability: persisted === null ? 'unavailable' : persisted ? 'persistent' : 'best-effort',
				persisted,
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
}

export function storageErrorMessage(error: unknown) {
	return error instanceof BrowserStorageError ? error.message : 'Unable to manage browser storage';
}

function unavailableStatus(capabilities: BrowserStorageCapabilities): BrowserStorageStatus {
	return {
		capabilities,
		durability: 'unavailable',
		persisted: null,
		originUsageBytes: null,
		quotaBytes: null,
		updatedAt: Date.now()
	};
}

function finiteBytes(value: number | undefined) {
	return Number.isFinite(value) && value !== undefined ? Math.max(0, value) : null;
}
