import type { PhotoCollection } from './library-schema';
import { entityId } from './entity-id';
import type { DocumentStatus } from './document-session';
import type { ObjectUrlRegistry } from './object-url-registry';
import { removePhotos } from './photo-removal';
import { storedPhoto, type ColorLabel, type Photo, type PhotoStack } from './photo-record';
import type { ThumbnailLoader } from './thumbnail-loader';
import type { WorkspacePersistence } from './workspace-persistence';

export interface PhotoOrganizerHost {
	photos: Photo[];
	collections: PhotoCollection[];
	stacks: PhotoStack[];
	selectedIds: string[];
	activePhotoId: string | null;
	readonly mode: 'welcome' | 'organize' | 'edit';
	readonly documentStatus: DocumentStatus;
	cancelDocument(): void;
	openDocument(photoId: string): void;
	enterOrganizeMode(): void;
}

export class PhotoOrganizer {
	constructor(
		private readonly persistence: WorkspacePersistence,
		private readonly thumbnails: ThumbnailLoader,
		private readonly objectUrls: ObjectUrlRegistry,
		private readonly host: PhotoOrganizerHost
	) {}

	setRating(photoId: string, rating: number) {
		const photo = this.host.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		this.applyRating([photoId], photo.rating === rating ? 0 : rating);
	}

	applyRating(photoIds: readonly string[], rating: number) {
		this.applyPhotoState(photoIds, (photo) => (photo.rating = rating));
	}

	toggleFlag(photoId: string) {
		const photo = this.host.photos.find((candidate) => candidate.id === photoId);
		if (!photo) return;
		this.applyFlag([photoId], !photo.flagged);
	}

	applyFlag(photoIds: readonly string[], flagged: boolean) {
		this.applyPhotoState(photoIds, (photo) => (photo.flagged = flagged));
	}

	setColorLabel(photoId: string, colorLabel: ColorLabel) {
		this.applyColorLabel([photoId], colorLabel);
	}

	applyColorLabel(photoIds: readonly string[], colorLabel: ColorLabel) {
		this.applyPhotoState(photoIds, (photo) => (photo.colorLabel = colorLabel));
	}

	private applyPhotoState(photoIds: readonly string[], mutate: (photo: Photo) => void) {
		for (const photoId of photoIds) {
			const photo = this.host.photos.find((candidate) => candidate.id === photoId);
			if (!photo) continue;
			mutate(photo);
			void this.persistence.queue((store) => store.updatePhotoState(storedPhoto(photo)));
		}
	}

	toggleCollection(photoId: string, collectionId: string) {
		const collection = this.host.collections.find((candidate) => candidate.id === collectionId);
		if (!collection) return;
		this.applyCollectionMembership([photoId], collectionId, !collection.photoIds.includes(photoId));
	}

	applyCollectionMembership(photoIds: readonly string[], collectionId: string, member: boolean) {
		const collection = this.host.collections.find((candidate) => candidate.id === collectionId);
		if (!collection) return;
		const valid = photoIds.filter((photoId) => this.host.photos.some(({ id }) => id === photoId));
		if (valid.length === 0) return;
		collection.photoIds = member
			? [...collection.photoIds, ...valid.filter((id) => !collection.photoIds.includes(id))]
			: collection.photoIds.filter((id) => !valid.includes(id));
		collection.updatedAt = Date.now();
		void this.persistence.queue((store) => store.saveCollection(collection));
	}

	deletePhotos(photoIds: readonly string[]) {
		const removed = photoIds.filter((photoId) => this.host.photos.some(({ id }) => id === photoId));
		if (removed.length === 0) return;
		if (
			this.host.documentStatus.kind === 'loading' &&
			removed.includes(this.host.documentStatus.photoId)
		) {
			this.host.cancelDocument();
		}
		const previousActiveId = this.host.activePhotoId;
		const removedPhotos = this.host.photos.filter(({ id }) => removed.includes(id));
		const next = removePhotos(
			{
				photos: this.host.photos,
				collections: this.host.collections,
				stacks: this.host.stacks,
				selectedIds: this.host.selectedIds,
				activePhotoId: this.host.activePhotoId
			},
			removed
		);
		this.host.photos = next.photos;
		this.host.collections = next.collections;
		this.host.stacks = next.stacks;
		this.host.selectedIds = next.selectedIds;
		this.host.activePhotoId = next.activePhotoId;
		this.releaseRemovedPhotos(removedPhotos);
		if (this.host.mode === 'edit') {
			if (!next.activePhotoId) this.host.enterOrganizeMode();
			else if (previousActiveId && removed.includes(previousActiveId)) {
				this.host.openDocument(next.activePhotoId);
			}
		}
		void this.persistence.queue(async (store) => {
			for (const photoId of removed) await store.deletePhoto(photoId);
		});
	}

	private releaseRemovedPhotos(photos: readonly Photo[]) {
		for (const photo of photos) {
			this.thumbnails.forget(photo.id);
			if (photo.src && this.objectUrls.tracks(photo.src)) {
				this.objectUrls.revoke(photo.src);
			}
		}
	}

	createStack() {
		const previousStackIds = new Map(this.host.photos.map((photo) => [photo.id, photo.stackId]));
		const photoIds = this.host.selectedIds.filter((photoId) =>
			this.host.photos.some((photo) => photo.id === photoId)
		);
		if (photoIds.length < 2) return;

		for (const stack of this.host.stacks) {
			stack.photoIds = stack.photoIds.filter((photoId) => !photoIds.includes(photoId));
		}
		this.host.stacks = this.host.stacks.filter((stack) => stack.photoIds.length > 1);
		const survivingStackIds = new Set(this.host.stacks.map((stack) => stack.id));
		for (const photo of this.host.photos) {
			if (photo.stackId && !survivingStackIds.has(photo.stackId)) photo.stackId = null;
		}

		const stack = {
			id: entityId('stack'),
			name: `Exposure stack ${this.host.stacks.length + 1}`,
			photoIds,
			collapsed: true
		};
		this.host.stacks.push(stack);
		for (const photo of this.host.photos) {
			if (photoIds.includes(photo.id)) photo.stackId = stack.id;
		}
		void this.persistStacks(previousStackIds);
	}

	ungroupStack(stackId: string) {
		const previousStackIds = new Map(this.host.photos.map((photo) => [photo.id, photo.stackId]));
		for (const photo of this.host.photos) {
			if (photo.stackId === stackId) photo.stackId = null;
		}
		this.host.stacks = this.host.stacks.filter((stack) => stack.id !== stackId);
		void this.persistStacks(previousStackIds);
	}

	toggleStack(stackId: string) {
		const stack = this.host.stacks.find((candidate) => candidate.id === stackId);
		if (!stack) return;
		stack.collapsed = !stack.collapsed;
		void this.persistence.queue((store) => store.saveStacks(this.host.stacks, new Map()));
	}

	private persistStacks(previousStackIds: ReadonlyMap<string, string | null>) {
		const changed = new Map<string, string | null>();
		for (const photo of this.host.photos) {
			if (previousStackIds.get(photo.id) !== photo.stackId) changed.set(photo.id, photo.stackId);
		}
		return this.persistence.queue((store) => store.saveStacks(this.host.stacks, changed));
	}
}
