// src/domain/commands/m4/AssetManagement.ts
// Fixed Asset Management domain commands per AM-BR.
// Posts journal entries through postJournalEntry() to keep the GL in sync.
//
// Commands:
//   postAssetAcquisition — capitalise a fixed asset + Dr Fixed Asset / Cr Cash
//   postDepreciation     — calculate per-period depreciation + Dr Dep Exp / Cr Accum Dep
//   postAssetDisposal    — dispose asset, derecognise cost + accum dep, recognise gain/loss

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { postJournalEntry, JournalLineInput } from './PostJournalEntry';

// ──────────────────────────────────────────────────────────────────────
// postAssetAcquisition
// ──────────────────────────────────────────────────────────────────────

export interface PostAssetAcquisitionInput {
  companyId: string;
  branchId?: string;
  assetCode: string;
  name: string;
  description?: string;
  categoryId?: string;
  location?: string;
  serialNumber?: string;
  purchaseDate: Date;
  purchaseCost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  depreciationMethod?: string; // straight_line / declining_balance / units_of_production
  depreciationRate?: number;   // % per year for declining_balance
  assetAccountId: string;      // Dr Fixed Asset
  accumDepAccountId: string;
  depExpenseAccountId: string;
  gainLossAccountId?: string;
  financialAccountId: string;  // Cr Cash/Bank
  currencyCode?: string;
  exchangeRate?: number;
  createdBy: string;
}

export interface PostAssetAcquisitionResult {
  fixedAssetId: string;
  assetCode: string;
  netBookValue: string;
  journalEntryNo: string;
}

export async function postAssetAcquisition(
  tx: Prisma.TransactionClient,
  input: PostAssetAcquisitionInput,
  correlationId: string,
): Promise<PostAssetAcquisitionResult> {
  if (input.purchaseCost <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Purchase cost must be > 0', {}, 400);
  }
  if (input.usefulLifeMonths <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Useful life months must be > 0', {}, 400);
  }

  // Validate uniqueness of asset_code within company
  const existing = await tx.fixedAsset.findFirst({
    where: { companyId: input.companyId, assetCode: input.assetCode },
  });
  if (existing) {
    throw new DomainError('VALIDATION_FAILED', `Asset code "${input.assetCode}" already exists`, {}, 409);
  }

  // Validate GL accounts belong to this company
  for (const accId of [input.assetAccountId, input.accumDepAccountId, input.depExpenseAccountId]) {
    const coa = await tx.chartOfAccount.findFirst({
      where: { id: accId, companyId: input.companyId, isActive: true },
    });
    if (!coa) throw new DomainError('VALIDATION_FAILED', `Chart of account ${accId} not found`, {}, 400);
  }

  // Validate payment (financial) account
  const fa = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId, isActive: true },
    include: { chartOfAccount: true },
  });
  if (!fa) {
    throw new DomainError('VALIDATION_FAILED', 'Financial account not found or inactive', {}, 404);
  }

  // Validate optional category if provided
  if (input.categoryId) {
    const cat = await tx.fixedAssetCategory.findFirst({
      where: { id: input.categoryId, companyId: input.companyId },
    });
    if (!cat) {
      throw new DomainError('VALIDATION_FAILED', 'Fixed asset category not found', {}, 404);
    }
  }

  const currencyCode = input.currencyCode ?? 'BDT';
  const exchangeRate = input.exchangeRate ?? 1.0;
  const salvageValue = input.salvageValue ?? 0;
  const baseCost = input.purchaseCost * exchangeRate;

  // Create the fixed asset record (net_book_value starts at purchase_cost)
  const asset = await tx.fixedAsset.create({
    data: {
      companyId: input.companyId,
      assetCode: input.assetCode,
      name: input.name,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      branchId: input.branchId ?? null,
      location: input.location ?? null,
      serialNumber: input.serialNumber ?? null,
      purchaseDate: input.purchaseDate,
      purchaseCost: baseCost,
      salvageValue: salvageValue * exchangeRate,
      usefulLifeMonths: input.usefulLifeMonths,
      depreciationMethod: input.depreciationMethod ?? 'straight_line',
      depreciationRate: input.depreciationRate ?? 0,
      accumulatedDepreciation: 0,
      netBookValue: baseCost,
      status: 'active',
      assetAccountId: input.assetAccountId,
      accumDepAccountId: input.accumDepAccountId,
      depExpenseAccountId: input.depExpenseAccountId,
      gainLossAccountId: input.gainLossAccountId ?? null,
      createdBy: input.createdBy,
    },
  });

  // Post acquisition journal entry: Dr Fixed Asset, Cr Cash/Bank
  const lines: JournalLineInput[] = [
    {
      chartOfAccountId: input.assetAccountId,
      branchId: input.branchId,
      financialAccountId: undefined,
      debit: baseCost,
      credit: 0,
      memo: `Acquisition of asset ${input.assetCode} — ${input.name}`,
    },
    {
      chartOfAccountId: fa.chartOfAccountId,
      branchId: input.branchId,
      financialAccountId: fa.id,
      debit: 0,
      credit: baseCost,
      memo: `Payment for asset ${input.assetCode}`,
    },
  ];

  const eventId = randomUUID();
  const je = await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.purchaseDate,
    postingKind: 'asset_acquisition',
    sourceType: 'fixed_asset',
    sourceId: asset.id,
    description: `Asset acquisition: ${input.assetCode} — ${input.name}`,
    currencyCode,
    exchangeRate,
    createdBy: input.createdBy,
    lines,
  }, correlationId);

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.createdBy,
      correlationId,
      action: 'fixed_asset.acquire',
      entityType: 'fixed_asset',
      entityId: asset.id,
      afterValue: JSON.stringify({
        asset_code: input.assetCode,
        name: input.name,
        purchase_cost: baseCost,
        je_no: je.entryNo,
      }),
    },
  });

  return {
    fixedAssetId: asset.id,
    assetCode: input.assetCode,
    netBookValue: baseCost.toFixed(2),
    journalEntryNo: je.entryNo,
  };
}

