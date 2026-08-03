import { acceptedPhotoTypes, normalizedRawExtensions } from './photo-source';
import {
	type CleanupResult,
	type OriginalWrite,
	type ThumbnailWrite,
	LibraryService
} from './library-service';
import type {
	PhotoCollection,
	StoredAsset,
	StoredFrame,
	StoredMetadata,
	StoredPhoto
} from './library-schema';
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
import {
	defaultDevelopSettings,
	LIGHT_CONTROL_NAMES,
	lightSettings,
	type DevelopSettings,
	type LightControlName,
	type LightSettings
} from './develop-settings';
import { DevelopHistory } from './develop-history';
import type { ImageScopeData } from './image-scope';

export type WorkspaceMode = 'welcome' | 'organize' | 'edit';
export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type MaskKind = 'brush' | 'linear' | 'radial' | 'subject' | 'sky' | 'background';
export type StorageStatus = 'memory' | 'saving' | 'saved' | 'error';
export type DevelopPreviewPhase = 'applying' | 'refining';
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
	develop: DevelopSettings;
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
	highlights: 0,
	shadows: 0,
	whites: 0,
	blacks: 0,
	vibrance: 8,
	saturation: 0,
	texture: 0,
	clarity: 0,
	dehaze: 0,
	sharpening: 40,
	noiseReduction: 10
};

