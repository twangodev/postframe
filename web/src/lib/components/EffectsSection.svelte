<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
</script>

<Panel title="Effects" open={false}>
	<AdjustmentSlider
		label="Vignette"
		bind:value={workspace.adjustments.vignetteAmount}
		min={-100}
		max={100}
	/>
	<AdjustmentSlider
		label="Midpoint"
		bind:value={workspace.adjustments.vignetteMidpoint}
		min={0}
		max={100}
		defaultValue={50}
		signed={false}
	/>
	<AdjustmentSlider
		label="Roundness"
		bind:value={workspace.adjustments.vignetteRoundness}
		min={-100}
		max={100}
	/>
	<AdjustmentSlider
		label="Feather"
		bind:value={workspace.adjustments.vignetteFeather}
		min={0}
		max={100}
		defaultValue={50}
		signed={false}
	/>
	<AdjustmentSlider
		label="Grain"
		bind:value={workspace.adjustments.grainAmount}
		min={0}
		max={100}
		signed={false}
	/>
	<AdjustmentSlider
		label="Grain size"
		bind:value={workspace.adjustments.grainSize}
		min={0}
		max={100}
		defaultValue={25}
		signed={false}
	/>
</Panel>
