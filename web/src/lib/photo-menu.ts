import { separator, type MenuAction, type MenuEntry, type MenuLeaf } from './menu.ts';
import type { ColorLabel, Photo, PhotoCollection, PhotoStack } from './workspace.svelte';

export type PhotoMenuAction =
	| { type: 'edit' }
	| { type: 'flag'; flagged: boolean }
	| { type: 'rate'; rating: number }
	| { type: 'label'; label: ColorLabel }
	| { type: 'collection'; collectionId: string; member: boolean }
	| { type: 'create-collection' }
	| { type: 'group-stack' }
	| { type: 'ungroup-stack'; stackId: string }
	| { type: 'remove' };

export interface PhotoMenuContext {
	targets: Photo[];
	stack: PhotoStack | null;
	collections: PhotoCollection[];
}

const COLOR_LABELS: ColorLabel[] = ['none', 'red', 'yellow', 'green', 'blue', 'purple'];

export function contextTargets(photoId: string, selectedIds: readonly string[]) {
	return selectedIds.includes(photoId)
		? { targetIds: [...selectedIds], moveSelection: false }
		: { targetIds: [photoId], moveSelection: true };
}

export function photoMenu({
	targets,
	stack,
	collections
}: PhotoMenuContext): MenuEntry<PhotoMenuAction>[] {
	return [
		{ kind: 'action', label: 'open in editor', action: { type: 'edit' } },
		separator(),
		flagEntry(targets),
		{ kind: 'submenu', label: 'rating', items: ratingEntries(targets) },
		{ kind: 'submenu', label: 'color label', items: labelEntries(targets) },
		{ kind: 'submenu', label: 'add to collection', items: collectionEntries(targets, collections) },
		stackEntry(targets, stack),
		separator(),
		removeEntry(targets)
	];
}

function flagEntry(targets: Photo[]): MenuAction<PhotoMenuAction> {
	const allFlagged = targets.every(({ flagged }) => flagged);
	return {
		kind: 'action',
		label: allFlagged ? 'remove flag' : targets.length > 1 ? 'flag photos' : 'flag photo',
		action: { type: 'flag', flagged: !allFlagged }
	};
}

function ratingEntries(targets: Photo[]): MenuLeaf<PhotoMenuAction>[] {
	return [0, 1, 2, 3, 4, 5].map((rating) => ({
		kind: 'action',
		label: rating === 0 ? 'none' : '★'.repeat(rating),
		action: { type: 'rate', rating },
		checked: targets.every((photo) => photo.rating === rating)
	}));
}

function labelEntries(targets: Photo[]): MenuLeaf<PhotoMenuAction>[] {
	return COLOR_LABELS.map((label) => ({
		kind: 'action',
		label,
		action: { type: 'label', label },
		checked: targets.every((photo) => photo.colorLabel === label)
	}));
}

function collectionEntries(
	targets: Photo[],
	collections: PhotoCollection[]
): MenuLeaf<PhotoMenuAction>[] {
	if (collections.length === 0) {
		return [{ kind: 'action', label: 'create collection…', action: { type: 'create-collection' } }];
	}
	return collections.map((collection) => {
		const member = targets.every(({ id }) => collection.photoIds.includes(id));
		return {
			kind: 'action',
			label: collection.name,
			action: { type: 'collection', collectionId: collection.id, member: !member },
			checked: member
		};
	});
}

function stackEntry(targets: Photo[], stack: PhotoStack | null): MenuAction<PhotoMenuAction> {
	if (stack && targets.every(({ stackId }) => stackId === stack.id)) {
		return {
			kind: 'action',
			label: 'ungroup stack',
			action: { type: 'ungroup-stack', stackId: stack.id }
		};
	}
	return {
		kind: 'action',
		label: 'group into stack',
		action: { type: 'group-stack' },
		disabled: targets.length < 2
	};
}

function removeEntry(targets: Photo[]): MenuAction<PhotoMenuAction> {
	return {
		kind: 'action',
		label:
			targets.length > 1 ? `remove ${targets.length} photos from library…` : 'remove from library…',
		action: { type: 'remove' }
	};
}
