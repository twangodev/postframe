<script lang="ts">
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		element?: HTMLInputElement;
	}

	let { workspace, element = $bindable() }: Props = $props();

	function importFiles(list: FileList | null) {
		if (!list?.length) return;
		void workspace.importFiles([...list]);
	}
</script>

<input
	bind:this={element}
	type="file"
	multiple
	accept={workspace.acceptedPhotos}
	class="sr-only"
	disabled={workspace.importing}
	onchange={(event) => importFiles(event.currentTarget.files)}
/>
