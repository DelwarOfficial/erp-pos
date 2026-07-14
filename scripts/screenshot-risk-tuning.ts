// scripts/screenshot-risk-tuning.ts
// Opens the risk-tuning dashboard, logs in, navigates through all 3 tabs,
// captures screenshots, and dumps the rendered text content for verification.

import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = '/home/z/my-project/download/risk-tuning-screenshots';

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezone: 'Asia/Dhaka',
  });
  const page = await context.newPage();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Risk Tuning Dashboard — Visual Verification');
  console.log('═══════════════════════════════════════════════════════════');

  // 1. Login
  console.log('\n[1/5] Logging in as admin...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[id="email"]', 'admin@erp-platform.local');
  await page.fill('[id="password"]', 'ChangeMe!2026');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  console.log('  ✓ Logged in');

  // 2. Navigate to risk-tuning page
  console.log('\n[2/5] Navigating to /dashboard/risk-tuning...');
  await page.goto(`${BASE_URL}/dashboard/risk-tuning`);
  await page.waitForSelector('text=Risk Threshold Tuning', { timeout: 10000 });
  console.log('  ✓ Page loaded');

  // 3. Screenshot Tab 1: FP/FN Report (default)
  console.log('\n[3/5] Capturing Tab 1: FP/FN Report...');
  await page.waitForSelector('text=Confusion Matrix', { timeout: 5000 });
  await page.waitForTimeout(1500); // let charts render
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-fpfn-report.png`, fullPage: true });
  console.log('  ✓ Screenshot saved: 01-fpfn-report.png');

  // Dump key text content
  const kpiText = await page.locator('text=Total Assessments').first().textContent();
  const precisionText = await page.locator('text=Precision').first().textContent();
  const recallText = await page.locator('text=Recall').first().textContent();
  console.log(`  KPI: ${kpiText}`);
  console.log(`  KPI: ${precisionText}`);
  console.log(`  KPI: ${recallText}`);

  // Get confusion matrix numbers
  const tp = await page.locator('text=True Positive').first().textContent();
  const tn = await page.locator('text=True Negative').first().textContent();
  const fp = await page.locator('text=False Positive').first().textContent();
  const fn = await page.locator('text=False Negative').first().textContent();
  console.log(`  Confusion matrix: TP=${tp}, TN=${tn}, FP=${fp}, FN=${fn}`);

  // Get recommendations
  const recAlert = page.locator('text=Tuning Recommendations').first();
  if (await recAlert.count() > 0) {
    const recText = await recAlert.locator('..').textContent();
    console.log(`  Recommendations: ${recText?.slice(0, 200)}`);
  }

  // 4. Screenshot Tab 2: Assessments
  console.log('\n[4/5] Capturing Tab 2: Assessments...');
  await page.click('[role="tab"]:has-text("Assessments")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-assessments.png`, fullPage: true });
  console.log('  ✓ Screenshot saved: 02-assessments.png');

  // Count assessment rows
  const assessmentRows = await page.locator('table tbody tr').count();
  console.log(`  Assessment rows in table: ${assessmentRows}`);

  // 5. Screenshot Tab 3: Thresholds
  console.log('\n[5/5] Capturing Tab 3: Current Thresholds...');
  await page.click('[role="tab"]:has-text("Current Thresholds")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-thresholds.png`, fullPage: true });
  console.log('  ✓ Screenshot saved: 03-thresholds.png');

  // Get the current CUSTOMER_DEBT_THRESHOLD value
  const debtThreshold = await page.locator('text=RISK_CUSTOMER_DEBT_THRESHOLD').first().textContent();
  console.log(`  Current threshold env var: ${debtThreshold}`);

  await browser.close();
  console.log('\n✓ All screenshots captured');
  console.log(`  Location: ${SCREENSHOT_DIR}/`);
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
