import type { ImageScopeData } from './image-scope.ts';

export function renderWaveformScope(
	host: HTMLCanvasElement,
	scope: ImageScopeData | null,
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
	drawWaveform(context, target, scope, width, height);
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
