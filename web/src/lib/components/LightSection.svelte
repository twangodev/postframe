<script lang="ts">
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import Panel from './ui/Panel.svelte';
	import { LIGHT_SLIDERS } from '$lib/develop-sliders';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
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
	<AdjustmentSliders
		sliders={LIGHT_SLIDERS}
		values={workspace.adjustments}
		disabled={!workspace.canAdjustLight}
		onPreview={(control, value) => workspace.previewAdjustment('light', control, value)}
		onCommit={(control, value) => workspace.commitAdjustment('light', control, value)}
	/>
</Panel>
