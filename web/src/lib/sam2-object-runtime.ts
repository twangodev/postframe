import {
	Sam2Model,
	Sam2Processor,
	Tensor,
	type ProgressInfo,
	type RawImage
} from '@huggingface/transformers';
import { rankSam2MaskCandidates, type RankedSam2MaskCandidate } from './sam2-candidates.ts';
import { createSam2PointPrompt, type Sam2PromptPoint } from './sam2-prompt.ts';
import type {
	SmartMaskDevice,
	SmartMaskModel,
	SmartMaskStroke
} from './smart-mask.ts';

export interface Sam2ImageEmbedding {
	tensors: Record<string, Tensor>;
	originalSizes: [number, number][];
	reshapedInputSizes: [number, number][];
}

export interface Sam2Selection {
	prompts: Sam2PromptPoint[];
	candidates: RankedSam2MaskCandidate[];
}

type ProgressCallback = (progress: ProgressInfo) => void;

export class Sam2ObjectRuntime {
	private constructor(
		readonly device: SmartMaskDevice,
		private readonly model: Sam2Model,
		private readonly processor: Sam2Processor
	) {}

	static async load(
		model: SmartMaskModel,
		device: SmartMaskDevice,
		onProgress: ProgressCallback
	) {
		const options = {
			revision: model.revision,
			dtype: model.dtype,
			device,
			progress_callback: onProgress
		} as const;
		const [runtime, processor] = await Promise.all([
			Sam2Model.from_pretrained(model.id, options),
			Sam2Processor.from_pretrained(model.id, { revision: model.revision })
		]);
		return new Sam2ObjectRuntime(device, runtime as Sam2Model, processor as Sam2Processor);
	}

	async encode(image: RawImage): Promise<Sam2ImageEmbedding> {
		const inputs = await this.processor(image);
		try {
			return {
				tensors: await this.model.get_image_embeddings({ pixel_values: inputs.pixel_values }),
				originalSizes: inputs.original_sizes,
				reshapedInputSizes: inputs.reshaped_input_sizes
			};
		} finally {
			inputs.pixel_values.dispose();
		}
	}

	async select(
		embedding: Sam2ImageEmbedding,
		strokes: SmartMaskStroke[],
		imageWidth: number,
		imageHeight: number
	): Promise<Sam2Selection> {
		const prompt = createSam2PointPrompt(strokes, imageWidth, imageHeight);
		const inputPoints = this.processor.reshape_input_points(
			prompt.coordinates,
			embedding.originalSizes,
			embedding.reshapedInputSizes
		);
		const inputLabels = new Tensor(
			'int64',
			BigInt64Array.from(prompt.labels.flat(2), BigInt),
			[1, 1, prompt.points.length]
		);
		try {
			const output = await this.model.forward({
				...embedding.tensors,
				input_points: inputPoints,
				input_labels: inputLabels
			});
			try {
				return {
					prompts: prompt.points,
					candidates: rankSam2MaskCandidates(candidatesFrom(output), prompt.points)
				};
			} finally {
				disposeOutput(output);
			}
		} finally {
			inputPoints.dispose();
			inputLabels.dispose();
		}
	}

	async render(
		candidate: RankedSam2MaskCandidate,
		embedding: Sam2ImageEmbedding
	) {
		const logits = new Tensor('float32', candidate.logits, [
			1,
			1,
			1,
			candidate.height,
			candidate.width
		]);
		try {
			const [mask] = await this.processor.post_process_masks(
				logits,
				embedding.originalSizes,
				embedding.reshapedInputSizes,
				{ binarize: false }
			);
			if (!mask) throw new Error('SAM 2 did not return a mask');
			try {
				return Uint8Array.from(mask.data as ArrayLike<number>, (logit) =>
					Math.round(sigmoid(logit) * 255)
				);
			} finally {
				mask.dispose();
			}
		} finally {
			logits.dispose();
		}
	}

	disposeEmbedding(embedding: Sam2ImageEmbedding | null) {
		if (!embedding) return;
		for (const tensor of Object.values(embedding.tensors)) tensor.dispose();
	}

	async dispose() {
		await this.model.dispose();
	}
}

function candidatesFrom(output: {
	pred_masks: Tensor;
	iou_scores: Tensor;
	object_score_logits: Tensor;
}) {
	const maskDimensions = output.pred_masks.dims;
	const width = maskDimensions.at(-1);
	const height = maskDimensions.at(-2);
	const count = maskDimensions.at(-3);
	if (!width || !height || !count || output.pred_masks.size !== width * height * count) {
		throw new Error('SAM 2 returned invalid mask candidates');
	}
	const logits = output.pred_masks.data as ArrayLike<number>;
	const scores = output.iou_scores.data as ArrayLike<number>;
	const objectScore = Number(output.object_score_logits.data[0]);
	const candidateSize = width * height;
	return Array.from({ length: count }, (_, index) => ({
		width,
		height,
		logits: Float32Array.from(
			Array.from({ length: candidateSize }, (_, offset) => logits[index * candidateSize + offset]!)
		),
		predictedIou: Number(scores[index]),
		objectScore
	}));
}

function disposeOutput(output: {
	pred_masks: Tensor;
	iou_scores: Tensor;
	object_score_logits: Tensor;
}) {
	output.pred_masks.dispose();
	output.iou_scores.dispose();
	output.object_score_logits.dispose();
}

function sigmoid(value: number) {
	return 1 / (1 + Math.exp(-value));
}
