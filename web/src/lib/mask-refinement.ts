export const UNKNOWN_TRIMAP_VALUE = 128;

const BACKGROUND_TRIMAP_VALUE = 0;
const FOREGROUND_TRIMAP_VALUE = 255;
const MASK_THRESHOLD = 128;
const CONFIDENT_BACKGROUND = 24;
const CONFIDENT_FOREGROUND = 231;
const UNREACHED = 65_535;

export interface MaskBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MatteRegion {
	bounds: MaskBounds;
	trimap: Uint8Array;
}

export function matteBoundaryRadius(width: number, height: number) {
	return Math.max(4, Math.round(Math.max(width, height) / 128));
}

export function prepareMatteRegion(
	coarseAlpha: Uint8Array,
	width: number,
	height: number,
	radius = matteBoundaryRadius(width, height)
): MatteRegion | null {
	validatePlane(coarseAlpha, width, height);
	const foreground = foregroundBounds(coarseAlpha, width, height);
	if (!foreground) return null;
	const trimap = trimapFromAlpha(coarseAlpha, width, height, radius);
	const bounds = expandBounds(foreground, radius * 3, width, height);
	return { bounds, trimap: cropPlane(trimap, width, bounds) };
}

export function cropMaskRegion(source: Uint8Array, width: number, bounds: MaskBounds) {
	const height = source.length / width;
	validatePlane(source, width, height);
	validateBounds(bounds, width, height);
	return cropPlane(source, width, bounds);
}

export function trimapFromAlpha(
	coarseAlpha: Uint8Array,
	width: number,
	height: number,
	radius: number
) {
	validatePlane(coarseAlpha, width, height);
	if (!Number.isInteger(radius) || radius < 0)
		throw new Error('Trimap radius must be non-negative');
	const trimap = Uint8Array.from(coarseAlpha, (alpha) =>
		alpha >= MASK_THRESHOLD ? FOREGROUND_TRIMAP_VALUE : BACKGROUND_TRIMAP_VALUE
	);
	const distance = new Uint16Array(coarseAlpha.length);
	distance.fill(UNREACHED);
	const queue = new Int32Array(coarseAlpha.length);
	let tail = 0;

	const seed = (index: number) => {
		if (distance[index] !== UNREACHED) return;
		distance[index] = 0;
		queue[tail++] = index;
	};

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			const alpha = coarseAlpha[index]!;
			if (alpha > CONFIDENT_BACKGROUND && alpha < CONFIDENT_FOREGROUND) seed(index);
			if (x + 1 < width && selected(alpha) !== selected(coarseAlpha[index + 1]!)) {
				seed(index);
				seed(index + 1);
			}
			if (y + 1 < height && selected(alpha) !== selected(coarseAlpha[index + width]!)) {
				seed(index);
				seed(index + width);
			}
		}
	}

	for (let head = 0; head < tail; head += 1) {
		const index = queue[head]!;
		const nextDistance = distance[index]! + 1;
		trimap[index] = UNKNOWN_TRIMAP_VALUE;
		if (nextDistance > radius) continue;
		const x = index % width;
		const y = Math.floor(index / width);
		if (x > 0) tail = visit(index - 1, nextDistance, distance, queue, tail);
		if (x + 1 < width) tail = visit(index + 1, nextDistance, distance, queue, tail);
		if (y > 0) tail = visit(index - width, nextDistance, distance, queue, tail);
		if (y + 1 < height) tail = visit(index + width, nextDistance, distance, queue, tail);
	}
	return trimap;
}

export function mergeRefinedAlpha(
	trimap: Uint8Array,
	matte: Uint8Array,
	width: number,
	height: number
) {
	validatePlane(trimap, width, height);
	validatePlane(matte, width, height);
	return Uint8Array.from(trimap, (value, index) => {
		if (value === BACKGROUND_TRIMAP_VALUE) return BACKGROUND_TRIMAP_VALUE;
		if (value === FOREGROUND_TRIMAP_VALUE) return FOREGROUND_TRIMAP_VALUE;
		return matte[index]!;
	});
}

export function placeMaskRegion(
	region: Uint8Array,
	bounds: MaskBounds,
	width: number,
	height: number
) {
	validatePlane(region, bounds.width, bounds.height);
	validateBounds(bounds, width, height);
	const alpha = new Uint8Array(width * height);
	for (let y = 0; y < bounds.height; y += 1) {
		alpha.set(
			region.subarray(y * bounds.width, (y + 1) * bounds.width),
			(bounds.y + y) * width + bounds.x
		);
	}
	return alpha;
}

function visit(
	index: number,
	nextDistance: number,
	distance: Uint16Array,
	queue: Int32Array,
	tail: number
) {
	if (distance[index]! <= nextDistance) return tail;
	distance[index] = nextDistance;
	queue[tail] = index;
	return tail + 1;
}

function foregroundBounds(alpha: Uint8Array, width: number, height: number): MaskBounds | null {
	let left = width;
	let top = height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (!selected(alpha[y * width + x]!)) continue;
			left = Math.min(left, x);
			top = Math.min(top, y);
			right = Math.max(right, x);
			bottom = Math.max(bottom, y);
		}
	}
	return right < left
		? null
		: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function expandBounds(
	bounds: MaskBounds,
	padding: number,
	width: number,
	height: number
): MaskBounds {
	const x = Math.max(0, bounds.x - padding);
	const y = Math.max(0, bounds.y - padding);
	const right = Math.min(width, bounds.x + bounds.width + padding);
	const bottom = Math.min(height, bounds.y + bounds.height + padding);
	return { x, y, width: right - x, height: bottom - y };
}

function cropPlane(source: Uint8Array, sourceWidth: number, bounds: MaskBounds) {
	const crop = new Uint8Array(bounds.width * bounds.height);
	for (let y = 0; y < bounds.height; y += 1) {
		const start = (bounds.y + y) * sourceWidth + bounds.x;
		crop.set(source.subarray(start, start + bounds.width), y * bounds.width);
	}
	return crop;
}

function selected(alpha: number) {
	return alpha >= MASK_THRESHOLD;
}

function validatePlane(data: Uint8Array, width: number, height: number) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		data.length !== width * height
	) {
		throw new Error('Mask dimensions do not match its pixels');
	}
}

function validateBounds(bounds: MaskBounds, width: number, height: number) {
	if (
		!Number.isSafeInteger(bounds.x) ||
		!Number.isSafeInteger(bounds.y) ||
		!Number.isSafeInteger(bounds.width) ||
		!Number.isSafeInteger(bounds.height) ||
		bounds.x < 0 ||
		bounds.y < 0 ||
		bounds.width < 1 ||
		bounds.height < 1 ||
		bounds.x + bounds.width > width ||
		bounds.y + bounds.height > height
	) {
		throw new Error('Mask region falls outside its pixels');
	}
}
