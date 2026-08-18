import { acceptedPhotoTypes, normalizedRawExtensions } from './photo-source';
import { LibraryService, type CleanupResult } from './library-service';
import type { PhotoCollection } from './library-schema';
import { PostframeWorkerClient } from './worker-client';
import {
	backgroundTasks as composeBackgroundTasks,
	viewportTask,
	type BackgroundTask,
	type ProgressTask
} from './progress-task';
import type { RenderTileRequest } from './worker';
import type { BrowserStorageStatus } from './browser-storage';
import type { StorageBreakdown } from './storage-breakdown';
import {
	defaultCurveSettings,
	defaultDevelopSettings,
	defaultGradingSettings,
	defaultMixerSettings,
	scalarAdjustments,
	type AdjustmentTarget,
	type DevelopSettings,
	type ColorControlName,
	type CurveChannelName,
	type CurvePoints,
	type LightControlName,
	type ScalarControlName,
	type ScalarGroupName
} from './develop-settings';
import {
	cloneEditDocument,
	createEditMask,
	type EditDocument,
	type EditMask,
	type MaskKind,
	type MaskOperation,
	type NormalizedCrop,
	type NormalizedPoint
} from './edit-document';
import type { MaskBrushStroke } from './mask-rasterizer';
import { exportFileName, type ExportProgress } from './export';
import type { EditorCommand } from './editor-command';
import type { ImageScopeData } from './image-scope';
import type { MaskEdgeStroke } from './smart-mask';
import type { MaskEdgeControlName } from './mask-edge-settings';
import { AdjustmentControls, type AdjustmentChange } from './adjustment-controls';
import { AutoAdjustments } from './auto-adjustments';
import { noClipping, type ClippingIndicators, type ClippingKind } from './clipping';
import { DevelopPreviewController, type DevelopPreviewPhase } from './develop-preview';
import { DocumentSession, type DocumentStatus } from './document-session';
import { EditorSession } from './editor-session';
import { entityId } from './entity-id';
import { MaskPainting, type GradientComponent } from './mask-painting';
import { MaskRasterPipeline, type SelectedMaskRaster } from './mask-raster-pipeline';
import { ObjectUrlRegistry } from './object-url-registry';
import { PhotoIngest } from './photo-ingest';
import { PhotoOrganizer } from './photo-organizer';
import type { ColorLabel, Photo, PhotoStack } from './photo-record';
import { SmartMasking, type SmartMaskStatus, type SubjectChoices } from './smart-masking';
import { StorageObserver } from './storage-observer';
import { StorageOverview } from './storage-overview';
import { ThumbnailLoader } from './thumbnail-loader';
import { WorkspacePersistence, type StorageStatus } from './workspace-persistence';

export type WorkspaceMode = 'welcome' | 'organize' | 'edit';
export type { ColorLabel, Photo, PhotoStack } from './photo-record';
export type { PhotoCollection } from './library-schema';
export type { MaskKind } from './edit-document';
export type { StorageStatus } from './workspace-persistence';
export type { DevelopPreviewPhase } from './develop-preview';
export type { SmartMaskStatus, SubjectChoices } from './smart-masking';
export type { SelectedMaskRaster } from './mask-raster-pipeline';
export type { DocumentStatus } from './document-session';

export type Mask = EditMask;

