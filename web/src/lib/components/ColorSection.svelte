<script lang="ts">
	import { SlidersHorizontal } from '@lucide/svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import type { ColorControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		onOpenMixer: () => void;
	}

	let { workspace, onOpenMixer }: Props = $props();

	const preview = (control: ColorControlName) => (value: number) =>
		workspace.previewAdjustment('color', control, value);
	const commit = (control: ColorControlName) => (value: number) =>
		workspace.commitAdjustment('color', control, value);
</script>

<Panel title="Color">
	<AdjustmentSlider
		label="Temperature"
		bind:value={workspace.adjustments.temperature}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('temperature')}
		onValueCommit={commit('temperature')}
	/>
	<AdjustmentSlider
		label="Tint"
		bind:value={workspace.adjustments.tint}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('tint')}
		onValueCommit={commit('tint')}
	/>
	<AdjustmentSlider
		label="Vibrance"
		bind:value={workspace.adjustments.vibrance}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('vibrance')}
		onValueCommit={commit('vibrance')}
	/>
	<AdjustmentSlider
		label="Saturation"
		bind:value={workspace.adjustments.saturation}
		min={-100}
		max={100}
		disabled={!workspace.canAdjustLight}
		onValueChange={preview('saturation')}
		onValueCommit={commit('saturation')}
	/>
	<button
		type="button"
		aria-label="open color mixer"
		onclick={onOpenMixer}
		class="mt-2 flex w-full cursor-pointer items-center justify-between rounded border border-subtle px-2 py-2 text-[11px] text-muted hover:text-text"
	>
		color mixer <SlidersHorizontal size={12} />
	</button>
</Panel>
