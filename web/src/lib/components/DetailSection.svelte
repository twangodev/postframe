<script lang="ts">
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import Panel from './ui/Panel.svelte';
	import { DETAIL_SLIDERS, PRESENCE_SLIDERS } from '$lib/develop-sliders';
	import type { DetailControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const preview = (control: DetailControlName, value: number) =>
		workspace.previewAdjustment('detail', control, value);
	const commit = (control: DetailControlName, value: number) =>
		workspace.commitAdjustment('detail', control, value);
</script>

<Panel title="Presence" open={false}>
	<AdjustmentSliders
		sliders={PRESENCE_SLIDERS}
		values={workspace.adjustments}
		disabled={!workspace.canAdjustLight}
		onPreview={preview}
		onCommit={commit}
	/>
</Panel>

<Panel title="Detail" open={false}>
	<AdjustmentSliders
		sliders={DETAIL_SLIDERS}
		values={workspace.adjustments}
		disabled={!workspace.canAdjustLight}
		onPreview={preview}
		onCommit={commit}
	/>
</Panel>