export class WorkspaceState {
	private readonly libraryService = LibraryService.supported() ? new LibraryService() : null;
	private readonly workerClient =
		typeof Worker === 'undefined' ? null : new PostframeWorkerClient();
	private readonly rawExtensions = new Set<string>();
	private capabilityLoading: Promise<void> | null = null;
	private readonly objectUrls = new ObjectUrlRegistry();
	private readonly ingest: PhotoIngest;
	private readonly persistence: WorkspacePersistence;
	private readonly storage: StorageOverview;
	private readonly storageObserver: StorageObserver;
	private stopStorageObserving = () => {};
	private readonly thumbnails: ThumbnailLoader;
	private readonly develop: DevelopPreviewController;
	private readonly pipeline: MaskRasterPipeline;
	private readonly smartMasks: SmartMasking;
	private readonly painting: MaskPainting;
	private readonly controls: AdjustmentControls;
	private readonly auto: AutoAdjustments;
	private readonly editor: EditorSession;
	private readonly session: DocumentSession;
	private readonly organizer: PhotoOrganizer;

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
	browserStorageBreakdown = $state<StorageBreakdown | null>(null);
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
	clipping = $state<ClippingIndicators>(noClipping());
	smartMaskStatus = $state<SmartMaskStatus>({
		phase: 'idle',
		progress: null,
		detail: '',
		error: null
	});
	modelPreloadStatus = $state<SmartMaskStatus>({
		phase: 'idle',
		progress: null,
		detail: '',
		error: null
	});
	selectedMaskRaster = $state<SelectedMaskRaster | null>(null);
	subjectChoices = $state<SubjectChoices | null>(null);
	adjustments = $state(scalarAdjustments(defaultDevelopSettings()));
	curve = $state(defaultCurveSettings());
	mixer = $state(defaultMixerSettings());
	grading = $state(defaultGradingSettings());
	renderSettings = $state<{
		adjustments: DevelopSettings;
		crop: NormalizedCrop | null;
		revision: number;
	}>({ adjustments: defaultDevelopSettings(), crop: null, revision: 0 });
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
	viewportProgress: ProgressTask | null = $derived(
		viewportTask(this.developPreview, this.selectedPhoto?.id ?? null)
	);
	backgroundTasks: BackgroundTask[] = $derived(
		composeBackgroundTasks(this.documentStatus, this.smartMaskStatus, this.modelPreloadStatus)
	);
	canAdjustLight = $derived(
		this.selectedPhoto !== null &&
			this.documentStatus.kind === 'ready' &&
			this.documentStatus.photoId === this.selectedPhoto.id
	);

	constructor() {
		const host = this.collaboratorHost();
		this.ingest = new PhotoIngest(this.workerClient, this.rawExtensions, this.objectUrls, host);
		this.persistence = new WorkspacePersistence(this.libraryService, this.objectUrls, host);
		this.storage = new StorageOverview(this.libraryService, host);
		this.storageObserver = new StorageObserver(() => this.storage.refresh());
		this.stopStorageObserving = this.observeStorageWrites();
		this.thumbnails = new ThumbnailLoader(
			this.libraryService,
			this.persistence,
			this.objectUrls,
			host
		);
		this.develop = new DevelopPreviewController(this.workerClient, this.objectUrls, host);
		this.pipeline = new MaskRasterPipeline(this.libraryService, this.workerClient, host);
		this.smartMasks = new SmartMasking(this.pipeline, host);
		this.painting = new MaskPainting(this.pipeline, this.smartMasks, host);
		this.controls = new AdjustmentControls(this.develop, this.pipeline, host);
		this.auto = new AutoAdjustments(this.workerClient, this.controls, host);
		this.editor = new EditorSession(this.develop, this.pipeline, this.persistence, host);
		this.session = new DocumentSession(
			this.libraryService,
			this.workerClient,
			this.persistence,
			this.objectUrls,
			this.pipeline,
			this.develop,
			this.smartMasks,
			host
		);
		this.organizer = new PhotoOrganizer(this.persistence, this.thumbnails, this.objectUrls, host);
		void this.initialize();
	}

	private collaboratorHost() {
		return Object.assign(
			stateAccessors(this, [
				'photos',
				'collections',
				'stacks',
				'selectedIds',
				'activePhotoId',
				'mode',
				'selectedPhoto',
				'canAdjustLight',
				'adjustments',
				'curve',
				'mixer',
				'grading',
				'masks',
				'selectedMaskId',
				'documentStatus',
				'editPreview',
				'imageScope',
				'selectedMaskRaster',
				'subjectChoices',
				'smartMaskStatus',
				'modelPreloadStatus',
				'developPreview',
				'renderSettings',
				'history',
				'canUndo',
				'canRedo',
				'storageStatus',
				'storageError',
				'libraryReady',
				'libraryError',
				'browserStorageStatus',
				'browserStorageBreakdown',
				'browserStorageError'
			] as const),
			{
				maskStorageAvailable: this.libraryService !== null,
				reportError: (message: string) => {
					this.ingestError = message;
				},
				clearFiles: () => this.clearFiles(),
				storageWritten: () => this.storageObserver.wrote(),
				resetEditState: (document: EditDocument) => this.editor.resetEditState(document),
				dispatchEditorCommand: (command: EditorCommand) => this.editor.dispatch(command),
				selectMask: (maskId: string | null) => this.selectMask(maskId),
				markRefining: (revision: number) => this.develop.markRefining(revision),
				failSmartMask: (error: unknown) => this.smartMasks.fail(error),
				cancelDocument: () => this.cancelDocument(),
				openDocument: (photoId: string) => {
					void this.session.open(photoId);
				},
				enterOrganizeMode: () => this.setMode('organize')
			}
		);
	}

