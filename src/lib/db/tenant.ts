import { db, systemDb } from './index';
import { getTenantContext, requireTenantContext } from './transaction';

const TENANT_MODELS = new Set([
  'account_transfers','accounting_policies','approval_requests','attendance_records','audit_logs','bank_reconciliation_lines','bank_reconciliations','branches','business_events','cash_drawer_counts','cashier_shifts','categories','chart_of_accounts','communication_campaigns','companies','company_domains','currencies','customers','delivery_orders','expenses','fixed_assets','gift_cards','inventory','invoices','journal_entries','journal_lines','leads','payments','product_serials','products','purchases','quotations','sales','sale_items','service_requests','stock_movements','suppliers','warehouses','warehouse_stocks'
]);

function isTenantModel(model: string): boolean {
  const ctx = getTenantContext();
  if (!ctx) return false;
  return TENANT_MODELS.has(model) || model.includes('company_id');
}

export const tenantDb = new Proxy(db as any, {
  get(target, prop) {
    const orig = target[prop];
    if (typeof orig !== 'object' || prop.toString().startsWith('$') || prop.toString().startsWith('_')) return orig;
    return new Proxy(orig, {
      get(modelTarget, method) {
        const fn = modelTarget[method];
        if (typeof fn !== 'function') return fn;
        return async (...args: any[]) => {
          const ctx = requireTenantContext();
          const model = prop.toString();
          if (TENANT_MODELS.has(model) || model.endsWith('s')) {
            const first = args[0] || {};
            if (['findMany','findFirst','count','aggregate','groupBy'].includes(method.toString())) {
              first.where = { ...first.where, company_id: ctx.companyId };
            }
            if (method.toString() === 'create' && first.data) {
              if (first.data.company_id && first.data.company_id !== ctx.companyId) throw new Error('TENANT_VIOLATION');
              first.data.company_id = ctx.companyId;
            }
          }
          return fn.apply(modelTarget, args);
        };
      }
    });
  }
});

export { systemDb };
