import { expect, test } from '@playwright/test';

test('presents the storage meter with segment tooltips and no overflow', async ({ page }) => {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#d8c3a5';
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'meter.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await expect(page.getByText('1 photo · saved locally')).toBeVisible();

	await page.getByRole('button', { name: 'Manage local storage' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();

	const meter = dialog.getByRole('meter', { name: 'Local storage used' });
	await expect(meter).toBeVisible({ timeout: 15_000 });
	await expect(meter).toHaveAttribute('aria-valuemin', '0');
	await expect(meter).toHaveAttribute('aria-valuemax', /^\d+$/);
	await expect(meter).toHaveAttribute('aria-valuenow', /^\d+$/);
	await expect(meter).toHaveAttribute('aria-valuetext', /used/);

	const segment = dialog.locator('[data-tooltip-trigger]').first();
	await segment.hover();
	const tooltip = page.locator('[data-tooltip-content]');
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toHaveText(/·\s*\d+(\.\d+)?\s(B|KB|MB|GB|TB)/);

	expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
});
