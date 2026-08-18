import { defineConfig } from '@playwright/test';

const port = process.env.PF_E2E_PORT ?? '4173';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure'
	},
	webServer: {
		command: `bun run dev:host -- --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
