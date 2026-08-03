import { expect, test } from '@playwright/test';

test('switches scope modes and edits adjustment values', async ({ page }) => {
	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#000000');
		gradient.addColorStop(0.5, '#ff4838');
		gradient.addColorStop(1, '#ffffff');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
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
	await expect(page.getByText('scope unavailable')).toHaveCount(0);
	await page.getByRole('radio', { name: 'Histogram scope' }).click();
	await expect(page.getByRole('img', { name: 'RGB histogram scope' })).toBeVisible();

	const value = page.getByRole('textbox', { name: 'Contrast value' });
	await value.fill('37');
	await value.press('Enter');
	await expect(value).toHaveValue('+37');

	await page.getByRole('slider', { name: 'Contrast' }).dblclick();
	await expect(value).toHaveValue('0');
});
