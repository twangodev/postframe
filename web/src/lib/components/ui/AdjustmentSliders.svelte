<script lang="ts" generics="Control extends string">
	import AdjustmentSlider from './AdjustmentSlider.svelte';
	import type { SliderSpec } from '$lib/develop-sliders';

	interface Props {
		sliders: readonly SliderSpec<Control>[];
		values: Record<Control, number>;
		disabled?: boolean;
		onPreview: (control: Control, value: number) => void;
		onCommit: (control: Control, value: number) => void;
	}

	let { sliders, values, disabled = false, onPreview, onCommit }: Props = $props();
</script>

{#each sliders as spec (spec.control)}
	<AdjustmentSlider
		{...spec}
		value={values[spec.control]}
		{disabled}
		onValueChange={(value) => onPreview(spec.control, value)}
		onValueCommit={(value) => onCommit(spec.control, value)}
	/>
{/each}
