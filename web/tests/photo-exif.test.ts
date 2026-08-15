import assert from 'node:assert/strict';
import test from 'node:test';

import { photoMetadata } from '../src/lib/photo-exif.ts';
import { storedPhotoSchema } from '../src/lib/library-schema.ts';

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

interface IfdEntry {
	tag: number;
	type: number;
	count: number;
	payload: Uint8Array;
}

function asciiEntry(tag: number, text: string): IfdEntry {
	const payload = new TextEncoder().encode(`${text}\0`);
	return { tag, type: ASCII, count: payload.length, payload };
}

function shortEntry(tag: number, value: number): IfdEntry {
	const payload = new Uint8Array(2);
	new DataView(payload.buffer).setUint16(0, value, true);
	return { tag, type: SHORT, count: 1, payload };
}

function longEntry(tag: number, value: number): IfdEntry {
	const payload = new Uint8Array(4);
	new DataView(payload.buffer).setUint32(0, value, true);
	return { tag, type: LONG, count: 1, payload };
}

function rationalEntry(tag: number, numerator: number, denominator: number): IfdEntry {
	const payload = new Uint8Array(8);
	const view = new DataView(payload.buffer);
	view.setUint32(0, numerator, true);
	view.setUint32(4, denominator, true);
	return { tag, type: RATIONAL, count: 1, payload };
}

function ifdSize(entryCount: number) {
	return 2 + entryCount * 12 + 4;
}

function tiffBytes(ifd0Entries: IfdEntry[], exifEntries: IfdEntry[]) {
	const exifIfdOffset = 8 + ifdSize(ifd0Entries.length + 1);
	const ifd0 = [...ifd0Entries, longEntry(0x8769, exifIfdOffset)].sort((a, b) => a.tag - b.tag);
	const dataStart = exifIfdOffset + ifdSize(exifEntries.length);
	const overflowLength = [...ifd0, ...exifEntries]
		.filter((entry) => entry.payload.length > 4)
		.reduce((total, entry) => total + entry.payload.length, 0);
	const bytes = new Uint8Array(dataStart + overflowLength);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 0x4949, true);
	view.setUint16(2, 42, true);
	view.setUint32(4, 8, true);

	let dataOffset = dataStart;
	const writeIfd = (entries: IfdEntry[], offset: number) => {
		view.setUint16(offset, entries.length, true);
		entries.forEach((entry, index) => {
			const at = offset + 2 + index * 12;
			view.setUint16(at, entry.tag, true);
			view.setUint16(at + 2, entry.type, true);
			view.setUint32(at + 4, entry.count, true);
			if (entry.payload.length <= 4) {
				bytes.set(entry.payload, at + 8);
			} else {
				view.setUint32(at + 8, dataOffset, true);
				bytes.set(entry.payload, dataOffset);
				dataOffset += entry.payload.length;
			}
		});
		view.setUint32(offset + 2 + entries.length * 12, 0, true);
	};
	writeIfd(ifd0, 8);
	writeIfd(exifEntries, exifIfdOffset);
	return bytes;
}

function exifJpeg(ifd0Entries: IfdEntry[], exifEntries: IfdEntry[]) {
	const tiff = tiffBytes(ifd0Entries, exifEntries);
	const exifHeader = new TextEncoder().encode('Exif\0\0');
	const bytes = new Uint8Array(6 + exifHeader.length + tiff.length + 2);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 0xffd8);
	view.setUint16(2, 0xffe1);
	view.setUint16(4, 2 + exifHeader.length + tiff.length);
	bytes.set(exifHeader, 6);
	bytes.set(tiff, 6 + exifHeader.length);
	view.setUint16(bytes.length - 2, 0xffd9);
	return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

function cameraJpeg() {
	return exifJpeg(
		[asciiEntry(0x010f, 'FUJIFILM'), asciiEntry(0x0110, 'X-T5'), shortEntry(0x0112, 6)],
		[
			rationalEntry(0x829a, 1, 250),
			rationalEntry(0x829d, 28, 10),
			shortEntry(0x8827, 200),
			asciiEntry(0x9003, '2026:08:11 14:30:05'),
			rationalEntry(0x920a, 35, 1),
			asciiEntry(0xa434, 'XF35mmF1.4 R')
		]
	);
}

test('maps camera exif tags to the stored metadata shape', async () => {
	assert.deepEqual(await photoMetadata(cameraJpeg()), {
		orientation: 6,
		cameraMake: 'FUJIFILM',
		cameraModel: 'X-T5',
		lens: 'XF35mmF1.4 R',
		capturedAt: '2026:08:11 14:30:05',
		exposureSeconds: 1 / 250,
		fNumber: 2.8,
		iso: 200,
		focalLengthMm: 35
	});
});

test('falls back to the create date and defaults unknown orientation', async () => {
	const metadata = await photoMetadata(
		exifJpeg([asciiEntry(0x010f, 'NIKON')], [asciiEntry(0x9004, '2025:12:01 08:00:00')])
	);
	assert.equal(metadata?.capturedAt, '2025:12:01 08:00:00');
	assert.equal(metadata?.orientation, 0);
});

test('treats zero, undefined, and blank capture values as unknown', async () => {
	const metadata = await photoMetadata(
		exifJpeg(
			[asciiEntry(0x010f, '  ')],
			[
				rationalEntry(0x829a, 0, 1),
				rationalEntry(0x920a, 1, 0),
				shortEntry(0x8827, 0),
				asciiEntry(0xa434, 'XF35mmF1.4 R')
			]
		)
	);
	assert.deepEqual(metadata, {
		orientation: 0,
		cameraMake: null,
		cameraModel: null,
		lens: 'XF35mmF1.4 R',
		capturedAt: null,
		exposureSeconds: null,
		fNumber: null,
		iso: null,
		focalLengthMm: null
	});
});

test('ignores exif that carries no capture details', async () => {
	assert.equal(await photoMetadata(exifJpeg([shortEntry(0x0112, 1)], [])), null);
});

test('returns null for images without exif', async () => {
	const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
	assert.equal(await photoMetadata(new File([jpeg], 'photo.jpg', { type: 'image/jpeg' })), null);
});

test('returns null instead of failing on unreadable files', async () => {
	assert.equal(await photoMetadata(new Blob([new Uint8Array([1, 2, 3, 4])])), null);
	assert.equal(await photoMetadata(new Blob([])), null);
});

test('produces metadata that persists through the stored photo schema', async () => {
	const photo = {
		id: 'photo-one',
		name: 'photo.jpg',
		importedAt: 1,
		kind: 'display',
		frames: [
			{
				raw: null,
				display: {
					id: 'asset-one',
					storageName: 'asset-one.jpg',
					name: 'photo.jpg',
					contentHash: '0'.repeat(64),
					source: {
						kind: 'image',
						format: 'jpg',
						mediaType: 'image/jpeg',
						size: 1,
						lastModified: 1
					}
				},
				filenameExposureHint: null
			}
		],
		bracketDetection: null,
		thumbnailStorageName: null,
		metadata: await photoMetadata(cameraJpeg()),
		width: 1,
		height: 1,
		rating: 0,
		flagged: false,
		rejected: false,
		colorLabel: 'none',
		stackId: null
	};
	const parsed = storedPhotoSchema.safeParse(photo);
	assert.equal(parsed.success, true);
	assert.equal(parsed.data?.metadata?.cameraModel, 'X-T5');
});
