import { test, expect } from '@playwright/test';

/**
 * E2E tests for the create-stream flow.
 *
 * Covers:
 *  1. Happy path: fill form → submit → new stream appears on dashboard
 *  2. Validation errors for invalid / empty inputs
 *  3. Wallet not-connected state shows connect prompt in nav
 */

// A valid Stellar public key used across tests
const VALID_RECIPIENT = 'GBKLYONWFBQFBFZK6HMTXQZJNBKQEXZ3PJOVXNKZXVTV4FQXVMKLKHA';

test.describe('Create Stream – happy path', () => {
  test('fill form → submit → new stream card visible on dashboard', async ({ page }) => {
    await page.goto('/stream/new');
    await expect(page.locator('h1')).toContainText('Create Stream');

    // Fill recipient
    await page.getByLabel('Recipient Address').fill(VALID_RECIPIENT);

    // Fill amount
    await page.getByLabel('Amount (USDC)').fill('50');

    // Set duration: 1 day
    await page.getByLabel('Days').fill('1');

    // Submit
    await page.getByRole('button', { name: 'Create Stream' }).click();

    // Should redirect to the new stream's detail page
    await expect(page).toHaveURL(/\/stream\/\d+/);
    const url = page.url();
    const streamId = url.split('/stream/')[1];
    expect(streamId).toBeTruthy();

    // Verify detail page renders with the right heading
    await expect(page.locator('h1')).toContainText(`Stream #${streamId}`);

    // Navigate to dashboard and confirm the new stream appears
    await page.goto('/dashboard');

    // Wait for loading skeleton to disappear
    await expect(page.locator('[role="status"]')).not.toBeVisible({ timeout: 5000 });

    // The new stream id badge should be present in the grid
    await expect(page.getByText(`#${streamId}`)).toBeVisible();
  });
});

test.describe('Create Stream – form validation', () => {
  test('shows required-field errors when submitting empty form', async ({ page }) => {
    await page.goto('/stream/new');

    // Submit without filling anything
    await page.getByRole('button', { name: 'Create Stream' }).click();

    // Recipient error
    await expect(page.locator('#recipient-error')).toBeVisible();
    await expect(page.locator('#recipient-error')).toContainText('required');

    // Amount error
    await expect(page.locator('#amount-error')).toBeVisible();
    await expect(page.locator('#amount-error')).toContainText('required');

    // Duration error — the DurationPicker surfaces it via role="alert"
    await expect(page.getByRole('alert').filter({ hasText: /duration/i })).toBeVisible();
  });

  test('shows invalid-address error for a bad recipient value', async ({ page }) => {
    await page.goto('/stream/new');

    await page.getByLabel('Recipient Address').fill('not-a-valid-key');
    await page.getByLabel('Recipient Address').blur();

    await expect(page.locator('#recipient-error')).toBeVisible();
    await expect(page.locator('#recipient-error')).toContainText('valid Stellar');
  });

  test('shows amount error when value is 0 or negative', async ({ page }) => {
    await page.goto('/stream/new');

    await page.getByLabel('Amount (USDC)').fill('0');
    await page.getByLabel('Amount (USDC)').blur();

    await expect(page.locator('#amount-error')).toBeVisible();
    await expect(page.locator('#amount-error')).toContainText('greater than 0');
  });

  test('shows duration error immediately when all duration fields are 0 and user interacts', async ({
    page,
  }) => {
    await page.goto('/stream/new');

    // Touch the Days field (type then clear back to 0) to trigger the onBlur guard
    const daysInput = page.getByLabel('Days');
    await daysInput.fill('1');
    await daysInput.fill('0');
    await daysInput.blur();

    // Inline error should appear inside the DurationPicker
    const durationAlert = page.getByRole('alert').filter({ hasText: /duration/i });
    await expect(durationAlert).toBeVisible();
    await expect(durationAlert).toContainText('greater than 0');
  });

  test('duration error clears when a valid duration is entered', async ({ page }) => {
    await page.goto('/stream/new');

    // Trigger the zero-duration error first
    const daysInput = page.getByLabel('Days');
    await daysInput.fill('1');
    await daysInput.fill('0');
    await daysInput.blur();

    await expect(page.getByRole('alert').filter({ hasText: /duration/i })).toBeVisible();

    // Now enter a valid duration
    await daysInput.fill('2');

    // Error should disappear
    await expect(page.getByRole('alert').filter({ hasText: /duration/i })).not.toBeVisible();
  });

  test('submit is blocked when duration is zero and duration error is shown', async ({ page }) => {
    await page.goto('/stream/new');

    // Fill valid recipient and amount but leave duration at 0
    await page.getByLabel('Recipient Address').fill(VALID_RECIPIENT);
    await page.getByLabel('Amount (USDC)').fill('100');

    await page.getByRole('button', { name: 'Create Stream' }).click();

    // Still on the same page — navigation did not happen
    await expect(page).toHaveURL('/stream/new');

    // Duration error is visible
    await expect(page.getByRole('alert').filter({ hasText: /duration/i })).toBeVisible();
  });
});

