import type { Photo, PhotoCollection, PhotoStack } from './workspace.svelte.ts';

export type LibrarySource =
	| { kind: 'all' }
	| { kind: 'recent' }
	| { kind: 'favorites' }
	| { kind: 'collection'; collectionId: string };

export type LibrarySort = 'capture' | 'name' | 'rating';

export type LibraryView = 'grid' | 'list';

export interface LibraryQuery {
	search: string;
	source: LibrarySource;
	sort: LibrarySort;
	recentCutoff: number;
}

export interface LibraryContents {
	photos: readonly Photo[];
	stacks: readonly PhotoStack[];
	collections: readonly PhotoCollection[];
}

export interface LibrarySourceCounts {
	all: number;
	recent: number;
	favorites: number;
}

export function sameSource(a: LibrarySource, b: LibrarySource) {
	if (a.kind === 'collection' && b.kind === 'collection') {
		return a.collectionId === b.collectionId;
	}
	return a.kind === b.kind;
}

export function visibleLibraryPhotos(
	{ photos, stacks, collections }: LibraryContents,
	{ search, source, sort, recentCutoff }: LibraryQuery
) {
	const text = search.trim().toLowerCase();
	const collection =
		source.kind === 'collection' ? collections.find(({ id }) => id === source.collectionId) : null;
	const matches = photos.filter((photo) => {
		if (text && !photo.name.toLowerCase().includes(text)) return false;
		if (source.kind === 'recent' && photo.importedAt < recentCutoff) return false;
		if (source.kind === 'favorites' && !photo.flagged) return false;
		if (collection && !collection.photoIds.includes(photo.id)) return false;
		return true;
	});
	return sorted(withCollapsedStacks(matches, stacks), sort);
}

export function librarySourceCounts(
	photos: readonly Photo[],
	recentCutoff: number
): LibrarySourceCounts {
	return {
		all: photos.length,
		recent: photos.filter((photo) => photo.importedAt >= recentCutoff).length,
		favorites: photos.filter((photo) => photo.flagged).length
	};
}

function withCollapsedStacks(photos: Photo[], stacks: readonly PhotoStack[]) {
	const visibleIds = new Set(photos.map(({ id }) => id));
	return photos.filter((photo) => {
		if (!photo.stackId) return true;
		const stack = stacks.find(({ id }) => id === photo.stackId);
		const firstVisible = stack?.photoIds.find((photoId) => visibleIds.has(photoId));
		return !stack?.collapsed || firstVisible === photo.id;
	});
}

function sorted(photos: Photo[], sort: LibrarySort) {
	return [...photos].sort((a, b) => {
		if (sort === 'name') return a.name.localeCompare(b.name);
		if (sort === 'rating') return b.rating - a.rating;
		return a.captured.localeCompare(b.captured);
	});
}
