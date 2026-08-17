<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { EffectsControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const preview = (control: EffectsControlName) => (value: number) =>
		workspace.previewAdjustment('effects', control, value);
	const commit = (control: EffectsControlName) => (value: number) =>
		workspace.commitAdjustment('effects', control, value);
</script>

<Panel title="Effects" open={false}>
	<AdjustmentSlider
		label="Vignette"
		bind:value={workspace.adjustments.vignetteAmount}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('vignetteAmount')}
		onValueCommit={commit('vignetteAmount')}
	/>
	<AdjustmentSlider
		label="Midpoint"
		bind:value={workspace.adjustments.vignetteMidpoint}
		min={0}
		max={100}
		defaultValue={50}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('vignetteMidpoint')}
		onValueCommit={commit('vignetteMidpoint')}
	/>
	<AdjustmentSlider
		label="Roundness"
		bind:value={workspace.adjustments.vignetteRoundness}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('vignetteRoundness')}
		onValueCommit={commit('vignetteRoundness')}
	/>
	<AdjustmentSlider
		label="Feather"
		bind:value={workspace.adjustments.vignetteFeather}
		min={0}
		max={100}
		defaultValue={50}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('vignetteFeather')}
		onValueCommit={commit('vignetteFeather')}
	/>
	<AdjustmentSlider
		label="Grain"
		bind:value={workspace.adjustments.grainAmount}
		min={0}
		max={100}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('grainAmount')}
		onValueCommit={commit('grainAmount')}
	/>
	<AdjustmentSlider
		label="Grain size"
		bind:value={workspace.adjustments.grainSize}
		min={0}
		max={100}
		defaultValue={25}
		signed={false}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('grainSize')}
		onValueCommit={commit('grainSize')}
	/>
</Panel>
