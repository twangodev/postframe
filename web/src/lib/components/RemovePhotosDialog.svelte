<script lang="ts">
	import DialogFooter from './ui/DialogFooter.svelte';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import { destructiveButtonClass } from '$lib/button';

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
	<DialogFooter cancel class="mt-5">
		<button type="button" class={destructiveButtonClass} onclick={onConfirm}> remove </button>
	</DialogFooter>
</DialogShell>
