<script lang="ts" generics="Control extends string">
	import AdjustmentSlider from './AdjustmentSlider.svelte';
	import type { ControlRevealPhase } from '$lib/adjustment-reveal';
	import type { SliderSpec } from '$lib/develop-sliders';

	interface Props {
		sliders: readonly SliderSpec<Control>[];
		values: Record<Control, number>;
		disabled?: boolean;
		reveals?: Partial<Record<Control, ControlRevealPhase>>;
		onRevealInteraction?: (control: Control) => void;
		onPreview: (control: Control, value: number) => void;
		onCommit: (control: Control, value: number) => void;
	}

	let {
		sliders,
		values,
		disabled = false,
		reveals = {},
		onRevealInteraction = () => {},
		onPreview,
		onCommit
	}: Props = $props();
</script>

{#each sliders as spec (spec.control)}
	<AdjustmentSlider
		{...spec}
		value={values[spec.control]}
		{disabled}
		revealPhase={reveals[spec.control]}
		onRevealInteraction={() => onRevealInteraction(spec.control)}
		onValueChange={(value) => onPreview(spec.control, value)}
		onValueCommit={(value) => onCommit(spec.control, value)}
	/>
{/each}
