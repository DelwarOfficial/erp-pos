// src/lib/accounting/seedCoa.ts
// Seeds a default Bangladesh retail chart of accounts skeleton + accounting
// policies for a new company during onboarding.

import { Prisma } from '@prisma/client';

interface CoaSpec {
  code: string;
  name: string;
  accountClass: string;
  accountSubtype: string;
  normalBalance: string;
  isControlAccount?: boolean;
  allowManualPosting?: boolean;
}

const DEFAULT_COA: CoaSpec[] = [
  // Assets
  { code: '1000', name: 'Current Assets', accountClass: 'asset', accountSubtype: 'current_asset', normalBalance: 'D', isControlAccount: true },
  { code: '1010', name: 'Cash on Hand', accountClass: 'asset', accountSubtype: 'cash', normalBalance: 'D', allowManualPosting: true },
  { code: '1020', name: 'Bank Account', accountClass: 'asset', accountSubtype: 'bank', normalBalance: 'D', allowManualPosting: true },
  { code: '1030', name: 'Mobile Wallet (bKash/Nagad)', accountClass: 'asset', accountSubtype: 'mobile_wallet', normalBalance: 'D', allowManualPosting: true },
  { code: '1100', name: 'Accounts Receivable', accountClass: 'asset', accountSubtype: 'accounts_receivable', normalBalance: 'D', isControlAccount: true },
  { code: '1200', name: 'Inventory', accountClass: 'asset', accountSubtype: 'inventory', normalBalance: 'D', isControlAccount: true },
  { code: '1210', name: 'Inventory - Retail', accountClass: 'asset', accountSubtype: 'inventory', normalBalance: 'D' },
  { code: '1220', name: 'Inventory - Damaged', accountClass: 'asset', accountSubtype: 'inventory_damaged', normalBalance: 'D' },
  { code: '1300', name: 'Supplier Advances', accountClass: 'asset', accountSubtype: 'supplier_advance', normalBalance: 'D', isControlAccount: true },
  { code: '1400', name: 'Courier COD Receivable', accountClass: 'asset', accountSubtype: 'cod_receivable', normalBalance: 'D', isControlAccount: true },
  { code: '1500', name: 'Repair WIP', accountClass: 'asset', accountSubtype: 'repair_wip', normalBalance: 'D' },
  { code: '1600', name: 'Cheque Clearing', accountClass: 'asset', accountSubtype: 'cheque_clearing', normalBalance: 'D' },
  { code: '1700', name: 'Goods Received Not Invoiced (GRNI)', accountClass: 'asset', accountSubtype: 'grni', normalBalance: 'C', isControlAccount: true },
  // AM-BR — Fixed assets
  { code: '1800', name: 'Fixed Assets', accountClass: 'asset', accountSubtype: 'fixed_asset', normalBalance: 'D', isControlAccount: true },
  { code: '1810', name: 'Office Equipment', accountClass: 'asset', accountSubtype: 'fixed_asset', normalBalance: 'D', allowManualPosting: true },
  { code: '1820', name: 'Vehicles', accountClass: 'asset', accountSubtype: 'fixed_asset', normalBalance: 'D', allowManualPosting: true },
  { code: '1830', name: 'Furniture & Fixtures', accountClass: 'asset', accountSubtype: 'fixed_asset', normalBalance: 'D', allowManualPosting: true },
  { code: '1840', name: 'Computers & Software', accountClass: 'asset', accountSubtype: 'fixed_asset', normalBalance: 'D', allowManualPosting: true },
  { code: '1850', name: 'Accumulated Depreciation', accountClass: 'asset', accountSubtype: 'accumulated_depreciation', normalBalance: 'C' },
  { code: '1860', name: 'Depreciation Expense', accountClass: 'expense', accountSubtype: 'depreciation', normalBalance: 'D' },
  { code: '1870', name: 'Gain/Loss on Asset Disposal', accountClass: 'revenue', accountSubtype: 'asset_disposal', normalBalance: 'C' },
  // Liabilities
  { code: '2000', name: 'Current Liabilities', accountClass: 'liability', accountSubtype: 'current_liability', normalBalance: 'C', isControlAccount: true },
  { code: '2010', name: 'Accounts Payable', accountClass: 'liability', accountSubtype: 'accounts_payable', normalBalance: 'C', isControlAccount: true },
  { code: '2020', name: 'Customer Advances', accountClass: 'liability', accountSubtype: 'customer_advance', normalBalance: 'C', isControlAccount: true },
  { code: '2100', name: 'VAT Payable', accountClass: 'liability', accountSubtype: 'tax_payable', normalBalance: 'C' },
  { code: '2110', name: 'Supplementary Duty Payable', accountClass: 'liability', accountSubtype: 'tax_payable', normalBalance: 'C' },
  { code: '2200', name: 'Gift Card Liability', accountClass: 'liability', accountSubtype: 'gift_card_liability', normalBalance: 'C', isControlAccount: true },
  { code: '2300', name: 'Branch Clearing', accountClass: 'liability', accountSubtype: 'branch_clearing', normalBalance: 'C' },
  // Equity
  { code: '3000', name: 'Equity', accountClass: 'equity', accountSubtype: 'equity', normalBalance: 'C', isControlAccount: true },
  { code: '3100', name: 'Opening Balance Equity', accountClass: 'equity', accountSubtype: 'opening_balance', normalBalance: 'C', allowManualPosting: true },
  { code: '3200', name: 'Retained Earnings', accountClass: 'equity', accountSubtype: 'retained_earnings', normalBalance: 'C' },
  // Revenue
  { code: '4000', name: 'Operating Revenue', accountClass: 'revenue', accountSubtype: 'operating_revenue', normalBalance: 'C', isControlAccount: true },
  { code: '4010', name: 'Sales Revenue', accountClass: 'revenue', accountSubtype: 'sales_revenue', normalBalance: 'C' },
  { code: '4020', name: 'Service Revenue', accountClass: 'revenue', accountSubtype: 'service_revenue', normalBalance: 'C' },
  { code: '4100', name: 'Purchase Price Variance', accountClass: 'revenue', accountSubtype: 'purchase_variance', normalBalance: 'C' },
  { code: '4200', name: 'Exchange Gain/Loss', accountClass: 'revenue', accountSubtype: 'exchange_gain_loss', normalBalance: 'C' },
  { code: '4300', name: 'Rounding', accountClass: 'revenue', accountSubtype: 'rounding', normalBalance: 'C' },
  // Expenses
  { code: '5000', name: 'Cost of Goods Sold', accountClass: 'expense', accountSubtype: 'cogs', normalBalance: 'D', isControlAccount: true },
  { code: '5010', name: 'COGS - Products', accountClass: 'expense', accountSubtype: 'cogs', normalBalance: 'D' },
  { code: '5020', name: 'COGS - Service Parts', accountClass: 'expense', accountSubtype: 'service_cogs', normalBalance: 'D' },
  { code: '5100', name: 'Inventory Damage', accountClass: 'expense', accountSubtype: 'inventory_damage', normalBalance: 'D' },
  { code: '5110', name: 'Inventory Write-off', accountClass: 'expense', accountSubtype: 'inventory_writeoff', normalBalance: 'D' },
  { code: '5120', name: 'Impairment Allowance', accountClass: 'expense', accountSubtype: 'impairment', normalBalance: 'D' },
  { code: '5200', name: 'Warranty Expense', accountClass: 'expense', accountSubtype: 'warranty_expense', normalBalance: 'D' },
  { code: '5300', name: 'Courier Fee Expense', accountClass: 'expense', accountSubtype: 'courier_fee', normalBalance: 'D' },
  { code: '5310', name: 'Failed Delivery Fee', accountClass: 'expense', accountSubtype: 'failed_delivery', normalBalance: 'D' },
  { code: '5400', name: 'Gateway Fee Expense', accountClass: 'expense', accountSubtype: 'gateway_fee', normalBalance: 'D' },
  { code: '5500', name: 'Cheque Bounce Fee', accountClass: 'expense', accountSubtype: 'cheque_bounce', normalBalance: 'D' },
  { code: '6000', name: 'Salaries & Wages', accountClass: 'expense', accountSubtype: 'payroll', normalBalance: 'D' },
  { code: '6100', name: 'Rent Expense', accountClass: 'expense', accountSubtype: 'rent', normalBalance: 'D' },
  { code: '6200', name: 'Utilities', accountClass: 'expense', accountSubtype: 'utilities', normalBalance: 'D' },
  { code: '6900', name: 'Miscellaneous Expense', accountClass: 'expense', accountSubtype: 'miscellaneous', normalBalance: 'D', allowManualPosting: true },
  { code: '7000', name: 'Operating Expenses (Control)', accountClass: 'expense', accountSubtype: 'operating_control', normalBalance: 'D', isControlAccount: true },
];

