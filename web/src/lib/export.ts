export type ExportPhase = 'decode' | 'develop' | 'encode';

export interface ExportProgress {
	phase: ExportPhase;
	completed: number;
	total: number;
}

export interface ExportCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ExportGeometry {
	rotation: number;
	flipHorizontal: boolean;
	flipVertical: boolean;
	crop: ExportCrop | null;
}

export interface ExportRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_EXPORT_QUALITY = 92;

const PHASE_SPANS: Record<ExportPhase, { start: number; end: number }> = {
	decode: { start: 0, end: 0.05 },
	develop: { start: 0.05, end: 0.8 },
	encode: { start: 0.8, end: 1 }
};

export function exportProgressPercent({ phase, completed, total }: ExportProgress): number {
	const { start, end } = PHASE_SPANS[phase];
	const fraction = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
	return Math.round((start + (end - start) * fraction) * 100);
}

export function exportFileName(photoName: string): string {
	const trimmed = photoName.trim();
	const dot = trimmed.lastIndexOf('.');
	const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
	return `${stem || 'photograph'}-edit.jpg`;
}

export function exportMetadataSource<Handle>(
	frames: readonly { raw: Handle; jpeg?: Handle }[]
): Handle | null {
	const reference = frames[Math.floor(frames.length / 2)];
	if (!reference) return null;
	return reference.jpeg ?? frames.find((frame) => frame.jpeg)?.jpeg ?? reference.raw;
}

export function exportTiles(width: number, height: number, tileSize: number): ExportRegion[] {
	const tiles: ExportRegion[] = [];
	for (let y = 0; y < height; y += tileSize) {
		for (let x = 0; x < width; x += tileSize) {
			tiles.push({
				x,
				y,
				width: Math.min(tileSize, width - x),
				height: Math.min(tileSize, height - y)
			});
		}
	}
	return tiles;
}

export function rotatedBounds(width: number, height: number, rotation: number) {
	const radians = (rotation * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	return {
		width: Math.max(1, Math.round(width * cos + height * sin)),
		height: Math.max(1, Math.round(width * sin + height * cos))
	};
}

export function cropRegion(width: number, height: number, crop: ExportCrop | null): ExportRegion {
	if (!crop) return { x: 0, y: 0, width, height };
	const x = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
	const y = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
	return {
		x,
		y,
		width: Math.max(1, Math.min(width - x, Math.round(crop.width * width))),
		height: Math.max(1, Math.min(height - y, Math.round(crop.height * height)))
	};
}

export function identityGeometry(geometry: ExportGeometry): boolean {
	return (
		geometry.rotation === 0 &&
		!geometry.flipHorizontal &&
		!geometry.flipVertical &&
		geometry.crop === null
	);
}
