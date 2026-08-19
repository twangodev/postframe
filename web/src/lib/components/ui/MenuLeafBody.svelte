<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { MenuAction, MenuTodo } from '$lib/menu';
	import ShortcutHint from './ShortcutHint.svelte';

	interface Props {
		entry: MenuAction<unknown> | MenuTodo;
	}

	let { entry }: Props = $props();
</script>

<span class="flex w-3 items-center justify-center">
	{#if entry.checked}<Check size={10} />{/if}
</span>
<span class="flex-1">{entry.label}</span>
{#if entry.shortcut}
	<kbd class="ml-5 font-mono text-[10px] text-muted"><ShortcutHint shortcut={entry.shortcut} /></kbd
	>
{/if}
