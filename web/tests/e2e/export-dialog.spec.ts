import { statSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('exports the edited photograph as a suggested jpeg download', async ({ page }) => {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 256;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#12324f');
		gradient.addColorStop(0.5, '#ff4838');
		gradient.addColorStop(1, '#f5ead6');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'export-me.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});

	await page.locator('header').getByRole('button', { name: 'export', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('export-me.png')).toBeVisible();
	await expect(dialog.getByText('quality', { exact: true })).toBeVisible();
	await expect(dialog.locator('input[type="range"]')).toHaveValue('92');
	await expect(dialog.getByText('JPEG · quality 92')).toBeVisible();

	const downloadEvent = page.waitForEvent('download', { timeout: 60_000 });
	await dialog.getByRole('button', { name: 'export', exact: true }).click();
	const download = await downloadEvent;
	expect(download.suggestedFilename()).toBe('export-me-edit.jpg');
	const downloadPath = await download.path();
	expect(statSync(downloadPath).size).toBeGreaterThan(1_000);
});
