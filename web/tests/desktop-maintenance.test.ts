import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopMaintenance } from '../src/lib/desktop/maintenance.ts';
import type { DesktopAssets } from '../src/lib/desktop/assets.ts';
import type { DesktopCatalog, PendingDelete } from '../src/lib/desktop/catalog.ts';
import type { DesktopAssetKind } from '../src/lib/desktop-api.ts';

test('routes pending deletions to their owning storage', async () => {
	const pending: PendingDelete[] = [
		{ kind: 'original', storageName: 'original.raw', queuedAt: 1 },
		{ kind: 'thumbnail', storageName: 'thumbnail.jpg', queuedAt: 1 },
		{ kind: 'edit', storageName: 'photo.json', queuedAt: 1 },
		{ kind: 'derived', storageName: 'photo.cache', queuedAt: 1 }
	];
	const deleted: string[] = [];
	let completed: readonly PendingDelete[] = [];
	const catalog = {
		pendingDeletions: async () => pending,
		completeDeletions: async (deletions: readonly PendingDelete[]) => {
			completed = deletions;
		}
	} as unknown as DesktopCatalog;
	const assets = {
		deleteAssets: async (kind: DesktopAssetKind, storageNames: readonly string[]) => {
			deleted.push(...storageNames.map((storageName) => `${kind}/${storageName}`));
		},
		deleteDerived: async (storageNames: readonly string[]) => {
			deleted.push(...storageNames.map((storageName) => `derived/${storageName}`));
		}
	} as unknown as DesktopAssets;

	const result = await createDesktopMaintenance(catalog, assets).resumePendingDeletions();

	assert.deepEqual(deleted, [
		'originals/original.raw',
		'thumbnails/thumbnail.jpg',
		'edits/photo.json',
		'derived/photo.cache'
	]);
	assert.deepEqual(completed, pending);
	assert.deepEqual(result, { deletedFiles: 4, failedFiles: 0, reclaimedBytes: 0 });
});