// ──────────────────────────────────────────────────────────────────────
// postDepreciation
// ──────────────────────────────────────────────────────────────────────

export interface PostDepreciationInput {
  companyId: string;
  fixedAssetId: string;
  periodStart: Date;
  periodEnd: Date;
  createdBy: string;
  currencyCode?: string;
  exchangeRate?: number;
}

export interface PostDepreciationResult {
  depreciationId: string;
  depreciationAmount: string;
  accumulatedAfter: string;
  netBookValueAfter: string;
  journalEntryNo: string;
}

export async function postDepreciation(
  tx: Prisma.TransactionClient,
  input: PostDepreciationInput,
  correlationId: string,
): Promise<PostDepreciationResult> {
  const asset = await tx.fixedAsset.findFirst({
    where: { id: input.fixedAssetId, companyId: input.companyId },
  });
  if (!asset) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Fixed asset not found', {}, 404);
  }
  if (asset.status === 'disposed') {
    throw new DomainError('VALIDATION_FAILED', 'Cannot depreciate a disposed asset', {}, 409);
  }
  if (asset.status === 'fully_depreciated') {
    throw new DomainError('VALIDATION_FAILED', 'Asset is already fully depreciated', {}, 409);
  }

  const currencyCode = input.currencyCode ?? 'BDT';
  const exchangeRate = input.exchangeRate ?? 1.0;

  // Compute depreciation amount for this period
  const purchaseCost = parseFloat(asset.purchaseCost.toString());
  const salvageValue = parseFloat(asset.salvageValue.toString());
  const currentAccum = parseFloat(asset.accumulatedDepreciation.toString());
  const currentNbv = parseFloat(asset.netBookValue.toString());
  const depreciableBase = Math.max(0, purchaseCost - salvageValue);

  let depreciationAmount: number;
  const method = asset.depreciationMethod;

  if (method === 'straight_line') {
    // Monthly depreciation = (cost - salvage) / useful_life_months
    const monthlyDep = depreciableBase / asset.usefulLifeMonths;
    // Period length in months (approximate by days / 30)
    const msInPeriod = input.periodEnd.getTime() - input.periodStart.getTime();
    const months = Math.max(1, Math.round(msInPeriod / (1000 * 60 * 60 * 24 * 30)));
    depreciationAmount = monthlyDep * months;
  } else if (method === 'declining_balance') {
    // depreciation_rate is % per year
    const ratePerYear = parseFloat((asset.depreciationRate ?? 0).toString()) / 100;
    const msInPeriod = input.periodEnd.getTime() - input.periodStart.getTime();
    const years = msInPeriod / (1000 * 60 * 60 * 24 * 365);
    depreciationAmount = currentNbv * ratePerYear * years;
  } else {
    // units_of_production — fall back to straight-line pro-rata (no usage tracking)
    const monthlyDep = depreciableBase / asset.usefulLifeMonths;
    const msInPeriod = input.periodEnd.getTime() - input.periodStart.getTime();
    const months = Math.max(1, Math.round(msInPeriod / (1000 * 60 * 60 * 24 * 30)));
    depreciationAmount = monthlyDep * months;
  }

  // Cap so we never depreciate below salvage value
  const remainingDepreciable = Math.max(0, depreciableBase - currentAccum);
  depreciationAmount = Math.min(depreciationAmount, remainingDepreciable);

  if (depreciationAmount <= 0) {
    // Mark fully depreciated if at salvage
    if (currentNbv <= salvageValue + 0.01) {
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { status: 'fully_depreciated', updatedAt: new Date() },
      });
    }
    throw new DomainError('VALIDATION_FAILED', 'Depreciation amount is zero — asset is fully depreciated', { current_nbv: currentNbv, salvage: salvageValue }, 409);
  }

  // Post journal: Dr Depreciation Expense, Cr Accumulated Depreciation
  const lines: JournalLineInput[] = [
    {
      chartOfAccountId: asset.depExpenseAccountId,
      branchId: asset.branchId ?? undefined,
      debit: depreciationAmount,
      credit: 0,
      memo: `Depreciation for ${asset.assetCode} — ${asset.name}`,
    },
    {
      chartOfAccountId: asset.accumDepAccountId,
      branchId: asset.branchId ?? undefined,
      debit: 0,
      credit: depreciationAmount,
      memo: `Accumulated depreciation for ${asset.assetCode}`,
    },
  ];

  const eventId = randomUUID();
  const je = await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.periodEnd,
    postingKind: 'asset_depreciation',
    sourceType: 'fixed_asset',
    sourceId: asset.id,
    description: `Depreciation: ${asset.assetCode} — ${asset.name} (${input.periodStart.toISOString().slice(0, 10)} → ${input.periodEnd.toISOString().slice(0, 10)})`,
    currencyCode,
    exchangeRate,
    createdBy: input.createdBy,
    lines,
  }, correlationId);

  const newAccum = currentAccum + depreciationAmount;
  const newNbv = purchaseCost - newAccum;

  // Record the depreciation run
  const depRun = await tx.fixedAssetDepreciation.create({
    data: {
      companyId: input.companyId,
      fixedAssetId: asset.id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      depreciationAmount,
      accumulatedAfter: newAccum,
      netBookValueAfter: newNbv,
      journalEntryId: je.journalEntryId,
      eventId,
      postedBy: input.createdBy,
    },
  });

  // Update the asset's accum + NBV. Mark fully_depreciated if NBV hits salvage.
  const newStatus = newNbv <= salvageValue + 0.01 ? 'fully_depreciated' : asset.status;
  await tx.fixedAsset.update({
    where: { id: asset.id },
    data: {
      accumulatedDepreciation: newAccum,
      netBookValue: newNbv,
      status: newStatus,
      updatedAt: new Date(),
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.createdBy,
      correlationId,
      action: 'fixed_asset.depreciate',
      entityType: 'fixed_asset',
      entityId: asset.id,
      afterValue: JSON.stringify({
        depreciation_amount: depreciationAmount,
        accumulated_after: newAccum,
        nbv_after: newNbv,
        je_no: je.entryNo,
      }),
    },
  });

  return {
    depreciationId: depRun.id,
    depreciationAmount: depreciationAmount.toFixed(2),
    accumulatedAfter: newAccum.toFixed(2),
    netBookValueAfter: newNbv.toFixed(2),
    journalEntryNo: je.entryNo,
  };
}

