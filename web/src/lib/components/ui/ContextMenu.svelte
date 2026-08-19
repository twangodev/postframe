<script lang="ts" generics="A">
	import { ContextMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import {
		menuContentClass,
		menuItemClass,
		menuSeparatorClass,
		type MenuEntry,
		type MenuLeaf
	} from '$lib/menu';
	import MenuLeafBody from './MenuLeafBody.svelte';
	import MenuSubmenuLabel from './MenuSubmenuLabel.svelte';

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
			<ContextMenu.Separator class={menuSeparatorClass} />
		{:else}
			<ContextMenu.Item
				disabled={disabled(entry)}
				data-todo={entry.kind === 'todo' ? entry.todo : undefined}
				class={menuItemClass}
				onSelect={() => select(entry)}
			>
				<MenuLeafBody {entry} />
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
							<MenuSubmenuLabel label={entry.label} />
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
