import { expect, test } from '@playwright/test';

test('edits and resets adjustment values', async ({ page }) => {
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

	const value = page.getByRole('textbox', { name: 'Contrast value' });
	await value.fill('37');
	await value.press('Enter');
	await expect(value).toHaveValue('+37');

	await page.getByRole('slider', { name: 'Contrast' }).dblclick();
	await expect(value).toHaveValue('0');
});
