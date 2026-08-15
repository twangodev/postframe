import exifr from 'exifr';

import type { StoredMetadata } from './library-schema';

const CAPTURE_TAGS = [
	'Orientation',
	'Make',
	'Model',
	'LensModel',
	'DateTimeOriginal',
	'CreateDate',
	'ExposureTime',
	'FNumber',
	'ISO',
	'FocalLength'
];

export async function photoMetadata(file: File | Blob): Promise<StoredMetadata | null> {
	try {
		const tags: Record<string, unknown> | undefined = await exifr.parse(await file.arrayBuffer(), {
			pick: CAPTURE_TAGS,
			translateValues: false,
			reviveValues: false
		});
		return tags ? storedExifMetadata(tags) : null;
	} catch {
		return null;
	}
}

function storedExifMetadata(tags: Record<string, unknown>): StoredMetadata | null {
	const details = {
		cameraMake: nonEmpty(tags.Make),
		cameraModel: nonEmpty(tags.Model),
		lens: nonEmpty(tags.LensModel),
		capturedAt: nonEmpty(tags.DateTimeOriginal) ?? nonEmpty(tags.CreateDate),
		exposureSeconds: positive(tags.ExposureTime),
		fNumber: positive(tags.FNumber),
		iso: positiveInteger(tags.ISO),
		focalLengthMm: positive(tags.FocalLength)
	};
	if (Object.values(details).every((value) => value === null)) return null;
	return { orientation: exifOrientation(tags.Orientation), ...details };
}

function exifOrientation(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8
		? value
		: 0;
}

function nonEmpty(value: unknown) {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function positive(value: unknown) {
	const single = Array.isArray(value) ? value[0] : value;
	return typeof single === 'number' && Number.isFinite(single) && single > 0 ? single : null;
}

function positiveInteger(value: unknown) {
	const number = positive(value);
	if (number === null) return null;
	const rounded = Math.round(number);
	return rounded > 0 ? rounded : null;
}
