// scripts/seed-m1.ts
// Seed M1 defaults for the existing platform company (which was created
// before M1 was built). For new tenants, the onboarding API handles this.

import { db } from '../src/lib/db';
import { seedFeatureFlagsForCompany } from '../src/lib/featureFlags';
import { seedLocalizationForCompany } from '../src/lib/i18n';
import { seedPermissions } from '../src/lib/permissions/catalogue';

async function main() {
  console.log('→ Re-seeding permissions (idempotent)...');
  await seedPermissions();

  const platform = await db.company.findUnique({ where: { code: 'PLATFORM' } });
  if (!platform) {
    console.error('✗ PLATFORM company not found. Run `bun run scripts/seed.ts` first.');
    process.exit(1);
  }
  const admin = await db.user.findFirst({
    where: { companyId: platform.id, email: 'admin@erp-platform.local' },
  });
  if (!admin) {
    console.error('✗ Platform admin not found.');
    process.exit(1);
  }

  console.log('→ Seeding feature flags for PLATFORM company...');
  await seedFeatureFlagsForCompany(platform.id, admin.id);

  console.log('→ Seeding localization for PLATFORM company...');
  await seedLocalizationForCompany(platform.id, 'bn-BD');

  // Also seed for any other existing companies
  const others = await db.company.findMany({ where: { code: { not: 'PLATFORM' } } });
  for (const c of others) {
    console.log(`→ Seeding M1 for company "${c.code}"...`);
    const owner = await db.user.findFirst({
      where: { companyId: c.id, accessScope: 'global' },
      orderBy: { createdAt: 'asc' },
    });
    if (owner) {
      await seedFeatureFlagsForCompany(c.id, owner.id);
      await seedLocalizationForCompany(c.id, c.defaultLocale === 'en-BD' ? 'en-BD' : 'bn-BD');
    }
  }

  console.log('\n✓ M1 seed complete.');
}

main()
  .catch((e) => { console.error('✗', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
