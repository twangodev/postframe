<script lang="ts">
	import { Collapsible } from 'bits-ui';
	import { ChevronDown } from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		open?: boolean;
		meta?: string;
		children: Snippet;
	}

	let { title, open = $bindable(true), meta, children }: Props = $props();
</script>

<Collapsible.Root bind:open class="border-subtle border-b">
	<Collapsible.Trigger
		class="group flex h-10 w-full cursor-pointer items-center justify-between px-3 text-left"
	>
		<span class="text-text/85 text-[11px] tracking-[0.03em] lowercase">{title}</span>
		<span class="flex items-center gap-2">
			{#if meta}<span class="text-muted text-[11px]">{meta}</span>{/if}
			<ChevronDown
				size={13}
				strokeWidth={1.5}
				class="text-muted transition-transform group-data-[state=open]:rotate-180"
			/>
		</span>
	</Collapsible.Trigger>
	<Collapsible.Content forceMount>
		{#snippet child({ props, open: expanded })}
			{#if expanded}
				<div {...props} transition:slide={{ duration: 200, easing: cubicOut }}>
					<div class="px-3 pb-4">{@render children()}</div>
				</div>
			{/if}
		{/snippet}
	</Collapsible.Content>
</Collapsible.Root>
