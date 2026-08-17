import { defaultColorSettings, developSettingsKey, type DevelopSettings } from './develop-settings';
import type { WasmSession } from './wasm-runtime';
import type { LinearTileSource } from './webgpu-renderer.ts';
import { wasm } from './worker-wasm.ts';
import type { RenderTileRequest } from './worker-protocol.ts';
import { canvasContext, displayTransform, imageData } from './worker-render.ts';
import { compositeDevelopedTile, hasMaskCompositors } from './worker-masks.ts';
import type { ActiveDocument, RawDocument } from './worker-documents.ts';

export async function renderTile(active: ActiveDocument, request: RenderTileRequest) {
	const developed = await renderDevelopedTile(active, request);
	if (!hasMaskCompositors()) return developed;
	try {
		return compositeDevelopedTile(active, developed, request);
	} catch {
		return developed;
	}
}

async function renderDevelopedTile(active: ActiveDocument, request: RenderTileRequest) {
	if (active.kind === 'raw') {
		if (active.renderer) {
			const key = rawTileKey(request);
			let tile: ReturnType<WasmSession['render_tile_linear']> | null = null;
			try {
				let source: LinearTileSource | null = null;
				if (!active.renderer.hasSource(key)) {
					tile = active.session.render_tile_linear(
						request.x,
						request.y,
						request.width,
						request.height,
						request.bin
					);
					source = { rgba: tile.rgba, width: tile.width, height: tile.height };
				}
				return await active.renderer.render(
					key,
					source,
					request.adjustments,
					request.tone,
					rawDevelopLuts(active, request.adjustments)
				);
			} catch {
				active.renderer.destroy();
				active.renderer = null;
			} finally {
				tile?.free();
			}
		}
		const tile = active.session.render_tile(
			request.x,
			request.y,
			request.width,
			request.height,
			request.bin,
			request.adjustments,
			request.tone
		);
		try {
			const context = canvasContext(tile.width, tile.height, false);
			context.putImageData(imageData(tile.rgba, tile.width, tile.height), 0, 0);
			return context.canvas.transferToImageBitmap();
		} finally {
			tile.free();
		}
	}

	const width = Math.ceil(request.width / request.bin);
	const height = Math.ceil(request.height / request.bin);
	const context = canvasContext(width, height);
	context.imageSmoothingEnabled = request.bin > 1;
	context.imageSmoothingQuality = 'high';
	context.drawImage(
		active.bitmap,
		request.x,
		request.y,
		request.width,
		request.height,
		0,
		0,
		width,
		height
	);
	const pixels = context.getImageData(0, 0, width, height);
	const adjusted = displayTransform(active, request.adjustments).apply_rgba(
		new Uint8Array(pixels.data)
	);
	context.putImageData(imageData(adjusted, width, height), 0, 0);
	return context.canvas.transferToImageBitmap();
}

function rawTileKey(tile: RenderTileRequest) {
	return `${tile.x}:${tile.y}:${tile.width}:${tile.height}:${tile.bin}`;
}

function rawDevelopLuts(active: RawDocument, adjustments: DevelopSettings) {
	const key = developSettingsKey(adjustments);
	if (active.developLuts?.key === key) return active.developLuts;
	const transform = new wasm.DisplayTransform({
		...adjustments,
		light: { ...adjustments.light, exposure: 0 },
		color: defaultColorSettings()
	});
	try {
		const luts = {
			key,
			luminance: transform.luminance_lut,
			mixer: transform.mixer_luts,
			grading: transform.grading_scalars
		};
		active.developLuts = luts;
		return luts;
	} finally {
		transform.free();
	}
}
