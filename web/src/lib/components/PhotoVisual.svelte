<script lang="ts">
	import { Aperture } from '@lucide/svelte';
	import type { Photo } from '$lib/workspace.svelte';

	interface Props {
		photo: Photo;
		contain?: boolean;
	}

	let { photo, contain = false }: Props = $props();
</script>

{#if photo.src}
	<img
		src={photo.src}
		alt={photo.name}
		draggable="false"
		class="size-full select-none {contain ? 'object-contain' : 'object-cover'}"
	/>
{:else}
	<!-- TODO(WASM_TODOS.previewRendering): display the decoded RAW thumbnail returned by Wasm. -->
	<div
		class="text-muted flex size-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_30%_25%,#403c31_0%,#22211d_42%,#151512_100%)]"
	>
		<Aperture size={32} strokeWidth={1} />
		<span class="font-mono text-[10px] tracking-[0.04em]">RAW preview</span>
	</div>
{/if}
