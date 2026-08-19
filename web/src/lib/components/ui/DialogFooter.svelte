<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { secondaryButtonClass } from '$lib/button';

	interface Props {
		cancel?: boolean;
		class?: string;
		children: Snippet;
	}

	let { cancel = false, class: className = '', children }: Props = $props();
</script>

<div class="flex justify-end gap-2 {className}">
	{#if cancel}
		<Dialog.Close class={secondaryButtonClass}>cancel</Dialog.Close>
	{/if}
	{@render children()}
</div>
