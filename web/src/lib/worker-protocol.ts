import type { ClippingIndicators } from './clipping.ts';
import type { DevelopSettings, LightSettings, MaskAdjustments } from './develop-settings';
import type {
	ColorRangeComponent,
	LuminanceRangeComponent,
	NormalizedCrop,
	NormalizedPoint
} from './edit-document.ts';
import type { ImageScopeTransfer } from './image-scope';
import type { MaskEdgeSettings } from './mask-edge-settings.ts';
import type { ExportGeometry, ExportProgress } from './export.ts';
import type { CameraMatchResult } from './camera-match.ts';

export type FileSource =
	| { kind: 'handle'; handle: FileSystemFileHandle }
	| { kind: 'url'; url: string; name: string; size: number };

export interface RawFrameHandleInput {
	raw: FileSource;
	jpeg?: FileSource;
}

export interface RawMetadata {
	width: number;
	height: number;
	orientation: number;
	cameraMake: string | null;
	cameraModel: string | null;
	lens: string | null;
	capturedAt: string | null;
	exposureSeconds: number | null;
	fNumber: number | null;
	iso: number | null;
	focalLengthMm: number | null;
}

export interface RawInspection {
	thumbnailJpeg: ArrayBuffer;
	metadata: RawMetadata;
}

export type DevelopPhase = 'reading' | 'decoding' | 'merging' | 'rendering';

export interface DevelopProgress {
	phase: DevelopPhase;
	bytesRead: number;
	totalBytes: number;
	framesDecoded: number;
	totalFrames: number;
	activeFrame: number;
}

export type RenderPerformanceStage =
	| 'file-read'
	| 'cache-read'
	| 'cache-restore'
	| 'cache-write'
	| 'raw-decode'
	| 'display-decode'
	| 'merge'
	| 'preview'
	| 'tile';

export interface RenderPerformanceMeasurement {
	stage: RenderPerformanceStage;
	durationMs: number;
	detail?: string;
}

export interface RenderTileRequest {
	x: number;
	y: number;
	width: number;
	height: number;
	bin: number;
	adjustments: DevelopSettings;
	crop: NormalizedCrop | null;
	tone: boolean;
	clipping?: ClippingIndicators;
}

export interface DevelopedMaskInput {
	id: string;
	width: number;
	height: number;
	alpha: ArrayBuffer;
	edge: MaskEdgeSettings;
	settings: MaskAdjustments;
}

export interface SourceImage {
	width: number;
	height: number;
	rgba: Uint8ClampedArray;
}

export interface MaskEdgeInput {
	width: number;
	height: number;
	alpha: ArrayBuffer;
	edge: MaskEdgeSettings;
}

export type RangeComponentInput =
	| { type: 'luminance-range'; range: LuminanceRangeComponent['range'] }
	| { type: 'color-range'; range: ColorRangeComponent['range'] };

/** A point on the image and how far around it to read, in source-image pixels. */
export interface WhiteBalanceSample extends NormalizedPoint {
	radius: number;
}

export type Request =
	| { id: number; type: 'capabilities'; performance?: boolean }
	| { id: number; type: 'validate'; raw: ArrayBuffer }
	| { id: number; type: 'inspect'; raw: ArrayBuffer; maxDimension: number }
	| {
			id: number;
			type: 'open-raw';
			frames: RawFrameHandleInput[];
			cache: FileSystemFileHandle;
			maxDimension: number;
			adjustments: DevelopSettings;
			crop: NormalizedCrop | null;
			cameraLook: number;
			matchCamera: boolean;
	  }
	| {
			id: number;
			type: 'open-display';
			source: FileSource;
			maxDimension: number;
			adjustments: DevelopSettings;
			crop: NormalizedCrop | null;
	  }
	| ({ id: number; type: 'tile' } & RenderTileRequest)
	| ({ id: number; type: 'adjust-mask' } & MaskEdgeInput)
	| { id: number; type: 'set-masks'; masks: DevelopedMaskInput[] }
	| { id: number; type: 'camera-look'; amount: number }
	| { id: number; type: 'camera-match' }
	| {
			id: number;
			type: 'preview';
			adjustments: DevelopSettings;
			crop: NormalizedCrop | null;
			tone: boolean;
	  }
	| {
			id: number;
			type: 'scope';
			adjustments: DevelopSettings;
			crop: NormalizedCrop | null;
			tone: boolean;
			sampleTarget: number;
	  }
	| { id: number; type: 'ultra' }
	| { id: number; type: 'source-image'; maxDimension: number }
	| {
			id: number;
			type: 'export';
			adjustments: DevelopSettings;
			masks: DevelopedMaskInput[];
			geometry: ExportGeometry;
			quality: number;
	  }
	| { id: number; type: 'close' }
	| { id: number; type: 'rasterize-range'; component: RangeComponentInput; maxDimension: number }
	| { id: number; type: 'auto-balance'; sample?: WhiteBalanceSample }
	| { id: number; type: 'auto-tone' };

export type Response =
	| { id: 0; type: 'performance'; measurement: RenderPerformanceMeasurement }
	| { id: 0; type: 'storage-written' }
	| { id: number; type: 'mask-adjusted'; alpha: ArrayBuffer }
	| ({ id: number; type: 'progress' } & DevelopProgress)
	| {
			id: number;
			type: 'capabilities';
			rawExtensions: string[];
			threaded: boolean;
			threadCount: number;
	  }
	| { id: number; type: 'validated' }
	| { id: number; type: 'inspected'; inspection: RawInspection }
	| {
			id: number;
			type: 'opened';
			image: ArrayBuffer;
			mediaType: 'image/jpeg' | 'image/png';
			scope: ImageScopeTransfer;
			boostStops: number | null;
			width: number;
			height: number;
			cameraMatch?: CameraMatchResult;
	  }
	| { id: number; type: 'tile'; bitmap: ImageBitmap }
	| { id: number; type: 'masks-set' }
	| { id: number; type: 'camera-look-set' }
	| { id: number; type: 'camera-matched'; result: CameraMatchResult }
	| {
			id: number;
			type: 'preview';
			image: ArrayBuffer;
			mediaType: 'image/jpeg' | 'image/png';
	  }
	| { id: number; type: 'scope'; scope: ImageScopeTransfer }
	| { id: number; type: 'ultra'; jpeg: ArrayBuffer }
	| { id: number; type: 'source-image'; width: number; height: number; rgba: ArrayBuffer }
	| ({ id: number; type: 'export-progress' } & ExportProgress)
	| { id: number; type: 'export'; jpeg: ArrayBuffer }
	| { id: number; type: 'closed' }
	| { id: number; type: 'error'; message: string }
	| { id: number; type: 'range-rasterized'; width: number; height: number; alpha: ArrayBuffer }
	| { id: number; type: 'auto-balance'; temperature: number; tint: number }
	| { id: number; type: 'auto-tone'; light: LightSettings };

export const post = (message: Response, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);
