// scripts/seed-coa.ts
// Seeds the default chart of accounts + accounting policies for the existing
// platform company (created before M4). For new tenants, the onboarding API handles this.

import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth/password';
import { seedDefaultCoa } from '../src/lib/accounting/seedCoa';

async function main() {
  // Find all companies that don't have accounting policies yet
  const companies = await db.company.findMany({
    where: { accountingPolicies: { none: {} } },
  });

  if (companies.length === 0) {
    console.log('✓ All companies already have accounting policies.');
    return;
  }

  for (const company of companies) {
    console.log(`→ Seeding CoA for company "${company.code}"...`);
    const result = await db.$transaction(async (tx) => {
      return seedDefaultCoa(tx, company.id);
    });
    console.log(`  ✓ ${Object.keys(result.chartOfAccounts).length} accounts created`);
    console.log(`  ✓ Cash: ${result.financialAccountIds.cash}`);
    console.log(`  ✓ Bank: ${result.financialAccountIds.bank}`);
    console.log(`  ✓ Mobile: ${result.financialAccountIds.mobileWallet}`);
  }

  console.log('\n✓ CoA seed complete.');
}

main()
  .catch((e) => { console.error('✗', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
