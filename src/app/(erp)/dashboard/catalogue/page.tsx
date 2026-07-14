// src/app/(erp)/dashboard/catalogue/page.tsx
// Catalogue management hub with inline editors for categories, brands, units, tax components.

'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FolderTree, Tag, Ruler, Receipt, Package } from 'lucide-react';
import { InlineCrudList } from '@/components/catalogue/InlineCrudList';

export default function CataloguePage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Catalogue Management</h1>
        <p className="text-muted-foreground">
          Manage categories, brands, units, and tax components inline. Each item supports create + (future) edit/delete.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FolderTree className="h-5 w-5" /> Categories</CardTitle>
            <CardDescription>Hierarchical product categories.</CardDescription>
          </CardHeader>
          <CardContent>
            <InlineCrudList
              endpoint="/api/v1/categories"
              label="Category"
              idempotencyPrefix="cat"
              fields={[
                { name: 'name', label: 'Name', type: 'text', placeholder: 'Electronics', required: true },
                { name: 'code', label: 'Code', type: 'text', placeholder: 'ELEC', required: true },
              ]}
              renderItem={(item) => (
                <div className="flex items-center gap-2">
                  <span className="font-medium">{String(item.name)}</span>
                  <Badge variant="outline" className="text-xs font-mono">{String(item.code)}</Badge>
                  {item.parent && <Badge variant="secondary" className="text-xs">↳ {String(item.parent.name ?? '')}</Badge>}
                </div>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Tag className="h-5 w-5" /> Brands</CardTitle>
            <CardDescription>Product brands.</CardDescription>
          </CardHeader>
          <CardContent>
            <InlineCrudList
              endpoint="/api/v1/brands"
              label="Brand"
              idempotencyPrefix="brand"
              fields={[
                { name: 'name', label: 'Brand Name', type: 'text', placeholder: 'Samsung', required: true },
              ]}
              renderItem={(item) => (
                <span className="font-medium">{String(item.name)}</span>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Ruler className="h-5 w-5" /> Units</CardTitle>
            <CardDescription>Stock/sale units with conversion factors.</CardDescription>
          </CardHeader>
          <CardContent>
            <InlineCrudList
              endpoint="/api/v1/units"
              label="Unit"
              idempotencyPrefix="unit"
              fields={[
                { name: 'name', label: 'Name', type: 'text', placeholder: 'Piece', required: true },
                { name: 'code', label: 'Code', type: 'text', placeholder: 'PCS', required: true },
                { name: 'conversion_factor', label: 'Conversion Factor', type: 'number', placeholder: '1', step: '0.000001', min: 0, required: true },
                { name: 'allow_fractional', label: 'Allow Fractional', type: 'boolean' },
              ]}
              renderItem={(item) => (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{String(item.name)}</span>
                  <Badge variant="outline" className="text-xs font-mono">{String(item.code)}</Badge>
                  {item.allow_fractional && <Badge variant="secondary" className="text-xs">fractional</Badge>}
                </div>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-5 w-5" /> Tax Components</CardTitle>
            <CardDescription>VAT / SD / RD / ATV / OTHER components.</CardDescription>
          </CardHeader>
          <CardContent>
            <InlineCrudList
              endpoint="/api/v1/tax-components"
              label="Tax Component"
              idempotencyPrefix="tax-comp"
              fields={[
                { name: 'component_code', label: 'Code', type: 'text', placeholder: 'VAT-15', required: true },
                { name: 'name', label: 'Name', type: 'text', placeholder: 'VAT 15%', required: true },
                {
                  name: 'component_type', label: 'Type', type: 'select', required: true,
                  options: [
                    { value: 'VAT', label: 'VAT' },
                    { value: 'SD', label: 'Supplementary Duty' },
                    { value: 'RD', label: 'Regulatory Duty' },
                    { value: 'ATV', label: 'Advance Trade VAT' },
                    { value: 'OTHER', label: 'Other' },
                  ],
                },
                { name: 'rate', label: 'Rate (%)', type: 'number', placeholder: '15', step: '0.000001', min: 0, required: true },
                { name: 'calculation_order', label: 'Calc Order', type: 'number', placeholder: '1', min: 1, required: true },
                { name: 'compound_on_previous', label: 'Compound on Previous', type: 'boolean' },
                { name: 'effective_from', label: 'Effective From', type: 'text', placeholder: '2026-01-01', required: true },
              ]}
              renderItem={(item) => (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{String(item.name)}</span>
                  <Badge variant="outline" className="text-xs font-mono">{String(item.component_code)}</Badge>
                  <Badge variant="secondary" className="text-xs">{String(item.component_type)}</Badge>
                  <Badge variant="outline" className="text-xs">{String(item.rate)}%</Badge>
                </div>
              )}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Products</CardTitle>
          <CardDescription>Master product list with activation workflow.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/products">
            <Button>Go to Products →</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