	openSingle = async (file: File) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const imported = (await this.ingest.photosFromFiles([file]))[0];
		if (!imported) return;
		const committed = await this.persistence.commitImports([imported]);
		if (!committed) return;
		this.photos.push(...committed.photos);
		const photoId = committed.photoIds[0];
		if (!photoId) return;
		this.selectPhoto(photoId);
		this.mode = 'edit';
		await this.session.open(photoId);
	};

	createCollection = async (name: string, files: File[]) => {
		await this.ensureCapabilities();
		this.ingestError = null;
		const trimmed = name.trim();
		if (!trimmed) return;
		const imported = await this.ingest.photosFromFiles(files);
		const importedPhotos = imported.map(({ photo }) => photo);
		const now = Date.now();
		const collection = {
			id: entityId('collection'),
			name: trimmed,
			createdAt: now,
			updatedAt: now,
			photoIds:
				importedPhotos.length > 0
					? importedPhotos.map((photo) => photo.id)
					: this.selectedIds.filter((photoId) => this.photos.some((photo) => photo.id === photoId))
		} satisfies PhotoCollection;
		const committed = await this.persistence.commitImports(imported, collection);
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
		const imported = await this.ingest.photosFromFiles(files);
		const committed = await this.persistence.commitImports(imported);
		if (!committed) return;
		this.photos.push(...committed.photos);
		if (!this.activePhotoId && committed.photoIds[0]) this.selectPhoto(committed.photoIds[0]);
	};

	async save() {
		await this.persistence.whenIdle();
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
		if (!this.libraryService) return;
		this.libraryError = null;
		try {
			await this.persistence.clearAll(() => {
				this.session.close();
				this.clearFiles();
			});
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
			this.editor.resetEditState();
			await this.refreshBrowserStorage();
		} catch (error) {
			this.libraryError = error instanceof Error ? error.message : 'Unable to clear local data';
			throw error;
		}
	};

	refreshBrowserStorage = () => this.storage.refresh();

	// Writes reach storage from three places: the persistence queue, imports,
	// and the worker's own render cache. All three end at the observer, and a
	// tab coming back into view re-measures in case another tab wrote.
	private observeStorageWrites() {
		const stopWorker = this.workerClient?.onStorageWritten(() => this.storageObserver.wrote());
		if (typeof document === 'undefined') return () => stopWorker?.();
		const onVisible = () => {
			if (document.visibilityState === 'visible') this.storageObserver.wrote();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stopWorker?.();
			document.removeEventListener('visibilitychange', onVisible);
		};
	}

	cleanupLocalData = async () => {
		const store = this.libraryService;
		if (!store) return;
		await this.persistence.whenIdle();
		this.storageCleanupResult = await store.cleanup();
		this.editor.resetHistory();
		await this.refreshBrowserStorage();
	};

	requestPersistentStorage = () => this.storage.requestPersistence();

	setMode(mode: Exclude<WorkspaceMode, 'welcome'>) {
		if (mode === 'edit' && this.photos.length === 0) return;
		this.mode = mode;
		if (mode === 'edit' && this.activePhotoId) void this.session.open(this.activePhotoId);
		else this.session.close();
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
		if (this.mode === 'edit' && !additive) void this.session.open(photoId);
	}

	editPhoto(photoId: string) {
		this.mode = 'edit';
		this.selectPhoto(photoId);
	}

	reloadDocument = () => {
		if (this.activePhotoId) void this.session.open(this.activePhotoId);
	};

	cancelDocument = () => this.session.cancel();

	previewAdjustment = <Group extends ScalarGroupName>(
		group: Group,
		control: ScalarControlName<Group>,
		value: number
	) => this.controls.previewAdjustment(group, control, value);

	commitAdjustment = <Group extends ScalarGroupName>(
		group: Group,
		control: ScalarControlName<Group>,
		value: number
	) => this.controls.commitAdjustment(group, control, value);

	previewCurve = (channel: CurveChannelName, points: CurvePoints) =>
		this.controls.previewCurve(channel, points);

	commitCurve = (channel: CurveChannelName, points: CurvePoints) =>
		this.controls.commitCurve(channel, points);

	previewAdjustmentAt = (target: AdjustmentTarget, value: number) =>
		this.controls.previewAdjustmentAt(target, value);

	commitAdjustmentAt = (target: AdjustmentTarget, value: number) =>
		this.controls.commitAdjustmentAt(target, value);

	previewAdjustmentsAt = (changes: readonly AdjustmentChange[]) =>
		this.controls.previewAdjustmentsAt(changes);

	commitAdjustmentsAt = (changes: readonly AdjustmentChange[]) =>
		this.controls.commitAdjustmentsAt(changes);

	commitAdjustments = (adjustments: DevelopSettings, label: string) =>
		this.controls.commitAdjustments(adjustments, label);

	autoWhiteBalance = () => this.auto.whiteBalance();

	sampleWhiteBalance = (point: NormalizedPoint) => this.auto.sampleWhiteBalance(point);

	autoTone = () => this.auto.tone();

	previewLight = (control: LightControlName, value: number) =>
		this.controls.previewLight(control, value);

	commitLight = (control: LightControlName, value: number) =>
		this.controls.commitLight(control, value);

	previewColor = (control: ColorControlName, value: number) =>
		this.controls.previewColor(control, value);

	commitColor = (control: ColorControlName, value: number) =>
		this.controls.commitColor(control, value);

	previewMaskLight = (control: LightControlName, value: number) =>
		this.controls.previewMaskLight(control, value);

	commitMaskLight = (control: LightControlName, value: number) =>
		this.controls.commitMaskLight(control, value);

	previewMaskColor = (control: ColorControlName, value: number) =>
		this.controls.previewMaskColor(control, value);

	commitMaskColor = (control: ColorControlName, value: number) =>
		this.controls.commitMaskColor(control, value);

	previewMaskEdge = (control: MaskEdgeControlName, value: number) =>
		this.controls.previewMaskEdge(control, value);

	commitMaskEdge = (control: MaskEdgeControlName, value: number) =>
		this.controls.commitMaskEdge(control, value);

	undo = () => this.editor.undo();

	redo = () => this.editor.redo();

	settleDevelopRender = (revision: number) => this.develop.settle(revision);

	// The indicators are a view over the tiles, so flipping one re-requests
	// every tile without touching the document.
	toggleClipping = (kind?: ClippingKind) => {
		const both = this.clipping.highlights && this.clipping.shadows;
		this.clipping = kind
			? { ...this.clipping, [kind]: !this.clipping[kind] }
			: { highlights: !both, shadows: !both };
		this.renderSettings = {
			adjustments: this.renderSettings.adjustments,
			crop: this.renderSettings.crop,
			revision: this.renderSettings.revision + 1
		};
	};

	exportPhoto = async (
		options: { quality: number },
		onProgress?: (progress: ExportProgress) => void
	): Promise<{ jpeg: ArrayBuffer; fileName: string }> => {
		const photo = this.selectedPhoto;
		if (!photo || !this.workerClient || !this.canAdjustLight) {
			throw new Error('Open the photograph in the edit view before exporting');
		}
		const edit = cloneEditDocument(photo.edit);
		const jpeg = await this.workerClient.exportPhoto(
			{
				adjustments: edit.adjustments,
				masks: await this.pipeline.renderMasks(edit),
				geometry: edit.geometry,
				quality: options.quality
			},
			onProgress
		);
		return { jpeg, fileName: exportFileName(photo.name) };
	};

	renderTile = async (photoId: string, tile: RenderTileRequest, signal: AbortSignal) => {
		if (
			!this.workerClient ||
			this.documentStatus.kind !== 'ready' ||
			this.documentStatus.photoId !== photoId
		) {
			throw new Error('Document is not ready for tile rendering');
		}
		return this.workerClient.renderTile(tile, signal);
	};

	loadThumbnail = (photoId: string) => this.thumbnails.load(photoId);

	setRating(photoId: string, rating: number) {
		this.organizer.setRating(photoId, rating);
	}

	applyRating(photoIds: readonly string[], rating: number) {
		this.organizer.applyRating(photoIds, rating);
	}

	toggleFlag(photoId: string) {
		this.organizer.toggleFlag(photoId);
	}

	applyFlag(photoIds: readonly string[], flagged: boolean) {
		this.organizer.applyFlag(photoIds, flagged);
	}

	setColorLabel(photoId: string, colorLabel: ColorLabel) {
		this.organizer.setColorLabel(photoId, colorLabel);
	}

	applyColorLabel(photoIds: readonly string[], colorLabel: ColorLabel) {
		this.organizer.applyColorLabel(photoIds, colorLabel);
	}

	toggleCollection(photoId: string, collectionId: string) {
		this.organizer.toggleCollection(photoId, collectionId);
	}

	applyCollectionMembership(photoIds: readonly string[], collectionId: string, member: boolean) {
		this.organizer.applyCollectionMembership(photoIds, collectionId, member);
	}

	deletePhotos(photoIds: readonly string[]) {
		this.organizer.deletePhotos(photoIds);
	}

	createStack = () => this.organizer.createStack();

	ungroupStack(stackId: string) {
		this.organizer.ungroupStack(stackId);
	}

	toggleStack(stackId: string) {
		this.organizer.toggleStack(stackId);
	}

	createMask(kind: MaskKind) {
		if (kind === 'subject') {
			void this.smartMasks.beginSubjectMasks();
			return;
		}
		if (kind === 'background' || kind === 'sky') {
			void this.smartMasks.createSemanticMask(kind);
			return;
		}
		const mask = createEditMask(entityId('mask'), kind);
		if (this.editor.dispatch({ type: 'mask.create', mask })) {
			this.selectMask(mask.id);
		}
	}

	selectMask = (maskId: string | null) => {
		this.selectedMaskId = maskId;
		void this.pipeline.refreshSelectedMaskRaster();
	};

	paintObjectMask = (
		points: NormalizedPoint[],
		label: 'foreground' | 'background' = 'foreground'
	) => this.smartMasks.paintObjectMask(points, label);

	cycleObjectMaskCandidate = (direction: -1 | 1) =>
		this.smartMasks.cycleObjectMaskCandidate(direction);

	cycleInstanceMaskCandidate = (direction: -1 | 1) =>
		this.smartMasks.cycleInstanceMaskCandidate(direction);

	refineMaskEdge = (stroke: MaskEdgeStroke) => this.smartMasks.refineMaskEdge(stroke);

	paintBrushMask = (stroke: MaskBrushStroke, operation: MaskOperation = 'add') =>
		this.painting.paintBrushMask(stroke, operation);

	placeGradientComponent = (component: GradientComponent) =>
		this.painting.placeGradientComponent(component);

	chooseDetectedSubject = (index: number) => this.smartMasks.chooseDetectedSubject(index);

	chooseAllSubjects = () => {
		this.subjectChoices = null;
		void this.smartMasks.createSemanticMask('subject');
	};

	dismissSubjectChoices = () => {
		this.subjectChoices = null;
	};

	preloadSmartMaskModels = () => this.smartMasks.preloadModels();

	toggleMask(maskId: string) {
		const mask = this.masks.find((candidate) => candidate.id === maskId);
		if (mask) {
			this.editor.dispatch({
				type: 'mask.visibility',
				maskId,
				visible: !mask.visible
			});
		}
	}

	deleteMask(maskId: string) {
		if (this.editor.dispatch({ type: 'mask.delete', maskId })) {
			this.selectMask(this.masks.at(-1)?.id ?? null);
		}
	}

	reset = () => {
		this.session.close();
		this.mode = 'welcome';
		this.collectionDialogOpen = false;
	};

	destroy = () => {
		this.stopStorageObserving();
		this.storageObserver.stop();
		this.session.invalidate();
		this.pipeline.clearMaskRenderTimer();
		this.develop.release();
		this.session.stopProgressTracking();
		this.smartMasks.stopProgressTracking();
		this.clearFiles();
		this.workerClient?.destroy();
		this.smartMasks.destroyClient();
		this.libraryService?.close();
	};

	private clearFiles() {
		this.develop.release();
		this.objectUrls.revokeAll();
		this.thumbnails.clear();
		this.pipeline.clearCaches();
		this.editPreview = null;
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
		await this.persistence.loadLibrary();
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
}

function stateAccessors<T extends object, K extends keyof T>(source: T, keys: readonly K[]) {
	const accessors = {} as Pick<T, K>;
	for (const key of keys) defineStateAccessor(accessors, source, key);
	return accessors;
}

function defineStateAccessor<T extends object, K extends keyof T>(
	target: Pick<T, K>,
	source: T,
	key: K
) {
	Object.defineProperty(target, key, {
		get: () => source[key],
		set: (value: T[K]) => {
			source[key] = value;
		}
	});
}

export { formatBytes } from './format-bytes';
