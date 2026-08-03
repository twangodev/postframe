import { expect, test } from '@playwright/test';

test('switches scope modes and edits adjustment values', async ({ page }) => {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'slider.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await expect(page.getByRole('img', { name: 'RGB waveform scope' })).toBeVisible();
	await page.getByRole('radio', { name: 'Histogram scope' }).click();
	await expect(page.getByRole('img', { name: 'RGB histogram scope' })).toBeVisible();

	const value = page.getByRole('textbox', { name: 'Contrast value' });
	await value.fill('37');
	await value.press('Enter');
	await expect(value).toHaveValue('+37');

	await page.getByRole('slider', { name: 'Contrast' }).dblclick();
	await expect(value).toHaveValue('0');
});
