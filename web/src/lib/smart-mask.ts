import { z } from 'zod';
import { normalizedPointSchema, maskPromptLabelSchema } from './edit-document.ts';

const smartMaskModelSchema = z.object({
	id: z.string().min(1),
	revision: z.string().min(1),
	license: z.string().min(1),
	dtype: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4'])
});

const segNextModelSchema = z.object({
	source: z.string().url(),
	revision: z.string().min(1),
	license: z.literal('MIT'),
	precision: z.literal('fp16'),
	inputSize: z.number().int().positive(),
	files: z.object({
		encoder: z.string().min(1),
		decoder: z.string().min(1)
	})
});

export const smartMaskPackSchema = z.object({
	version: z.string().min(1),
	subjectHost: z.string().url(),
	object: segNextModelSchema,
	subject: smartMaskModelSchema
});

export const SMART_MASK_PACK = smartMaskPackSchema.parse({
	version: 'segnext-vitb-4c45ce8-rgb-edge-v2-ormbg-main',
	subjectHost: 'https://huggingface.co/',
	object: {
		source: 'https://github.com/uncbiag/SegNext',
		revision: '4c45ce8bfa8d3121d36d71f0ff263555805dad89',
		license: 'MIT',
		precision: 'fp16',
		inputSize: 1024,
		files: {
			encoder: 'encoder.fp16.onnx',
			decoder: 'decoder.fp16.onnx'
		}
	},
	subject: {
		id: 'onnx-community/ormbg-ONNX',
		revision: 'main',
		license: 'Apache-2.0',
		dtype: 'q8'
	}
});

export type SegNextModel = z.infer<typeof segNextModelSchema>;

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
}

export type SmartMaskPhase =
	'idle' | 'downloading' | 'loading' | 'encoding' | 'ready' | 'refining' | 'error';

export interface SmartMaskProgress {
	phase: SmartMaskPhase;
	progress: number | null;
	detail: string;
}

export type SmartMaskRequest =
	| { id: number; type: 'prepare'; photoId: string; image: Blob }
	| {
			id: number;
			type: 'object';
			photoId: string;
			selectionId: string;
			strokes: SmartMaskStroke[];
	  }
	| { id: number; type: 'subject'; photoId: string }
	| {
			id: number;
			type: 'refine-edge';
			photoId: string;
			width: number;
			height: number;
			alpha: ArrayBuffer;
			stroke: MaskEdgeStroke;
	  }
	| { id: number; type: 'reset' };

export type SmartMaskResponse =
	| ({ id: number; type: 'progress' } & SmartMaskProgress)
	| { id: number; type: 'prepared'; modelVersion: string; device: 'webgpu' | 'wasm' }
	| {
			id: number;
			type: 'mask';
			modelVersion: string;
			width: number;
			height: number;
			alpha: ArrayBuffer;
	  }
	| { id: number; type: 'reset' }
	| { id: number; type: 'error'; message: string };
