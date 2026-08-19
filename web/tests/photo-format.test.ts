import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEditDocument } from '../src/lib/edit-document.ts';
import type { StoredMetadata } from '../src/lib/library-schema.ts';
import { focalLength, lens, metadataRows } from '../src/lib/photo-format.ts';
import type { Photo } from '../src/lib/workspace.svelte.ts';

const photo = (metadata: Partial<StoredMetadata> | null = null): Photo => ({
	id: 'p1',
	name: 'p1.jpg',
	extension: 'jpg',
	src: null,
	kind: 'display',
	frames: [],
	bracketDetection: null,
	thumbnailStorageName: null,
	metadata: metadata
		? {
				orientation: 1,
				cameraMake: null,
				cameraModel: null,
				lens: null,
				capturedAt: null,
				exposureSeconds: null,
				fNumber: null,
				iso: null,
				focalLengthMm: null,
				...metadata
			}
		: null,
	size: 0,
	width: 4000,
	height: 3000,
	captured: 'Mar 4, 2024, 3:15 PM',
	importedAt: 0,
	rating: 0,
	flagged: false,
	rejected: false,
	colorLabel: 'none',
	stackId: null,
	edit: defaultEditDocument('p1')
});

test('lens falls back to a dash', () => {
	assert.equal(lens(photo({ lens: 'RF 35mm F1.8' })), 'RF 35mm F1.8');
	assert.equal(lens(photo()), '—');
});

test('focalLength renders trimmed millimetres or a dash', () => {
	assert.equal(focalLength(photo({ focalLengthMm: 35 })), '35 mm');
	assert.equal(focalLength(photo({ focalLengthMm: 23.42 })), '23.4 mm');
	assert.equal(focalLength(photo()), '—');
});

test('metadataRows lays out the detail rail in display order', () => {
	const rows = metadataRows(
		photo({
			cameraMake: 'Canon',
			cameraModel: 'R6',
			lens: 'RF 35mm F1.8',
			exposureSeconds: 0.005,
			fNumber: 1.8,
			iso: 400,
			focalLengthMm: 35
		})
	);
	assert.deepEqual(rows, [
		{ label: 'captured', value: 'Mar 4, 2024, 3:15 PM' },
		{ label: 'dimensions', value: '4000 × 3000', mono: true },
		{ label: 'camera', value: 'Canon R6' },
		{ label: 'lens', value: 'RF 35mm F1.8' },
		{ label: 'focal length', value: '35 mm', mono: true },
		{ label: 'exposure', value: '1/200 · f/1.8 · ISO 400', mono: true }
	]);
});

test('metadataRows dashes out missing metadata', () => {
	assert.deepEqual(
		metadataRows(photo()).map(({ value }) => value),
		['Mar 4, 2024, 3:15 PM', '4000 × 3000', '—', '—', '—', '—']
	);
});
