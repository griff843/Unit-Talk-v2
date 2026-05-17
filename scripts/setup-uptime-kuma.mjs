/**
 * Playwright automation: initialize Uptime Kuma and configure Discord notification
 * Run after SSH tunnel is established: ssh -L 3001:localhost:3001 deploy@<host>
 */
import { chromium } from 'playwright';

const KUMA_URL = 'http://localhost:3001';
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.KUMA_PASS || 'gaaefx0rBwXsHytrLpW5bgkKkZ47V8LhCOM2qOb6';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  console.log('Navigating to Uptime Kuma...');
  await page.goto(KUMA_URL, { waitUntil: 'networkidle' });

  const url = page.url();
  console.log('Current URL:', url);

  // Step 1: Setup database if needed
  if (url.includes('setup-database')) {
    console.log('Setting up database...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Step 1a: Language selection — select English and click Next
    const langSelect = page.locator('select#language');
    if (await langSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await langSelect.selectOption('en');
      console.log('Language set to English');
      await page.waitForTimeout(500);
    }

    // Click Next (may be enabled now after language select)
    let nextBtn = page.locator('button[type="submit"]');
    const isDisabled = await nextBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      // Force via JS dispatch to trigger Vue reactivity
      await page.evaluate(() => {
        const sel = document.querySelector('select#language');
        if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(500);
    }
    await nextBtn.click({ force: true });
    await page.waitForTimeout(2000);
    console.log('After language step, URL:', page.url());

    // Step 1b: If still on setup-database, now select database type
    if (page.url().includes('setup-database')) {
      // Look for SQLite option card or radio button
      await page.locator('.db-option, [data-v]:has-text("SQLite"), input[value="sqlite"]').first().click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('button[type="submit"]').click({ force: true });
      await page.waitForTimeout(3000);
      console.log('After DB type step, URL:', page.url());
    }
  }

  // Step 2: Create admin if at setup page
  await page.goto(KUMA_URL, { waitUntil: 'networkidle' });
  const url2 = page.url();
  console.log('URL after reload:', url2);

  if (url2.includes('setup')) {
    console.log('Creating admin account...');
    await page.waitForSelector('input[placeholder*="sername" i], input[name="username" i]', { timeout: 10000 });
    await page.fill('input[placeholder*="sername" i], input[name="username" i]', ADMIN_USER);
    await page.fill('input[placeholder*="assword" i][type="password"]', ADMIN_PASS);

    // Confirm password field if present
    const confirmField = page.locator('input[placeholder*="onfirm" i], input[placeholder*="epeat" i]');
    if (await confirmField.isVisible()) {
      await confirmField.fill(ADMIN_PASS);
    }

    await page.click('button[type="submit"], button:has-text("Create")');
    await page.waitForURL(/dashboard|login/, { timeout: 15000 }).catch(() => {});
    console.log('After admin create, URL:', page.url());
  }

  // Step 3: Log in if needed
  if (page.url().includes('login') || page.url().includes('setup')) {
    console.log('Logging in...');
    await page.waitForSelector('input[placeholder*="sername" i], input[name="username" i]', { timeout: 10000 });
    await page.fill('input[placeholder*="sername" i], input[name="username" i]', ADMIN_USER);
    await page.fill('input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard/, { timeout: 15000 });
    console.log('Logged in. URL:', page.url());
  }

  console.log('Dashboard reached. Setting up Discord notification...');

  // Step 4: Navigate to Settings > Notifications
  await page.goto(`${KUMA_URL}/settings/notifications`, { waitUntil: 'networkidle' });
  await page.waitForLoadState('networkidle');
  console.log('On notifications page:', page.url());

  // Click "Add Notification"
  const addBtn = page.locator('button').filter({ hasText: /add notification/i });
  await addBtn.waitFor({ timeout: 10000 });
  await addBtn.click();

  // Wait for the modal
  await page.waitForSelector('.modal-dialog, [role="dialog"]', { timeout: 10000 });
  console.log('Notification modal open');

  // Select notification type: Discord
  const typeSelect = page.locator('select').filter({ hasText: /discord/i }).first();
  if (await typeSelect.isVisible()) {
    await typeSelect.selectOption({ label: /discord/i });
  } else {
    // May be a searchable dropdown
    const typeInput = page.locator('input[placeholder*="type" i], .multiselect__input').first();
    if (await typeInput.isVisible()) {
      await typeInput.fill('Discord');
      await page.locator('.multiselect__option, li').filter({ hasText: 'Discord' }).first().click();
    }
  }

  await page.waitForTimeout(500);

  // Fill in the notification name
  const nameField = page.locator('input[placeholder*="friendly name" i], input[id*="name"], input[placeholder*="name" i]').first();
  if (await nameField.isVisible()) {
    await nameField.fill('canary-alerts Discord');
  }

  // Fill webhook URL
  if (DISCORD_WEBHOOK) {
    const webhookField = page.locator('input[placeholder*="webhook" i], input[type="url"]').first();
    if (await webhookField.isVisible()) {
      await webhookField.fill(DISCORD_WEBHOOK);
    }
  }

  // Save notification
  await page.locator('button[type="submit"], button:has-text("Save")').last().click();
  await page.waitForTimeout(2000);
  console.log('Discord notification saved');

  // Step 5: Assign notification to the API health monitor
  await page.goto(`${KUMA_URL}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForLoadState('networkidle');

  // Find the "Unit Talk API Health" monitor
  const monitorLink = page.locator('a, .item').filter({ hasText: /unit talk api health/i }).first();
  if (await monitorLink.isVisible({ timeout: 5000 })) {
    await monitorLink.click();
    await page.waitForLoadState('networkidle');

    // Click Edit
    const editBtn = page.locator('button').filter({ hasText: /edit/i }).first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await page.waitForLoadState('networkidle');

      // Enable the Discord notification checkbox
      const discordCheck = page.locator('input[type="checkbox"]').filter({ has: page.locator(':scope ~ label:has-text("canary-alerts"), :scope ~ span:has-text("canary-alerts")') }).first();
      if (await discordCheck.isVisible()) {
        if (!await discordCheck.isChecked()) {
          await discordCheck.click();
        }
      } else {
        // Try clicking on the notification name label
        const notifLabel = page.locator('label, .notification-item').filter({ hasText: /canary-alerts/i }).first();
        if (await notifLabel.isVisible()) await notifLabel.click();
      }

      await page.locator('button[type="submit"], button:has-text("Save")').last().click();
      await page.waitForTimeout(2000);
      console.log('Notification assigned to API health monitor');
    }
  } else {
    console.log('Monitor not found on dashboard yet — may need manual assignment');
  }

  console.log('\n=== Setup complete ===');
  console.log('Uptime Kuma is running at http://localhost:3001 (via SSH tunnel)');
  console.log('Admin user: admin');
  console.log('Discord notification: canary-alerts Discord → #canary-alerts');

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
