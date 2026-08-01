export const DISPLAY_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export type PhotoKind = 'raw' | 'image';

export interface PhotoSource {
	kind: PhotoKind;
	format: string;
	mediaType: string;
	size: number;
	lastModified: number;
}

const displayMediaTypes = new Set<string>(DISPLAY_MEDIA_TYPES);

export function acceptedPhotoTypes(rawExtensions: Iterable<string>) {
	return [
		...DISPLAY_MEDIA_TYPES,
		...normalizedRawExtensions(rawExtensions).map((value) => `.${value}`)
	].join(',');
}

export function fileExtension(name: string) {
	return name.split('.').pop()?.toLowerCase() ?? '';
}

export function describePhotoSource(
	file: File,
	rawExtensions: ReadonlySet<string>
): PhotoSource | null {
	const format = fileExtension(file.name);
	const kind = rawExtensions.has(format)
		? 'raw'
		: displayMediaTypes.has(file.type.toLowerCase())
			? 'image'
			: null;

	if (!kind) return null;

	return {
		kind,
		format,
		mediaType: file.type,
		size: file.size,
		lastModified: file.lastModified
	};
}

export function normalizedRawExtensions(extensions: Iterable<string>) {
	return [...new Set(extensions)]
		.map((extension) => extension.trim().toLowerCase())
		.filter((extension) => /^[a-z0-9]+$/.test(extension))
		.sort();
}
