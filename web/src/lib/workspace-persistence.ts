import type { LibraryPersistence, LocalLibraryReset } from './library-backend.ts';
import type { PhotoCollection } from './library-schema';
import { restoredPhoto, storedPhoto, type Photo, type PhotoStack } from './photo-record';
import type { PhotoImport } from './photo-ingest';
import type { ObjectUrlRegistry } from './object-url-registry';
import type { Preset } from './preset';
import type { CameraMatchPreference } from './camera-match.ts';

export type StorageStatus = 'memory' | 'saving' | 'saved' | 'error';

export interface WorkspacePersistenceHost {
	photos: Photo[];
	collections: PhotoCollection[];
	stacks: PhotoStack[];
	presets: Preset[];
	cameraMatchPreference: CameraMatchPreference;
	selectedIds: string[];
	activePhotoId: string | null;
	storageStatus: StorageStatus;
	storageError: string | null;
	libraryReady: boolean;
	libraryError: string | null;
	clearFiles(): void;
	storageWritten(): void;
}

export class WorkspacePersistence {
	private persistence = Promise.resolve();
	private revision = 0;
	private loadRevision = 0;
	private libraryCreatedAt = 0;

	constructor(
		private readonly service: LibraryPersistence | null,
		private readonly localLibraryReset: LocalLibraryReset | null,
		private readonly objectUrls: ObjectUrlRegistry,
		private readonly host: WorkspacePersistenceHost
	) {}

	whenIdle() {
		return this.persistence;
	}

	async loadLibrary() {
		const store = this.service;
		if (!store) {
			this.libraryCreatedAt = Date.now();
			this.host.libraryReady = true;
			return;
		}

		const revision = ++this.loadRevision;
		this.host.libraryReady = false;
		this.host.libraryError = null;
		await this.persistence;
		try {
			const [library, presets] = await Promise.all([store.loadLibrary(), store.listPresets()]);
			if (revision !== this.loadRevision) return;
			this.host.presets = presets;
			if (!library) {
				this.libraryCreatedAt = Date.now();
				this.host.cameraMatchPreference = 'ask';
				return;
			}

			this.host.clearFiles();
			const photos = await Promise.all(
				library.photos.map((photo) =>
					restoredPhoto(photo, (photoId) => store.loadEditDocument(photoId))
				)
			);
			if (revision !== this.loadRevision) return;
			this.libraryCreatedAt = library.createdAt;
			this.host.cameraMatchPreference = library.cameraMatchPreference;
			this.host.photos = photos;
			this.host.collections = library.collections.map((collection) => ({
				...collection,
				photoIds: [...collection.photoIds]
			}));
			this.host.stacks = library.stacks.map((stack) => ({
				...stack,
				photoIds: [...stack.photoIds]
			}));
			this.host.selectedIds = photos[0] ? [photos[0].id] : [];
			this.host.activePhotoId = photos[0]?.id ?? null;
			this.host.storageStatus = 'saved';
			this.host.storageError = null;
		} catch (error) {
			if (revision === this.loadRevision) {
				this.host.libraryError =
					error instanceof Error ? error.message : 'Unable to read the library';
			}
		} finally {
			if (revision === this.loadRevision) this.host.libraryReady = true;
		}
	}

	async clearAll(onCleared: () => void) {
		this.loadRevision += 1;
		await this.persistence;
		await this.localLibraryReset?.clearAll();
		onCleared();
		this.revision += 1;
		this.libraryCreatedAt = Date.now();
	}

	async queue(operation: (store: LibraryPersistence) => Promise<unknown>): Promise<boolean> {
		const store = this.service;
		if (!store) {
			this.host.storageStatus = 'memory';
			return true;
		}

		const revision = ++this.revision;
		this.host.storageStatus = 'saving';
		this.host.storageError = null;
		const mutation = this.persistence.then(() => operation(store));
		this.persistence = mutation.then(
			() => {
				if (revision === this.revision) this.host.storageStatus = 'saved';
				this.host.storageWritten();
			},
			(error: unknown) => {
				this.host.storageWritten();
				if (revision !== this.revision) return;
				this.host.storageStatus = 'error';
				this.host.storageError = error instanceof Error ? error.message : 'Unable to save changes';
			}
		);
		try {
			await mutation;
			return true;
		} catch {
			return false;
		}
	}

	async commitImports(
		imports: readonly PhotoImport[],
		collection: PhotoCollection | null = null
	): Promise<{ photos: Photo[]; photoIds: string[]; collection: PhotoCollection | null } | null> {
		const store = this.service;
		if (!store) {
			this.host.storageStatus = 'memory';
			return {
				photos: imports.map(({ photo }) => photo),
				photoIds: imports.map(({ photo }) => photo.id),
				collection
			};
		}

		const importedById = new Map(imports.map((entry) => [entry.photo.id, entry]));
		const revision = ++this.revision;
		this.host.storageStatus = 'saving';
		this.host.storageError = null;
		const transaction = this.persistence.then(() =>
			store.importPhotos(
				this.libraryCreatedAt,
				imports.map(({ photo }) => storedPhoto(photo)),
				imports.flatMap(({ originals }) => originals),
				imports.flatMap(({ thumbnails }) => thumbnails),
				collection
			)
		);
		this.persistence = transaction.then(
			() => {
				if (revision === this.revision) this.host.storageStatus = 'saved';
				this.host.storageWritten();
			},
			(error: unknown) => {
				this.host.storageWritten();
				if (revision !== this.revision) return;
				this.host.storageStatus = 'error';
				this.host.storageError = error instanceof Error ? error.message : 'Unable to import photos';
			}
		);

		try {
			const result = await transaction;
			const additionIds = new Set(result.photos.map(({ id }) => id));
			for (const entry of imports) {
				if (!additionIds.has(entry.photo.id)) this.discardImport(entry);
			}
			return {
				photos: result.photos.flatMap((photo) => {
					const imported = importedById.get(photo.id);
					return imported ? [imported.photo] : [];
				}),
				photoIds: result.photoIds,
				collection: result.collection
			};
		} catch {
			for (const entry of imports) this.discardImport(entry);
			return null;
		}
	}

	private discardImport({ photo }: PhotoImport) {
		if (!photo.src) return;
		this.objectUrls.revoke(photo.src);
		photo.src = null;
	}
}
