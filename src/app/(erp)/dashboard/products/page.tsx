// src/app/(erp)/dashboard/products/page.tsx
// Product list with search + filter. Cursor pagination.

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ProductListItem {
  id: string;
  name: string;
  code: string;
  product_type: string;
  is_serialized: boolean;
  is_active: boolean;
  is_featured: boolean;
  reference_cost: string;
  default_price: string;
  category: { id: string; name: string; code: string };
  brand: { id: string; name: string } | null;
  unit: { id: string; name: string; code: string };
}

export default function ProductsPage() {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [search, setSearch] = useState('');
  const [productType, setProductType] = useState<string>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (reset: boolean = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (productType !== 'all') params.set('product_type', productType);
      params.set('is_active', 'true');
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '20');
      const res = await fetch(`/api/v1/products?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load');
      setItems(prev => reset ? data.items : [...prev, ...data.items]);
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [search, productType, cursor]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true);
  }, [search, productType]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" /> Products
          </h1>
          <p className="text-muted-foreground">Master product catalogue — Phase M1.</p>
        </div>
        <Link href="/dashboard/products/new">
          <Button><Plus className="h-4 w-4 mr-2" /> New Product</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or code..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="combo">Combo</SelectItem>
              <SelectItem value="service">Service</SelectItem>
              <SelectItem value="digital">Digital</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products ({items.length})</CardTitle>
          <CardDescription>Click a product to view details, add barcodes, or activate.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 && !loading ? (
            <div className="text-center py-8 text-muted-foreground">
              No products yet. Click "New Product" to create one.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(p => (
                <Link
                  key={p.id}
                  href={`/dashboard/products/${p.id}`}
                  className="flex items-center justify-between p-3 border rounded-md hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="font-medium">{p.name}</div>
                    <Badge variant="outline" className="font-mono text-xs">{p.code}</Badge>
                    <Badge variant="secondary" className="text-xs">{p.product_type}</Badge>
                    {p.is_serialized && <Badge variant="outline" className="text-xs">serialized</Badge>}
                    {p.is_featured && <Badge className="text-xs">featured</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{p.category?.name}</span>
                    <span className="font-mono">৳ {Number(p.default_price).toFixed(2)}</span>
                    {p.is_active
                      ? <Badge>active</Badge>
                      : <Badge variant="outline">inactive</Badge>}
                  </div>
                </Link>
              ))}
              {hasMore && (
                <Button variant="outline" className="w-full" onClick={() => load(false)} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Load more
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
