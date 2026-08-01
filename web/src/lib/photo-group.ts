import { describePhotoSource, normalizedRawExtensions, type PhotoSource } from './photo-source';

export interface PhotoAsset {
	key: string;
	name: string;
	source: PhotoSource;
}

export interface DisplayPhotoFrame {
	kind: 'display';
	key: string;
	display: PhotoAsset;
}

export interface RawPhotoFrame {
	kind: 'raw';
	key: string;
	raw: PhotoAsset;
}

export interface RawPairPhotoFrame {
	kind: 'raw-pair';
	key: string;
	raw: PhotoAsset;
	display: PhotoAsset;
}

export type PhotoFrame = DisplayPhotoFrame | RawPhotoFrame | RawPairPhotoFrame;

export interface FilenameBracketFrame {
	photo: PhotoFrame;
	filenameExposureHint: number;
}

export interface BracketPhotoGroup {
	kind: 'bracket';
	key: string;
	detection: 'filename-candidate';
	frames: FilenameBracketFrame[];
}

export type PhotoGroup = PhotoFrame | BracketPhotoGroup;

export interface PhotoFileGrouping {
	groups: PhotoGroup[];
	filesByAssetKey: ReadonlyMap<string, File>;
	rejectedFiles: File[];
}

interface FileCandidate {
	asset: PhotoAsset;
	file: File;
	basename: string;
}

interface FrameCandidate {
	photo: PhotoFrame;
	basename: string;
}

interface FilenameExposureCandidate {
	family: string;
	hint: number;
}

export function photoBasename(name: string) {
	const extensionIndex = name.lastIndexOf('.');
	return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}

export function normalizePhotoBasename(name: string) {
	return photoBasename(name).normalize('NFKC').trim().toLowerCase();
}

export function groupPhotoFiles(
	files: Iterable<File>,
	rawExtensions: Iterable<string>
): PhotoFileGrouping {
	const supportedRawExtensions = new Set(normalizedRawExtensions(rawExtensions));
	const orderedFiles = [...files].sort(compareFiles);
	const candidates: FileCandidate[] = [];
	const rejectedFiles: File[] = [];
	const filesByAssetKey = new Map<string, File>();
	const keyOccurrences = new Map<string, number>();

	for (const file of orderedFiles) {
		const source = describePhotoSource(file, supportedRawExtensions);
		if (!source) {
			rejectedFiles.push(file);
			continue;
		}

		const keyBase = assetKeyBase(file, source);
		const occurrence = (keyOccurrences.get(keyBase) ?? 0) + 1;
		keyOccurrences.set(keyBase, occurrence);
		const asset = {
			key: stableKey('asset', [keyBase, String(occurrence)]),
			name: file.name,
			source
		};

		candidates.push({ asset, file, basename: normalizePhotoBasename(file.name) });
		filesByAssetKey.set(asset.key, file);
	}

	return {
		groups: organizeBracketCandidates(pairPhotoFiles(candidates)),
		filesByAssetKey,
		rejectedFiles
	};
}

function pairPhotoFiles(candidates: readonly FileCandidate[]) {
	const buckets = new Map<string, FileCandidate[]>();
	const frames: FrameCandidate[] = [];

	for (const candidate of candidates) {
		const matches = buckets.get(candidate.basename) ?? [];
		matches.push(candidate);
		buckets.set(candidate.basename, matches);
	}

	for (const [basename, matches] of [...buckets].sort(([left], [right]) =>
		compareText(left, right)
	)) {
		const raw = matches.filter((candidate) => candidate.asset.source.kind === 'raw');
		const jpeg = matches.filter(
			(candidate) => candidate.asset.source.kind === 'image' && isJpeg(candidate.asset.source)
		);
		const display = matches.filter(
			(candidate) => candidate.asset.source.kind === 'image' && !isJpeg(candidate.asset.source)
		);
		const pairCount = Math.min(raw.length, jpeg.length);

		for (let index = 0; index < pairCount; index += 1) {
			frames.push({
				basename,
				photo: rawPairFrame(raw[index].asset, jpeg[index].asset)
			});
		}

		for (const candidate of raw.slice(pairCount)) {
			frames.push({ basename, photo: rawFrame(candidate.asset) });
		}

		for (const candidate of [...jpeg.slice(pairCount), ...display].sort(compareCandidates)) {
			frames.push({ basename, photo: displayFrame(candidate.asset) });
		}
	}

	return frames.sort((left, right) => compareFrames(left.photo, right.photo));
}

