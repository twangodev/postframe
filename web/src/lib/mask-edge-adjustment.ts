import { maskEdgeSettingsSchema, type MaskEdgeSettings } from './mask-edge-settings.ts';
import { validateMaskRaster, type MaskRasterData } from './mask-raster.ts';

export function adjustMaskEdges(
	raster: MaskRasterData,
	settings: MaskEdgeSettings
): MaskRasterData {
	validateMaskRaster(raster);
	const parsed = maskEdgeSettingsSchema.parse(settings);
	let alpha = shiftedAlpha(raster, parsed.shift);
	alpha = featheredAlpha(alpha, raster.width, raster.height, parsed.feather);
	alpha = contrastedAlpha(alpha, parsed.contrast);
	return { width: raster.width, height: raster.height, alpha };
}

function shiftedAlpha(raster: MaskRasterData, shift: number): Uint8Array<ArrayBuffer> {
	const radius = Math.round(Math.abs(shift));
	if (radius === 0) return Uint8Array.from(raster.alpha);
	const horizontal = new Uint8Array(raster.alpha.length);
	const shifted = new Uint8Array(raster.alpha.length);
	const maximum = shift > 0;
	extremumPass(
		raster.alpha,
		horizontal,
		raster.width,
		raster.height,
		1,
		raster.width,
		radius,
		maximum
	);
	extremumPass(horizontal, shifted, raster.height, raster.width, raster.width, 1, radius, maximum);
	return shifted;
}

function featheredAlpha(
	alpha: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	feather: number
) {
	const radii = gaussianBoxRadii(feather, 3).filter((radius) => radius > 0);
	if (radii.length === 0) return alpha;
	let current = alpha;
	let horizontal = new Uint8Array(alpha.length);
	let blurred = new Uint8Array(alpha.length);
	for (const radius of radii) {
		boxBlurPass(current, horizontal, width, height, 1, width, radius);
		boxBlurPass(horizontal, blurred, height, width, width, 1, radius);
		[current, blurred] = [blurred, current];
	}
	return current;
}

function contrastedAlpha(
	alpha: Uint8Array<ArrayBuffer>,
	contrast: number
): Uint8Array<ArrayBuffer> {
	if (contrast === 0) return alpha;
	const exponent = 1 + contrast / 25;
	return Uint8Array.from(alpha, (value) => {
		if (value === 0 || value === 255) return value;
		const normalized = value / 255;
		const foreground = normalized ** exponent;
		const background = (1 - normalized) ** exponent;
		return Math.round((foreground / (foreground + background)) * 255);
	});
}

function extremumPass(
	source: Uint8Array,
	target: Uint8Array,
	lineLength: number,
	lineCount: number,
	stride: number,
	lineStride: number,
	radius: number,
	maximum: boolean
) {
	const queue = new Int32Array(lineLength);
	for (let line = 0; line < lineCount; line += 1) {
		const base = line * lineStride;
		let head = 0;
		let tail = 0;
		let included = 0;
		for (let position = 0; position < lineLength; position += 1) {
			const end = Math.min(lineLength - 1, position + radius);
			while (included <= end) {
				const value = source[base + included * stride]!;
				while (tail > head) {
					const queued = source[base + queue[tail - 1]! * stride]!;
					if (maximum ? queued > value : queued < value) break;
					tail -= 1;
				}
				queue[tail] = included;
				tail += 1;
				included += 1;
			}
			const start = position - radius;
			while (tail > head && queue[head]! < start) head += 1;
			target[base + position * stride] = source[base + queue[head]! * stride]!;
		}
	}
}

function boxBlurPass(
	source: Uint8Array,
	target: Uint8Array,
	lineLength: number,
	lineCount: number,
	stride: number,
	lineStride: number,
	radius: number
) {
	for (let line = 0; line < lineCount; line += 1) {
		const base = line * lineStride;
		let first = 0;
		let last = Math.min(lineLength - 1, radius);
		let sum = 0;
		for (let position = first; position <= last; position += 1) {
			sum += source[base + position * stride]!;
		}
		for (let position = 0; position < lineLength; position += 1) {
			target[base + position * stride] = Math.round(sum / (last - first + 1));
			const nextFirst = Math.max(0, position + 1 - radius);
			const nextLast = Math.min(lineLength - 1, position + 1 + radius);
			while (first < nextFirst) {
				sum -= source[base + first * stride]!;
				first += 1;
			}
			while (last < nextLast) {
				last += 1;
				sum += source[base + last * stride]!;
			}
		}
	}
}

function gaussianBoxRadii(sigma: number, passes: number) {
	if (sigma <= 0) return [];
	const idealWidth = Math.sqrt((12 * sigma * sigma) / passes + 1);
	const roundedWidth = Math.floor(idealWidth);
	const narrowWidth = Math.max(1, roundedWidth % 2 === 0 ? roundedWidth - 1 : roundedWidth);
	const wideWidth = narrowWidth + 2;
	const narrowPasses = Math.max(
		0,
		Math.min(
			passes,
			Math.round(
				(12 * sigma * sigma -
					passes * narrowWidth * narrowWidth -
					4 * passes * narrowWidth -
					3 * passes) /
					(-4 * narrowWidth - 4)
			)
		)
	);
	return Array.from({ length: passes }, (_, index) =>
		Math.floor(((index < narrowPasses ? narrowWidth : wideWidth) - 1) / 2)
	);
}
