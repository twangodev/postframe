import type { AssetUsage, StoredFile } from '../asset-store.ts';
import type { DesktopAssetKind } from '../desktop-api.ts';
import type { EditDocument } from '../edit-document.ts';
import type { CleanupResult } from '../library-backend.ts';
import { renderCacheStorageName } from '../render-cache.ts';
import type { DesktopAssets } from './assets.ts';
import type { DesktopCatalog, PendingDelete } from './catalog.ts';

const EMPTY_CLEANUP: CleanupResult = { deletedFiles: 0, failedFiles: 0, reclaimedBytes: 0 };
const PENDING_ASSET_KIND = {
	original: 'originals',
	thumbnail: 'thumbnails',
	edit: 'edits'
} as const satisfies Record<Exclude<PendingDelete['kind'], 'derived'>, DesktopAssetKind>;

export function createDesktopMaintenance(catalog: DesktopCatalog, assets: DesktopAssets) {
	const deleteFiles = async (
		kind: DesktopAssetKind,
		files: readonly (StoredFile | string)[]
	): Promise<CleanupResult> => {
		if (files.length === 0) return { ...EMPTY_CLEANUP };
		try {
			await assets.deleteAssets(
				kind,
				files.map((file) => (typeof file === 'string' ? file : file.storageName))
			);
			return cleanupResult(files, files.length, 0);
		} catch {
			return cleanupResult([], 0, files.length);
		}
	};

	const flushPending = async (deletions: readonly PendingDelete[]): Promise<CleanupResult> => {
		const completed: PendingDelete[] = [];
		for (const deletion of deletions) {
			try {
				if (deletion.kind === 'derived') {
					await assets.deleteDerived([deletion.storageName]);
				} else {
					await assets.deleteAssets(PENDING_ASSET_KIND[deletion.kind], [deletion.storageName]);
				}
				completed.push(deletion);
			} catch {}
		}
		await catalog.completeDeletions(completed);
		return {
			deletedFiles: completed.length,
			failedFiles: deletions.length - completed.length,
			reclaimedBytes: 0
		};
	};

	const deleteOrphans = async (kind: DesktopAssetKind, references: readonly string[]) => {
		const files = await assets.listAssets(kind);
		const referenced = new Set(references);
		return deleteFiles(
			kind,
			files.filter(({ storageName }) => !referenced.has(storageName))
		);
	};

	return {
		async deletePhoto(photoId: string) {
			const document = await assets.loadEditDocument(photoId).catch(() => null);
			const pending = await catalog.deletePhoto(photoId, renderCacheStorageName(photoId));
			const [library, masks] = await Promise.all([
				flushPending(pending),
				deleteFiles('masks', maskStorageNames(document))
			]);
			return mergeCleanup(library, masks);
		},

		async cleanup() {
			const pending = await flushPending(await catalog.pendingDeletions());
			const references = await catalog.storageReferences();
			const native = await Promise.all([
				deleteOrphans('originals', references.originals),
				deleteOrphans('thumbnails', references.thumbnails),
				deleteOrphans('edits', references.edits),
				deleteOrphans('masks', references.masks)
			]);
			const derived = await assets.listDerived();
			const expectedDerived = new Set(references.photoIds.map(renderCacheStorageName));
			const staleDerived = derived.filter(({ storageName }) => !expectedDerived.has(storageName));
			await assets.deleteDerived(staleDerived.map(({ storageName }) => storageName));
			return mergeCleanup(pending, ...native, cleanupResult(staleDerived, staleDerived.length, 0));
		},

		async storageUsage(): Promise<AssetUsage> {
			const [durable, cache] = await Promise.all([assets.durableUsage(), assets.cacheUsage()]);
			return {
				originals: durable.originals,
				thumbnails: durable.thumbnails,
				edits: durable.edits,
				derived: cache.derived,
				models: cache.models,
				masks: durable.masks
			};
		},

		async resumePendingDeletions() {
			return flushPending(await catalog.pendingDeletions());
		}
	};
}

function maskStorageNames(document: EditDocument | null) {
	return (
		document?.masks.flatMap((mask) =>
			mask.components.flatMap((component) => component.raster?.storageName ?? [])
		) ?? []
	);
}

function cleanupResult(
	files: readonly (StoredFile | string)[],
	deletedFiles: number,
	failedFiles: number
): CleanupResult {
	return {
		deletedFiles,
		failedFiles,
		reclaimedBytes: files.reduce(
			(total, file) => total + (typeof file === 'string' ? 0 : file.size),
			0
		)
	};
}

function mergeCleanup(...results: CleanupResult[]): CleanupResult {
	return results.reduce(
		(total, result) => ({
			deletedFiles: total.deletedFiles + result.deletedFiles,
			failedFiles: total.failedFiles + result.failedFiles,
			reclaimedBytes: total.reclaimedBytes + result.reclaimedBytes
		}),
		{ ...EMPTY_CLEANUP }
	);
}
