import {
	ACCEPTED_PHOTOS,
	describePhotoSource,
	type PhotoKind,
	type PhotoSource
} from './photo-source';
import {
	CollectionStore,
	type CollectionManifest,
	type OriginalWrite,
	type StoredPhoto
} from './collection-store';

export { ACCEPTED_PHOTOS } from './photo-source';

export type WorkspaceMode = 'welcome' | 'organize' | 'edit';
export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type MaskKind = 'brush' | 'linear' | 'radial' | 'subject' | 'sky' | 'background';
export type StorageStatus = 'memory' | 'saving' | 'saved' | 'error';

export interface Photo {
	id: string;
	storageName: string;
	name: string;
	extension: string;
	src: string | null;
	kind: PhotoKind;
	source: PhotoSource;
	size: number;
	width: number | null;
	height: number | null;
	captured: string;
	rating: number;
	flagged: boolean;
	rejected: boolean;
	colorLabel: ColorLabel;
	albumIds: string[];
	stackId: string | null;
}

export interface Album {
	id: string;
	name: string;
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
	original: OriginalWrite;
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

function extension(name: string) {
	return name.split('.').pop()?.toUpperCase() ?? 'FILE';
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
	private readonly collectionStore = CollectionStore.supported() ? new CollectionStore() : null;
	private collectionId: string | null = null;
	private collectionCreatedAt = 0;
	private persistence = Promise.resolve();
	private persistenceRevision = 0;
	private objectUrls = new Set<string>();

	mode = $state<WorkspaceMode>('welcome');
	collectionName = $state('');
	photos = $state<Photo[]>([]);
	albums = $state<Album[]>([]);
	stacks = $state<PhotoStack[]>([]);
	selectedIds = $state<string[]>([]);
	activePhotoId = $state<string | null>(null);
	masks = $state<Mask[]>([]);
	selectedMaskId = $state<string | null>(null);
	storageStatus = $state<StorageStatus>(this.collectionStore ? 'saved' : 'memory');
	storageError = $state<string | null>(null);
	// TODO(WASM_TODOS.adjustments): send changes to the render graph and refresh the preview.
	adjustments = $state({ ...defaultAdjustments });
	// TODO(WASM_TODOS.layersAndHistory): record document operations and back undo and redo.
	history = $state<string[]>(['imported']);

	selectedPhoto = $derived(this.photos.find((photo) => photo.id === this.activePhotoId) ?? null);
	selectedPhotos = $derived(this.photos.filter((photo) => this.selectedIds.includes(photo.id)));

	async openSingle(file: File) {
		// TODO(WASM_TODOS.photoIngest): route the file through worker load and the Session bindings.
		this.clearFiles();
		const imported = await this.photoFromFile(file);
		if (!imported) return;
		this.beginCollection(file.name.replace(/\.[^.]+$/, ''), [imported.photo]);
		this.mode = 'edit';
		await this.queuePersistence([imported.original]);
	}

	async createCollection(name: string, files: File[]) {
		this.clearFiles();
		const imported = await this.photosFromFiles(files);
		this.beginCollection(
			name.trim() || 'untitled collection',
			imported.map(({ photo }) => photo)
		);
		this.mode = 'organize';
		await this.queuePersistence(imported.map(({ original }) => original));
	}

	async importFiles(files: File[]) {
		// TODO(WASM_TODOS.photoIngest): ingest and thumbnail these files through the Wasm worker.
		const imported = await this.photosFromFiles(files);
		this.photos.push(...imported.map(({ photo }) => photo));
		if (!this.activePhotoId && imported[0]?.photo) {
			this.selectPhoto(imported[0].photo.id);
		}
		await this.queuePersistence(imported.map(({ original }) => original));
	}

	async save() {
		await this.queuePersistence();
	}

	setMode(mode: Exclude<WorkspaceMode, 'welcome'>) {
		if (this.photos.length === 0) return;
		this.mode = mode;
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
	}

	editPhoto(photoId: string) {
		this.selectPhoto(photoId);
		this.mode = 'edit';
	}

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

	createAlbum(name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		const album = { id: id('album'), name: trimmed };
		this.albums.push(album);
		for (const photo of this.selectedPhotos) photo.albumIds.push(album.id);
		void this.queuePersistence();
	}

	toggleAlbum(photoId: string, albumId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.albumIds = photo.albumIds.includes(albumId)
			? photo.albumIds.filter((id) => id !== albumId)
			: [...photo.albumIds, albumId];
		void this.queuePersistence();
	}

	createStack() {
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
	}

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

	reset() {
		this.clearFiles();
		this.persistenceRevision += 1;
		this.collectionId = null;
		this.collectionCreatedAt = 0;
		this.mode = 'welcome';
		this.collectionName = '';
		this.photos = [];
		this.albums = [];
		this.stacks = [];
		this.selectedIds = [];
		this.activePhotoId = null;
		this.storageStatus = this.collectionStore ? 'saved' : 'memory';
		this.storageError = null;
		this.resetEditState();
	}

	destroy() {
		this.clearFiles();
	}

	private resetEditState() {
		this.masks = [];
		this.selectedMaskId = null;
		this.adjustments = { ...defaultAdjustments };
		this.history = ['imported'];
	}

	private clearFiles() {
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls.clear();
	}

	private beginCollection(name: string, photos: Photo[]) {
		this.collectionId = id('collection');
		this.collectionCreatedAt = Date.now();
		this.collectionName = name;
		this.photos = photos;
		this.albums = [];
		this.stacks = [];
		this.selectedIds = photos[0] ? [photos[0].id] : [];
		this.activePhotoId = photos[0]?.id ?? null;
		this.storageError = null;
		this.resetEditState();
	}

	private async photosFromFiles(files: File[]) {
		const imported = await Promise.all(files.map((file) => this.photoFromFile(file)));
		return imported.filter((photo): photo is PhotoImport => photo !== null);
	}

	private async photoFromFile(file: File): Promise<PhotoImport | null> {
		// TODO(WASM_TODOS.photoIngest): replace browser metadata and the RAW placeholder with Wasm output.
		const source = describePhotoSource(file);
		if (!source) return null;

		const src = source.kind === 'image' ? URL.createObjectURL(file) : null;
		if (src) this.objectUrls.add(src);

		const dimensions = src ? await this.readDimensions(src) : null;
		const photoId = id('photo');
		const storageName = `${photoId}.${source.format}`;
		const photo = {
			id: photoId,
			storageName,
			name: file.name,
			extension: extension(file.name),
			src,
			kind: source.kind,
			source,
			size: file.size,
			width: dimensions?.width ?? null,
			height: dimensions?.height ?? null,
			captured: dateLabel(file.lastModified),
			rating: 0,
			flagged: false,
			rejected: false,
			colorLabel: 'none',
			albumIds: [],
			stackId: null
		} satisfies Photo;

		return { photo, original: { storageName, file } };
	}

	private collectionManifest(): CollectionManifest | null {
		if (!this.collectionId) return null;

		return {
			version: 1,
			id: this.collectionId,
			name: this.collectionName,
			createdAt: this.collectionCreatedAt,
			updatedAt: Date.now(),
			photos: this.photos.map((photo) => this.storedPhoto(photo)),
			albums: this.albums.map((album) => ({ ...album })),
			stacks: this.stacks.map((stack) => ({ ...stack, photoIds: [...stack.photoIds] }))
		};
	}

	private storedPhoto(photo: Photo): StoredPhoto {
		return {
			id: photo.id,
			storageName: photo.storageName,
			name: photo.name,
			source: { ...photo.source },
			width: photo.width,
			height: photo.height,
			rating: photo.rating,
			flagged: photo.flagged,
			rejected: photo.rejected,
			colorLabel: photo.colorLabel,
			albumIds: [...photo.albumIds],
			stackId: photo.stackId
		};
	}

	private queuePersistence(originals: readonly OriginalWrite[] = []) {
		const manifest = this.collectionManifest();
		const store = this.collectionStore;
		if (!store || !manifest) {
			this.storageStatus = 'memory';
			return Promise.resolve();
		}

		const revision = ++this.persistenceRevision;
		this.storageStatus = 'saving';
		this.storageError = null;
		const save = this.persistence.then(() => store.saveCollection(manifest, originals));
		this.persistence = save.then(
			() => {
				if (revision !== this.persistenceRevision) return;
				this.storageStatus = 'saved';
			},
			(error: unknown) => {
				if (revision !== this.persistenceRevision) return;
				this.storageStatus = 'error';
				this.storageError = error instanceof Error ? error.message : 'Unable to save collection';
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

export function formatBytes(bytes: number) {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
