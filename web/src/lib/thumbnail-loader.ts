import type { PhotoAssetStore } from './library-backend.ts';
import type { ObjectUrlRegistry } from './object-url-registry';
import { primaryStoredFrame, type Photo } from './photo-record';
import type { StorageStatus, WorkspacePersistence } from './workspace-persistence';

export interface ThumbnailLoaderHost {
	readonly photos: Photo[];
	storageStatus: StorageStatus;
	storageError: string | null;
}

export class ThumbnailLoader {
	private readonly loads = new Map<string, Promise<void>>();

	constructor(
		private readonly service: PhotoAssetStore | null,
		private readonly persistence: WorkspacePersistence,
		private readonly objectUrls: ObjectUrlRegistry,
		private readonly host: ThumbnailLoaderHost
	) {}

	load(photoId: string) {
		const photo = this.host.photos.find((candidate) => candidate.id === photoId);
		if (!photo || photo.src) return Promise.resolve();
		const pending = this.loads.get(photoId);
		if (pending) return pending;

		const load = this.restore(photo)
			.catch((error: unknown) => {
				this.host.storageStatus = 'error';
				this.host.storageError =
					error instanceof Error ? error.message : `Unable to load ${photo.name}`;
			})
			.finally(() => this.loads.delete(photoId));
		this.loads.set(photoId, load);
		return load;
	}

	private async restore(photo: Photo) {
		const store = this.service;
		if (!store) return;
		await this.persistence.whenIdle();
		let file: Blob;
		if (photo.thumbnailStorageName) {
			file = await store.readThumbnail(photo.thumbnailStorageName);
		} else {
			const display = primaryStoredFrame(photo).display;
			if (!display) return;
			file = await store.readOriginal(display.storageName);
		}
		if (photo.src || !this.host.photos.some((candidate) => candidate.id === photo.id)) return;
		const src = URL.createObjectURL(file);
		this.objectUrls.add(src);
		photo.src = src;
	}

	forget(photoId: string) {
		this.loads.delete(photoId);
	}

	clear() {
		this.loads.clear();
	}
}
