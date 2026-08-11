<script lang="ts">
	import { dev } from '$app/environment';
	import './app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta
		name="description"
		content="Postframe is a focused workspace for organizing, developing, and finishing photographs."
	/>
	{#if !dev}
		<script
			src="https://rybbit.twango.dev/api/script.js"
			data-site-id="b45b9596157c"
			defer
		></script>
	{/if}
</svelte:head>

{@render children()}
