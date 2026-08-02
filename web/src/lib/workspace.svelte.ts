import { acceptedPhotoTypes, normalizedRawExtensions } from './photo-source';
import {
	LibraryStore,
	type LibraryManifest,
	type OriginalWrite,
	type PhotoCollection,
	type StoredAsset,
	type StoredFrame,
	type StoredMetadata,
	type ThumbnailWrite,
	type StoredPhoto
} from './library-store';
import { PostframeWorkerClient } from './worker-client';
import {
	groupPhotoFiles,
	type PhotoAsset as GroupedPhotoAsset,
	type PhotoFrame as GroupedPhotoFrame,
	type PhotoGroup
} from './photo-group';
import type {
	DevelopPhase,
	DevelopProgress,
	RawFrameHandleInput,
	RawMetadata,
	RenderTileRequest
} from './worker';
import {
	BrowserStorageService,
	storageErrorMessage,
	type BrowserStorageStatus
} from './browser-storage';

export type WorkspaceMode = 'welcome' | 'organize' | 'edit';
export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type MaskKind = 'brush' | 'linear' | 'radial' | 'subject' | 'sky' | 'background';
export type StorageStatus = 'memory' | 'saving' | 'saved' | 'error';
export type DocumentStatus =
	| { kind: 'idle' }
	| {
			kind: 'loading';
			photoId: string;
			phase: DevelopPhase;
			bytesRead: number;
			totalBytes: number;
			framesDecoded: number;
			totalFrames: number;
			activeFrame: number;
	  }
	| { kind: 'ready'; photoId: string; boostStops: number | null }
	| { kind: 'cancelled'; photoId: string }
	| { kind: 'error'; photoId: string; message: string };

export interface Photo {
	id: string;
	name: string;
	extension: string;
	src: string | null;
	kind: StoredPhoto['kind'];
	frames: StoredFrame[];
	bracketDetection: StoredPhoto['bracketDetection'];
	thumbnailStorageName: string | null;
	metadata: StoredMetadata | null;
	size: number;
	width: number | null;
	height: number | null;
	captured: string;
	importedAt: number;
	rating: number;
	flagged: boolean;
	rejected: boolean;
	colorLabel: ColorLabel;
	stackId: string | null;
}

export interface PhotoStack {
	id: string;
	name: string;
	photoIds: string[];
	collapsed: boolean;
}

export interface Mask {
	id: string;
	name: string;
	kind: MaskKind;
	visible: boolean;
}

interface PhotoImport {
	photo: Photo;
	originals: OriginalWrite[];
	thumbnails: ThumbnailWrite[];
}

interface FrameImport {
	frame: StoredFrame;
	originals: OriginalWrite[];
	rawFile: File | null;
	displayFile: File | null;
}

const defaultAdjustments = {
	temperature: 5600,
	tint: 4,
	exposure: 0,
	contrast: 0,
	highlights: -18,
	shadows: 12,
	whites: 0,
	blacks: -6,
	vibrance: 8,
	saturation: 0,
	texture: 0,
	clarity: 0,
	dehaze: 0,
	sharpening: 40,
	noiseReduction: 10
};

