<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		size?: 'sm' | 'lg';
		class?: string;
		overlayClass?: string;
		trigger?: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		size = 'lg',
		class: className = '',
		overlayClass = 'bg-black/65 backdrop-blur-sm',
		trigger,
		children
	}: Props = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	{#if trigger}
		<Dialog.Trigger>
			{#snippet child({ props })}
				{@render trigger(props)}
			{/snippet}
		</Dialog.Trigger>
	{/if}
	<Dialog.Portal>
		<Dialog.Overlay class="motion-dialog-overlay fixed inset-0 z-40 {overlayClass}" />
		<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
			<Dialog.Content
				class="motion-dialog-content pointer-events-auto max-h-[calc(100svh-2rem)] w-full overflow-x-hidden overflow-y-auto rounded-lg border border-subtle bg-bg shadow-2xl {size ===
				'sm'
					? 'max-w-sm'
					: 'max-w-lg'} {className}"
			>
				{@render children()}
			</Dialog.Content>
		</div>
	</Dialog.Portal>
</Dialog.Root>
