import { adjustMaskEdges } from './mask-edge-adjustment.ts';
import { freeQuietly, reportError, reportUncaught } from './diagnostics.ts';
import { post, type Request } from './worker-protocol.ts';
import { ready, threadCount, threaded, wasm } from './worker-wasm.ts';
import { measure, measureAsync, setPerformanceEnabled } from './worker-performance.ts';
import {
	activeDocument,
	activeRawDocument,
	applyCameraLook,
	closeDocument,
	deferRawCacheWrite,
	openDisplayDocument,
	openRawDocument
} from './worker-documents.ts';
import { renderPreviewImage, renderScope, sourceImage } from './worker-render.ts';
import { renderTile } from './worker-tiles.ts';
import { setMaskCompositors } from './worker-masks.ts';
import { exportDocument } from './worker-export.ts';
import { rasterizeRange } from './worker-ranges.ts';
import { autoBalance, autoTone } from './worker-auto.ts';

export type {
	DevelopedMaskInput,
	DevelopPhase,
	DevelopProgress,
	MaskEdgeInput,
	RangeComponentInput,
	RawFrameHandleInput,
	RawInspection,
	RawMetadata,
	RenderPerformanceMeasurement,
	RenderPerformanceStage,
	RenderTileRequest,
	Request,
	Response,
	SourceImage,
	WhiteBalanceSample
} from './worker-protocol.ts';

self.onmessage = async (event: MessageEvent<Request>) => {
	const message = event.data;
	try {
		await ready;
		switch (message.type) {
			case 'capabilities':
				setPerformanceEnabled(message.performance === true);
				post({
					id: message.id,
					type: 'capabilities',
					rawExtensions: wasm.supported_raw_extensions(),
					threaded,
					threadCount
				});
				break;
			case 'validate':
				measure('raw-decode', () => wasm.validate_raw(new Uint8Array(message.raw)), 'validation');
				post({ id: message.id, type: 'validated' });
				break;
			case 'inspect':
				inspectDocument(message);
				break;
			case 'open-raw':
				await openRawDocument(message);
				break;
			case 'open-display':
				await openDisplayDocument(message);
				break;
			case 'tile': {
				const active = activeDocument();
				deferRawCacheWrite(active);
				try {
					const bitmap = await measureAsync('tile', () => renderTile(active, message));
					post({ id: message.id, type: 'tile', bitmap }, [bitmap]);
				} finally {
					deferRawCacheWrite(active);
				}
				break;
			}
			case 'adjust-mask': {
				const adjusted = adjustMaskEdges(
					{
						width: message.width,
						height: message.height,
						alpha: new Uint8Array(message.alpha)
					},
					message.edge
				);
				const alpha = adjusted.alpha.buffer as ArrayBuffer;
				post({ id: message.id, type: 'mask-adjusted', alpha }, [alpha]);
				break;
			}
			case 'set-masks':
				setMaskCompositors(message.masks);
				post({ id: message.id, type: 'masks-set' });
				break;
			case 'camera-look':
				applyCameraLook(message.amount);
				post({ id: message.id, type: 'camera-look-set' });
				break;
			case 'preview': {
				const preview = await renderPreviewImage(
					activeDocument(),
					message.adjustments,
					message.crop,
					message.tone
				);
				post(
					{
						id: message.id,
						type: 'preview',
						image: preview.image,
						mediaType: preview.mediaType
					},
					preview.transfer
				);
				break;
			}
			case 'scope': {
				const scope = renderScope(
					activeDocument(),
					message.adjustments,
					message.crop,
					message.tone,
					message.sampleTarget
				);
				post({ id: message.id, type: 'scope', scope: scope.data }, scope.transfer);
				break;
			}
			case 'ultra': {
				const jpeg = activeRawDocument().preview_ultra().buffer as ArrayBuffer;
				post({ id: message.id, type: 'ultra', jpeg }, [jpeg]);
				break;
			}
			case 'source-image': {
				const source = await sourceImage(activeDocument(), message.maxDimension);
				const rgba = source.data.slice().buffer as ArrayBuffer;
				post(
					{
						id: message.id,
						type: 'source-image',
						width: source.width,
						height: source.height,
						rgba
					},
					[rgba]
				);
				break;
			}
			case 'export': {
				const jpeg = await exportDocument(activeDocument(), message);
				post({ id: message.id, type: 'export', jpeg }, [jpeg]);
				break;
			}
			case 'close':
				closeDocument();
				post({ id: message.id, type: 'closed' });
				break;
			case 'rasterize-range': {
				const source = await sourceImage(activeDocument(), message.maxDimension);
				const alpha = rasterizeRange(source, message.component).buffer as ArrayBuffer;
				post(
					{
						id: message.id,
						type: 'range-rasterized',
						width: source.width,
						height: source.height,
						alpha
					},
					[alpha]
				);
				break;
			}
			case 'auto-balance': {
				const balance = await autoBalance(activeDocument(), message.sample);
				post({ id: message.id, type: 'auto-balance', ...balance });
				break;
			}
			case 'auto-tone': {
				const light = await autoTone(activeDocument());
				post({ id: message.id, type: 'auto-tone', light });
				break;
			}
		}
	} catch (error) {
		post({
			id: message.id,
			type: 'error',
			message: reportedFailure(`worker request "${message.type}" failed`, error)
		});
	}
};

reportUncaught('pipeline worker', self);

function reportedFailure(context: string, error: unknown) {
	reportError(context, error);
	return String(error);
}

function inspectDocument(message: Extract<Request, { type: 'inspect' }>) {
	const result = measure(
		'raw-decode',
		() => wasm.inspect_raw(new Uint8Array(message.raw), message.maxDimension),
		'inspection'
	);
	try {
		const thumbnailJpeg = result.thumbnail_jpeg.buffer as ArrayBuffer;
		post(
			{
				id: message.id,
				type: 'inspected',
				inspection: {
					thumbnailJpeg,
					metadata: {
						width: result.width,
						height: result.height,
						orientation: result.orientation,
						cameraMake: result.camera_make ?? null,
						cameraModel: result.camera_model ?? null,
						lens: result.lens ?? null,
						capturedAt: result.captured_at ?? null,
						exposureSeconds: result.exposure_seconds ?? null,
						fNumber: result.f_number ?? null,
						iso: result.iso ?? null,
						focalLengthMm: result.focal_length_mm ?? null
					}
				}
			},
			[thumbnailJpeg]
		);
	} finally {
		freeQuietly('raw inspection', result);
	}
}
