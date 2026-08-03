<script lang="ts">
	import { LineChart } from 'layerchart/svg';
	import { HISTOGRAM_BINS, type ImageScopeData } from '$lib/image-scope';

	interface Props {
		data: ImageScopeData;
		reduceMotion?: boolean;
	}

	type HistogramPoint = {
		bin: number;
		red: number;
		green: number;
		blue: number;
		luma: number;
	};

	let { data, reduceMotion = false }: Props = $props();

	const points = $derived.by(() => histogramPoints(data.histogram));
	const motion = $derived(reduceMotion ? 'none' : { type: 'tween' as const, duration: 140 });
	const series = [
		{
			key: 'luma',
			value: 'luma',
			color: '#e8e5df',
			props: { opacity: 0.34, strokeWidth: 0.75 }
		},
		{
			key: 'red',
			value: 'red',
			color: '#ff5968',
			props: { opacity: 0.82, strokeWidth: 0.9 }
		},
		{
			key: 'green',
			value: 'green',
			color: '#62d979',
			props: { opacity: 0.78, strokeWidth: 0.9 }
		},
		{
			key: 'blue',
			value: 'blue',
			color: '#5f83ff',
			props: { opacity: 0.86, strokeWidth: 0.9 }
		}
	];

	function histogramPoints(histogram: Uint32Array): HistogramPoint[] {
		let peak = 1;
		for (const count of histogram) peak = Math.max(peak, count);
		const logarithmicPeak = Math.log1p(peak);
		const level = (channel: number, bin: number) =>
			Math.log1p(histogram[channel * HISTOGRAM_BINS + bin] ?? 0) / logarithmicPeak;

		return Array.from({ length: HISTOGRAM_BINS }, (_, bin) => ({
			bin,
			red: level(0, bin),
			green: level(1, bin),
			blue: level(2, bin),
			luma: level(3, bin)
		}));
	}
</script>

<div class="relative size-full" aria-hidden="true">
	<div class="pointer-events-none absolute inset-0">
		{#each [25, 50, 75] as position}
			<div
				class="absolute right-0 left-0 border-t border-[rgba(122,117,104,0.16)]"
				style:top={`${position}%`}
			></div>
		{/each}
	</div>
	<LineChart
		data={points}
		x="bin"
		xDomain={[0, HISTOGRAM_BINS - 1]}
		yDomain={[0, 1]}
		{series}
		axis={false}
		highlight={false}
		tooltipContext={false}
		pointerEvents={false}
		clip={true}
		padding={{ top: 5, right: 0, bottom: 5, left: 0 }}
		props={{
			spline: {
				fill: 'none',
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round',
				motion
			}
		}}
		class="size-full [&_.lc-path]:mix-blend-screen [&_.lc-path]:[filter:drop-shadow(0_0_2px_currentColor)]"
	/>
</div>