test.describe('Create Stream – end date & cliff date validation', () => {
  /**
   * Helper: navigate to step 2 (Amount & Duration) with valid recipient.
   */
  async function goToAmountStep(page: import('@playwright/test').Page) {
    await page.goto('/stream/new');
    await page.getByLabel('Recipient Address').fill(VALID_RECIPIENT);
    await page.getByRole('button', { name: 'Next' }).click();
    // Should now be on step 2
    await expect(page.getByLabel(/Amount/i).first()).toBeVisible();
  }

  /**
   * Returns a datetime-local string that is offset from now by `offsetMs` ms.
   * Playwright fills datetime-local inputs with the format YYYY-MM-DDTHH:MM.
   */
  function datetimeLocalOffset(offsetMs: number): string {
    const d = new Date(Date.now() + offsetMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  test('shows error when end date is in the past', async ({ page }) => {
    await goToAmountStep(page);

    const pastDate = datetimeLocalOffset(-86400000); // 1 day ago
    await page.getByLabel('End Date').fill(pastDate);
    await page.getByLabel('End Date').blur();

    await expect(page.locator('#end-date-error')).toBeVisible();
    await expect(page.locator('#end-date-error')).toContainText(/future/i);
  });

  test('does not show end-date error when end date is in the future', async ({ page }) => {
    await goToAmountStep(page);

    const futureDate = datetimeLocalOffset(86400000 * 2); // 2 days ahead
    await page.getByLabel('End Date').fill(futureDate);
    await page.getByLabel('End Date').blur();

    await expect(page.locator('#end-date-error')).not.toBeVisible();
  });

  test('shows error when cliff date is after end date', async ({ page }) => {
    await goToAmountStep(page);

    const endDate = datetimeLocalOffset(86400000); // 1 day ahead
    const cliffAfterEnd = datetimeLocalOffset(86400000 * 3); // 3 days ahead (after end)

    await page.getByLabel('End Date').fill(endDate);
    await page.getByLabel('End Date').blur();

    await page.getByLabel('Cliff Date').fill(cliffAfterEnd);
    await page.getByLabel('Cliff Date').blur();

    await expect(page.locator('#cliff-date-error')).toBeVisible();
    await expect(page.locator('#cliff-date-error')).toContainText(/before the end date/i);
  });

  test('shows error when cliff date is in the past', async ({ page }) => {
    await goToAmountStep(page);

    const pastCliff = datetimeLocalOffset(-86400000); // 1 day ago
    await page.getByLabel('Cliff Date').fill(pastCliff);
    await page.getByLabel('Cliff Date').blur();

    await expect(page.locator('#cliff-date-error')).toBeVisible();
    await expect(page.locator('#cliff-date-error')).toContainText(/future/i);
  });

  test('no cliff error when cliff is before a valid end date', async ({ page }) => {
    await goToAmountStep(page);

    const endDate = datetimeLocalOffset(86400000 * 3); // 3 days ahead
    const cliffBeforeEnd = datetimeLocalOffset(86400000); // 1 day ahead (before end)

    await page.getByLabel('End Date').fill(endDate);
    await page.getByLabel('End Date').blur();

    await page.getByLabel('Cliff Date').fill(cliffBeforeEnd);
    await page.getByLabel('Cliff Date').blur();

    await expect(page.locator('#cliff-date-error')).not.toBeVisible();
  });

  test('Next is blocked when end date is in the past', async ({ page }) => {
    await goToAmountStep(page);

    // Fill valid amount & duration
    await page.getByLabel('Amount (USDC)').fill('10');
    await page.getByLabel('Days').fill('1');

    const pastDate = datetimeLocalOffset(-86400000);
    await page.getByLabel('End Date').fill(pastDate);
    await page.getByLabel('End Date').blur();

    await page.getByRole('button', { name: 'Next' }).click();

    // Still on amount step (not proceeded to review)
    await expect(page.locator('#end-date-error')).toBeVisible();
    await expect(page.locator('#end-date-error')).toContainText(/future/i);
  });

  test('Next is blocked when cliff date is after end date', async ({ page }) => {
    await goToAmountStep(page);

    await page.getByLabel('Amount (USDC)').fill('10');
    await page.getByLabel('Days').fill('1');

    const endDate = datetimeLocalOffset(86400000);
    const cliffAfterEnd = datetimeLocalOffset(86400000 * 3);

    await page.getByLabel('End Date').fill(endDate);
    await page.getByLabel('End Date').blur();
    await page.getByLabel('Cliff Date').fill(cliffAfterEnd);
    await page.getByLabel('Cliff Date').blur();

    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.locator('#cliff-date-error')).toBeVisible();
    await expect(page.locator('#cliff-date-error')).toContainText(/before the end date/i);
  });
});

test.describe('Create Stream – wallet not connected', () => {
  test('mobile header keeps the navigation menu visible without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/stream/1');

    const menuButton = page.locator('button[aria-controls="mobile-nav-drawer"]');
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.locator('#mobile-nav-drawer')).toBeVisible();
    await expect(page.locator('#mobile-nav-drawer').getByRole('link', { name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('nav shows Connect wallet button when no wallet is connected', async ({ page }) => {
    await page.goto('/stream/new');

    // WalletConnect renders in the NavHeader with an aria-label containing "Connect"
    const connectBtn = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectBtn).toBeVisible();
  });

  test('wallet section in nav is visible and not showing a connected address', async ({
    page,
  }) => {
    await page.goto('/');

    // There should be no connected-wallet display (no truncated address like "GBKL…KLHA")
    const connectedLabel = page.getByLabel(/connected wallet/i);
    await expect(connectedLabel).not.toBeVisible();

    // The Connect button is shown instead
    const connectBtn = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectBtn).toBeVisible();
  });

  test('connect prompt appears and shows error for missing Freighter extension', async ({
    page,
  }) => {
    await page.goto('/stream/new');

    // Click the Freighter connect button (default wallet type)
    const connectBtn = page.getByRole('button', { name: /connect freighter/i });
    await expect(connectBtn).toBeVisible();

    await connectBtn.click();

    // Freighter isn't installed in the test browser — error should appear
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    await expect(errorAlert).toContainText(/freighter/i);
  });
});

test.describe('Create Stream – template picker prefill flow', () => {
  test('select template → verify prefill → override one field → submit and verify', async ({ page }) => {
    // 1. Go to stream creation page
    await page.goto('/stream/new');

    // Fill recipient first to get to step 2
    await page.getByLabel('Recipient Address').fill(VALID_RECIPIENT);
    await page.getByRole('button', { name: 'Next' }).click();

    // 2. Select "Biweekly payroll" template
    await page.getByRole('button', { name: /biweekly payroll/i }).click();

    // 3. Verify fields are prefilled: amount "5000", days "14", hours "0", minutes "0"
    await expect(page.getByLabel('Amount (USDC)')).toHaveValue('5000');
    await expect(page.getByLabel('Days')).toHaveValue('14');
    await expect(page.getByLabel('Hours')).toHaveValue('0');
    await expect(page.getByLabel('Minutes')).toHaveValue('0');

    // 4. Override one field (Amount to "2500") and verify only that field changes
    await page.getByLabel('Amount (USDC)').fill('2500');

    // Verify amount is updated, but duration fields are unchanged
    await expect(page.getByLabel('Amount (USDC)')).toHaveValue('2500');
    await expect(page.getByLabel('Days')).toHaveValue('14');
    await expect(page.getByLabel('Hours')).toHaveValue('0');
    await expect(page.getByLabel('Minutes')).toHaveValue('0');

    // Next, proceed to review step
    await page.getByRole('button', { name: 'Next' }).click();

    // 5. Verify review page shows correct values: Amount 2,500/2500 USDC, Duration 14d
    await expect(page.getByText('2500 USDC')).toBeVisible();
    await expect(page.getByText('14d')).toBeVisible();

    // Submit stream
    await page.getByRole('button', { name: 'Create Stream' }).click();

    // Should redirect to stream detail page
    await expect(page).toHaveURL(/\/stream\/\d+/);
    const url = page.url();
    const streamId = url.split('/stream/')[1].split('?')[0];
    expect(streamId).toBeTruthy();

    // Verify detail page has correct heading
    await expect(page.locator('h1')).toContainText(`Stream #${streamId}`);
  });
});

test.describe('Create Stream – full wizard flow', () => {
  test('recipient → amount & duration → review → submit → detail → dashboard', async ({ page }) => {
    await page.goto('/stream/new');

    // Step 1: recipient
    await page.getByLabel('Recipient Address').fill(VALID_RECIPIENT);
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: amount & duration
    await page.getByLabel('Amount (USDC)').fill('75');
    await page.getByLabel('Days').fill('3');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: review shows entered values
    await expect(page.getByText('75 USDC')).toBeVisible();
    await expect(page.getByText('3d')).toBeVisible();

    // Submit
    await page.getByRole('button', { name: 'Create Stream' }).click();

    // Detail page
    await expect(page).toHaveURL(/\/stream\/\d+/);
    const streamId = page.url().split('/stream/')[1].split('?')[0];
    expect(streamId).toBeTruthy();
    await expect(page.locator('h1')).toContainText(`Stream #${streamId}`);

    // Dashboard lists the new stream
    await page.goto('/dashboard');
    await expect(page.locator('[role="status"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(`#${streamId}`)).toBeVisible();
  });
});
