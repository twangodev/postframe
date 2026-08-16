<script lang="ts">
	import { BarChart } from 'layerchart/svg';
	import Tooltip from './ui/Tooltip.svelte';
	import { formatBytes } from '$lib/format-bytes';
	import type { StorageBreakdown } from '$lib/storage-breakdown';

	let { breakdown }: { breakdown: StorageBreakdown } = $props();

	const occupied = $derived(breakdown.segments.filter((segment) => segment.bytes > 0));
	const visibleFloor = $derived(breakdown.totalBytes * 0.0075);
	const widths = $derived(occupied.map((segment) => Math.max(segment.bytes, visibleFloor)));
	const scaleBytes = $derived(widths.reduce((total, width) => total + width, 0));
	const row = $derived(Object.fromEntries(occupied.map(({ id }, index) => [id, widths[index]])));
	const series = $derived(occupied.map(({ id, color }) => ({ key: id, color })));
	const regions = $derived.by(() => {
		let offset = 0;
		return occupied.map((segment, index) => {
			const width = widths[index] / scaleBytes;
			const region = { segment, left: offset, width };
			offset += width;
			return region;
		});
	});
	const summary = $derived(
		breakdown.totalBytes === 0
			? 'nothing stored yet'
			: `${formatBytes(breakdown.totalBytes)} on this device`
	);
</script>

<div class="relative">
	<div class="bg-subtle h-1.5 overflow-hidden rounded-full" aria-hidden="true">
		{#if occupied.length > 0}
			<BarChart
				data={[row]}
				y={() => 'used'}
				{series}
				orientation="horizontal"
				seriesLayout="stack"
				xDomain={[0, scaleBytes]}
				xNice={false}
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
	<div class="absolute inset-x-0 -inset-y-1.5">
		{#each regions as { segment, left, width } (segment.id)}
			<Tooltip text={`${segment.label} · ${formatBytes(segment.bytes)}`}>
				{#snippet children(props)}
					<div
						{...props}
						class="absolute inset-y-0"
						style:left={`${left * 100}%`}
						style:width={`${width * 100}%`}
					></div>
				{/snippet}
			</Tooltip>
		{/each}
	</div>
</div>
<p class="text-muted mt-2 text-[11px]">{summary}</p>
{#if occupied.length > 0}
	<ul aria-label="Storage breakdown" class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
		{#each occupied as segment (segment.id)}
			<li class="flex items-center justify-between gap-3">
				<span class="flex items-center gap-1.5">
					<span class="size-1.5 rounded-full" style:background={segment.color}></span>
					{segment.label}
				</span>
				<span class="text-muted font-mono">{formatBytes(segment.bytes)}</span>
			</li>
		{/each}
	</ul>
{/if}
