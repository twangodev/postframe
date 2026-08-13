<script lang="ts">
	import { BarChart } from 'layerchart/svg';
	import { formatBytes } from '$lib/format-bytes';
	import type { StorageBreakdown } from '$lib/storage-breakdown';

	let { breakdown }: { breakdown: StorageBreakdown } = $props();

	const occupied = $derived(breakdown.segments.filter((segment) => segment.bytes > 0));
	const scaleBytes = $derived(breakdown.quotaBytes ?? breakdown.originBytes ?? breakdown.appBytes);
	const visibleFloor = $derived(scaleBytes * 0.0075);
	const row = $derived(
		Object.fromEntries(occupied.map(({ id, bytes }) => [id, Math.max(bytes, visibleFloor)]))
	);
	const series = $derived(occupied.map(({ id, color }) => ({ key: id, color })));
</script>

<div class="bg-subtle h-1.5 overflow-hidden rounded-full">
	{#if occupied.length > 0}
		<BarChart
			data={[row]}
			y={() => 'used'}
			{series}
			orientation="horizontal"
			seriesLayout="stack"
			xDomain={[0, scaleBytes]}
			bandPadding={0}
			axis={false}
			grid={false}
			tooltipContext={false}
			pointerEvents={false}
			padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
			class="size-full"
		/>
	{/if}
</div>
<div class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
	{#each occupied as segment (segment.id)}
		<div class="flex items-center gap-1.5">
			<span class="h-1.5 w-1.5 rounded-full" style:background={segment.color}></span>
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
