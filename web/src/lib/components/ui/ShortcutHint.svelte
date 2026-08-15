<script lang="ts">
	import { ArrowBigUp, ChevronUp, Command, Option } from '@lucide/svelte';
	import { applePlatform } from '$lib/platform';
	import { parseShortcut, shortcutText } from '$lib/shortcut';

	let { shortcut }: { shortcut: string } = $props();

	const apple = applePlatform();
	const keys = $derived(parseShortcut(shortcut));
</script>

{#if apple}
	<span class="inline-flex items-center gap-px">
		{#if keys.control}<ChevronUp size={10} strokeWidth={2} />{/if}
		{#if keys.alt}<Option size={10} strokeWidth={2} />{/if}
		{#if keys.shift}<ArrowBigUp size={10} strokeWidth={2} />{/if}
		{#if keys.mod}<Command size={10} strokeWidth={2} />{/if}
		<span>{keys.key}</span>
	</span>
{:else}
	{shortcutText(shortcut)}
{/if}
