import type { ColorSettings, DevelopSettings, LightSettings } from './develop-settings';
import type { ImageScopeTransfer } from './image-scope';
import type { MaskEdgeSettings } from './mask-edge-settings.ts';
import type { ExportGeometry, ExportProgress } from './export.ts';

export interface RawFrameHandleInput {
	raw: FileSystemFileHandle;
	jpeg?: FileSystemFileHandle;
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
	tone: boolean;
}

export interface DevelopedMaskSettings {
	light: LightSettings;
	color: ColorSettings;
}

export interface DevelopedMaskInput {
	id: string;
	width: number;
	height: number;
	alpha: ArrayBuffer;
	edge: MaskEdgeSettings;
	settings: DevelopedMaskSettings;
}

export interface MaskEdgeInput {
	width: number;
	height: number;
	alpha: ArrayBuffer;
	edge: MaskEdgeSettings;
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
	  }
	| {
			id: number;
			type: 'open-display';
			source: FileSystemFileHandle;
			maxDimension: number;
			adjustments: DevelopSettings;
	  }
	| ({ id: number; type: 'tile' } & RenderTileRequest)
	| ({ id: number; type: 'adjust-mask' } & MaskEdgeInput)
	| { id: number; type: 'set-masks'; masks: DevelopedMaskInput[] }
	| { id: number; type: 'preview'; adjustments: DevelopSettings; tone: boolean }
	| {
			id: number;
			type: 'scope';
			adjustments: DevelopSettings;
			tone: boolean;
			sampleTarget: number;
	  }
	| { id: number; type: 'ultra' }
	| {
			id: number;
			type: 'export';
			adjustments: DevelopSettings;
			masks: DevelopedMaskInput[];
			geometry: ExportGeometry;
			quality: number;
	  }
	| { id: number; type: 'close' };

export type Response =
	| { id: 0; type: 'performance'; measurement: RenderPerformanceMeasurement }
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
	  }
	| { id: number; type: 'tile'; bitmap: ImageBitmap }
	| { id: number; type: 'masks-set' }
	| {
			id: number;
			type: 'preview';
			image: ArrayBuffer;
			mediaType: 'image/jpeg' | 'image/png';
	  }
	| { id: number; type: 'scope'; scope: ImageScopeTransfer }
	| { id: number; type: 'ultra'; jpeg: ArrayBuffer }
	| ({ id: number; type: 'export-progress' } & ExportProgress)
	| { id: number; type: 'export'; jpeg: ArrayBuffer }
	| { id: number; type: 'closed' }
	| { id: number; type: 'error'; message: string };

export const post = (message: Response, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);
