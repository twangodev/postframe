<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { LightControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const preview = (control: LightControlName) => (value: number) =>
		workspace.previewAdjustment('light', control, value);
	const commit = (control: LightControlName) => (value: number) =>
		workspace.commitAdjustment('light', control, value);
</script>

<Panel title="Light">
	<button
		type="button"
		aria-label="Auto tone"
		disabled={!workspace.canAdjustLight}
		onclick={() => void workspace.autoTone()}
		class="mb-3 flex h-6 w-full cursor-pointer items-center justify-center rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:text-text disabled:cursor-default disabled:opacity-40"
	>
		auto
	</button>
	<AdjustmentSlider
		label="Exposure"
		bind:value={workspace.adjustments.exposure}
		min={-4}
		max={4}
		step={0.05}
		decimals={2}
		suffix=" EV"
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('exposure')}
		onValueCommit={commit('exposure')}
	/>
	<AdjustmentSlider
		label="Contrast"
		bind:value={workspace.adjustments.contrast}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('contrast')}
		onValueCommit={commit('contrast')}
	/>
	<AdjustmentSlider
		label="Highlights"
		bind:value={workspace.adjustments.highlights}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('highlights')}
		onValueCommit={commit('highlights')}
	/>
	<AdjustmentSlider
		label="Shadows"
		bind:value={workspace.adjustments.shadows}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('shadows')}
		onValueCommit={commit('shadows')}
	/>
	<AdjustmentSlider
		label="Whites"
		bind:value={workspace.adjustments.whites}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('whites')}
		onValueCommit={commit('whites')}
	/>
	<AdjustmentSlider
		label="Blacks"
		bind:value={workspace.adjustments.blacks}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('blacks')}
		onValueCommit={commit('blacks')}
	/>
</Panel>
