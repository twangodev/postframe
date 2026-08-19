<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		selected?: boolean;
		icon?: Component<Record<string, unknown>>;
		meta?: string | Snippet;
		children: Snippet;
	}

	let { selected = false, icon: Icon, meta, children, ...rest }: Props = $props();
</script>

<button
	type="button"
	{...rest}
	class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-2 text-left text-[12px] transition-colors {selected
		? 'bg-surface text-text'
		: 'text-muted hover:bg-surface/60 hover:text-text'}"
>
	{#if Icon}<Icon size={13} strokeWidth={1.5} />{/if}
	<span class="min-w-0 flex-1 truncate">{@render children()}</span>
	{#if typeof meta === 'string'}
		<span class="font-mono text-[11px]">{meta}</span>
	{:else if meta}
		{@render meta()}
	{/if}
</button>