function id(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}`;
}

function dateLabel(timestamp: number) {
	return new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(timestamp);
}

export class WorkspaceState {
	private readonly libraryStore = LibraryStore.supported() ? new LibraryStore() : null;
	private readonly browserStorage = new BrowserStorageService();
	private readonly workerClient =
		typeof Worker === 'undefined' ? null : new PostframeWorkerClient();
	private readonly rawExtensions = new Set<string>();
	private capabilityLoading: Promise<void> | null = null;
	private libraryRevision = 0;
	private libraryCreatedAt = 0;
	private persistence = Promise.resolve();
	private persistenceRevision = 0;
	private objectUrls = new Set<string>();
	private documentRevision = 0;
	private removeProgressListener: (() => void) | null = null;

	mode = $state<WorkspaceMode>('welcome');
	photos = $state<Photo[]>([]);
	collections = $state<PhotoCollection[]>([]);
	stacks = $state<PhotoStack[]>([]);
	selectedIds = $state<string[]>([]);
	activePhotoId = $state<string | null>(null);
	masks = $state<Mask[]>([]);
	selectedMaskId = $state<string | null>(null);
	acceptedPhotos = $state(acceptedPhotoTypes([]));
	capabilitiesReady = $state(false);
	capabilitiesError = $state<string | null>(null);
	ingestError = $state<string | null>(null);
	libraryReady = $state(false);
	libraryError = $state<string | null>(null);
	collectionDialogOpen = $state(false);
	startupReady = $state(false);
	localStorageAvailable = this.libraryStore !== null;
	storageStatus = $state<StorageStatus>(this.libraryStore ? 'saved' : 'memory');
	storageError = $state<string | null>(null);
	browserStorageStatus = $state<BrowserStorageStatus | null>(null);
	browserStorageError = $state<string | null>(null);
	documentStatus = $state<DocumentStatus>({ kind: 'idle' });
	editPreview = $state<{ src: string; width: number; height: number } | null>(null);
	// TODO(WASM_TODOS.adjustments): send changes to the render graph and refresh the preview.
	adjustments = $state({ ...defaultAdjustments });
	// TODO(WASM_TODOS.layersAndHistory): record document operations and back undo and redo.
	history = $state<string[]>(['imported']);

	selectedPhoto = $derived(this.photos.find((photo) => photo.id === this.activePhotoId) ?? null);
	selectedPhotos = $derived(this.photos.filter((photo) => this.selectedIds.includes(photo.id)));
	editingPhoto = $derived(
		this.selectedPhoto
			? {
					...this.selectedPhoto,
					src: this.editPreview?.src ?? this.selectedPhoto.src,
					width: this.editPreview?.width ?? this.selectedPhoto.width,
					height: this.editPreview?.height ?? this.selectedPhoto.height
				}
			: null
	);

	constructor() {
		this.removeProgressListener =
			this.workerClient?.onProgress((progress) => {
				if (this.documentStatus.kind !== 'loading') return;
				this.documentStatus = {
					...this.documentStatus,
					...developProgress(progress)
				};
			}) ?? null;
		void this.initialize();
	}

	openSingle = async (file: File) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const imported = (await this.photosFromFiles([file]))[0];
		if (!imported) return;
		this.photos.push(imported.photo);
		this.selectPhoto(imported.photo.id);
		await this.queuePersistence(imported.originals, imported.thumbnails);
		this.mode = 'edit';
		await this.openDocument(imported.photo.id);
	};

	createCollection = async (name: string, files: File[]) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const trimmed = name.trim();
		if (!trimmed) return;
		const imported = await this.photosFromFiles(files);
		const importedPhotos = imported.map(({ photo }) => photo);
		this.photos.push(...importedPhotos);
		const now = Date.now();
		this.collections.push({
			id: id('collection'),
			name: trimmed,
			createdAt: now,
			updatedAt: now,
			photoIds:
				importedPhotos.length > 0
					? importedPhotos.map((photo) => photo.id)
					: this.selectedIds.filter((photoId) => this.photos.some((photo) => photo.id === photoId))
		});
		if (importedPhotos[0]) this.selectPhoto(importedPhotos[0].id);
		this.mode = 'organize';
		this.collectionDialogOpen = false;
		await this.queuePersistence(
			imported.flatMap(({ originals }) => originals),
			imported.flatMap(({ thumbnails }) => thumbnails)
		);
	};

	importFiles = async (files: File[]) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const imported = await this.photosFromFiles(files);
		this.photos.push(...imported.map(({ photo }) => photo));
		if (!this.activePhotoId && imported[0]?.photo) {
			this.selectPhoto(imported[0].photo.id);
		}
		await this.queuePersistence(
			imported.flatMap(({ originals }) => originals),
			imported.flatMap(({ thumbnails }) => thumbnails)
		);
	};

	async save() {
		await this.queuePersistence();
	}

	enterLibrary = () => {
		this.mode = 'organize';
		this.collectionDialogOpen = false;
	};

	requestCollectionCreation = () => {
		this.mode = 'organize';
		this.collectionDialogOpen = true;
	};

	clearLocalData = async () => {
		const store = this.libraryStore;
		if (!store) return;

		this.libraryRevision += 1;
		this.libraryError = null;
		await this.persistence;
		try {
			await store.clearAll();
			this.closeDocument();
			this.clearFiles();
			this.persistenceRevision += 1;
			this.libraryCreatedAt = Date.now();
			this.photos = [];
			this.collections = [];
			this.stacks = [];
			this.selectedIds = [];
			this.activePhotoId = null;
			this.mode = 'welcome';
			this.libraryReady = true;
			this.storageStatus = 'saved';
			this.storageError = null;
			this.resetEditState();
			await this.refreshBrowserStorage();
		} catch (error) {
			this.libraryError = error instanceof Error ? error.message : 'Unable to clear local data';
			throw error;
		}
	};

	refreshBrowserStorage = async () => {
		this.browserStorageError = null;
		try {
			this.browserStorageStatus = await this.browserStorage.status();
		} catch (error) {
			this.browserStorageError = storageErrorMessage(error);
			throw error;
		}
	};

	requestPersistentStorage = async () => {
		this.browserStorageError = null;
		try {
			const result = await this.browserStorage.requestPersistence();
			this.browserStorageStatus = result.status;
		} catch (error) {
			this.browserStorageError = storageErrorMessage(error);
			throw error;
		}
	};

	setMode(mode: Exclude<WorkspaceMode, 'welcome'>) {
		if (mode === 'edit' && this.photos.length === 0) return;
		this.mode = mode;
		if (mode === 'edit' && this.activePhotoId) void this.openDocument(this.activePhotoId);
		else this.closeDocument();
	}

	selectPhoto(photoId: string, additive = false) {
		if (additive) {
			this.selectedIds = this.selectedIds.includes(photoId)
				? this.selectedIds.filter((id) => id !== photoId)
				: [...this.selectedIds, photoId];
		} else {
			this.selectedIds = [photoId];
		}
		this.activePhotoId = photoId;
		if (this.mode === 'edit' && !additive) void this.openDocument(photoId);
	}

	editPhoto(photoId: string) {
		this.mode = 'edit';
		this.selectPhoto(photoId);
	}

	reloadDocument = () => {
		if (this.activePhotoId) void this.openDocument(this.activePhotoId);
	};

	cancelDocument = () => {
		if (this.documentStatus.kind !== 'loading') return;
		const photoId = this.documentStatus.photoId;
		this.documentRevision += 1;
		this.workerClient?.restart('Development cancelled');
		this.releaseEditPreview();
		this.documentStatus = { kind: 'cancelled', photoId };
	};

	renderTile = async (photoId: string, tile: RenderTileRequest) => {
		if (
			!this.workerClient ||
			this.documentStatus.kind !== 'ready' ||
			this.documentStatus.photoId !== photoId ||
			this.selectedPhoto?.kind === 'display'
		) {
			throw new Error('RAW document is not ready for tile rendering');
		}
		return this.workerClient.renderTile(tile);
	};

	setRating(photoId: string, rating: number) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.rating = photo.rating === rating ? 0 : rating;
		void this.queuePersistence();
	}

	toggleFlag(photoId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.flagged = !photo.flagged;
		void this.queuePersistence();
	}

	setColorLabel(photoId: string, colorLabel: ColorLabel) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.colorLabel = colorLabel;
		void this.queuePersistence();
	}

	toggleCollection(photoId: string, collectionId: string) {
		const collection = this.collections.find((candidate) => candidate.id === collectionId);
		if (!collection || !this.photos.some((photo) => photo.id === photoId)) return;
		collection.photoIds = collection.photoIds.includes(photoId)
			? collection.photoIds.filter((id) => id !== photoId)
			: [...collection.photoIds, photoId];
		collection.updatedAt = Date.now();
		void this.queuePersistence();
	}

	createStack = () => {
		const photoIds = this.selectedIds.filter((photoId) =>
			this.photos.some((photo) => photo.id === photoId)
		);
		if (photoIds.length < 2) return;

		for (const stack of this.stacks) {
			stack.photoIds = stack.photoIds.filter((photoId) => !photoIds.includes(photoId));
		}
		this.stacks = this.stacks.filter((stack) => stack.photoIds.length > 1);
		const survivingStackIds = new Set(this.stacks.map((stack) => stack.id));
		for (const photo of this.photos) {
			if (photo.stackId && !survivingStackIds.has(photo.stackId)) photo.stackId = null;
		}

		const stack = {
			id: id('stack'),
			name: `Exposure stack ${this.stacks.length + 1}`,
			photoIds,
			collapsed: true
		};
		this.stacks.push(stack);
		for (const photo of this.photos) {
			if (photoIds.includes(photo.id)) photo.stackId = stack.id;
		}
		void this.queuePersistence();
	};

	ungroupStack(stackId: string) {
		for (const photo of this.photos) {
			if (photo.stackId === stackId) photo.stackId = null;
		}
		this.stacks = this.stacks.filter((stack) => stack.id !== stackId);
		void this.queuePersistence();
	}

	toggleStack(stackId: string) {
		const stack = this.stacks.find((candidate) => candidate.id === stackId);
		if (!stack) return;
		stack.collapsed = !stack.collapsed;
		void this.queuePersistence();
	}

	createMask(kind: MaskKind) {
		// TODO(WASM_TODOS.masks): create the actual mask raster in the Wasm document.
		const labels: Record<MaskKind, string> = {
			brush: 'brush',
			linear: 'linear gradient',
			radial: 'radial gradient',
			subject: 'subject',
			sky: 'sky',
			background: 'background'
		};
		const mask = { id: id('mask'), name: labels[kind], kind, visible: true };
		this.masks.push(mask);
		this.selectedMaskId = mask.id;
		this.history.push(`Created ${labels[kind].toLowerCase()} mask`);
	}

	toggleMask(maskId: string) {
		// TODO(WASM_TODOS.masks): mirror visibility into the render graph.
		const mask = this.masks.find((candidate) => candidate.id === maskId);
		if (mask) mask.visible = !mask.visible;
	}

	deleteMask(maskId: string) {
		// TODO(WASM_TODOS.masks): delete the mask raster and its adjustment node.
		this.masks = this.masks.filter((mask) => mask.id !== maskId);
		this.selectedMaskId = this.masks.at(-1)?.id ?? null;
	}

	reset = () => {
		this.closeDocument();
		this.mode = 'welcome';
		this.collectionDialogOpen = false;
	};

	destroy = () => {
		this.documentRevision += 1;
		this.removeProgressListener?.();
		this.removeProgressListener = null;
		this.clearFiles();
		this.workerClient?.destroy();
	};

	private resetEditState() {
		this.masks = [];
		this.selectedMaskId = null;
		this.adjustments = { ...defaultAdjustments };
		this.history = ['imported'];
	}

	private async openDocument(photoId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo || this.mode !== 'edit') return;

		const revision = ++this.documentRevision;
		if (this.documentStatus.kind !== 'idle') {
			this.workerClient?.restart('Document changed');
		}
		this.releaseEditPreview();

		if (photo.kind === 'display') {
			this.documentStatus = { kind: 'ready', photoId, boostStops: null };
			return;
		}
		if (!this.workerClient) {
			this.documentStatus = { kind: 'error', photoId, message: 'RAW decoder is unavailable' };
			return;
		}

		this.documentStatus = {
			kind: 'loading',
			photoId,
			phase: 'reading',
			bytesRead: 0,
			totalBytes: 0,
			framesDecoded: 0,
			totalFrames: photo.frames.length,
			activeFrame: 1
		};

		try {
			await this.persistence;
			if (revision !== this.documentRevision) return;
			const frames = await this.documentFrames(photo);
			if (revision !== this.documentRevision) return;
			const result = await this.workerClient.openDocument(frames, previewDimension());
			if (revision !== this.documentRevision) return;

			const src = URL.createObjectURL(new Blob([result.jpeg], { type: 'image/jpeg' }));
			this.objectUrls.add(src);
			this.editPreview = { src, width: result.width, height: result.height };
			this.documentStatus = { kind: 'ready', photoId, boostStops: result.boostStops };
		} catch (error) {
			if (revision !== this.documentRevision) return;
			this.documentStatus = {
				kind: 'error',
				photoId,
				message: error instanceof Error ? error.message : 'Unable to open RAW document'
			};
		}
	}

	private async documentFrames(photo: Photo): Promise<RawFrameHandleInput[]> {
		const store = this.libraryStore;
		if (!store) throw new Error('RAW editing requires local OPFS storage');

		return Promise.all(
			photo.frames.map(async (frame) => {
				if (!frame.raw) throw new Error('Every bracket frame needs a RAW source');
				const raw = await store.originalHandle(frame.raw.storageName);
				const jpeg = frame.display
					? await store.originalHandle(frame.display.storageName)
					: undefined;
				return { raw, jpeg };
			})
		);
	}

	private closeDocument() {
		this.documentRevision += 1;
		const hadDocument = this.documentStatus.kind !== 'idle';
		this.releaseEditPreview();
		this.documentStatus = { kind: 'idle' };
		if (hadDocument) this.workerClient?.restart('Document closed');
	}

	private releaseEditPreview() {
		if (!this.editPreview) return;
		URL.revokeObjectURL(this.editPreview.src);
		this.objectUrls.delete(this.editPreview.src);
		this.editPreview = null;
	}

	private clearFiles() {
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls.clear();
		this.editPreview = null;
	}

	private async photosFromFiles(files: File[]) {
		const grouping = groupPhotoFiles(files, this.rawExtensions);
		const imported: PhotoImport[] = [];
		if (grouping.rejectedFiles[0]) {
			this.ingestError = `${grouping.rejectedFiles[0].name}: unsupported photo format`;
		}

		for (const group of grouping.groups) {
			try {
				imported.push(await this.photoFromGroup(group, grouping.filesByAssetKey));
			} catch (error) {
				const name = firstGroupedAsset(group)?.name ?? 'photo';
				const reason = error instanceof Error ? error.message : 'unsupported photo';
				this.ingestError = `${name}: ${reason}`;
			}
		}

		return imported;
	}

	private async photoFromGroup(
		group: PhotoGroup,
		filesByAssetKey: ReadonlyMap<string, File>
	): Promise<PhotoImport> {
		const importedFrames = groupedFrames(group).map(({ photo, filenameExposureHint }) =>
			this.importFrame(photo, filenameExposureHint, filesByAssetKey)
		);
		const selectedFrame = importedFrames[primaryFrameIndex(group)];
		if (!selectedFrame) throw new Error('photo group has no frames');

		const rawFrames = importedFrames.filter(
			(frame): frame is FrameImport & { rawFile: File } => frame.rawFile !== null
		);
		const metadataFrame = selectedFrame.rawFile ? selectedFrame : rawFrames[0];
		let inspection: Awaited<ReturnType<PostframeWorkerClient['inspectRaw']>> | null = null;

		for (const frame of rawFrames) {
			if (!this.workerClient) throw new Error('RAW decoder is unavailable');
			const bytes = await frame.rawFile.arrayBuffer();
			if (frame === metadataFrame) inspection = await this.workerClient.inspectRaw(bytes);
			else await this.workerClient.validateRaw(bytes);
		}

		const photoId = id('photo');
		const selectedAsset = selectedFrame.frame.display ?? selectedFrame.frame.raw;
		if (!selectedAsset) throw new Error('photo frame has no source');
		let src: string | null = null;
		let thumbnailStorageName: string | null = null;
		const thumbnails: ThumbnailWrite[] = [];

		if (selectedFrame.displayFile) {
			src = URL.createObjectURL(selectedFrame.displayFile);
		} else if (inspection) {
			const blob = new Blob([inspection.thumbnailJpeg], { type: 'image/jpeg' });
			src = URL.createObjectURL(blob);
			thumbnailStorageName = `${photoId}.jpg`;
			thumbnails.push({ storageName: thumbnailStorageName, blob });
		}
		if (src) this.objectUrls.add(src);

		const dimensions = inspection?.metadata ?? (src ? await this.readDimensions(src) : null);
		// TODO(WASM_TODOS.metadata): inspect EXIF for display-only assets with a dedicated parser.
		const metadata = inspection ? storedMetadata(inspection.metadata) : null;
		const frameAssets = importedFrames.flatMap(({ frame }) =>
			[frame.raw, frame.display].filter((asset): asset is StoredAsset => asset !== null)
		);
		const photo = {
			id: photoId,
			name: selectedAsset.name,
			extension: groupLabel(group.kind, selectedFrame.frame, importedFrames.length),
			src,
			kind: group.kind,
			frames: importedFrames.map(({ frame }) => frame),
			bracketDetection: group.kind === 'bracket' ? group.detection : null,
			thumbnailStorageName,
			metadata,
			size: frameAssets.reduce((total, asset) => total + asset.source.size, 0),
			width: dimensions?.width ?? null,
			height: dimensions?.height ?? null,
			captured: captureLabel(metadata?.capturedAt, selectedAsset.source.lastModified),
			importedAt: Date.now(),
			rating: 0,
			flagged: false,
			rejected: false,
			colorLabel: 'none',
			stackId: null
		} satisfies Photo;

		return {
			photo,
			originals: importedFrames.flatMap(({ originals }) => originals),
			thumbnails
		};
	}

	private async restorePhoto(photo: StoredPhoto): Promise<Photo> {
		const store = this.libraryStore;
		if (!store) throw new Error('Local library storage is unavailable');
		let src: string | null = null;
		let metadata = photo.metadata ? { ...photo.metadata } : null;
		let width = photo.width;
		let height = photo.height;
		const frame = primaryStoredFrame(photo);
		const display = frame.display;

		if (display) {
			const file = await store.readOriginal(display.storageName);
			if (!file) throw new Error(`Original ${display.name} is unavailable`);
			src = URL.createObjectURL(file);
		} else if (photo.thumbnailStorageName) {
			const file = await store.readThumbnail(photo.thumbnailStorageName);
			src = URL.createObjectURL(file);
		} else if (frame.raw && this.workerClient) {
			// TODO(WASM_TODOS.libraryStorage): persist thumbnails regenerated from migrated manifests.
			const file = await store.readOriginal(frame.raw.storageName);
			if (!file) throw new Error(`Original ${frame.raw.name} is unavailable`);
			const inspection = await this.workerClient.inspectRaw(await file.arrayBuffer());
			const blob = new Blob([inspection.thumbnailJpeg], { type: 'image/jpeg' });
			src = URL.createObjectURL(blob);
			metadata ??= storedMetadata(inspection.metadata);
			width ??= inspection.metadata.width;
			height ??= inspection.metadata.height;
		}
		if (src) this.objectUrls.add(src);

		const selectedAsset = frame.display ?? frame.raw;
		if (!selectedAsset) throw new Error(`Photo ${photo.name} has no source`);

		return {
			id: photo.id,
			name: photo.name,
			extension: groupLabel(photo.kind, frame, photo.frames.length),
			src,
			kind: photo.kind,
			frames: cloneFrames(photo.frames),
			bracketDetection: photo.bracketDetection,
			thumbnailStorageName: photo.thumbnailStorageName,
			metadata,
			size: photo.frames
				.flatMap((candidate) => [candidate.raw, candidate.display])
				.filter((asset): asset is StoredAsset => asset !== null)
				.reduce((total, asset) => total + asset.source.size, 0),
			width,
			height,
			captured: captureLabel(metadata?.capturedAt, selectedAsset.source.lastModified),
			importedAt: photo.importedAt,
			rating: photo.rating,
			flagged: photo.flagged,
			rejected: photo.rejected,
			colorLabel: photo.colorLabel,
			stackId: photo.stackId
		};
	}

	private importFrame(
		frame: GroupedPhotoFrame,
		filenameExposureHint: number | null,
		filesByAssetKey: ReadonlyMap<string, File>
	): FrameImport {
		const raw = frame.kind === 'raw' || frame.kind === 'raw-pair' ? frame.raw : null;
		const display = frame.kind === 'display' || frame.kind === 'raw-pair' ? frame.display : null;
		const rawImport = raw ? importedAsset(raw, filesByAssetKey) : null;
		const displayImport = display ? importedAsset(display, filesByAssetKey) : null;

		return {
			frame: {
				raw: rawImport?.asset ?? null,
				display: displayImport?.asset ?? null,
				filenameExposureHint
			},
			originals: [rawImport?.original, displayImport?.original].filter(
				(original): original is OriginalWrite => original !== undefined
			),
			rawFile: rawImport?.file ?? null,
			displayFile: displayImport?.file ?? null
		};
	}

	private async loadLibrary() {
		const store = this.libraryStore;
		if (!store) {
			this.libraryCreatedAt = Date.now();
			this.libraryReady = true;
			return;
		}

		const revision = ++this.libraryRevision;
		this.libraryReady = false;
		this.libraryError = null;
		await this.persistence;
		try {
			const library = await store.loadLibrary();
			if (revision !== this.libraryRevision) return;
			if (!library) {
				this.libraryCreatedAt = Date.now();
				return;
			}

			this.clearFiles();
			const photos = await Promise.all(library.photos.map((photo) => this.restorePhoto(photo)));
			if (revision !== this.libraryRevision) return;
			this.libraryCreatedAt = library.createdAt;
			this.photos = photos;
			this.collections = library.collections.map((collection) => ({
				...collection,
				photoIds: [...collection.photoIds]
			}));
			this.stacks = library.stacks.map((stack) => ({
				...stack,
				photoIds: [...stack.photoIds]
			}));
			this.selectedIds = photos[0] ? [photos[0].id] : [];
			this.activePhotoId = photos[0]?.id ?? null;
			this.storageStatus = 'saved';
			this.storageError = null;
		} catch (error) {
			if (revision === this.libraryRevision) {
				this.libraryError = error instanceof Error ? error.message : 'Unable to read the library';
			}
		} finally {
			if (revision === this.libraryRevision) this.libraryReady = true;
		}
	}

	private async ensureCapabilities() {
		if (this.capabilitiesReady) return;
		this.capabilityLoading ??= this.loadCapabilities();
		await this.capabilityLoading;
	}

	private async initialize() {
		await Promise.all([
			this.ensureCapabilities(),
			this.refreshBrowserStorage().catch(() => undefined)
		]);
		await this.loadLibrary();
		if (this.photos.length > 0) this.mode = 'organize';
		this.startupReady = true;
	}

	private async loadCapabilities() {
		try {
			const response = await this.workerClient?.capabilities();
			for (const extension of normalizedRawExtensions(response?.rawExtensions ?? [])) {
				this.rawExtensions.add(extension);
			}
			this.acceptedPhotos = acceptedPhotoTypes(this.rawExtensions);
		} catch (error) {
			this.capabilitiesError =
				error instanceof Error ? error.message : 'Unable to load decoder capabilities';
		} finally {
			this.capabilitiesReady = true;
		}
	}

	private libraryManifest(): LibraryManifest | null {
		if (!this.libraryReady || this.libraryCreatedAt === 0) return null;
		return {
			version: 1,
			createdAt: this.libraryCreatedAt,
			updatedAt: Date.now(),
			photos: this.photos.map((photo) => this.storedPhoto(photo)),
			collections: this.collections.map((collection) => ({
				...collection,
				photoIds: [...collection.photoIds]
			})),
			stacks: this.stacks.map((stack) => ({ ...stack, photoIds: [...stack.photoIds] }))
		};
	}

	private storedPhoto(photo: Photo): StoredPhoto {
		return {
			id: photo.id,
			name: photo.name,
			kind: photo.kind,
			frames: cloneFrames(photo.frames),
			bracketDetection: photo.bracketDetection,
			thumbnailStorageName: photo.thumbnailStorageName,
			metadata: photo.metadata ? { ...photo.metadata } : null,
			importedAt: photo.importedAt,
			width: photo.width,
			height: photo.height,
			rating: photo.rating,
			flagged: photo.flagged,
			rejected: photo.rejected,
			colorLabel: photo.colorLabel,
			stackId: photo.stackId
		};
	}

	private queuePersistence(
		originals: readonly OriginalWrite[] = [],
		thumbnails: readonly ThumbnailWrite[] = []
	) {
		const manifest = this.libraryManifest();
		const store = this.libraryStore;
		if (!store || !manifest) {
			this.storageStatus = 'memory';
			return Promise.resolve();
		}

		const revision = ++this.persistenceRevision;
		this.storageStatus = 'saving';
		this.storageError = null;
		const save = this.persistence.then(() => store.saveLibrary(manifest, originals, thumbnails));
		this.persistence = save.then(
			() => {
				if (revision !== this.persistenceRevision) return;
				this.storageStatus = 'saved';
			},
			(error: unknown) => {
				if (revision !== this.persistenceRevision) return;
				this.storageStatus = 'error';
				this.storageError = error instanceof Error ? error.message : 'Unable to save the library';
			}
		);
		return this.persistence;
	}

	private readDimensions(src: string): Promise<{ width: number; height: number } | null> {
		return new Promise((resolve) => {
			const image = new Image();
			image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
			image.onerror = () => resolve(null);
			image.src = src;
		});
	}
}

function groupedFrames(group: PhotoGroup) {
	return group.kind === 'bracket'
		? group.frames.map(({ photo, filenameExposureHint }) => ({ photo, filenameExposureHint }))
		: [{ photo: group, filenameExposureHint: null }];
}

function primaryFrameIndex(group: PhotoGroup) {
	if (group.kind !== 'bracket') return 0;
	const neutral = group.frames.findIndex(({ filenameExposureHint }) => filenameExposureHint === 0);
	return neutral >= 0 ? neutral : Math.floor(group.frames.length / 2);
}

function firstGroupedAsset(group: PhotoGroup) {
	const frame = groupedFrames(group)[0]?.photo;
	if (!frame) return null;
	return frame.kind === 'display' ? frame.display : frame.raw;
}

function importedAsset(
	asset: GroupedPhotoAsset,
	filesByAssetKey: ReadonlyMap<string, File>
): { asset: StoredAsset; original: OriginalWrite; file: File } {
	const file = filesByAssetKey.get(asset.key);
	if (!file) throw new Error(`${asset.name} is unavailable`);
	const assetId = id('asset');
	const stored = {
		id: assetId,
		storageName: `${assetId}.${asset.source.format}`,
		name: asset.name,
		source: { ...asset.source }
	} satisfies StoredAsset;
	return { asset: stored, original: { storageName: stored.storageName, file }, file };
}

function storedMetadata(metadata: RawMetadata): StoredMetadata {
	return {
		orientation: metadata.orientation,
		cameraMake: metadata.cameraMake,
		cameraModel: metadata.cameraModel,
		lens: metadata.lens,
		capturedAt: metadata.capturedAt,
		exposureSeconds: metadata.exposureSeconds,
		fNumber: metadata.fNumber,
		iso: metadata.iso,
		focalLengthMm: metadata.focalLengthMm
	};
}

function captureLabel(capturedAt: string | null | undefined, fallback: number) {
	const match = capturedAt?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
	if (!match) return capturedAt ?? dateLabel(fallback);
	const [, year, month, day, hour, minute, second] = match;
	return dateLabel(
		new Date(
			Number(year),
			Number(month) - 1,
			Number(day),
			Number(hour),
			Number(minute),
			Number(second)
		).getTime()
	);
}

function groupLabel(kind: StoredPhoto['kind'], frame: StoredFrame, frameCount: number) {
	if (kind === 'bracket') return `BRACKET × ${frameCount}`;
	if (kind === 'raw-pair') {
		return `${frame.raw?.source.format.toUpperCase()} + ${frame.display?.source.format.toUpperCase()}`;
	}
	return (frame.display ?? frame.raw)?.source.format.toUpperCase() ?? 'PHOTO';
}

function primaryStoredFrame(photo: Pick<StoredPhoto, 'kind' | 'frames'>) {
	if (photo.kind !== 'bracket') return photo.frames[0];
	return (
		photo.frames.find(({ filenameExposureHint }) => filenameExposureHint === 0) ??
		photo.frames[Math.floor(photo.frames.length / 2)]
	);
}

function cloneFrames(frames: StoredFrame[]) {
	return frames.map((frame) => ({
		raw: frame.raw ? cloneAsset(frame.raw) : null,
		display: frame.display ? cloneAsset(frame.display) : null,
		filenameExposureHint: frame.filenameExposureHint
	}));
}

function cloneAsset(asset: StoredAsset) {
	return { ...asset, source: { ...asset.source } };
}

function previewDimension() {
	if (typeof window === 'undefined') return 2048;
	const longestSide = Math.max(window.innerWidth, window.innerHeight) * window.devicePixelRatio;
	return Math.round(Math.min(2560, Math.max(1024, longestSide)));
}

function developProgress(progress: DevelopProgress) {
	return {
		phase: progress.phase,
		bytesRead: progress.bytesRead,
		totalBytes: progress.totalBytes,
		framesDecoded: progress.framesDecoded,
		totalFrames: progress.totalFrames,
		activeFrame: progress.activeFrame
	};
}

export function formatBytes(bytes: number) {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
