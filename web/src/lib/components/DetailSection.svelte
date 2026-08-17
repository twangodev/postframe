<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
</script>

<Panel title="Presence" open={false}>
	<AdjustmentSlider
		label="Texture"
		bind:value={workspace.adjustments.texture}
		min={-100}
		max={100}
	/>
	<AdjustmentSlider
		label="Clarity"
		bind:value={workspace.adjustments.clarity}
		min={-100}
		max={100}
	/>
	<AdjustmentSlider label="Dehaze" bind:value={workspace.adjustments.dehaze} min={-100} max={100} />
</Panel>

<Panel title="Detail" open={false}>
	<AdjustmentSlider
		label="Sharpening"
		bind:value={workspace.adjustments.sharpenAmount}
		min={0}
		max={150}
		signed={false}
	/>
	<AdjustmentSlider
		label="Noise reduction"
		bind:value={workspace.adjustments.noiseLuminance}
		min={0}
		max={100}
		signed={false}
	/>
	<AdjustmentSlider
		label="Color noise"
		bind:value={workspace.adjustments.noiseColor}
		min={0}
		max={100}
		signed={false}
	/>
</Panel>
