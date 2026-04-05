/**
 * Smart Form audit script — explores actual form state for an MLB pick submission.
 * Run: npx tsx scripts/smart-form-audit.ts
 * Requires: Smart Form running on localhost:4100, API on localhost:4000
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await browser.newPage();
  const issues: string[] = [];

  console.log('\n=== Smart Form Audit: MLB pick with capper Griff843 ===\n');

  await page.goto('http://localhost:4100/submit');
  await page.waitForLoadState('networkidle');

  // Step 1: Select capper
  console.log('1. Checking capper dropdown...');
  const capperSelect = page.locator('select[name="capper"], [data-testid="capper"], input[placeholder*="capper" i], [aria-label*="capper" i]').first();
  const capperExists = await capperSelect.count() > 0;
  if (capperExists) {
    console.log('   ✓ Capper field found');
  } else {
    // Try to find capper by label
    const capperLabel = page.getByText(/capper/i).first();
    const labelExists = await capperLabel.count() > 0;
    console.log(`   ${labelExists ? '✓ Capper label found' : '⚠ Capper field not found'}`);
  }

  // Take screenshot of initial state
  await page.screenshot({ path: '/tmp/smartform-initial.png' });
  console.log('   Screenshot: /tmp/smartform-initial.png');

  // Step 2: Select sport = MLB
  console.log('\n2. Selecting MLB sport...');
  const mlbButton = page.getByRole('button', { name: /MLB/i }).or(page.getByText('MLB')).first();
  const mlbExists = await mlbButton.count() > 0;
  if (mlbExists) {
    await mlbButton.click();
    console.log('   ✓ MLB selected');
  } else {
    issues.push('MLB button not found');
    console.log('   ⚠ MLB button not found');
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/smartform-mlb.png' });
  console.log('   Screenshot: /tmp/smartform-mlb.png');

  // Step 3: Check available market families
  console.log('\n3. Checking market families after selecting MLB...');
  const marketButtons = await page.locator('[data-testid*="market"], button').filter({ hasText: /moneyline|spread|total|prop|run.?line|futures|teaser|parlay|player/i }).all();
  const marketNames = await Promise.all(marketButtons.map(b => b.textContent()));
  console.log('   Found markets:', marketNames.filter(Boolean));
  if (!marketNames.some(n => /run.?line/i.test(n ?? ''))) {
    issues.push('MLB "Run Line" not labeled — shows as "Spread"');
    console.log('   ⚠ No "Run Line" label — MLB spread shows as generic "Spread"');
  }
  if (!marketNames.some(n => /prop/i.test(n ?? ''))) {
    issues.push('Player Props market family missing from MLB');
    console.log('   ⚠ No "Player Props" market family visible');
  }

  // Step 4: Select Player Prop market type
  console.log('\n4. Selecting Player Prop...');
  const propButton = page.getByRole('button', { name: /prop|player/i }).first();
  if (await propButton.count() > 0) {
    await propButton.click();
    console.log('   ✓ Player Prop clicked');
  } else {
    issues.push('Player Prop market type button not clickable');
    console.log('   ⚠ Player Prop button not found');
  }

  await page.waitForTimeout(500);

  // Step 5: Check stat type dropdown
  console.log('\n5. Checking stat types for MLB player props...');
  const statSelect = page.locator('select, [role="combobox"]').filter({ hasText: /stat|select stat/i }).first();
  if (await statSelect.count() > 0) {
    const options = await page.locator('option').allTextContents();
    console.log('   Stat options:', options.slice(0, 15));
    if (options.length < 5) {
      issues.push(`Very few MLB stat types: only ${options.length} options`);
    }
  } else {
    // Try clicking a combobox
    const triggerBtn = page.getByRole('combobox').first();
    if (await triggerBtn.count() > 0) {
      await triggerBtn.click();
      await page.waitForTimeout(500);
      const items = await page.locator('[role="option"]').allTextContents();
      console.log('   Stat options (dropdown):', items.slice(0, 15));
    } else {
      issues.push('Stat type selector not found');
      console.log('   ⚠ Stat type selector not found');
    }
  }

  // Step 6: Check player name field
  console.log('\n6. Checking player name field...');
  const playerInput = page.locator('input[name*="player" i], input[placeholder*="player" i], input[placeholder*="name" i]').first();
  if (await playerInput.count() > 0) {
    await playerInput.fill('Aaron');
    await page.waitForTimeout(1500);
    const suggestions = await page.locator('[role="option"], [data-testid*="suggestion"], li').all();
    const suggestionTexts = await Promise.all(suggestions.map(s => s.textContent()));
    const playerSuggestions = suggestionTexts.filter(t => t && /aaron/i.test(t));
    if (playerSuggestions.length > 0) {
      console.log('   ✓ Player autocomplete working:', playerSuggestions.slice(0, 3));
    } else {
      issues.push('Player name autocomplete not returning results');
      console.log('   ⚠ Player autocomplete not working — no suggestions for "Aaron"');
    }
  } else {
    issues.push('Player name input field not found');
    console.log('   ⚠ Player name input not found');
  }

  await page.screenshot({ path: '/tmp/smartform-player.png' });
  console.log('   Screenshot: /tmp/smartform-player.png');

  // Step 7: Check all sport buttons available
  console.log('\n7. Checking all sport options...');
  await page.goto('http://localhost:4100/submit');
  await page.waitForLoadState('networkidle');
  const sportButtons = await page.locator('button').filter({ hasText: /NBA|NFL|MLB|NHL|Golf|Soccer|Tennis|NCAAB|NCAAF|MMA/i }).all();
  const sportNames = await Promise.all(sportButtons.map(b => b.textContent()));
  console.log('   Sports shown:', sportNames.filter(Boolean));
  if (!sportNames.some(n => /golf/i.test(n ?? ''))) {
    issues.push('Golf not available as a sport');
    console.log('   ⚠ Golf not showing as a sport option');
  }

  await page.screenshot({ path: '/tmp/smartform-sports.png' });
  console.log('   Screenshot: /tmp/smartform-sports.png');

  // Summary
  console.log('\n=== Issues Found ===');
  if (issues.length === 0) {
    console.log('No issues found.');
  } else {
    for (const issue of issues) {
      console.log(`  ⚠ ${issue}`);
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
