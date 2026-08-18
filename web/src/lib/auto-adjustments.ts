import type { DevelopSettings, LightSettings } from './develop-settings.ts';
import type { NormalizedPoint } from './edit-document.ts';
import type { Photo } from './photo-record.ts';
import { EYEDROPPER_SAMPLE_RADIUS } from './white-balance.ts';
import type { WhiteBalanceSample } from './worker.ts';

export interface AutoAdjustmentsHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	reportError(message: string): void;
}

export interface AutoAdjustmentSource {
	autoBalance(sample?: WhiteBalanceSample): Promise<{ temperature: number; tint: number }>;
	autoTone(): Promise<LightSettings>;
}

export interface AdjustmentCommitter {
	commitAdjustments(adjustments: DevelopSettings, label: string): boolean;
}

/**
 * One-click estimates measured by the worker on the neutral source image and
 * written back through a single adjustment.replace, so each lands as one
 * history entry.
 */
export class AutoAdjustments {
	private readonly source: AutoAdjustmentSource | null;
	private readonly controls: AdjustmentCommitter;
	private readonly host: AutoAdjustmentsHost;

	constructor(
		source: AutoAdjustmentSource | null,
		controls: AdjustmentCommitter,
		host: AutoAdjustmentsHost
	) {
		this.source = source;
		this.controls = controls;
		this.host = host;
	}

	whiteBalance() {
		return this.estimate(
			'auto white balance',
			(source) => source.autoBalance(),
			(adjustments, balance) => ({ ...adjustments, color: { ...adjustments.color, ...balance } })
		);
	}

	sampleWhiteBalance(point: NormalizedPoint) {
		return this.estimate(
			'white balance',
			(source) => source.autoBalance({ ...point, radius: EYEDROPPER_SAMPLE_RADIUS }),
			(adjustments, balance) => ({ ...adjustments, color: { ...adjustments.color, ...balance } })
		);
	}

	tone() {
		return this.estimate(
			'auto tone',
			(source) => source.autoTone(),
			(adjustments, light) => ({ ...adjustments, light })
		);
	}

	private async estimate<Estimate>(
		label: string,
		measure: (source: AutoAdjustmentSource) => Promise<Estimate>,
		applied: (adjustments: DevelopSettings, estimate: Estimate) => DevelopSettings
	) {
		const photo = this.host.selectedPhoto;
		if (!this.source || !this.host.canAdjustLight || !photo) return false;
		try {
			const estimate = await measure(this.source);
			const current = this.host.selectedPhoto;
			if (current?.id !== photo.id) return false;
			return this.controls.commitAdjustments(applied(current.edit.adjustments, estimate), label);
		} catch (error) {
			this.host.reportError(
				`${label} failed: ${error instanceof Error ? error.message : String(error)}`
			);
			return false;
		}
	}
}
