import { HISTOGRAM_BINS, type ImageScopeData, type ImageScopeMode } from './image-scope.ts';

export function renderImageScope(
	host: HTMLCanvasElement,
	scope: ImageScopeData | null,
	mode: ImageScopeMode,
	width: number,
	height: number
) {
	const target = host.ownerDocument.createElement('canvas');
	target.width = width;
	target.height = height;
	const context = target.getContext('2d');
	if (!context) return target;
	drawGrid(context, width, height);
	if (!scope) return target;
	if (mode === 'waveform') drawWaveform(context, target, scope, width, height);
	else drawHistogram(context, scope, width, height);
	return target;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
	context.fillStyle = '#11110f';
	context.fillRect(0, 0, width, height);
	context.strokeStyle = 'rgba(122, 117, 104, 0.16)';
	context.lineWidth = 1;
	for (const position of [0.25, 0.5, 0.75]) {
		const y = Math.round(height * position) + 0.5;
		context.beginPath();
		context.moveTo(0, y);
		context.lineTo(width, y);
		context.stroke();
	}
}

function drawWaveform(
	context: CanvasRenderingContext2D,
	target: HTMLCanvasElement,
	scope: ImageScopeData,
	width: number,
	height: number
) {
	const density = target.ownerDocument.createElement('canvas');
	density.width = scope.waveformWidth;
	density.height = scope.waveformHeight;
	const densityContext = density.getContext('2d');
	if (!densityContext) return;
	const pixels = densityContext.createImageData(scope.waveformWidth, scope.waveformHeight);
	const plane = scope.waveformWidth * scope.waveformHeight;
	let peak = 0;
	for (let channel = 0; channel < 3; channel += 1) {
		for (let index = 0; index < plane; index += 1) {
			peak = Math.max(peak, scope.waveform[channel * plane + index] ?? 0);
		}
	}
	const logarithmicPeak = Math.log1p(Math.max(1, peak));
	for (let index = 0; index < plane; index += 1) {
		const red = densityLevel(scope.waveform[index] ?? 0, logarithmicPeak);
		const green = densityLevel(scope.waveform[plane + index] ?? 0, logarithmicPeak);
		const blue = densityLevel(scope.waveform[plane * 2 + index] ?? 0, logarithmicPeak);
		const strongest = Math.max(red, green, blue);
		if (strongest === 0) continue;
		const offset = index * 4;
		pixels.data[offset] = Math.round((red / strongest) * 255);
		pixels.data[offset + 1] = Math.round((green / strongest) * 255);
		pixels.data[offset + 2] = Math.round((blue / strongest) * 255);
		pixels.data[offset + 3] = Math.round(Math.pow(strongest, 0.72) * 235);
	}
	densityContext.putImageData(pixels, 0, 0);

	context.save();
	context.imageSmoothingEnabled = true;
	context.globalCompositeOperation = 'screen';
	context.globalAlpha = 0.42;
	context.filter = `blur(${Math.max(2, width / 180)}px)`;
	context.drawImage(density, 0, 0, width, height);
	context.filter = 'none';
	context.globalAlpha = 0.9;
	context.drawImage(density, 0, 0, width, height);
	context.restore();
}

function densityLevel(count: number, logarithmicPeak: number) {
	return count === 0 ? 0 : Math.pow(Math.log1p(count) / logarithmicPeak, 0.78);
}

function drawHistogram(
	context: CanvasRenderingContext2D,
	scope: ImageScopeData,
	width: number,
	height: number
) {
	let peak = 0;
	for (const count of scope.histogram) peak = Math.max(peak, count);
	const logarithmicPeak = Math.log1p(Math.max(1, peak));
	const channels = [
		{ index: 3, color: '#e8e5df', fill: 0.07, line: 0.36 },
		{ index: 0, color: '#ff5968', fill: 0.1, line: 0.82 },
		{ index: 1, color: '#62d979', fill: 0.09, line: 0.78 },
		{ index: 2, color: '#5f83ff', fill: 0.11, line: 0.86 }
	];
	for (const channel of channels) {
		const values = scope.histogram.subarray(
			channel.index * HISTOGRAM_BINS,
			(channel.index + 1) * HISTOGRAM_BINS
		);
		const paths = histogramPaths(values, logarithmicPeak, width, height);
		context.save();
		context.globalCompositeOperation = 'screen';
		context.fillStyle = channel.color;
		context.globalAlpha = channel.fill;
		context.fill(paths.fill);
		context.globalAlpha = channel.line;
		context.strokeStyle = channel.color;
		context.lineWidth = Math.max(1, width / 280);
		context.shadowColor = channel.color;
		context.shadowBlur = Math.max(2, width / 90);
		context.stroke(paths.trace);
		context.restore();
	}
}

function histogramPaths(
	values: Uint32Array,
	logarithmicPeak: number,
	width: number,
	height: number
) {
	const fill = new Path2D();
	const trace = new Path2D();
	const bottom = height;
	const verticalPadding = Math.max(3, height * 0.04);
	const availableHeight = height - verticalPadding * 2;
	const point = (index: number) => ({
		x: (index / (HISTOGRAM_BINS - 1)) * width,
		y:
			height -
			verticalPadding -
			(Math.log1p(values[index] ?? 0) / logarithmicPeak) * availableHeight
	});
	let previous = point(0);
	fill.moveTo(0, bottom);
	fill.lineTo(previous.x, previous.y);
	trace.moveTo(previous.x, previous.y);
	for (let index = 1; index < HISTOGRAM_BINS; index += 1) {
		const current = point(index);
		const midpoint = {
			x: (previous.x + current.x) / 2,
			y: (previous.y + current.y) / 2
		};
		fill.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
		trace.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
		previous = current;
	}
	fill.lineTo(previous.x, previous.y);
	trace.lineTo(previous.x, previous.y);
	fill.lineTo(width, bottom);
	fill.closePath();
	return { fill, trace };
}
