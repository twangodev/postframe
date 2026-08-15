<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import CenteredDialogContent from './ui/CenteredDialogContent.svelte';
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

<Dialog.Root bind:open={workspace.collectionDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
		<CenteredDialogContent size="sm" class="p-5">
			<form onsubmit={createCollection}>
				<div class="flex items-start justify-between">
					<div>
						<Dialog.Title class="text-sm font-medium tracking-tight">create collection</Dialog.Title
						>
						<Dialog.Description class="text-muted mt-1 text-xs">
							selected photos will be added automatically.
						</Dialog.Description>
					</div>
					<Dialog.Close
						class="text-muted hover:text-text cursor-pointer rounded p-1"
						aria-label="Close"
					>
						<X size={15} />
					</Dialog.Close>
				</div>
				<input
					bind:value={collectionName}
					placeholder="collection name"
					class="border-subtle bg-surface placeholder:text-muted/50 focus:border-accent mt-5 w-full rounded border px-3 py-2 text-xs focus:outline-none"
				/>
				<div class="mt-4 flex justify-end">
					<button
						type="submit"
						disabled={!collectionName.trim() || collectionBusy}
						class="bg-text text-bg cursor-pointer rounded px-3 py-2 text-[11px] disabled:opacity-35"
					>
						create collection
					</button>
				</div>
			</form>
		</CenteredDialogContent>
	</Dialog.Portal>
</Dialog.Root>
