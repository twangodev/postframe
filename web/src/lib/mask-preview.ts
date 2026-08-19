import { separator, type MenuLeaf } from './menu.ts';

export const MASK_PREVIEW_MODES = ['overlay', 'matte', 'edge'] as const;

export type MaskPreviewMode = (typeof MASK_PREVIEW_MODES)[number];

export function maskPreviewMenu(mode: MaskPreviewMode | null): MenuLeaf<MaskPreviewMode | null>[] {
	const choice = (option: MaskPreviewMode | null): MenuLeaf<MaskPreviewMode | null> => ({
		kind: 'action',
		label: option ?? 'off',
		action: option,
		checked: mode === option
	});
	return [...MASK_PREVIEW_MODES.map(choice), separator(), choice(null)];
}

export const MASK_OVERLAY_TINT_ALPHA = 0.46;

export function tintCoverage(context: CanvasRenderingContext2D, width: number, height: number) {
	context.globalCompositeOperation = 'source-in';
	context.fillStyle = getComputedStyle(context.canvas).color;
	context.fillRect(0, 0, width, height);
	context.globalCompositeOperation = 'source-over';
}

export function maskEdgePreview(alpha: Uint8Array, width: number, height: number) {
	if (alpha.length !== width * height) throw new Error('Mask preview dimensions do not match');
	const edge = new Uint8Array(alpha.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			let minimum = alpha[index]!;
			let maximum = minimum;
			for (
				let neighborY = Math.max(0, y - 1);
				neighborY <= Math.min(height - 1, y + 1);
				neighborY += 1
			) {
				for (
					let neighborX = Math.max(0, x - 1);
					neighborX <= Math.min(width - 1, x + 1);
					neighborX += 1
				) {
					const value = alpha[neighborY * width + neighborX]!;
					minimum = Math.min(minimum, value);
					maximum = Math.max(maximum, value);
				}
			}
			edge[index] = Math.min(255, (maximum - minimum) * 3);
		}
	}
	return edge;
}
