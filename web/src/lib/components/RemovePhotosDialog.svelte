<script lang="ts">
	import { Dialog } from 'bits-ui';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';

	interface Props {
		ids: string[] | null;
		onCancel: () => void;
		onConfirm: () => void;
	}

	let { ids, onCancel, onConfirm }: Props = $props();
</script>

<DialogShell
	open={ids !== null}
	onOpenChange={(open) => {
		if (!open) onCancel();
	}}
	size="sm"
	class="p-5"
>
	<DialogHeader
		title={`remove ${ids?.length === 1 ? 'photo' : `${ids?.length} photos`} from library`}
		description="local files and edits are deleted. this cannot be undone."
	/>
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
</DialogShell>
