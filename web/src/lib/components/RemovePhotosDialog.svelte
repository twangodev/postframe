<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import CenteredDialogContent from './ui/CenteredDialogContent.svelte';

	interface Props {
		ids: string[] | null;
		onCancel: () => void;
		onConfirm: () => void;
	}

	let { ids, onCancel, onConfirm }: Props = $props();
</script>

<Dialog.Root
	open={ids !== null}
	onOpenChange={(open) => {
		if (!open) onCancel();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
		<CenteredDialogContent size="sm" class="p-5">
			<div class="flex items-start justify-between">
				<div>
					<Dialog.Title class="text-sm font-medium tracking-tight">
						remove {ids?.length === 1 ? 'photo' : `${ids?.length} photos`} from library
					</Dialog.Title>
					<Dialog.Description class="mt-1 text-xs text-muted">
						local files and edits are deleted. this cannot be undone.
					</Dialog.Description>
				</div>
				<Dialog.Close
					class="cursor-pointer rounded p-1 text-muted hover:text-text"
					aria-label="Close"
				>
					<X size={15} />
				</Dialog.Close>
			</div>
			<div class="mt-5 flex justify-end gap-2">
				<Dialog.Close
					class="cursor-pointer rounded border border-subtle px-3 py-2 text-[11px] text-muted hover:text-text"
				>
					cancel
				</Dialog.Close>
				<button
					type="button"
					class="cursor-pointer rounded bg-negative px-3 py-2 text-[11px] text-bg"
					onclick={onConfirm}
				>
					remove
				</button>
			</div>
		</CenteredDialogContent>
	</Dialog.Portal>
</Dialog.Root>