const INTERACTIVE_SCOPE_SAMPLE_TARGET = 150_000;
const COMMITTED_SCOPE_SAMPLE_TARGET = 750_000;
const INTERACTIVE_SCOPE_INTERVAL_MS = 125;

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
	private readonly libraryService = LibraryService.supported() ? new LibraryService() : null;
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
	private thumbnailLoads = new Map<string, Promise<void>>();
	private documentRevision = 0;
	private developPreviewTimer: ReturnType<typeof setTimeout> | null = null;
	private developScopeTimer: ReturnType<typeof setTimeout> | null = null;
	private developScopeRevision = 0;
	private lastDevelopScopeAt = 0;
	private developPreviewRevision = 0;
	private developPreviewUrl: string | null = null;
	private refinementRevision: number | null = null;
	private developGesture: { control: LightControlName; before: DevelopSettings } | null = null;
	private readonly developHistory = new DevelopHistory();
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
	localStorageAvailable = this.libraryService !== null;
	storageStatus = $state<StorageStatus>(this.libraryService ? 'saved' : 'memory');
	storageError = $state<string | null>(null);
	browserStorageStatus = $state<BrowserStorageStatus | null>(null);
	browserStorageError = $state<string | null>(null);
	storageCleanupResult = $state<CleanupResult | null>(null);
	documentStatus = $state<DocumentStatus>({ kind: 'idle' });
	editPreview = $state<{ src: string; width: number; height: number } | null>(null);
	developPreview = $state<{
		photoId: string;
		src: string | null;
		phase: DevelopPreviewPhase;
	} | null>(null);
	imageScope = $state<ImageScopeData | null>(null);
	adjustments = $state({ ...defaultAdjustments });
	renderSettings = $state({ settings: lightSettings(defaultDevelopSettings()), revision: 0 });
	// TODO(WASM_TODOS.layersAndHistory): record document operations and back undo and redo.
	history = $state<string[]>(['imported']);
	canUndo = $state(false);
	canRedo = $state(false);

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
	canAdjustLight = $derived(
		this.selectedPhoto !== null &&
			this.documentStatus.kind === 'ready' &&
			this.documentStatus.photoId === this.selectedPhoto.id
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
		const committed = await this.persistImports([imported]);
		if (!committed) return;
		this.photos.push(...committed.photos);
		const photoId = committed.photoIds[0];
		if (!photoId) return;
		this.selectPhoto(photoId);
		this.mode = 'edit';
		await this.openDocument(photoId);
	};

	createCollection = async (name: string, files: File[]) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const trimmed = name.trim();
		if (!trimmed) return;
		const imported = await this.photosFromFiles(files);
		const importedPhotos = imported.map(({ photo }) => photo);
		const now = Date.now();
		const collection = {
			id: id('collection'),
			name: trimmed,
			createdAt: now,
			updatedAt: now,
			photoIds:
				importedPhotos.length > 0
					? importedPhotos.map((photo) => photo.id)
					: this.selectedIds.filter((photoId) => this.photos.some((photo) => photo.id === photoId))
		} satisfies PhotoCollection;
		const committed = await this.persistImports(imported, collection);
		if (!committed?.collection) return;
		this.photos.push(...committed.photos);
		this.collections.push(committed.collection);
		if (committed.photoIds[0]) this.selectPhoto(committed.photoIds[0]);
		this.mode = 'organize';
		this.collectionDialogOpen = false;
	};

	importFiles = async (files: File[]) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const imported = await this.photosFromFiles(files);
		const committed = await this.persistImports(imported);
		if (!committed) return;
		this.photos.push(...committed.photos);
		if (!this.activePhotoId && committed.photoIds[0]) this.selectPhoto(committed.photoIds[0]);
	};

	async save() {
		await this.persistence;
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
		const store = this.libraryService;
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
			this.storageCleanupResult = null;
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

	cleanupLocalData = async () => {
		const store = this.libraryService;
		if (!store) return;
		await this.persistence;
		this.storageCleanupResult = await store.cleanup();
		await this.refreshBrowserStorage();
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

	previewLight = (control: LightControlName, value: number) => {
		if (!this.canAdjustLight || !this.selectedPhoto) return;
		if (this.developGesture?.control !== control) {
			this.developGesture = { control, before: { ...this.selectedPhoto.develop } };
		}
		this.adjustments[control] = value;
		this.scheduleDevelopPreview({ ...this.selectedPhoto.develop, [control]: value });
	};

	commitLight = (control: LightControlName, value: number) => {
		if (!this.canAdjustLight || !this.selectedPhoto) return;
		const before =
			this.developGesture?.control === control
				? this.developGesture.before
				: { ...this.selectedPhoto.develop };
		const after = { ...this.selectedPhoto.develop, [control]: value };
		this.developGesture = null;
		if (!this.developHistory.commit({ label: lightEditLabel(control, value), before, after })) {
			this.releaseDevelopPreview();
			return;
		}
		this.refineDevelopSettings(after);
		this.syncHistory();
	};

	undo = () => {
		const settings = this.developHistory.undo();
		if (!settings) return;
		this.developGesture = null;
		this.refineDevelopSettings(settings);
		this.syncHistory();
	};

	redo = () => {
		const settings = this.developHistory.redo();
		if (!settings) return;
		this.developGesture = null;
		this.refineDevelopSettings(settings);
		this.syncHistory();
	};

	settleDevelopRender = (revision: number) => {
		if (this.refinementRevision !== revision) return;
		this.refinementRevision = null;
		this.releaseDevelopPreview();
	};

	renderTile = async (photoId: string, tile: RenderTileRequest) => {
		if (
			!this.workerClient ||
			this.documentStatus.kind !== 'ready' ||
			this.documentStatus.photoId !== photoId
		) {
			throw new Error('Document is not ready for tile rendering');
		}
		return this.workerClient.renderTile(tile);
	};

	loadThumbnail = (photoId: string) => {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo || photo.src) return Promise.resolve();
		const pending = this.thumbnailLoads.get(photoId);
		if (pending) return pending;

		const load = this.restoreThumbnail(photo)
			.catch((error: unknown) => {
				this.storageStatus = 'error';
				this.storageError = error instanceof Error ? error.message : `Unable to load ${photo.name}`;
			})
			.finally(() => this.thumbnailLoads.delete(photoId));
		this.thumbnailLoads.set(photoId, load);
		return load;
	};

	setRating(photoId: string, rating: number) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.rating = photo.rating === rating ? 0 : rating;
		void this.queueCatalogMutation((store) => store.updatePhotoState(this.storedPhoto(photo)));
	}

	toggleFlag(photoId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.flagged = !photo.flagged;
		void this.queueCatalogMutation((store) => store.updatePhotoState(this.storedPhoto(photo)));
	}

	setColorLabel(photoId: string, colorLabel: ColorLabel) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.colorLabel = colorLabel;
		void this.queueCatalogMutation((store) => store.updatePhotoState(this.storedPhoto(photo)));
	}

	toggleCollection(photoId: string, collectionId: string) {
		const collection = this.collections.find((candidate) => candidate.id === collectionId);
		if (!collection || !this.photos.some((photo) => photo.id === photoId)) return;
		collection.photoIds = collection.photoIds.includes(photoId)
			? collection.photoIds.filter((id) => id !== photoId)
			: [...collection.photoIds, photoId];
		collection.updatedAt = Date.now();
		void this.queueCatalogMutation((store) => store.saveCollection(collection));
	}

	createStack = () => {
		const previousStackIds = new Map(this.photos.map((photo) => [photo.id, photo.stackId]));
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
		void this.persistStacks(previousStackIds);
	};

	ungroupStack(stackId: string) {
		const previousStackIds = new Map(this.photos.map((photo) => [photo.id, photo.stackId]));
		for (const photo of this.photos) {
			if (photo.stackId === stackId) photo.stackId = null;
		}
		this.stacks = this.stacks.filter((stack) => stack.id !== stackId);
		void this.persistStacks(previousStackIds);
	}

	toggleStack(stackId: string) {
		const stack = this.stacks.find((candidate) => candidate.id === stackId);
		if (!stack) return;
		stack.collapsed = !stack.collapsed;
		void this.queueCatalogMutation((store) => store.saveStacks(this.stacks, new Map()));
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
		this.releaseDevelopPreview();
		this.removeProgressListener?.();
		this.removeProgressListener = null;
		this.clearFiles();
		this.workerClient?.destroy();
		this.libraryService?.close();
	};

	private resetEditState(develop = defaultDevelopSettings()) {
		this.releaseDevelopPreview();
		this.imageScope = null;
		this.developGesture = null;
		this.developHistory.reset();
		this.masks = [];
		this.selectedMaskId = null;
		this.adjustments = { ...defaultAdjustments, ...lightSettings(develop) };
		this.renderSettings = {
			settings: lightSettings(develop),
			revision: this.renderSettings.revision + 1
		};
		this.syncHistory();
	}

	private async openDocument(photoId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo || this.mode !== 'edit') return;
		this.resetEditState(photo.develop);

		const revision = ++this.documentRevision;
		if (this.documentStatus.kind !== 'idle') {
			this.workerClient?.restart('Document changed');
		}
		this.releaseEditPreview();

		if (!this.workerClient) {
			this.documentStatus = { kind: 'error', photoId, message: 'Image worker is unavailable' };
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
			if (photo.kind === 'display') {
				await this.openDisplayDocument(photo, revision);
				return;
			}
			const frames = await this.documentFrames(photo);
			const cache = await this.libraryService!.renderCacheHandle(photo.id);
			if (revision !== this.documentRevision) return;
			const result = await this.workerClient.openRawDocument(
				frames,
				cache,
				previewDimension(),
				lightSettings(photo.develop)
			);
			if (revision !== this.documentRevision) return;

			this.installOpenedDocument(photoId, result);
		} catch (error) {
			if (revision !== this.documentRevision) return;
			this.documentStatus = {
				kind: 'error',
				photoId,
				message: error instanceof Error ? error.message : 'Unable to open document'
			};
		}
	}

	private async openDisplayDocument(photo: Photo, revision: number) {
		const store = this.libraryService;
		const display = primaryStoredFrame(photo).display;
		if (!store || !display) throw new Error('Display original is unavailable');
		const source = await store.originalHandle(display.storageName);
		if (revision !== this.documentRevision) return;
		const result = await this.workerClient!.openDisplayDocument(
			source,
			previewDimension(),
			lightSettings(photo.develop)
		);
		if (revision !== this.documentRevision) return;
		this.installOpenedDocument(photo.id, result);
	}

	private installOpenedDocument(
		photoId: string,
		result: Awaited<ReturnType<PostframeWorkerClient['openRawDocument']>>
	) {
		const src = URL.createObjectURL(new Blob([result.image], { type: result.mediaType }));
		this.objectUrls.add(src);
		this.editPreview = { src, width: result.width, height: result.height };
		this.imageScope = result.scope;
		this.documentStatus = { kind: 'ready', photoId, boostStops: result.boostStops };
	}

	private async documentFrames(photo: Photo): Promise<RawFrameHandleInput[]> {
		const store = this.libraryService;
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
		this.releaseDevelopPreview();
		const hadDocument = this.documentStatus.kind !== 'idle';
		this.releaseEditPreview();
		this.imageScope = null;
		this.documentStatus = { kind: 'idle' };
		if (hadDocument) this.workerClient?.restart('Document closed');
	}

	private releaseEditPreview() {
		if (!this.editPreview) return;
		URL.revokeObjectURL(this.editPreview.src);
		this.objectUrls.delete(this.editPreview.src);
		this.editPreview = null;
	}

	private scheduleDevelopPreview(settings: DevelopSettings) {
		this.clearDevelopPreviewTimer();
		this.showDevelopPreview('applying');
		this.developPreviewTimer = setTimeout(() => {
			this.developPreviewTimer = null;
			this.requestDevelopPreview(settings, 'applying');
		}, 40);
	}

	private applyDevelopRender(settings: DevelopSettings) {
		const next = lightSettings(settings);
		if (LIGHT_CONTROL_NAMES.every((name) => this.renderSettings.settings[name] === next[name]))
			return;
		this.renderSettings = { settings: next, revision: this.renderSettings.revision + 1 };
	}

	private requestDevelopPreview(settings: DevelopSettings, phase: DevelopPreviewPhase) {
		this.clearDevelopPreviewTimer();
		if (!this.workerClient || !this.selectedPhoto || !this.canAdjustLight) return;
		const photoId = this.selectedPhoto.id;
		const revision = ++this.developPreviewRevision;
		this.showDevelopPreview(phase);
		void this.workerClient
			.preview(lightSettings(settings), true)
			.then((preview) => {
				if (revision !== this.developPreviewRevision || this.selectedPhoto?.id !== photoId) return;
				const src = URL.createObjectURL(new Blob([preview.image], { type: preview.mediaType }));
				this.replaceDevelopPreviewUrl(src);
				this.developPreview = { photoId, src, phase: this.developPreview?.phase ?? phase };
				this.scheduleDevelopScope(lightSettings(settings), photoId, phase === 'refining');
			})
			.catch(() => {
				if (revision === this.developPreviewRevision && this.refinementRevision === null) {
					this.releaseDevelopPreview();
				}
			});
	}

	private showDevelopPreview(phase: DevelopPreviewPhase) {
		if (!this.selectedPhoto) return;
		this.developPreview = {
			photoId: this.selectedPhoto.id,
			src: this.developPreviewUrl,
			phase
		};
	}

	private replaceDevelopPreviewUrl(src: string) {
		if (this.developPreviewUrl) {
			URL.revokeObjectURL(this.developPreviewUrl);
			this.objectUrls.delete(this.developPreviewUrl);
		}
		this.developPreviewUrl = src;
		this.objectUrls.add(src);
	}

	private releaseDevelopPreview() {
		this.clearDevelopPreviewTimer();
		this.clearDevelopScopeTimer();
		this.developPreviewRevision += 1;
		this.developScopeRevision += 1;
		this.refinementRevision = null;
		if (this.developPreviewUrl) {
			URL.revokeObjectURL(this.developPreviewUrl);
			this.objectUrls.delete(this.developPreviewUrl);
		}
		this.developPreviewUrl = null;
		this.developPreview = null;
	}

	private clearDevelopPreviewTimer() {
		if (this.developPreviewTimer === null) return;
		clearTimeout(this.developPreviewTimer);
		this.developPreviewTimer = null;
	}

	private scheduleDevelopScope(settings: LightSettings, photoId: string, committed: boolean) {
		this.clearDevelopScopeTimer();
		const revision = ++this.developScopeRevision;
		const elapsed = Date.now() - this.lastDevelopScopeAt;
		const delay = committed ? 0 : Math.max(0, INTERACTIVE_SCOPE_INTERVAL_MS - elapsed);
		this.developScopeTimer = setTimeout(() => {
			this.developScopeTimer = null;
			this.lastDevelopScopeAt = Date.now();
			void this.workerClient
				?.scope(
					settings,
					true,
					committed ? COMMITTED_SCOPE_SAMPLE_TARGET : INTERACTIVE_SCOPE_SAMPLE_TARGET
				)
				.then((scope) => {
					if (revision !== this.developScopeRevision || this.selectedPhoto?.id !== photoId) return;
					this.imageScope = scope;
				})
				.catch(() => {});
		}, delay);
	}

	private clearDevelopScopeTimer() {
		if (this.developScopeTimer === null) return;
		clearTimeout(this.developScopeTimer);
		this.developScopeTimer = null;
	}

	private applyDevelopSettings(settings: DevelopSettings) {
		if (!this.selectedPhoto) return;
		for (const control of LIGHT_CONTROL_NAMES) this.adjustments[control] = settings[control];
		this.applyDevelopRender(settings);
		this.selectedPhoto.develop = { ...settings };
		const photoId = this.selectedPhoto.id;
		void this.queueCatalogMutation((store) => store.saveDevelopSettings(photoId, settings));
	}

	private refineDevelopSettings(settings: DevelopSettings) {
		this.requestDevelopPreview(settings, 'refining');
		this.applyDevelopSettings(settings);
		this.refinementRevision = this.renderSettings.revision;
	}

	private syncHistory() {
		this.history = ['imported', ...this.developHistory.labels];
		this.canUndo = this.developHistory.canUndo;
		this.canRedo = this.developHistory.canRedo;
	}

	private clearFiles() {
		this.releaseDevelopPreview();
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls.clear();
		this.thumbnailLoads.clear();
		this.editPreview = null;
	}

	private async photosFromFiles(files: File[]) {
		const grouping = groupPhotoFiles(files, this.rawExtensions);
		const imported: PhotoImport[] = [];
		const contentHashes = new Map<string, string>();
		if (grouping.rejectedFiles[0]) {
			this.ingestError = `${grouping.rejectedFiles[0].name}: unsupported photo format`;
		}
		for (const [assetKey, file] of grouping.filesByAssetKey) {
			contentHashes.set(assetKey, await fileContentHash(file));
		}

		for (const group of grouping.groups) {
			try {
				imported.push(await this.photoFromGroup(group, grouping.filesByAssetKey, contentHashes));
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
		filesByAssetKey: ReadonlyMap<string, File>,
		contentHashes: ReadonlyMap<string, string>
	): Promise<PhotoImport> {
		const importedFrames = groupedFrames(group).map(({ photo, filenameExposureHint }) =>
			this.importFrame(photo, filenameExposureHint, filesByAssetKey, contentHashes)
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
		let displayDimensions: { width: number; height: number } | null = null;

		if (selectedFrame.displayFile) {
			const thumbnail = await createDisplayThumbnail(selectedFrame.displayFile);
			src = URL.createObjectURL(thumbnail.blob);
			displayDimensions = { width: thumbnail.width, height: thumbnail.height };
			thumbnailStorageName = `${photoId}.jpg`;
			thumbnails.push({ storageName: thumbnailStorageName, blob: thumbnail.blob });
		} else if (inspection) {
			const blob = new Blob([inspection.thumbnailJpeg], { type: 'image/jpeg' });
			src = URL.createObjectURL(blob);
			thumbnailStorageName = `${photoId}.jpg`;
			thumbnails.push({ storageName: thumbnailStorageName, blob });
		}
		if (src) this.objectUrls.add(src);

		const dimensions = inspection?.metadata ?? displayDimensions;
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
			stackId: null,
			develop: defaultDevelopSettings()
		} satisfies Photo;

		return {
			photo,
			originals: importedFrames.flatMap(({ originals }) => originals),
			thumbnails
		};
	}

	private async restorePhoto(photo: StoredPhoto): Promise<Photo> {
		const metadata = photo.metadata ? { ...photo.metadata } : null;
		const frame = primaryStoredFrame(photo);

		const selectedAsset = frame.display ?? frame.raw;
		if (!selectedAsset) throw new Error(`Photo ${photo.name} has no source`);

		return {
			id: photo.id,
			name: photo.name,
			extension: groupLabel(photo.kind, frame, photo.frames.length),
			src: null,
			kind: photo.kind,
			frames: cloneFrames(photo.frames),
			bracketDetection: photo.bracketDetection,
			thumbnailStorageName: photo.thumbnailStorageName,
			metadata,
			size: photo.frames
				.flatMap((candidate) => [candidate.raw, candidate.display])
				.filter((asset): asset is StoredAsset => asset !== null)
				.reduce((total, asset) => total + asset.source.size, 0),
			width: photo.width,
			height: photo.height,
			captured: captureLabel(metadata?.capturedAt, selectedAsset.source.lastModified),
			importedAt: photo.importedAt,
			rating: photo.rating,
			flagged: photo.flagged,
			rejected: photo.rejected,
			colorLabel: photo.colorLabel,
			stackId: photo.stackId,
			develop: await this.libraryService!.loadDevelopSettings(photo.id)
		};
	}

	private async restoreThumbnail(photo: Photo) {
		const store = this.libraryService;
		if (!store) return;
		await this.persistence;
		let file: Blob;
		if (photo.thumbnailStorageName) {
			file = await store.readThumbnail(photo.thumbnailStorageName);
		} else {
			const display = primaryStoredFrame(photo).display;
			if (!display) return;
			file = await store.readOriginal(display.storageName);
		}
		if (photo.src || !this.photos.some((candidate) => candidate.id === photo.id)) return;
		const src = URL.createObjectURL(file);
		this.objectUrls.add(src);
		photo.src = src;
	}

	private importFrame(
		frame: GroupedPhotoFrame,
		filenameExposureHint: number | null,
		filesByAssetKey: ReadonlyMap<string, File>,
		contentHashes: ReadonlyMap<string, string>
	): FrameImport {
		const raw = frame.kind === 'raw' || frame.kind === 'raw-pair' ? frame.raw : null;
		const display = frame.kind === 'display' || frame.kind === 'raw-pair' ? frame.display : null;
		const rawImport = raw ? importedAsset(raw, filesByAssetKey, contentHashes) : null;
		const displayImport = display ? importedAsset(display, filesByAssetKey, contentHashes) : null;

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
		const store = this.libraryService;
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

	private async persistImports(
		imports: readonly PhotoImport[],
		collection: PhotoCollection | null = null
	): Promise<{ photos: Photo[]; photoIds: string[]; collection: PhotoCollection | null } | null> {
		const store = this.libraryService;
		if (!store) {
			this.storageStatus = 'memory';
			return {
				photos: imports.map(({ photo }) => photo),
				photoIds: imports.map(({ photo }) => photo.id),
				collection
			};
		}

		const importedById = new Map(imports.map((entry) => [entry.photo.id, entry]));
		const revision = ++this.persistenceRevision;
		this.storageStatus = 'saving';
		this.storageError = null;
		const transaction = this.persistence.then(() =>
			store.importPhotos(
				this.libraryCreatedAt,
				imports.map(({ photo }) => this.storedPhoto(photo)),
				imports.flatMap(({ originals }) => originals),
				imports.flatMap(({ thumbnails }) => thumbnails),
				collection
			)
		);
		this.persistence = transaction.then(
			() => {
				if (revision === this.persistenceRevision) this.storageStatus = 'saved';
			},
			(error: unknown) => {
				if (revision !== this.persistenceRevision) return;
				this.storageStatus = 'error';
				this.storageError = error instanceof Error ? error.message : 'Unable to import photos';
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

	private persistStacks(previousStackIds: ReadonlyMap<string, string | null>) {
		const changed = new Map<string, string | null>();
		for (const photo of this.photos) {
			if (previousStackIds.get(photo.id) !== photo.stackId) changed.set(photo.id, photo.stackId);
		}
		return this.queueCatalogMutation((store) => store.saveStacks(this.stacks, changed));
	}

	private async queueCatalogMutation(
		operation: (store: LibraryService) => Promise<unknown>
	): Promise<boolean> {
		const store = this.libraryService;
		if (!store) {
			this.storageStatus = 'memory';
			return true;
		}

		const revision = ++this.persistenceRevision;
		this.storageStatus = 'saving';
		this.storageError = null;
		const mutation = this.persistence.then(() => operation(store));
		this.persistence = mutation.then(
			() => {
				if (revision === this.persistenceRevision) this.storageStatus = 'saved';
			},
			(error: unknown) => {
				if (revision !== this.persistenceRevision) return;
				this.storageStatus = 'error';
				this.storageError = error instanceof Error ? error.message : 'Unable to save changes';
			}
		);
		try {
			await mutation;
			return true;
		} catch {
			return false;
		}
	}

	private discardImport({ photo }: PhotoImport) {
		if (!photo.src) return;
		URL.revokeObjectURL(photo.src);
		this.objectUrls.delete(photo.src);
		photo.src = null;
	}

	private async ensureCapabilities() {
		if (this.capabilitiesReady) return;
		this.capabilityLoading ??= this.loadCapabilities();
		await this.capabilityLoading;
	}

	private async initialize() {
		await Promise.all([
			this.ensureCapabilities(),
			this.refreshBrowserStorage().catch(() => undefined),
			this.resumePendingDeletions()
		]);
		await this.loadLibrary();
		if (this.photos.length > 0) this.mode = 'organize';
		this.startupReady = true;
	}

	private async resumePendingDeletions() {
		const store = this.libraryService;
		if (!store) return;
		try {
			const result = await store.resumePendingDeletions();
			if (result.deletedFiles > 0 || result.failedFiles > 0) this.storageCleanupResult = result;
		} catch (error) {
			this.storageStatus = 'error';
			this.storageError =
				error instanceof Error ? error.message : 'Unable to finish storage cleanup';
		}
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
	filesByAssetKey: ReadonlyMap<string, File>,
	contentHashes: ReadonlyMap<string, string>
): { asset: StoredAsset; original: OriginalWrite; file: File } {
	const file = filesByAssetKey.get(asset.key);
	if (!file) throw new Error(`${asset.name} is unavailable`);
	const contentHash = contentHashes.get(asset.key);
	if (!contentHash) throw new Error(`${asset.name} has no content identity`);
	const assetId = id('asset');
	const stored = {
		id: assetId,
		storageName: `${assetId}.${asset.source.format}`,
		name: asset.name,
		contentHash,
		source: { ...asset.source }
	} satisfies StoredAsset;
	return { asset: stored, original: { storageName: stored.storageName, file }, file };
}

async function fileContentHash(file: File) {
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

async function createDisplayThumbnail(file: File) {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		const longestSide = Math.max(bitmap.width, bitmap.height);
		const scale = Math.min(1, 640 / longestSide);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Unable to create thumbnail canvas');
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('Unable to encode thumbnail'))),
				'image/jpeg',
				0.84
			)
		);
		return { blob, width: bitmap.width, height: bitmap.height };
	} finally {
		bitmap.close();
	}
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

function lightEditLabel(control: LightControlName, value: number) {
	const formatted = control === 'exposure' ? `${value.toFixed(2)} EV` : value.toFixed(0);
	return `${control} ${value > 0 ? '+' : ''}${formatted}`;
}
