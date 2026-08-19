<script lang="ts">
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	let collectionName = $state('');
	let collectionBusy = $state(false);

	async function createCollection(event: SubmitEvent) {
		event.preventDefault();
		if (!collectionName.trim() || collectionBusy) return;
		collectionBusy = true;
		try {
			await workspace.createCollection(collectionName, []);
			collectionName = '';
		} finally {
			collectionBusy = false;
		}
	}
</script>

<DialogShell bind:open={workspace.collectionDialogOpen} size="sm" class="p-5">
	<form onsubmit={createCollection}>
		<DialogHeader
			title="create collection"
			description="selected photos will be added automatically."
		/>
		<input
			bind:value={collectionName}
			placeholder="collection name"
			class="mt-5 w-full rounded border border-subtle bg-surface px-3 py-2 text-xs placeholder:text-muted/50 focus:border-accent focus:outline-none"
		/>
		<div class="mt-4 flex justify-end">
			<button
				type="submit"
				disabled={!collectionName.trim() || collectionBusy}
				class="cursor-pointer rounded bg-text px-3 py-2 text-[11px] text-bg disabled:opacity-35"
			>
				create collection
			</button>
		</div>
	</form>
</DialogShell>