// ──────────────────────────────────────────────────────────────────────
// postAssetDisposal
// ──────────────────────────────────────────────────────────────────────

export interface PostAssetDisposalInput {
  companyId: string;
  fixedAssetId: string;
  disposedAt: Date;
  disposalAmount: number;        // sale proceeds (0 if scrapped/donated)
  disposalMethod: string;        // sold / scrapped / donated
  financialAccountId?: string;   // Cr Cash/Bank if sale proceeds > 0
  currencyCode?: string;
  exchangeRate?: number;
  disposedBy: string;
}

export interface PostAssetDisposalResult {
  fixedAssetId: string;
  status: string;
  disposalAmount: string;
  gainOrLoss: string;            // positive = gain, negative = loss
  journalEntryNo: string;
}

export async function postAssetDisposal(
  tx: Prisma.TransactionClient,
  input: PostAssetDisposalInput,
  correlationId: string,
): Promise<PostAssetDisposalResult> {
  const asset = await tx.fixedAsset.findFirst({
    where: { id: input.fixedAssetId, companyId: input.companyId },
  });
  if (!asset) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Fixed asset not found', {}, 404);
  }
  if (asset.status === 'disposed') {
    throw new DomainError('VALIDATION_FAILED', 'Asset is already disposed', {}, 409);
  }

  const currencyCode = input.currencyCode ?? 'BDT';
  const exchangeRate = input.exchangeRate ?? 1.0;

  const purchaseCost = parseFloat(asset.purchaseCost.toString());
  const accumDep = parseFloat(asset.accumulatedDepreciation.toString());
  const nbvAtDisposal = purchaseCost - accumDep;
  const disposalAmount = input.disposalAmount * exchangeRate;

  // Gain/Loss = disposal proceeds − NBV at disposal
  //   > 0 → gain (credit gain/loss account)
  //   < 0 → loss (debit gain/loss account)
  const gainOrLoss = disposalAmount - nbvAtDisposal;

  // Validate financial account if there's a cash receipt
  let faChartOfAccountId: string | undefined;
  let faId: string | undefined;
  if (disposalAmount > 0) {
    if (!input.financialAccountId) {
      throw new DomainError('VALIDATION_FAILED', 'financial_account_id is required when disposal_amount > 0', {}, 400);
    }
    const fa = await tx.financialAccount.findFirst({
      where: { id: input.financialAccountId, companyId: input.companyId, isActive: true },
      include: { chartOfAccount: true },
    });
    if (!fa) {
      throw new DomainError('VALIDATION_FAILED', 'Financial account not found or inactive', {}, 404);
    }
    faChartOfAccountId = fa.chartOfAccountId;
    faId = fa.id;
  }

  // Validate gain/loss account if there is a gain or loss
  let gainLossAccountId: string | undefined = asset.gainLossAccountId ?? undefined;
  if (Math.abs(gainOrLoss) > 0.01 && !gainLossAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'Asset has no gain_loss_account_id and disposal produces a gain/loss', { gain_or_loss: gainOrLoss }, 400);
  }

  // Build journal lines:
  //   Dr Cash/Bank (sale proceeds)             [if disposalAmount > 0]
  //   Dr Accumulated Depreciation (accumDep)
  //   Dr Gain/Loss on Disposal (if loss)       [if gainOrLoss < 0]
  //   Cr Fixed Asset (cost at original value)
  //   Cr Gain/Loss on Disposal (if gain)       [if gainOrLoss > 0]
  const lines: JournalLineInput[] = [];

  if (disposalAmount > 0 && faChartOfAccountId && faId) {
    lines.push({
      chartOfAccountId: faChartOfAccountId,
      branchId: asset.branchId ?? undefined,
      financialAccountId: faId,
      debit: disposalAmount,
      credit: 0,
      memo: `Disposal proceeds for ${asset.assetCode}`,
    });
  }

  if (accumDep > 0) {
    lines.push({
      chartOfAccountId: asset.accumDepAccountId,
      branchId: asset.branchId ?? undefined,
      debit: accumDep,
      credit: 0,
      memo: `Remove accumulated depreciation on disposal of ${asset.assetCode}`,
    });
  }

  if (gainOrLoss < 0 && gainLossAccountId) {
    // Loss — debit gain/loss account
    lines.push({
      chartOfAccountId: gainLossAccountId,
      branchId: asset.branchId ?? undefined,
      debit: Math.abs(gainOrLoss),
      credit: 0,
      memo: `Loss on disposal of ${asset.assetCode}`,
    });
  }

  // Cr Fixed Asset (original cost)
  lines.push({
    chartOfAccountId: asset.assetAccountId,
    branchId: asset.branchId ?? undefined,
    debit: 0,
    credit: purchaseCost,
    memo: `Derecognise fixed asset ${asset.assetCode} on disposal`,
  });

  if (gainOrLoss > 0 && gainLossAccountId) {
    // Gain — credit gain/loss account
    lines.push({
      chartOfAccountId: gainLossAccountId,
      branchId: asset.branchId ?? undefined,
      debit: 0,
      credit: gainOrLoss,
      memo: `Gain on disposal of ${asset.assetCode}`,
    });
  }

  const eventId = randomUUID();
  const je = await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.disposedAt,
    postingKind: 'asset_disposal',
    sourceType: 'fixed_asset',
    sourceId: asset.id,
    description: `Asset disposal: ${asset.assetCode} — ${asset.name} (${input.disposalMethod})`,
    currencyCode,
    exchangeRate,
    createdBy: input.disposedBy,
    lines,
  }, correlationId);

  // Mark asset disposed
  await tx.fixedAsset.update({
    where: { id: asset.id },
    data: {
      status: 'disposed',
      disposedAt: input.disposedAt,
      disposalAmount,
      disposalMethod: input.disposalMethod,
      netBookValue: 0,
      updatedAt: new Date(),
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.disposedBy,
      correlationId,
      action: 'fixed_asset.dispose',
      entityType: 'fixed_asset',
      entityId: asset.id,
      beforeValue: JSON.stringify({ nbv_at_disposal: nbvAtDisposal, accum_dep: accumDep }),
      afterValue: JSON.stringify({
        disposal_amount: disposalAmount,
        disposal_method: input.disposalMethod,
        gain_or_loss: gainOrLoss,
        je_no: je.entryNo,
      }),
    },
  });

  return {
    fixedAssetId: asset.id,
    status: 'disposed',
    disposalAmount: disposalAmount.toFixed(2),
    gainOrLoss: gainOrLoss.toFixed(2),
    journalEntryNo: je.entryNo,
  };
}
