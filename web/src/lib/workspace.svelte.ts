import { acceptedPhotoTypes, normalizedRawExtensions } from './photo-source';
import type { CleanupResult } from './library-backend';
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
	cloneDevelopSettings,
	defaultCurveSettings,
	defaultDevelopSettings,
	defaultGradingSettings,
	defaultMixerSettings,
	sameDevelopSettings,
	scalarAdjustments,
	type AdjustmentTarget,
	type DevelopGroupName,
	type DevelopSettings,
	type CurveChannelName,
	type CurvePoints,
	type MaskAdjustmentTarget,
	type ScalarControlName,
	type ScalarGroupName
} from './develop-settings';
import { globalDevelopBinding, maskDevelopBinding, type DevelopBinding } from './develop-binding';
import {
	cloneEditDocument,
	createEditMask,
	FULL_CAMERA_LOOK,
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
import {
	AdjustmentControls,
	type AdjustmentChange,
	type MaskAdjustmentChange
} from './adjustment-controls';
import { AutoAdjustments } from './auto-adjustments';
import { noClipping, type ClippingIndicators, type ClippingKind } from './clipping';
import { DevelopComparison } from './develop-comparison.ts';
import { DevelopPreviewController, type DevelopPreviewPhase } from './develop-preview';
import { DocumentSession, type DocumentStatus } from './document-session';
import { EditorSession } from './editor-session';
import { entityId } from './entity-id';
import { MaskPainting, type GradientComponent } from './mask-painting';
import { MaskRanging, type RangeKind, type RangeSettings } from './mask-ranging';
import { MaskRasterPipeline, type SelectedMaskRaster } from './mask-raster-pipeline';
import { ObjectUrlRegistry } from './object-url-registry';
import { PhotoIngest } from './photo-ingest';
import { PhotoOrganizer } from './photo-organizer';
import type { ColorLabel, Photo, PhotoStack } from './photo-record';
import { applyGroups, changedGroups, savedPreset, type Preset } from './preset';
import { copiedSettings, type SettingsClipboard } from './settings-clipboard';
import { SmartMasking, type SmartMaskStatus, type SubjectChoices } from './smart-masking';
import { StorageObserver } from './storage-observer';
import { StorageOverview } from './storage-overview';
import { ThumbnailLoader } from './thumbnail-loader';
import {
	applyCameraMatchSettings,
	cameraMatchPreferenceSchema,
	cameraMatchResultSchema,
	type CameraMatchCandidate,
	type CameraMatchPreference,
	type CameraMatchResult,
	type CameraMatchTarget
} from './camera-match.ts';
import { createPlatformServices } from './platform-services.ts';
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
export type { Preset } from './preset';
export type { SettingsClipboard } from './settings-clipboard';

export type Mask = EditMask;

export class WorkspaceState {
	private readonly platform = createPlatformServices();
	private readonly libraryService = this.platform.library;
	private readonly managedLibrary = this.platform.managedLibrary;
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
	private readonly comparison: DevelopComparison;
	private readonly pipeline: MaskRasterPipeline;
	private readonly smartMasks: SmartMasking;
	private readonly painting: MaskPainting;
	private readonly ranging: MaskRanging;
	private readonly controls: AdjustmentControls;
	private readonly auto: AutoAdjustments;
	private readonly editor: EditorSession;
	private readonly session: DocumentSession;
	private readonly organizer: PhotoOrganizer;
	private cameraMatchCandidateId = 0;

	mode = $state<WorkspaceMode>('welcome');
	photos = $state<Photo[]>([]);
	collections = $state<PhotoCollection[]>([]);
	stacks = $state<PhotoStack[]>([]);
	presets = $state<Preset[]>([]);
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
	desktop = this.platform.kind === 'desktop';
	desktopLibraryRequired = $state(false);
	desktopLibraryPath = $state<string | null>(null);
	localStorageAvailable = this.libraryService !== null;
	storageStatus = $state<StorageStatus>(this.libraryService ? 'saved' : 'memory');
	storageError = $state<string | null>(null);
	importing = $state(false);
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
	settingsClipboard = $state<SettingsClipboard | null>(null);
	comparingOriginal = $state(false);
	renderSettings = $state<{
		adjustments: DevelopSettings;
		crop: NormalizedCrop | null;
		revision: number;
	}>({ adjustments: defaultDevelopSettings(), crop: null, revision: 0 });
	history = $state<string[]>(['imported']);
	canUndo = $state(false);
	canRedo = $state(false);
	cameraMatchPreference = $state<CameraMatchPreference>('ask');
	cameraMatchCandidate = $state<CameraMatchCandidate | null>(null);
	cameraMatchPromptOpen = $state(false);

	selectedPhoto = $derived(this.photos.find((photo) => photo.id === this.activePhotoId) ?? null);
	editedGroups = $derived(
		changedGroups(this.selectedPhoto?.edit.adjustments ?? defaultDevelopSettings())
	);
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
	activeDocument = $derived(
		this.selectedPhoto &&
			this.documentStatus.kind !== 'idle' &&
			this.documentStatus.photoId === this.selectedPhoto.id
			? this.documentStatus
			: null
	);
	canAdjustLight = $derived(this.activeDocument?.kind === 'ready');
	syncTargetIds = $derived(this.selectedIds.filter((id) => id !== this.activePhotoId));
	canSync = $derived(this.syncTargetIds.length > 0);
	selectedMask = $derived(this.masks.find((mask) => mask.id === this.selectedMaskId) ?? null);
	globalDevelop: DevelopBinding = globalDevelopBinding(this);
	private readonly maskDevelop: DevelopBinding = maskDevelopBinding(this);
	selectedMaskDevelop: DevelopBinding | null = $derived(
		this.selectedMask ? this.maskDevelop : null
	);

	constructor() {
		const host = this.collaboratorHost();
		this.ingest = new PhotoIngest(this.workerClient, this.rawExtensions, this.objectUrls, host);
		this.persistence = new WorkspacePersistence(
			this.libraryService,
			this.platform.localLibraryReset,
			this.objectUrls,
			host
		);
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
		this.ranging = new MaskRanging(this.workerClient, this.pipeline, host);
		this.comparison = new DevelopComparison(this.pipeline, host);
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
				'presets',
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
				'comparingOriginal',
				'cameraLook',
				'history',
				'canUndo',
				'canRedo',
				'cameraMatchPreference',
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
				resetEditState: (document: EditDocument) => {
					this.clearCameraMatchCandidate();
					this.editor.resetEditState(document);
				},
				dispatchEditorCommand: (command: EditorCommand) => this.editor.dispatch(command),
				selectMask: (maskId: string | null) => this.selectMask(maskId),
				markRefining: (revision: number) => this.develop.markRefining(revision),
				pushCameraLook: (amount: number) => this.pushCameraLook(amount),
				applyCameraMatch: (result: CameraMatchResult, target: CameraMatchTarget) =>
					this.applyCameraMatch(result, target),
				presentCameraMatch: (result: CameraMatchResult, target: CameraMatchTarget) =>
					this.presentCameraMatch(result, target, true),
				startCameraNeutral: () => this.startNeutralCameraMatch(false),
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
		this.importing = true;
		try {
			await this.ensureCapabilities();
			this.ingestError = null;
			const imported = await this.ingest.photosFromFiles(files);
			const committed = await this.persistence.commitImports(imported);
			if (!committed) return;
			this.photos.push(...committed.photos);
			if (!this.activePhotoId && committed.photoIds[0]) this.selectPhoto(committed.photoIds[0]);
		} finally {
			this.importing = false;
		}
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
			this.presets = [];
			this.selectedIds = [];
			this.activePhotoId = null;
			this.mode = 'welcome';
			this.libraryReady = true;
			this.storageStatus = 'saved';
			this.storageError = null;
			this.storageCleanupResult = null;
			this.cameraMatchPreference = 'ask';
			this.clearCameraMatchCandidate();
			this.editor.resetEditState();
			await this.refreshBrowserStorage();
		} catch (error) {
			this.libraryError = error instanceof Error ? error.message : 'Unable to clear local data';
			throw error;
		}
	};

	refreshBrowserStorage = () => this.storage.refresh();

	private observeStorageWrites() {
		const stopWorker = this.workerClient?.onStorageWritten(() => this.storageObserver.wrote());
		if (typeof document === 'undefined') return () => stopWorker?.();
		const remeasureAfterOtherTabWrites = () => {
			if (document.visibilityState === 'visible') this.storageObserver.wrote();
		};
		document.addEventListener('visibilitychange', remeasureAfterOtherTabWrites);
		return () => {
			stopWorker?.();
			document.removeEventListener('visibilitychange', remeasureAfterOtherTabWrites);
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

	clearDesktopCaches = async () => {
		if (!this.managedLibrary) return;
		await this.persistence.whenIdle();
		await this.managedLibrary.clearCaches();
		this.storageCleanupResult = null;
		await this.refreshBrowserStorage();
	};

	requestPersistentStorage = () => this.storage.requestPersistence();

	createDesktopLibrary = () => this.activateDesktopLibrary(() => this.managedLibrary?.create());

	openDesktopLibrary = () => this.activateDesktopLibrary(() => this.managedLibrary?.open());

	revealDesktopLibrary = () => this.managedLibrary?.reveal();

	setMode(mode: Exclude<WorkspaceMode, 'welcome'>) {
		if (mode === 'edit' && this.photos.length === 0) return;
		this.mode = mode;
		if (mode === 'edit' && this.activePhotoId) void this.session.open(this.activePhotoId);
		else this.session.close();
	}

	selectPhoto(photoId: string, additive = false) {
		if (!additive) {
			this.selectedIds = [photoId];
			this.activePhotoId = photoId;
			if (this.mode === 'edit') void this.session.open(photoId);
			return;
		}
		if (this.mode === 'edit' && photoId === this.activePhotoId) return;
		this.selectedIds = this.selectedIds.includes(photoId)
			? this.selectedIds.filter((id) => id !== photoId)
			: [...this.selectedIds, photoId];
		if (this.mode !== 'edit') this.activePhotoId = photoId;
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

	savePreset = (name: string, groups: readonly DevelopGroupName[]) => {
		const photo = this.selectedPhoto;
		if (!photo || groups.length === 0) return;
		const preset = savedPreset(
			this.presets,
			name,
			photo.edit.adjustments,
			groups,
			new Date().toISOString()
		);
		this.presets = [preset, ...this.presets.filter(({ id }) => id !== preset.id)];
		void this.persistence.queue((store) => store.savePreset(preset));
	};

	applyPreset = (presetId: string) => {
		const photo = this.selectedPhoto;
		const preset = this.presets.find(({ id }) => id === presetId);
		if (!photo || !preset) return false;
		return this.commitAdjustments(
			applyGroups(photo.edit.adjustments, preset.settings, preset.groups),
			`preset ${preset.name}`
		);
	};

	deletePreset = (presetId: string) => {
		this.presets = this.presets.filter(({ id }) => id !== presetId);
		void this.persistence.queue((store) => store.deletePreset(presetId));
	};

	cameraLook = $derived(this.selectedPhoto?.edit.profile.cameraLook ?? FULL_CAMERA_LOOK);
	cameraLookEnabled = $derived(this.selectedPhoto?.edit.profile.cameraLookEnabled ?? true);
	cameraMatch = $derived(
		this.selectedPhoto?.edit.profile.cameraMatch ?? ({ status: 'legacy' } as const)
	);
	hasCameraLook = $derived(this.selectedPhoto?.kind !== 'display');

	setCameraLook = (amount: number) => this.editor.dispatch({ type: 'profile.cameraLook', amount });
	toggleCameraLook = () =>
		this.editor.dispatch({
			type: 'profile.cameraLookEnabled',
			enabled: !this.cameraLookEnabled
		});

	applyCameraMatch = (result: CameraMatchResult, target: CameraMatchTarget) => {
		const photo = this.selectedPhoto;
		if (!photo || photo.kind === 'display') return false;
		return this.editor.dispatch({
			type: 'profile.cameraMatch',
			adjustments: applyCameraMatchSettings(photo.edit.adjustments, result),
			result,
			target
		});
	};

	presentCameraMatch = (
		result: CameraMatchResult,
		target: CameraMatchTarget,
		alreadyRendered = false
	) => {
		const photo = this.selectedPhoto;
		if (!photo || photo.kind === 'display') return false;
		const automatic = cameraMatchResultSchema.parse(result);
		this.cameraMatchCandidate = {
			id: ++this.cameraMatchCandidateId,
			photoId: photo.id,
			target,
			automatic,
			draft: automatic
		};
		this.cameraMatchPromptOpen = true;
		this.renderCameraMatchPreview(automatic, !alreadyRendered);
		return true;
	};

	previewCameraMatch = (result: CameraMatchResult) => {
		const candidate = this.cameraMatchCandidate;
		if (!candidate || candidate.photoId !== this.selectedPhoto?.id) return;
		const draft = cameraMatchResultSchema.parse(result);
		this.cameraMatchCandidate = { ...candidate, draft };
		this.renderCameraMatchPreview(draft, true);
	};

	previewNeutralCameraMatch = (neutral: boolean) => {
		const candidate = this.cameraMatchCandidate;
		const photo = this.selectedPhoto;
		if (!candidate || !photo || candidate.photoId !== photo.id) return;
		if (!neutral) {
			this.renderCameraMatchPreview(candidate.draft, true);
			return;
		}
		const document = cloneEditDocument(photo.edit);
		document.profile = {
			cameraLook: 0,
			cameraLookEnabled: false,
			cameraMatch: document.profile.cameraMatch
		};
		this.renderCameraMatchDocument(document, true);
	};

	applyCameraMatchCandidate = (remember: boolean) => {
		const candidate = this.cameraMatchCandidate;
		if (!candidate || candidate.photoId !== this.selectedPhoto?.id) return false;
		if (remember) this.setCameraMatchPreference('always');
		this.clearCameraMatchCandidate();
		return this.applyCameraMatch(candidate.draft, candidate.target);
	};

	startNeutralCameraMatch = (remember: boolean) => {
		const photo = this.selectedPhoto;
		if (!photo || photo.kind === 'display') return false;
		if (remember) this.setCameraMatchPreference('never');
		this.clearCameraMatchCandidate();
		const changed = this.editor.dispatch({
			type: 'profile.cameraMatch.dismiss',
			adjustments: cloneDevelopSettings(photo.edit.adjustments)
		});
		this.restoreCameraMatchPreview();
		return changed;
	};

	cancelCameraMatchCandidate = () => {
		const photo = this.selectedPhoto;
		if (!this.cameraMatchCandidate || !photo) return;
		const pending = photo.edit.profile.cameraMatch.status === 'pending';
		this.clearCameraMatchCandidate();
		if (pending) {
			this.editor.dispatch({
				type: 'profile.cameraMatch.dismiss',
				adjustments: cloneDevelopSettings(photo.edit.adjustments)
			});
		}
		this.restoreCameraMatchPreview();
	};

	setCameraMatchPreference = (preference: CameraMatchPreference) => {
		const value = cameraMatchPreferenceSchema.parse(preference);
		if (this.cameraMatchPreference === value) return;
		this.cameraMatchPreference = value;
		void this.persistence.queue((store) => store.saveCameraMatchPreference(value));
	};

	matchCamera = async () => {
		const photo = this.selectedPhoto;
		if (!photo || photo.kind === 'display' || !this.workerClient || !this.canAdjustLight) return;
		try {
			const result = await this.workerClient.cameraMatch();
			if (this.selectedPhoto?.id !== photo.id) return;
			this.presentCameraMatch(
				result,
				photo.frames.some(({ display }) => display !== null) ? 'camera-jpeg' : 'embedded-preview',
				false
			);
		} catch (error) {
			this.ingestError =
				error instanceof Error ? error.message : 'Unable to match camera rendering';
		}
	};

	reviewCameraMatch = (groups: readonly ('light' | 'color' | 'curve')[]) => {
		const photo = this.selectedPhoto;
		const match = photo?.edit.profile.cameraMatch;
		if (!photo || match?.status !== 'applied') return false;
		const neutral = defaultDevelopSettings();
		const settings = cloneDevelopSettings(photo.edit.adjustments);
		settings.light = groups.includes('light') ? match.result.light : neutral.light;
		settings.color = groups.includes('color') ? match.result.color : neutral.color;
		settings.curve = groups.includes('curve') ? match.result.curve : neutral.curve;
		return this.editor.dispatch({
			type: 'profile.cameraMatch',
			adjustments: settings,
			result: match.result,
			target: match.target,
			label: 'reviewed camera match'
		});
	};

	discardCameraMatch = () => {
		const photo = this.selectedPhoto;
		if (!photo || photo.edit.profile.cameraMatch.status !== 'applied') return false;
		const neutral = defaultDevelopSettings();
		const adjustments = cloneDevelopSettings(photo.edit.adjustments);
		adjustments.light = neutral.light;
		adjustments.color = neutral.color;
		adjustments.curve = neutral.curve;
		return this.editor.dispatch({ type: 'profile.cameraMatch.dismiss', adjustments });
	};

	private renderCameraMatchPreview(result: CameraMatchResult, requestPreview: boolean) {
		const photo = this.selectedPhoto;
		if (!photo) return;
		const document = cloneEditDocument(photo.edit);
		document.adjustments = applyCameraMatchSettings(document.adjustments, result);
		document.profile = {
			cameraLook: result.cameraLook,
			cameraLookEnabled: true,
			cameraMatch: document.profile.cameraMatch
		};
		this.renderCameraMatchDocument(document, requestPreview);
	}

	private renderCameraMatchDocument(document: EditDocument, requestPreview: boolean) {
		this.pushCameraLook(document.profile.cameraLookEnabled ? document.profile.cameraLook : 0);
		this.pipeline.renderEditDocument(document);
		if (requestPreview) {
			this.develop.request(document.adjustments, document.geometry.crop, 'refining');
		}
	}

	private restoreCameraMatchPreview() {
		const photo = this.selectedPhoto;
		if (!photo) return;
		this.renderCameraMatchDocument(photo.edit, true);
	}

	private clearCameraMatchCandidate() {
		this.cameraMatchPromptOpen = false;
		this.cameraMatchCandidate = null;
	}

	pushCameraLook = (amount: number) => {
		void this.workerClient
			?.setCameraLook(amount)
			.then(() => this.rerequestAllTiles())
			.catch(() => {});
	};

	snapshots = $derived(this.selectedPhoto?.edit.snapshots ?? []);

	saveSnapshot = (name: string) => {
		const photo = this.selectedPhoto;
		const trimmed = name.trim();
		if (!photo || !trimmed) return;
		this.editor.dispatch({
			type: 'snapshot.create',
			snapshot: {
				id: entityId('snapshot'),
				name: trimmed,
				adjustments: cloneDevelopSettings(photo.edit.adjustments)
			}
		});
	};

	applySnapshot = (snapshotId: string) =>
		this.editor.dispatch({ type: 'snapshot.apply', snapshotId });

	deleteSnapshot = (snapshotId: string) =>
		this.editor.dispatch({ type: 'snapshot.delete', snapshotId });

	copySettings = (groups: readonly DevelopGroupName[]) => {
		const photo = this.selectedPhoto;
		if (!photo || groups.length === 0) return;
		this.settingsClipboard = copiedSettings(photo.edit.adjustments, groups);
	};

	pasteSettings = () => {
		const photo = this.selectedPhoto;
		const clipboard = this.settingsClipboard;
		if (!photo || !clipboard) return false;
		return this.commitAdjustments(
			applyGroups(photo.edit.adjustments, clipboard.settings, clipboard.groups),
			'paste settings'
		);
	};

	syncSettings = (groups: readonly DevelopGroupName[]) => {
		const source = this.selectedPhoto;
		if (!source || groups.length === 0) return;
		for (const photo of this.photos) {
			if (!this.syncTargetIds.includes(photo.id)) continue;
			const adjustments = applyGroups(photo.edit.adjustments, source.edit.adjustments, groups);
			if (sameDevelopSettings(photo.edit.adjustments, adjustments)) continue;
			const edit = { ...photo.edit, adjustments };
			photo.edit = edit;
			void this.persistence.queue((store) => store.saveEditDocument(photo.id, edit));
		}
	};

	autoWhiteBalance = () => this.auto.whiteBalance();

	sampleWhiteBalance = (point: NormalizedPoint) => this.auto.sampleWhiteBalance(point);

	autoTone = () => this.auto.tone();

	previewMaskAdjustmentAt = (target: MaskAdjustmentTarget, value: number) =>
		this.controls.previewMaskAdjustmentAt(target, value);

	commitMaskAdjustmentAt = (target: MaskAdjustmentTarget, value: number) =>
		this.controls.commitMaskAdjustmentAt(target, value);

	previewMaskAdjustmentsAt = (changes: readonly MaskAdjustmentChange[]) =>
		this.controls.previewMaskAdjustmentsAt(changes);

	commitMaskAdjustmentsAt = (changes: readonly MaskAdjustmentChange[]) =>
		this.controls.commitMaskAdjustmentsAt(changes);

	previewMaskCurve = (channel: CurveChannelName, points: CurvePoints) =>
		this.controls.previewMaskCurve(channel, points);

	commitMaskCurve = (channel: CurveChannelName, points: CurvePoints) =>
		this.controls.commitMaskCurve(channel, points);

	previewMaskEdge = (control: MaskEdgeControlName, value: number) =>
		this.controls.previewMaskEdge(control, value);

	commitMaskEdge = (control: MaskEdgeControlName, value: number) =>
		this.controls.commitMaskEdge(control, value);

	undo = () => this.editor.undo();

	redo = () => this.editor.redo();

	settleDevelopRender = (revision: number) => this.develop.settle(revision);

	compareOriginal = (comparing: boolean) => {
		void this.comparison.set(comparing);
	};

	toggleClipping = (kind?: ClippingKind) => {
		const both = this.clipping.highlights && this.clipping.shadows;
		this.clipping = kind
			? { ...this.clipping, [kind]: !this.clipping[kind] }
			: { highlights: !both, shadows: !both };
		this.rerequestAllTiles();
	};

	private rerequestAllTiles() {
		this.renderSettings = {
			adjustments: this.renderSettings.adjustments,
			crop: this.renderSettings.crop,
			revision: this.renderSettings.revision + 1
		};
	}

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

	saveExport = (jpeg: ArrayBuffer, fileName: string) =>
		this.platform.exportSink.save(jpeg, fileName);

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
			if (kind === 'luminance' || kind === 'color') {
				void this.ranging.addRangeComponent(kind, 'add');
			}
		}
	}

	addRangeComponent = (kind: RangeKind, operation: MaskOperation) =>
		this.ranging.addRangeComponent(kind, operation);

	previewRange = (componentId: string, range: RangeSettings) =>
		this.ranging.previewRange(componentId, range);

	commitRange = (componentId: string, range: RangeSettings) =>
		this.ranging.commitRange(componentId, range);

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
		await this.ensureCapabilities();
		if (this.managedLibrary) {
			const status = await this.managedLibrary.status();
			if (status.kind !== 'ready') {
				this.desktopLibraryRequired = true;
				this.libraryReady = true;
				this.libraryError = status.kind === 'error' ? status.message : null;
				this.startupReady = true;
				return;
			}
			this.desktopLibraryPath = status.path;
		}
		await Promise.all([
			this.refreshBrowserStorage().catch(() => undefined),
			this.resumePendingDeletions()
		]);
		await this.persistence.loadLibrary();
		if (this.photos.length > 0) this.mode = 'organize';
		this.startupReady = true;
	}

	private async activateDesktopLibrary(action: () => Promise<string | null> | undefined) {
		if (!this.managedLibrary) return;
		await this.persistence.whenIdle();
		const path = await action();
		if (!path) return;
		this.session.close();
		this.clearFiles();
		this.photos = [];
		this.collections = [];
		this.stacks = [];
		this.presets = [];
		this.selectedIds = [];
		this.activePhotoId = null;
		this.mode = 'welcome';
		this.desktopLibraryPath = path;
		this.desktopLibraryRequired = false;
		this.libraryError = null;
		await this.resumePendingDeletions();
		await this.persistence.loadLibrary();
		await this.refreshBrowserStorage().catch(() => undefined);
		if (this.photos.length > 0) this.mode = 'organize';
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
