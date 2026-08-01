export const RAW_EXTENSIONS = [
	'ari',
	'arw',
	'cr2',
	'cr3',
	'crm',
	'crw',
	'dcr',
	'dcs',
	'dng',
	'erf',
	'iiq',
	'kdc',
	'mef',
	'mos',
	'mrw',
	'nef',
	'nrw',
	'orf',
	'ori',
	'pef',
	'raf',
	'raw',
	'rw2',
	'rwl',
	'srw',
	'3fr',
	'fff',
	'x3f',
	'qtk'
] as const;

export const DISPLAY_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif'] as const;
export const PHOTO_EXTENSIONS = [...DISPLAY_EXTENSIONS, ...RAW_EXTENSIONS] as const;

export type RawExtension = (typeof RAW_EXTENSIONS)[number];
export type DisplayExtension = (typeof DISPLAY_EXTENSIONS)[number];
export type PhotoExtension = (typeof PHOTO_EXTENSIONS)[number];
export type PhotoKind = 'raw' | 'image';

export interface PhotoSource {
	kind: PhotoKind;
	format: PhotoExtension;
	mediaType: string;
	size: number;
	lastModified: number;
}

const rawExtensions = new Set<string>(RAW_EXTENSIONS);
const displayExtensions = new Set<string>(DISPLAY_EXTENSIONS);

export const ACCEPTED_PHOTOS = PHOTO_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export function fileExtension(name: string) {
	return name.split('.').pop()?.toLowerCase() ?? '';
}

export function describePhotoSource(file: File): PhotoSource | null {
	const format = fileExtension(file.name);
	const kind = rawExtensions.has(format) ? 'raw' : displayExtensions.has(format) ? 'image' : null;

	if (!kind) return null;

	return {
		kind,
		format: format as PhotoExtension,
		mediaType: file.type,
		size: file.size,
		lastModified: file.lastModified
	};
}
