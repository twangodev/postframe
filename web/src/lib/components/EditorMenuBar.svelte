<script lang="ts">
	import { Menubar } from 'bits-ui';
	import { EDITOR_MENUS, type EditorMenuAction, type EditorMenuEntry } from '$lib/editor-menu';
	import {
		menuContentClass as contentClass,
		menuItemClass as itemClass,
		menuSeparatorClass,
		type MenuLeaf
	} from '$lib/menu';
	import MenuLeafBody from './ui/MenuLeafBody.svelte';
	import MenuSubmenuLabel from './ui/MenuSubmenuLabel.svelte';

	interface Props {
		onAction: (action: EditorMenuAction) => void;
		canUndo: boolean;
		canRedo: boolean;
		canPaste: boolean;
		canSync: boolean;
	}

	let { onAction, canUndo, canRedo, canPaste, canSync }: Props = $props();

	function select(entry: EditorMenuEntry) {
		if (entry.kind === 'action') onAction(entry.action);
	}

	function disabled(entry: EditorMenuEntry) {
		if (entry.kind === 'todo') return true;
		if (entry.kind !== 'action') return false;
		if (entry.action === 'undo') return !canUndo;
		if (entry.action === 'redo') return !canRedo;
		if (entry.action === 'paste-settings') return !canPaste;
		if (entry.action === 'sync-settings') return !canSync;
		return false;
	}
</script>

<nav
	class="flex h-7 shrink-0 items-center border-t border-subtle bg-bg px-2"
	aria-label="Editor menu"
>
	{#snippet item(entry: MenuLeaf<EditorMenuAction>)}
		{#if entry.kind === 'separator'}
			<Menubar.Separator class={menuSeparatorClass} />
		{:else}
			<Menubar.Item
				disabled={disabled(entry)}
				data-todo={entry.kind === 'todo' ? entry.todo : undefined}
				class={itemClass}
				onSelect={() => select(entry)}
			>
				<MenuLeafBody {entry} />
			</Menubar.Item>
		{/if}
	{/snippet}

	<Menubar.Root loop class="flex h-full items-center gap-0.5">
		{#each EDITOR_MENUS as menu (menu.id)}
			<Menubar.Menu value={menu.id}>
				<Menubar.Trigger
					class="flex h-5 cursor-default items-center rounded-sm px-2 text-[11px] text-muted outline-none hover:bg-surface/60 hover:text-text data-[state=open]:bg-surface data-[state=open]:text-text"
				>
					{menu.label}
				</Menubar.Trigger>
				<Menubar.Portal>
					<Menubar.Content align="start" sideOffset={3} class={contentClass}>
						{#each menu.items as entry, index (`${menu.id}-${index}`)}
							{#if entry.kind === 'submenu'}
								<Menubar.Sub>
									<Menubar.SubTrigger class={itemClass}>
										<MenuSubmenuLabel label={entry.label} />
									</Menubar.SubTrigger>
									<Menubar.Portal>
										<Menubar.SubContent sideOffset={3} class={contentClass}>
											{#each entry.items as child, childIndex (`${menu.id}-${index}-${childIndex}`)}
												{@render item(child)}
											{/each}
										</Menubar.SubContent>
									</Menubar.Portal>
								</Menubar.Sub>
							{:else}
								{@render item(entry)}
							{/if}
						{/each}
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
		{/each}
	</Menubar.Root>
</nav>
