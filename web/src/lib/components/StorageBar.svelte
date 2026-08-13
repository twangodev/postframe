<script lang="ts">
	import { formatBytes } from '$lib/format-bytes';
	import type { StorageBreakdown } from '$lib/storage-breakdown';

	let { breakdown }: { breakdown: StorageBreakdown } = $props();

	const occupied = $derived(breakdown.segments.filter((segment) => segment.bytes > 0));
	const scaleBytes = $derived(breakdown.quotaBytes ?? breakdown.originBytes ?? breakdown.appBytes);

	function widthPercent(bytes: number) {
		return scaleBytes > 0 ? Math.max(0.75, (bytes / scaleBytes) * 100) : 0;
	}
</script>

<div class="bg-subtle flex h-1.5 gap-px overflow-hidden rounded-full">
	{#each occupied as segment (segment.id)}
		<div class={[segment.color, 'h-full']} style:width="{widthPercent(segment.bytes)}%"></div>
	{/each}
</div>
<div class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
	{#each occupied as segment (segment.id)}
		<div class="flex items-center gap-1.5">
			<span class={[segment.color, 'h-1.5 w-1.5 rounded-full']}></span>
			<span class="text-muted text-[11px]">{segment.label}</span>
			<span class="font-mono text-[11px]">{formatBytes(segment.bytes)}</span>
		</div>
	{:else}
		<span class="text-muted text-[11px]">nothing stored yet</span>
	{/each}
</div>
{#if breakdown.freeBytes !== null}
	<p class="text-muted mt-2 text-[11px]">
		{formatBytes(breakdown.freeBytes)} free of {formatBytes(breakdown.quotaBytes)}
	</p>
{/if}
