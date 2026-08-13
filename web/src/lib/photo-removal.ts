import type { Photo, PhotoCollection, PhotoStack } from './workspace.svelte';

export interface LibraryState {
	photos: Photo[];
	collections: PhotoCollection[];
	stacks: PhotoStack[];
	selectedIds: string[];
	activePhotoId: string | null;
}

export function removePhotos(state: LibraryState, photoIds: readonly string[]): LibraryState {
	const removed = new Set(photoIds);
	const stacks = state.stacks
		.map((stack) => ({
			...stack,
			photoIds: stack.photoIds.filter((id) => !removed.has(id))
		}))
		.filter((stack) => stack.photoIds.length >= 2);
	const stackIds = new Set(stacks.map(({ id }) => id));

	const photos = state.photos
		.filter(({ id }) => !removed.has(id))
		.map((photo) =>
			photo.stackId && !stackIds.has(photo.stackId) ? { ...photo, stackId: null } : photo
		);

	const collections = state.collections.map((collection) =>
		collection.photoIds.some((id) => removed.has(id))
			? { ...collection, photoIds: collection.photoIds.filter((id) => !removed.has(id)) }
			: collection
	);

	const activePhotoId = nextActivePhotoId(state, removed);
	const selectedIds = state.selectedIds.filter((id) => !removed.has(id));
	return {
		photos,
		collections,
		stacks,
		selectedIds: selectedIds.length > 0 ? selectedIds : activePhotoId ? [activePhotoId] : [],
		activePhotoId
	};
}

function nextActivePhotoId(state: LibraryState, removed: ReadonlySet<string>) {
	const { photos, activePhotoId } = state;
	if (!activePhotoId) return null;
	if (!removed.has(activePhotoId)) return activePhotoId;
	const index = photos.findIndex(({ id }) => id === activePhotoId);
	const after = photos.slice(index + 1).find(({ id }) => !removed.has(id));
	if (after) return after.id;
	const before = photos
		.slice(0, index)
		.reverse()
		.find(({ id }) => !removed.has(id));
	return before?.id ?? null;
}
