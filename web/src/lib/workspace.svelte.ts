export type WorkspaceMode = 'welcome' | 'organize' | 'edit';
export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type MaskKind = 'brush' | 'linear' | 'radial' | 'subject' | 'sky' | 'background';

export interface Photo {
	id: string;
	name: string;
	extension: string;
	src: string | null;
	kind: 'image' | 'raw';
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

export const ACCEPTED_PHOTOS = '.jpg,.jpeg,.png,.webp,.avif,.raf,.RAF';

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
	mode = $state<WorkspaceMode>('welcome');
	shootName = $state('');
	photos = $state<Photo[]>([]);
	albums = $state<Album[]>([]);
	stacks = $state<PhotoStack[]>([]);
	selectedIds = $state<string[]>([]);
	activePhotoId = $state<string | null>(null);
	masks = $state<Mask[]>([]);
	selectedMaskId = $state<string | null>(null);
	adjustments = $state({ ...defaultAdjustments });
	history = $state<string[]>(['Imported']);

	selectedPhoto = $derived(this.photos.find((photo) => photo.id === this.activePhotoId) ?? null);
	selectedPhotos = $derived(this.photos.filter((photo) => this.selectedIds.includes(photo.id)));

	private objectUrls = new Set<string>();

	async openSingle(file: File) {
		this.clearFiles();
		const photo = await this.photoFromFile(file);
		this.photos = [photo];
		this.shootName = file.name.replace(/\.[^.]+$/, '');
		this.selectedIds = [photo.id];
		this.activePhotoId = photo.id;
		this.mode = 'edit';
		this.resetEditState();
	}

	async createShoot(name: string, files: File[]) {
		this.clearFiles();
		this.photos = await Promise.all(files.map((file) => this.photoFromFile(file)));
		this.shootName = name.trim() || 'Untitled shoot';
		this.selectedIds = this.photos[0] ? [this.photos[0].id] : [];
		this.activePhotoId = this.photos[0]?.id ?? null;
		this.mode = 'organize';
		this.resetEditState();
	}

	async importFiles(files: File[]) {
		const imported = await Promise.all(files.map((file) => this.photoFromFile(file)));
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
		const labels: Record<MaskKind, string> = {
			brush: 'Brush',
			linear: 'Linear gradient',
			radial: 'Radial gradient',
			subject: 'Subject',
			sky: 'Sky',
			background: 'Background'
		};
		const mask = { id: id('mask'), name: labels[kind], kind, visible: true };
		this.masks.push(mask);
		this.selectedMaskId = mask.id;
		this.history.push(`Created ${labels[kind].toLowerCase()} mask`);
	}

	toggleMask(maskId: string) {
		const mask = this.masks.find((candidate) => candidate.id === maskId);
		if (mask) mask.visible = !mask.visible;
	}

	deleteMask(maskId: string) {
		this.masks = this.masks.filter((mask) => mask.id !== maskId);
		this.selectedMaskId = this.masks.at(-1)?.id ?? null;
	}

	reset() {
		this.clearFiles();
		this.mode = 'welcome';
		this.shootName = '';
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
		this.history = ['Imported'];
	}

	private clearFiles() {
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls.clear();
	}

	private async photoFromFile(file: File): Promise<Photo> {
		const raw = file.name.toLowerCase().endsWith('.raf');
		const src = !raw && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
		if (src) this.objectUrls.add(src);

		const dimensions = src ? await this.readDimensions(src) : null;
		return {
			id: id('photo'),
			name: file.name,
			extension: extension(file.name),
			src,
			kind: raw ? 'raw' : 'image',
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
