import {
	ACCEPTED_PHOTOS,
	describePhotoSource,
	type PhotoKind,
	type PhotoSource
} from './photo-source';

export { ACCEPTED_PHOTOS } from './photo-source';

export type WorkspaceMode = 'welcome' | 'organize' | 'edit';
export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type MaskKind = 'brush' | 'linear' | 'radial' | 'subject' | 'sky' | 'background';

export interface Photo {
	id: string;
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
	// TODO(WASM_TODOS.collectionStorage): replace session-only state with an OPFS-backed catalog.
	mode = $state<WorkspaceMode>('welcome');
	collectionName = $state('');
	photos = $state<Photo[]>([]);
	albums = $state<Album[]>([]);
	stacks = $state<PhotoStack[]>([]);
	selectedIds = $state<string[]>([]);
	activePhotoId = $state<string | null>(null);
	masks = $state<Mask[]>([]);
	selectedMaskId = $state<string | null>(null);
	// TODO(WASM_TODOS.adjustments): send changes to the render graph and refresh the preview.
	adjustments = $state({ ...defaultAdjustments });
	// TODO(WASM_TODOS.layersAndHistory): record document operations and back undo and redo.
	history = $state<string[]>(['imported']);

	selectedPhoto = $derived(this.photos.find((photo) => photo.id === this.activePhotoId) ?? null);
	selectedPhotos = $derived(this.photos.filter((photo) => this.selectedIds.includes(photo.id)));

	private objectUrls = new Set<string>();

	async openSingle(file: File) {
		// TODO(WASM_TODOS.photoIngest): route the file through worker load and the Session bindings.
		this.clearFiles();
		const photo = await this.photoFromFile(file);
		if (!photo) return;
		this.photos = [photo];
		this.collectionName = file.name.replace(/\.[^.]+$/, '');
		this.selectedIds = [photo.id];
		this.activePhotoId = photo.id;
		this.mode = 'edit';
		this.resetEditState();
	}

	async createCollection(name: string, files: File[]) {
		// TODO(WASM_TODOS.collectionStorage): create the collection and originals store in OPFS.
		this.clearFiles();
		this.photos = await this.photosFromFiles(files);
		this.collectionName = name.trim() || 'untitled collection';
		this.selectedIds = this.photos[0] ? [this.photos[0].id] : [];
		this.activePhotoId = this.photos[0]?.id ?? null;
		this.mode = 'organize';
		this.resetEditState();
	}

	async importFiles(files: File[]) {
		// TODO(WASM_TODOS.photoIngest): ingest and thumbnail these files through the Wasm worker.
		const imported = await this.photosFromFiles(files);
		this.photos.push(...imported);
		if (!this.activePhotoId && imported[0]) {
			this.selectPhoto(imported[0].id);
		}
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
		if (photo) photo.rating = photo.rating === rating ? 0 : rating;
	}

	toggleFlag(photoId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (photo) photo.flagged = !photo.flagged;
	}

	setColorLabel(photoId: string, colorLabel: ColorLabel) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (photo) photo.colorLabel = colorLabel;
	}

	createAlbum(name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		const album = { id: id('album'), name: trimmed };
		this.albums.push(album);
		for (const photo of this.selectedPhotos) photo.albumIds.push(album.id);
	}

	toggleAlbum(photoId: string, albumId: string) {
		const photo = this.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		photo.albumIds = photo.albumIds.includes(albumId)
			? photo.albumIds.filter((id) => id !== albumId)
			: [...photo.albumIds, albumId];
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
	}

	ungroupStack(stackId: string) {
		for (const photo of this.photos) {
			if (photo.stackId === stackId) photo.stackId = null;
		}
		this.stacks = this.stacks.filter((stack) => stack.id !== stackId);
	}

	toggleStack(stackId: string) {
		const stack = this.stacks.find((candidate) => candidate.id === stackId);
		if (stack) stack.collapsed = !stack.collapsed;
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
		this.mode = 'welcome';
		this.collectionName = '';
		this.photos = [];
		this.albums = [];
		this.stacks = [];
		this.selectedIds = [];
		this.activePhotoId = null;
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

	private async photosFromFiles(files: File[]) {
		const photos = await Promise.all(files.map((file) => this.photoFromFile(file)));
		return photos.filter((photo): photo is Photo => photo !== null);
	}

	private async photoFromFile(file: File): Promise<Photo | null> {
		// TODO(WASM_TODOS.photoIngest): replace browser metadata and the RAW placeholder with Wasm output.
		const source = describePhotoSource(file);
		if (!source) return null;

		const src = source.kind === 'image' ? URL.createObjectURL(file) : null;
		if (src) this.objectUrls.add(src);

		const dimensions = src ? await this.readDimensions(src) : null;
		return {
			id: id('photo'),
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
		};
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