export async function seedDefaultCoa(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<{
  chartOfAccounts: Record<string, string>;
  financialAccountIds: { cash: string; bank: string; mobileWallet: string };
}> {
  const coaMap = new Map<string, string>();

  for (const spec of DEFAULT_COA) {
    const account = await tx.chartOfAccount.create({
      data: {
        companyId,
        code: spec.code,
        name: spec.name,
        accountClass: spec.accountClass,
        accountSubtype: spec.accountSubtype,
        normalBalance: spec.normalBalance,
        isControlAccount: spec.isControlAccount ?? false,
        allowManualPosting: spec.allowManualPosting ?? false,
        isActive: true,
      },
    });
    coaMap.set(spec.code, account.id);
  }

  const cashFa = await tx.financialAccount.create({
    data: { companyId, chartOfAccountId: coaMap.get('1010')!, name: 'Main Cash Drawer', accountType: 'cash', currencyCode: 'BDT' },
  });
  const bankFa = await tx.financialAccount.create({
    data: { companyId, chartOfAccountId: coaMap.get('1020')!, name: 'Primary Bank Account', accountType: 'bank', currencyCode: 'BDT' },
  });
  const mobileFa = await tx.financialAccount.create({
    data: { companyId, chartOfAccountId: coaMap.get('1030')!, name: 'bKash/Nagad Wallet', accountType: 'mobile_wallet', currencyCode: 'BDT' },
  });

  await tx.accountingPolicy.create({
    data: {
      companyId,
      inventoryAccountId: coaMap.get('1210')!,
      cogsAccountId: coaMap.get('5010')!,
      salesRevenueAccountId: coaMap.get('4010')!,
      arAccountId: coaMap.get('1100')!,
      apAccountId: coaMap.get('2010')!,
      customerAdvanceAccountId: coaMap.get('2020')!,
      supplierAdvanceAccountId: coaMap.get('1300')!,
      purchaseVarianceAccountId: coaMap.get('4100')!,
      giftCardLiabilityAccountId: coaMap.get('2200')!,
      branchClearingAccountId: coaMap.get('2300')!,
      inventoryDamageAccountId: coaMap.get('5100')!,
      inventoryWriteOffAccountId: coaMap.get('5110')!,
      exchangeGainLossAccountId: coaMap.get('4200')!,
      courierClearingAccountId: coaMap.get('1400')!,
      serviceCogsAccountId: coaMap.get('5020')!,
      repairWipAccountId: coaMap.get('1500')!,
      chequeClearingAccountId: coaMap.get('1600')!,
      roundingAccountId: coaMap.get('4300')!,
      grniAccountId: coaMap.get('1700')!,
      openingBalanceEquityAccountId: coaMap.get('3100')!,
      impairmentAllowanceAccountId: coaMap.get('5120')!,
      chequeBounceFeeAccountId: coaMap.get('5500')!,
    },
  });

  return {
    chartOfAccounts: Object.fromEntries(coaMap),
    financialAccountIds: { cash: cashFa.id, bank: bankFa.id, mobileWallet: mobileFa.id },
  };
}
