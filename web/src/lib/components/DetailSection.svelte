<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { DetailControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const preview = (control: DetailControlName) => (value: number) =>
		workspace.previewAdjustment('detail', control, value);
	const commit = (control: DetailControlName) => (value: number) =>
		workspace.commitAdjustment('detail', control, value);
</script>

<Panel title="Presence" open={false}>
	<AdjustmentSlider
		label="Texture"
		bind:value={workspace.adjustments.texture}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('texture')}
		onValueCommit={commit('texture')}
	/>
	<AdjustmentSlider
		label="Clarity"
		bind:value={workspace.adjustments.clarity}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('clarity')}
		onValueCommit={commit('clarity')}
	/>
	<AdjustmentSlider
		label="Dehaze"
		bind:value={workspace.adjustments.dehaze}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('dehaze')}
		onValueCommit={commit('dehaze')}
	/>
</Panel>

<Panel title="Detail" open={false}>
	<AdjustmentSlider
		label="Sharpening"
		bind:value={workspace.adjustments.sharpenAmount}
		min={0}
		max={150}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('sharpenAmount')}
		onValueCommit={commit('sharpenAmount')}
	/>
	<AdjustmentSlider
		label="Noise reduction"
		bind:value={workspace.adjustments.noiseLuminance}
		min={0}
		max={100}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('noiseLuminance')}
		onValueCommit={commit('noiseLuminance')}
	/>
	<AdjustmentSlider
		label="Color noise"
		bind:value={workspace.adjustments.noiseColor}
		min={0}
		max={100}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('noiseColor')}
		onValueCommit={commit('noiseColor')}
	/>
</Panel>
