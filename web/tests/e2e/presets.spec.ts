import { expect, test, type Locator, type Page } from '@playwright/test';

const png = (page: Page, fill: string) =>
	page.evaluate((fill) => {
		const canvas = document.createElement('canvas');
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#202020');
		gradient.addColorStop(0.5, fill);
		gradient.addColorStop(1, '#f0f0f0');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	}, fill);

const upload = (name: string, dataUrl: string) => ({
	name,
	mimeType: 'image/png',
	buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
});

function storedEditNamed(page: Page, name: string) {
	return page.evaluate(async (name) => {
		const photoId = await new Promise<string | null>((resolve, reject) => {
			const request = indexedDB.open('postframe-catalog');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const database = request.result;
				const photos = database.transaction('photos').objectStore('photos').getAll();
				photos.onerror = () => reject(photos.error);
				photos.onsuccess = () => {
					database.close();
					const photo = (photos.result as { id: string; name: string }[]).find(
						(candidate) => candidate.name === name
					);
					resolve(photo?.id ?? null);
				};
			};
		});
		if (!photoId) return null;
		const root = await navigator.storage.getDirectory();
		const app = await root.getDirectoryHandle('postframe');
		const edits = await app.getDirectoryHandle('edits');
		try {
			const handle = await edits.getFileHandle(`${photoId}.json`);
			return JSON.parse(await (await handle.getFile()).text());
		} catch {
			return null;
		}
	}, name);
}

async function commit(value: Locator, draft: string, formatted: string) {
	await value.fill(draft);
	await value.press('Enter');
	await expect(value).toHaveValue(formatted);
}

async function openInFilmstrip(page: Page, name: string, mirrored: Locator, value: string) {
	await page.getByRole('button', { name, exact: true }).click();
	await expect(mirrored).toHaveValue(value);
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});
}

async function chooseEditMenu(page: Page, item: string) {
	await page.getByRole('menuitem', { name: 'edit', exact: true }).click();
	await page.getByRole('menuitem', { name: item }).click();
}

test('presets, copied settings and synced settings travel between photographs', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'open photo' })).toBeEnabled();
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles(upload('first.png', await png(page, '#d97a4a')));
	const exposure = page.getByRole('textbox', { name: 'Exposure value' });
	await expect(exposure).toBeEnabled({ timeout: 20_000 });
	await page
		.locator('header input[type="file"][multiple]')
		.setInputFiles(upload('second.png', await png(page, '#4a7ad9')));
	await expect(page.getByText('2 photos · saved locally')).toBeVisible();

	await commit(exposure, '1', '+1.00 EV');

	await page.getByRole('button', { name: 'Presets' }).click();
	await expect(page.getByText('no presets yet')).toBeVisible();
	await page.getByRole('button', { name: 'save current…' }).click();
	const saveDialog = page.getByRole('dialog', { name: 'save preset' });
	await expect(saveDialog.getByRole('checkbox', { name: 'Light' })).toBeChecked();
	await expect(saveDialog.getByRole('checkbox', { name: 'Color' })).not.toBeChecked();
	await saveDialog.getByRole('textbox', { name: 'preset name' }).fill('Warm');
	await saveDialog.getByRole('button', { name: 'save preset' }).click();
	await expect(saveDialog).toBeHidden();
	const warm = page.getByRole('button', { name: /^Warm 1 group$/ });
	await expect(warm).toBeVisible();

	await openInFilmstrip(page, 'second.png', exposure, '0.00 EV');
	await warm.click();
	await expect(exposure).toHaveValue('+1.00 EV');
	await page.getByRole('button', { name: 'History' }).click();
	await expect(page.getByText('preset Warm')).toBeVisible();

	await page.getByRole('menuitem', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'paste settings' })).toBeDisabled();
	await expect(page.getByRole('menuitem', { name: 'sync settings…' })).toBeDisabled();
	await page.keyboard.press('Escape');

	const temperature = page.getByRole('textbox', { name: 'Temperature value' });
	await commit(temperature, '45', '+45');
	await chooseEditMenu(page, 'copy settings…');
	const copyDialog = page.getByRole('dialog', { name: 'copy settings' });
	await expect(copyDialog.getByRole('checkbox', { name: 'Light' })).toBeChecked();
	await expect(copyDialog.getByRole('checkbox', { name: 'Color' })).toBeChecked();
	await copyDialog.getByRole('button', { name: 'none' }).click();
	await copyDialog.getByRole('checkbox', { name: 'Color' }).check();
	await copyDialog.getByRole('button', { name: 'copy', exact: true }).click();
	await expect(copyDialog).toBeHidden();

	await openInFilmstrip(page, 'first.png', temperature, '0');
	await chooseEditMenu(page, 'paste settings');
	await expect(temperature).toHaveValue('+45');
	await expect(exposure).toHaveValue('+1.00 EV');
	await expect(page.getByText('paste settings', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(temperature).toHaveValue('0');
	await page.keyboard.press('ControlOrMeta+Shift+v');
	await expect(temperature).toHaveValue('+45');

	await commit(exposure, '2', '+2.00 EV');
	await page
		.getByRole('button', { name: 'second.png', exact: true })
		.click({ modifiers: ['ControlOrMeta'] });
	await expect(page.getByRole('button', { name: 'second.png', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(exposure).toHaveValue('+2.00 EV');
	await chooseEditMenu(page, 'sync settings…');
	const syncDialog = page.getByRole('dialog', { name: 'sync settings' });
	await expect(syncDialog.getByText('1 other selected photo.')).toBeVisible();
	await syncDialog.getByRole('button', { name: 'none' }).click();
	await syncDialog.getByRole('checkbox', { name: 'Light' }).check();
	await syncDialog.getByRole('button', { name: 'sync', exact: true }).click();
	await expect(syncDialog).toBeHidden();
	await expect
		.poll(() => storedEditNamed(page, 'second.png'))
		.toMatchObject({
			adjustments: { light: { exposure: 2 }, color: { temperature: 45 } }
		});

	await page.reload();
	await expect(page.getByRole('tab', { name: 'edit', exact: true })).toBeEnabled();
	await expect
		.poll(() => storedEditNamed(page, 'second.png'))
		.toMatchObject({
			adjustments: { light: { exposure: 2 }, color: { temperature: 45 } }
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await page.getByRole('button', { name: 'Presets' }).click();
	await expect(page.getByRole('button', { name: /^Warm 1 group$/ })).toBeVisible();
});
