<script lang="ts">
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
</svelte:head>

{@render children()}