function organizeBracketCandidates(frames: readonly FrameCandidate[]): PhotoGroup[] {
	const candidates = new Map<
		string,
		Array<FrameCandidate & { exposure: FilenameExposureCandidate }>
	>();
	const standalone: PhotoFrame[] = [];

	for (const frame of frames) {
		const exposure = filenameExposureCandidate(frame.basename);
		if (!exposure) {
			standalone.push(frame.photo);
			continue;
		}

		const matches = candidates.get(exposure.family) ?? [];
		matches.push({ ...frame, exposure });
		candidates.set(exposure.family, matches);
	}

	const groups: PhotoGroup[] = [...standalone];

	for (const [, matches] of [...candidates].sort(([left], [right]) => compareText(left, right))) {
		const distinctHints = new Set(matches.map(({ exposure }) => exposure.hint));
		if (matches.length < 2 || distinctHints.size < 2) {
			groups.push(...matches.map(({ photo }) => photo));
			continue;
		}

		const frames = matches
			.map(({ photo, exposure }) => ({
				photo,
				filenameExposureHint: exposure.hint
			}))
			.sort(
				(left, right) =>
					left.filenameExposureHint - right.filenameExposureHint ||
					compareFrames(left.photo, right.photo)
			);

		// TODO(WASM_TODOS.photoIngest): confirm bracket membership and ordering from capture metadata.
		groups.push({
			kind: 'bracket',
			key: stableKey(
				'bracket',
				frames.map(({ photo }) => photo.key)
			),
			detection: 'filename-candidate',
			frames
		});
	}

	return groups.sort(compareGroups);
}

function filenameExposureCandidate(basename: string): FilenameExposureCandidate | null {
	const patterns = [
		/^(.*?)[._ -]+ev[._ -]?([+-]?\d+(?:\.\d+)?)$/i,
		/^(.*?)[._ -]+([+-]?\d+(?:\.\d+)?)[._ -]?ev$/i,
		/^(.*?)[._ -]+([+-]\d+(?:\.\d+)?|0)$/i
	];

	for (const pattern of patterns) {
		const match = basename.match(pattern);
		if (!match) continue;

		const family = match[1].replace(/[._ -]+$/, '');
		const hint = Number(match[2]);
		if (family && Number.isFinite(hint)) return { family, hint };
	}

	return null;
}

function displayFrame(display: PhotoAsset): DisplayPhotoFrame {
	return { kind: 'display', key: stableKey('photo', ['display', display.key]), display };
}

function rawFrame(raw: PhotoAsset): RawPhotoFrame {
	return { kind: 'raw', key: stableKey('photo', ['raw', raw.key]), raw };
}

function rawPairFrame(raw: PhotoAsset, display: PhotoAsset): RawPairPhotoFrame {
	return {
		kind: 'raw-pair',
		key: stableKey('photo', ['raw-pair', raw.key, display.key]),
		raw,
		display
	};
}

function assetKeyBase(file: File, source: PhotoSource) {
	return [
		file.name.normalize('NFKC').trim().toLowerCase(),
		source.size,
		source.lastModified,
		source.mediaType.toLowerCase()
	].join('\0');
}

function isJpeg(source: PhotoSource) {
	return source.mediaType.toLowerCase() === 'image/jpeg' || ['jpg', 'jpeg'].includes(source.format);
}

function compareFiles(left: File, right: File) {
	return (
		compareText(left.name.normalize('NFKC'), right.name.normalize('NFKC')) ||
		left.lastModified - right.lastModified ||
		left.size - right.size ||
		compareText(left.type, right.type)
	);
}

function compareCandidates(left: FileCandidate, right: FileCandidate) {
	return compareText(left.asset.key, right.asset.key);
}

function compareFrames(left: PhotoFrame, right: PhotoFrame) {
	return compareText(left.key, right.key);
}

function compareGroups(left: PhotoGroup, right: PhotoGroup) {
	return compareText(left.key, right.key);
}

function compareText(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function stableKey(prefix: string, parts: readonly string[]) {
	let hash = 0xcbf29ce484222325n;

	for (const byte of new TextEncoder().encode(parts.join('\0'))) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}

	return `${prefix}-${hash.toString(16).padStart(16, '0')}`;
}
