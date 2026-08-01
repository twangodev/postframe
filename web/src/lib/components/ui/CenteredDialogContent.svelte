<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		size?: 'sm' | 'lg';
		class?: string;
	}

	let { children, size = 'lg', class: className = '' }: Props = $props();
</script>

<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
	<Dialog.Content
		class="motion-dialog-content border-subtle bg-bg pointer-events-auto max-h-[calc(100svh-2rem)] w-full overflow-y-auto rounded-lg border shadow-2xl {size ===
		'sm'
			? 'max-w-sm'
			: 'max-w-lg'} {className}"
	>
		{@render children()}
	</Dialog.Content>
</div>
