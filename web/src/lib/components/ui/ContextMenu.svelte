<script lang="ts" generics="A">
	import { ContextMenu } from 'bits-ui';
	import { Check, ChevronRight } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { menuContentClass, menuItemClass, type MenuEntry, type MenuLeaf } from '$lib/menu';

	interface Props {
		items: MenuEntry<A>[];
		onAction: (action: A) => void;
		onOpen?: () => void;
		children: Snippet<[{ props: Record<string, unknown> }]>;
	}

	let { items, onAction, onOpen, children }: Props = $props();

	function select(entry: MenuLeaf<A>) {
		if (entry.kind === 'action') onAction(entry.action);
	}

	function disabled(entry: MenuLeaf<A>) {
		if (entry.kind === 'todo') return true;
		return entry.kind === 'action' && (entry.disabled ?? false);
	}
</script>

{#snippet leaves(entries: MenuLeaf<A>[], prefix: string)}
	{#each entries as entry, index (`${prefix}-${index}`)}
		{#if entry.kind === 'separator'}
			<ContextMenu.Separator class="bg-subtle my-1 h-px" />
		{:else}
			<ContextMenu.Item
				disabled={disabled(entry)}
				data-todo={entry.kind === 'todo' ? entry.todo : undefined}
				class={menuItemClass}
				onSelect={() => select(entry)}
			>
				<span class="flex w-3 items-center justify-center">
					{#if entry.checked}<Check size={10} />{/if}
				</span>
				<span class="flex-1">{entry.label}</span>
				{#if entry.shortcut}
					<kbd class="text-muted ml-5 font-mono text-[10px]">{entry.shortcut}</kbd>
				{/if}
			</ContextMenu.Item>
		{/if}
	{/each}
{/snippet}

<ContextMenu.Root onOpenChange={(open) => open && onOpen?.()}>
	<ContextMenu.Trigger>
		{#snippet child({ props })}
			{@render children({ props })}
		{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Portal>
		<ContextMenu.Content class={menuContentClass}>
			{#each items as entry, index (index)}
				{#if entry.kind === 'submenu'}
					<ContextMenu.Sub>
						<ContextMenu.SubTrigger class={menuItemClass}>
							<span class="w-3"></span>
							<span class="flex-1">{entry.label}</span>
							<ChevronRight size={11} class="text-muted" />
						</ContextMenu.SubTrigger>
						<ContextMenu.Portal>
							<ContextMenu.SubContent sideOffset={3} class={menuContentClass}>
								{@render leaves(entry.items, `${index}`)}
							</ContextMenu.SubContent>
						</ContextMenu.Portal>
					</ContextMenu.Sub>
				{:else}
					{@render leaves([entry], `${index}`)}
				{/if}
			{/each}
		</ContextMenu.Content>
	</ContextMenu.Portal>
</ContextMenu.Root>
