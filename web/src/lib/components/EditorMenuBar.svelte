<script lang="ts">
	import { Menubar } from 'bits-ui';
	import { Check, ChevronRight } from '@lucide/svelte';
	import { EDITOR_MENUS, type EditorMenuAction, type EditorMenuEntry } from '$lib/editor-menu';
	import { menuContentClass as contentClass, menuItemClass as itemClass } from '$lib/menu';
	import ShortcutHint from './ui/ShortcutHint.svelte';

	interface Props {
		onAction: (action: EditorMenuAction) => void;
		canUndo: boolean;
		canRedo: boolean;
	}

	let { onAction, canUndo, canRedo }: Props = $props();

	function select(entry: EditorMenuEntry) {
		if (entry.kind === 'action') onAction(entry.action);
	}

	function disabled(entry: EditorMenuEntry) {
		if (entry.kind === 'todo') return true;
		if (entry.kind !== 'action') return false;
		if (entry.action === 'undo') return !canUndo;
		if (entry.action === 'redo') return !canRedo;
		return false;
	}
</script>

<nav
	class="border-subtle bg-bg flex h-7 shrink-0 items-center border-t px-2"
	aria-label="Editor menu"
>
	<Menubar.Root loop class="flex h-full items-center gap-0.5">
		{#each EDITOR_MENUS as menu (menu.id)}
			<Menubar.Menu value={menu.id}>
				<Menubar.Trigger
					class="text-muted data-[state=open]:bg-surface data-[state=open]:text-text hover:bg-surface/60 hover:text-text flex h-5 cursor-default items-center rounded-sm px-2 text-[11px] outline-none"
				>
					{menu.label}
				</Menubar.Trigger>
				<Menubar.Portal>
					<Menubar.Content align="start" sideOffset={3} class={contentClass}>
						{#each menu.items as entry, index (`${menu.id}-${index}`)}
							{#if entry.kind === 'separator'}
								<Menubar.Separator class="bg-subtle my-1 h-px" />
							{:else if entry.kind === 'submenu'}
								<Menubar.Sub>
									<Menubar.SubTrigger class={itemClass}>
										<span class="w-3"></span>
										<span class="flex-1">{entry.label}</span>
										<ChevronRight size={11} class="text-muted" />
									</Menubar.SubTrigger>
									<Menubar.Portal>
										<Menubar.SubContent sideOffset={3} class={contentClass}>
											{#each entry.items as child, childIndex (`${menu.id}-${index}-${childIndex}`)}
												{#if child.kind === 'separator'}
													<Menubar.Separator class="bg-subtle my-1 h-px" />
												{:else}
													<Menubar.Item
														disabled={disabled(child)}
														data-todo={child.kind === 'todo' ? child.todo : undefined}
														class={itemClass}
														onSelect={() => select(child)}
													>
														<span class="flex w-3 items-center justify-center">
															{#if child.kind === 'todo' && child.checked}<Check size={10} />{/if}
														</span>
														<span class="flex-1">{child.label}</span>
														{#if child.shortcut}
															<kbd class="text-muted ml-5 font-mono text-[10px]"
																><ShortcutHint shortcut={child.shortcut} /></kbd
															>
														{/if}
													</Menubar.Item>
												{/if}
											{/each}
										</Menubar.SubContent>
									</Menubar.Portal>
								</Menubar.Sub>
							{:else}
								<Menubar.Item
									disabled={disabled(entry)}
									data-todo={entry.kind === 'todo' ? entry.todo : undefined}
									class={itemClass}
									onSelect={() => select(entry)}
								>
									<span class="flex w-3 items-center justify-center">
										{#if entry.kind === 'todo' && entry.checked}<Check size={10} />{/if}
									</span>
									<span class="flex-1">{entry.label}</span>
									{#if entry.shortcut}
										<kbd class="text-muted ml-5 font-mono text-[10px]"
											><ShortcutHint shortcut={entry.shortcut} /></kbd
										>
									{/if}
								</Menubar.Item>
							{/if}
						{/each}
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
		{/each}
	</Menubar.Root>
</nav>
