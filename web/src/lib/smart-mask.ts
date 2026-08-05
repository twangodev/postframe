import { z } from 'zod';
import { normalizedPointSchema, maskPromptLabelSchema } from './edit-document.ts';

const smartMaskModelSchema = z.object({
	id: z.string().min(1),
	revision: z.string().min(1),
	license: z.string().min(1),
	dtype: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4'])
});

export const smartMaskPackSchema = z.object({
	version: z.string().min(1),
	host: z.string().url(),
	object: smartMaskModelSchema,
	subject: smartMaskModelSchema
});

export const SMART_MASK_PACK = smartMaskPackSchema.parse({
	version: 'sam2.1-hiera-tiny-814a066-ormbg-main',
	host: 'https://huggingface.co/',
	object: {
		id: 'onnx-community/sam2.1-hiera-tiny-ONNX',
		revision: '814a066',
		license: 'Apache-2.0',
		dtype: 'q8'
	},
	subject: {
		id: 'onnx-community/ormbg-ONNX',
		revision: 'main',
		license: 'Apache-2.0',
		dtype: 'q8'
	}
});

export const smartMaskPromptSchema = z.object({
	label: maskPromptLabelSchema,
	point: normalizedPointSchema
});

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
			prompts: z.infer<typeof smartMaskPromptSchema>[];
	  }
	| { id: number; type: 'subject'; photoId: string }
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
