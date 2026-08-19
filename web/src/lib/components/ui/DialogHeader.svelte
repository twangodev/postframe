<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import type { Component } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		eyebrow?: { icon: Component<{ size?: number; strokeWidth?: number }>; label: string };
		closeDisabled?: boolean;
		class?: string;
	}

	let {
		title,
		description,
		eyebrow,
		closeDisabled = false,
		class: className = ''
	}: Props = $props();
</script>

<div class="flex items-start justify-between {className}">
	<div>
		{#if eyebrow}
			<div class="mb-1.5 flex items-center gap-2 text-muted">
				<eyebrow.icon size={14} strokeWidth={1.4} />
				<span class="text-[11px] tracking-[0.04em]">{eyebrow.label}</span>
			</div>
		{/if}
		<Dialog.Title class="text-sm font-medium tracking-tight">{title}</Dialog.Title>
		{#if description}
			<Dialog.Description class="mt-1 text-xs text-muted">{description}</Dialog.Description>
		{/if}
	</div>
	<Dialog.Close
		aria-label="Close"
		disabled={closeDisabled}
		class="cursor-pointer rounded p-1 text-muted transition-colors hover:text-text disabled:cursor-wait disabled:opacity-40"
	>
		<X size={15} />
	</Dialog.Close>
</div>
