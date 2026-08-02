<script lang="ts">
	import { Aperture } from '@lucide/svelte';
	import type { Photo } from '$lib/workspace.svelte';

	interface Props {
		photo: Photo;
		contain?: boolean;
		onRequest?: (photoId: string) => void | Promise<void>;
	}

	let { photo, contain = false, onRequest }: Props = $props();
	let container: HTMLDivElement;

	$effect(() => {
		if (!container || photo.src || !onRequest) return;
		if (typeof IntersectionObserver === 'undefined') {
			void onRequest(photo.id);
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void onRequest(photo.id);
			},
			{ rootMargin: '240px' }
		);
		observer.observe(container);
		return () => observer.disconnect();
	});
</script>

<div bind:this={container} class="size-full">
	{#if photo.src}
		<img
			src={photo.src}
			alt={photo.name}
			draggable="false"
			class="size-full select-none {contain ? 'object-contain' : 'object-cover'}"
		/>
	{:else}
		<div
			class="text-muted flex size-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_30%_25%,#403c31_0%,#22211d_42%,#151512_100%)]"
		>
			<Aperture size={32} strokeWidth={1} />
			<span class="font-mono text-[10px] tracking-[0.04em]">loading preview</span>
		</div>
	{/if}
</div>
