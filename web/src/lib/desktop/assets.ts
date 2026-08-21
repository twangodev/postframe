import { invoke } from '@tauri-apps/api/core';
import {
	AssetStore,
	type AssetUsage,
	type OriginalWrite,
	type StoredFile,
	type ThumbnailWrite
} from '../asset-store.ts';
import {
	desktopAssetExists,
	desktopAssetSource,
	writeDesktopAsset,
	type DesktopAssetKind
} from '../desktop-api.ts';
import {
	defaultEditDocument,
	editDocumentSchema,
	editDocumentStorageName,
	parseEditDocument,
	type EditDocument
} from '../edit-document.ts';
import type { StoredPhoto } from '../library-schema.ts';
import { renderCacheStorageName } from '../render-cache.ts';

export interface DurableUsage {
	originals: number;
	thumbnails: number;
	edits: number;
	masks: number;
}

export function createDesktopAssets(cache: AssetStore) {
	const readAsset = async (kind: DesktopAssetKind, storageName: string) => {
		const source = await desktopAssetSource(kind, storageName);
		const response = await fetch(source.url);
		if (!response.ok) throw new Error(`Unable to read ${source.name}`);
		return response.blob();
	};

	const deleteAssets = async (kind: DesktopAssetKind, storageNames: readonly string[]) => {
		if (storageNames.length === 0) return;
		await invoke('delete_assets', { kind, storageNames });
	};

	return {
		readOriginal(storageName: string) {
			return readAsset('originals', storageName);
		},

		async originalSource(storageName: string) {
			const source = await desktopAssetSource('originals', storageName);
			return { kind: 'url' as const, ...source };
		},

		renderCacheHandle(photoId: string) {
			return cache.derivedHandle(renderCacheStorageName(photoId));
		},

		async saveMaskRaster(photoId: string, componentId: string, alpha: Uint8Array) {
			const storageName = `${photoId}-${componentId}.mask`;
			await writeDesktopAsset('masks', storageName, alpha);
			return storageName;
		},

		async readMaskRaster(storageName: string) {
			return readAsset('masks', storageName).then((blob) => blob.arrayBuffer());
		},

		deleteMaskRasters(storageNames: readonly string[]) {
			return deleteAssets('masks', storageNames);
		},

		readThumbnail(storageName: string) {
			return readAsset('thumbnails', storageName);
		},

		async loadEditDocument(photoId: string) {
			const storageName = editDocumentStorageName(photoId);
			if (!(await desktopAssetExists('edits', storageName))) return defaultEditDocument(photoId);
			const file = await readAsset('edits', storageName);
			return parseEditDocument(JSON.parse(await file.text()), photoId);
		},

		async saveEditDocument(photoId: string, value: EditDocument) {
			const document = editDocumentSchema.parse(value);
			if (document.photoId !== photoId) throw new Error('Edit document belongs to another photo');
			await writeDesktopAsset(
				'edits',
				editDocumentStorageName(photoId),
				new Blob([JSON.stringify(document)], { type: 'application/json' })
			);
		},

		async writeOriginals(writes: readonly OriginalWrite[], photos: readonly StoredPhoto[]) {
			const hashes = new Map(
				photos.flatMap((photo) =>
					photo.frames.flatMap((frame) =>
						[frame.raw, frame.display]
							.filter((asset): asset is NonNullable<typeof asset> => asset !== null)
							.map((asset) => [asset.storageName, asset.contentHash] as const)
					)
				)
			);
			for (const write of writes) {
				await writeDesktopAsset(
					'originals',
					write.storageName,
					write.file,
					hashes.get(write.storageName) ?? null
				);
			}
		},

		async writeThumbnails(writes: readonly ThumbnailWrite[]) {
			for (const write of writes) {
				await writeDesktopAsset('thumbnails', write.storageName, write.blob);
			}
		},

		deleteAssets,

		listAssets(kind: DesktopAssetKind) {
			return invoke<StoredFile[]>('list_assets', { kind });
		},

		durableUsage() {
			return invoke<DurableUsage>('durable_usage');
		},

		listDerived() {
			return cache.listDerived();
		},

		deleteDerived(storageNames: readonly string[]) {
			return cache.deleteDerived(storageNames);
		},

		cacheUsage(): Promise<AssetUsage> {
			return cache.usage();
		}
	};
}

export type DesktopAssets = ReturnType<typeof createDesktopAssets>;
