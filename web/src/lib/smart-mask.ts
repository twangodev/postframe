import { z } from 'zod';
import {
	normalizedPointSchema,
	maskPromptLabelSchema,
	type NormalizedRegion
} from './edit-document.ts';
import type { DetectedSubject } from './subject-detection.ts';

const smartMaskModelSchema = z.object({
	id: z.string().min(1),
	revision: z.string().min(1),
	license: z.string().min(1),
	dtype: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4'])
});

export const smartMaskPackSchema = z.object({
	version: z.string().min(1),
	modelHost: z.string().url(),
	object: smartMaskModelSchema,
	subject: smartMaskModelSchema,
	detector: smartMaskModelSchema,
	sky: smartMaskModelSchema
});

export const SMART_MASK_PACK = smartMaskPackSchema.parse({
	version: 'sam2.1-hiera-tiny-814a066-fp32-rgb-edge-v2-ormbg-main-detr50-q8-skypan-ea24b2d-fp16',
	modelHost: 'https://huggingface.co/',
	object: {
		id: 'onnx-community/sam2.1-hiera-tiny-ONNX',
		revision: '814a066640debee5a91e70aa401fb8e17e030503',
		license: 'Apache-2.0',
		dtype: 'fp32'
	},
	subject: {
		id: 'onnx-community/ormbg-ONNX',
		revision: 'main',
		license: 'Apache-2.0',
		dtype: 'q8'
	},
	detector: {
		id: 'Xenova/detr-resnet-50',
		revision: 'main',
		license: 'Apache-2.0',
		dtype: 'q8'
	},
	sky: {
		id: 'Xenova/detr-resnet-50-panoptic',
		revision: 'ea24b2d4e0bfae31f0a1299ba3fb892a2df064de',
		license: 'Apache-2.0',
		dtype: 'fp16'
	}
});

export type SmartMaskModel = z.infer<typeof smartMaskModelSchema>;
export type SmartMaskDevice = 'webgpu' | 'wasm';

export const smartMaskStrokeSchema = z.object({
	label: maskPromptLabelSchema,
	points: z.array(normalizedPointSchema).min(1)
});

export type SmartMaskStroke = z.infer<typeof smartMaskStrokeSchema>;

export const maskEdgeStrokeSchema = z.object({
	points: z.array(normalizedPointSchema).min(1),
	radius: z.number().finite().positive().max(1)
});

export type MaskEdgeStroke = z.infer<typeof maskEdgeStrokeSchema>;

export interface SmartMaskRaster {
	width: number;
	height: number;
	alpha: Uint8Array;
	alternatives?: { index: number; count: number };
}

export type SmartMaskPhase =
	'idle' | 'downloading' | 'loading' | 'encoding' | 'ready' | 'refining' | 'error';

export interface SmartMaskTransfer {
	bytesPerSecond: number;
	secondsLeft: number | null;
}

export interface SmartMaskProgress {
	phase: SmartMaskPhase;
	progress: number | null;
	detail: string;
	transfer?: SmartMaskTransfer | null;
}

export type SmartMaskRequest =
	| { id: number; type: 'prepare'; photoId: string; image: Blob }
	| {
			id: number;
			type: 'object';
			photoId: string;
			selectionId: string;
			strokes: SmartMaskStroke[];
			candidate: number;
	  }
	| { id: number; type: 'subject'; photoId: string }
	| { id: number; type: 'sky'; photoId: string }
	| { id: number; type: 'detect-subjects'; photoId: string }
	| {
			id: number;
			type: 'instance';
			photoId: string;
			selectionId: string;
			box: NormalizedRegion;
			candidate: number;
	  }
	| {
			id: number;
			type: 'refine-edge';
			photoId: string;
			width: number;
			height: number;
			alpha: ArrayBuffer;
			stroke: MaskEdgeStroke;
	  }
	| { id: number; type: 'reset' }
	| { id: number; type: 'warmup' };

export type SmartMaskResponse =
	| ({ id: number; type: 'progress' } & SmartMaskProgress)
	| { id: number; type: 'warmed' }
	| { id: number; type: 'prepared'; modelVersion: string; device: SmartMaskDevice }
	| { id: number; type: 'detections'; modelVersion: string; subjects: DetectedSubject[] }
	| {
			id: number;
			type: 'mask';
			modelVersion: string;
			width: number;
			height: number;
			alpha: ArrayBuffer;
			alternatives?: { index: number; count: number };
	  }
	| { id: number; type: 'reset' }
	| { id: number; type: 'error'; message: string };
