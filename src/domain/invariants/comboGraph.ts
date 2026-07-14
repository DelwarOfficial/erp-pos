// src/domain/invariants/comboGraph.ts
// validate_combo_graph() per §16 — rejects cyclic combo definitions.
//
// A combo product references component products. If a component is itself a
// combo that (transitively) references the parent, we have a cycle that
// would cause infinite recursion in stock issuance + cost calculation.
//
// Algorithm: DFS with a visited stack. If we encounter a node currently on
// the stack, we have a back-edge → cycle.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

interface ComboEdge {
  comboProductId: string;
  componentProductId: string;
}

/**
 * Detect cycles in the combo graph for a given company.
 * Returns the first cycle found (as a path of product IDs), or null.
 */
export async function detectComboCycle(
  tx: Prisma.TransactionClient,
  companyId: string,
  startProductId?: string,
): Promise<string[] | null> {
  // Load all combo edges for the company (or starting from startProductId)
  const edges: ComboEdge[] = await tx.productComboItem.findMany({
    where: { companyId },
    select: { comboProductId: true, componentProductId: true },
  });

  // Build adjacency: comboProductId → [componentProductId, ...]
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.comboProductId)) adj.set(e.comboProductId, []);
    adj.get(e.comboProductId)!.push(e.componentProductId);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  let cyclePath: string[] | null = null;

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    const neighbors = adj.get(u) ?? [];
    for (const v of neighbors) {
      const vColor = color.get(v) ?? WHITE;
      if (vColor === GRAY) {
        // Back-edge → cycle. Reconstruct path.
        const path = [v, u];
        let cur: string | null = u;
        while (cur && cur !== v) {
          cur = parent.get(cur) ?? null;
          if (cur) path.push(cur);
        }
        path.reverse();
        cyclePath = path;
        return true;
      }
      if (vColor === WHITE) {
        parent.set(v, u);
        if (dfs(v)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  }

  const startNodes = startProductId ? [startProductId] : Array.from(adj.keys());
  for (const node of startNodes) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      parent.set(node, null);
      if (dfs(node)) return cyclePath;
    }
  }

  return null;
}

/**
 * Validate that adding a combo edge (parent → component) does not create
 * a cycle. Throws VALIDATION_FAILED with the cycle path if it would.
 */
export async function validateComboGraph(
  tx: Prisma.TransactionClient,
  params: { companyId: string; comboProductId: string; componentProductId: string },
): Promise<void> {
  // Self-reference
  if (params.comboProductId === params.componentProductId) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Combo product cannot reference itself as a component',
      { combo_product_id: params.comboProductId },
      400,
    );
  }

  // Check that comboProductId.product_type === 'combo'
  const combo = await tx.product.findUnique({
    where: { id: params.comboProductId },
    select: { id: true, productType: true, name: true },
  });
  if (!combo) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Combo product not found', {}, 404);
  }
  if (combo.productType !== 'combo') {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Product "${combo.name}" is not a combo product (product_type=${combo.productType})`,
      { product_id: params.comboProductId, product_type: combo.productType },
      400,
    );
  }

  // Check that component is not itself a combo (one level only — blueprint
  // says "components cannot be the same combo and recursive cycles are rejected")
  const component = await tx.product.findUnique({
    where: { id: params.componentProductId },
    select: { id: true, productType: true, name: true },
  });
  if (!component) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Component product not found', {}, 404);
  }
  if (component.productType === 'combo') {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Component "${component.name}" is itself a combo — nested combos are not allowed`,
      { component_product_id: params.componentProductId },
      400,
    );
  }

  // Check for cycles: would adding edge comboProductId → componentProductId
  // create a cycle? This is the case if there's already a path from
  // componentProductId back to comboProductId.
  // We do this by checking the existing graph (without the new edge).
  const cycle = await detectComboCycle(tx, params.companyId, params.comboProductId);
  if (cycle) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Combo graph cycle detected — would create infinite stock issuance recursion',
      { cycle_path: cycle },
      400,
    );
  }
}
