<script lang="ts">
	import { BarChart } from 'layerchart/svg';
	import Tooltip from './ui/Tooltip.svelte';
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
	const regions = $derived.by(() => {
		let offset = 0;
		return occupied.map((segment) => {
			const width = Math.max(segment.bytes, visibleFloor) / scaleBytes;
			const region = { segment, left: offset, width };
			offset += width;
			return region;
		});
	});
	const usedBytes = $derived(breakdown.originBytes ?? breakdown.appBytes);
	const summary = $derived(
		breakdown.freeBytes === null
			? `${formatBytes(usedBytes)} used`
			: `${formatBytes(usedBytes)} used · ${formatBytes(breakdown.freeBytes)} free of ${formatBytes(breakdown.quotaBytes)}`
	);
</script>

<div class="relative">
	<div
		class="bg-subtle h-1.5 overflow-hidden rounded-full"
		role="meter"
		aria-label="Local storage used"
		aria-valuemin={0}
		aria-valuemax={scaleBytes}
		aria-valuenow={usedBytes}
		aria-valuetext={summary}
	>
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
<ul class="sr-only">
	{#each occupied as segment (segment.id)}
		<li>{segment.label}: {formatBytes(segment.bytes)}</li>
	{/each}
</ul>
