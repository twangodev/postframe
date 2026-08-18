<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import {
		GRADING_BLEND_CONTROL_NAMES,
		GRADING_RANGE_NAMES,
		type GradingBlendControlName,
		type GradingRangeName
	} from '$lib/develop-settings';
	import {
		clampToDisc,
		hueSaturationToPoint,
		pointToHueSaturation,
		type DiscPoint
	} from '$lib/grading-wheel';
	import type { DevelopBinding } from '$lib/develop-binding';

	interface Props {
		binding: DevelopBinding;
	}

	let { binding }: Props = $props();

	const discCenterId = $props.id();

	const DISC_MARGIN = 1.08;
	const WEDGE_DEGREES = 6;
	const WEDGES = Array.from({ length: 360 / WEDGE_DEGREES }, (_, index) => {
		const hue = index * WEDGE_DEGREES;
		const start = hueSaturationToPoint(hue, 100);
		const end = hueSaturationToPoint(hue + WEDGE_DEGREES + 0.5, 100);
		return { hue, path: `M 0 0 L ${start.x} ${start.y} A 1 1 0 0 1 ${end.x} ${end.y} Z` };
	});

	let range = $state<GradingRangeName>('shadows');

	const wheel = $derived(binding.grading[range]);
	const puck = $derived(hueSaturationToPoint(wheel.hue, wheel.saturation));

	const wheelChanges = (position: DiscPoint) => {
		const { hue, saturation } = pointToHueSaturation(position);
		return [
			{ target: { group: 'grading', range, control: 'hue' } as const, value: hue },
			{ target: { group: 'grading', range, control: 'saturation' } as const, value: saturation }
		];
	};

	type DiscEvent = PointerEvent & { currentTarget: SVGSVGElement };

	function discPosition(event: DiscEvent) {
		const bounds = event.currentTarget.getBoundingClientRect();
		return clampToDisc({
			x: ((2 * (event.clientX - bounds.left)) / bounds.width - 1) * DISC_MARGIN,
			y: ((2 * (event.clientY - bounds.top)) / bounds.height - 1) * DISC_MARGIN
		});
	}

	function beginDrag(event: DiscEvent) {
		if (binding.disabled) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		binding.previewAdjustmentsAt(wheelChanges(discPosition(event)));
	}

	function dragTo(event: DiscEvent) {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		binding.previewAdjustmentsAt(wheelChanges(discPosition(event)));
	}

	function endDrag(event: DiscEvent) {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		event.currentTarget.releasePointerCapture(event.pointerId);
		binding.commitAdjustmentsAt(wheelChanges(discPosition(event)));
	}

	const blendTarget = (control: GradingBlendControlName) =>
		({ group: 'grading', control }) as const;
	const previewBlend = (control: GradingBlendControlName) => (value: number) =>
		binding.previewAdjustmentAt(blendTarget(control), value);
	const commitBlend = (control: GradingBlendControlName) => (value: number) =>
		binding.commitAdjustmentAt(blendTarget(control), value);

	const previewLuminance = (value: number) =>
		binding.previewAdjustmentAt({ group: 'grading', range, control: 'luminance' }, value);
	const commitLuminance = (value: number) =>
		binding.commitAdjustmentAt({ group: 'grading', range, control: 'luminance' }, value);
</script>

<Panel title="Color grading" open={false}>
	<div class="mb-3 flex gap-1" role="tablist" aria-label="Tonal range">
		{#each GRADING_RANGE_NAMES as name (name)}
			<button
				type="button"
				role="tab"
				aria-selected={range === name}
				onclick={() => (range = name)}
				class="h-6 flex-1 cursor-pointer rounded border text-[11px] lowercase transition-colors {range ===
				name
					? 'border-control-edge bg-surface text-text'
					: 'border-subtle text-muted hover:text-text'}"
			>
				{name}
			</button>
		{/each}
	</div>
	<div class="flex items-center gap-3">
		<svg
			viewBox={`${-DISC_MARGIN} ${-DISC_MARGIN} ${2 * DISC_MARGIN} ${2 * DISC_MARGIN}`}
			role="slider"
			tabindex="-1"
			aria-label={`${range} hue and saturation`}
			aria-valuetext={`hue ${wheel.hue.toFixed(0)}, saturation ${wheel.saturation.toFixed(0)}`}
			aria-valuenow={wheel.hue}
			aria-valuemin={0}
			aria-valuemax={360}
			class="size-24 shrink-0 touch-none transition-opacity"
			class:opacity-40={binding.disabled}
			class:cursor-grab={!binding.disabled}
			onpointerdown={beginDrag}
			onpointermove={dragTo}
			onpointerup={endDrag}
			onpointercancel={endDrag}
		>
			<defs>
				<radialGradient id={discCenterId}>
					<stop offset="0%" stop-color="#23221e" />
					<stop offset="100%" stop-color="#23221e" stop-opacity="0" />
				</radialGradient>
			</defs>
			{#each WEDGES as wedge (wedge.hue)}
				<path d={wedge.path} fill={`hsl(${wedge.hue} 70% 50%)`} />
			{/each}
			<circle r="1" fill="url(#{discCenterId})" />
			<circle r="1" fill="none" stroke="var(--color-subtle)" stroke-width="0.03" />
			<circle
				cx={puck.x}
				cy={puck.y}
				r="0.09"
				fill="none"
				stroke="var(--color-text)"
				stroke-width="0.05"
			/>
		</svg>
		<div class="min-w-0 flex-1">
			<AdjustmentSlider
				label="Luminance"
				bind:value={binding.grading[range].luminance}
				min={-100}
				max={100}
				disabled={binding.disabled}
				onValueChange={previewLuminance}
				onValueCommit={commitLuminance}
			/>
		</div>
	</div>
	<div class="mt-2">
		{#each GRADING_BLEND_CONTROL_NAMES as control (control)}
			<AdjustmentSlider
				label={control}
				bind:value={binding.grading[control]}
				min={control === 'balance' ? -100 : 0}
				max={100}
				defaultValue={control === 'balance' ? 0 : 50}
				signed={control === 'balance'}
				disabled={binding.disabled}
				onValueChange={previewBlend(control)}
				onValueCommit={commitBlend(control)}
			/>
		{/each}
	</div>
</Panel>
