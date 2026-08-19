<script lang="ts">
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import Panel from './ui/Panel.svelte';
	import { EFFECTS_SLIDERS } from '$lib/develop-sliders';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
</script>

<Panel title="Effects" open={false}>
	<AdjustmentSliders
		sliders={EFFECTS_SLIDERS}
		values={workspace.adjustments}
		disabled={!workspace.canAdjustLight}
		onPreview={(control, value) => workspace.previewAdjustment('effects', control, value)}
		onCommit={(control, value) => workspace.commitAdjustment('effects', control, value)}
	/>
</Panel>
