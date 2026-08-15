import type { ColorLabel, Photo } from './workspace.svelte.ts';

export const colorLabelChoices: ColorLabel[] = ['red', 'yellow', 'green', 'blue', 'purple'];

export const labelColors: Record<ColorLabel, string> = {
	none: 'var(--color-muted)',
	red: '#c26f68',
	yellow: '#c4a35a',
	green: '#6fa878',
	blue: '#5e8fc9',
	purple: '#9676b8'
};

export function dimensions(photo: Photo) {
	return photo.width && photo.height ? `${photo.width} × ${photo.height}` : '—';
}

export function camera(photo: Photo) {
	return [photo.metadata?.cameraMake, photo.metadata?.cameraModel].filter(Boolean).join(' ') || '—';
}

export function exposure(photo: Photo) {
	const metadata = photo.metadata;
	if (!metadata) return '—';
	const values = [
		formatExposureTime(metadata.exposureSeconds),
		metadata.fNumber ? `f/${formatDecimal(metadata.fNumber)}` : null,
		metadata.iso ? `ISO ${metadata.iso}` : null
	].filter(Boolean);
	return values.join(' · ') || '—';
}

export function formatDecimal(value: number) {
	return Number(value.toFixed(1)).toString();
}

function formatExposureTime(seconds: number | null) {
	if (!seconds) return null;
	if (seconds >= 1) return `${formatDecimal(seconds)}s`;
	return `1/${Math.round(1 / seconds)}`;
}
