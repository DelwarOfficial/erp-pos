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
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean = false) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
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
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, productType, cursor]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true);
  }, [search, productType]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" /> Products
          </h1>
          <p className="text-muted-foreground">Master product catalogue — Phase M1.</p>
        </div>
        <Link href="/dashboard/products/new">
          <Button className="min-h-[44px]"><Plus className="h-4 w-4 mr-2" /> New Product</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search products"
            />
          </div>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by product type"><SelectValue placeholder="Type" /></SelectTrigger>
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
          {loading ? (
            <LoadingState label="Loading products…" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => load(true)} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Package className="h-8 w-8 text-muted-foreground/50" />}
              message={<>No products yet. Click <strong>&ldquo;New Product&rdquo;</strong> to create one.</>}
              action={
                <Link href="/dashboard/products/new">
                  <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-2" /> New Product</Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {items.map(p => (
                <Link
                  key={p.id}
                  href={`/dashboard/products/${p.id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border rounded-md hover:bg-slate-50 transition-colors min-h-[44px]"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium">{p.name}</div>
                    <Badge variant="outline" className="font-mono text-xs">{p.code}</Badge>
                    <Badge variant="secondary" className="text-xs">{p.product_type}</Badge>
                    {p.is_serialized && <Badge variant="outline" className="text-xs">serialized</Badge>}
                    {p.is_featured && <Badge className="text-xs">featured</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="truncate max-w-[140px]">{p.category?.name}</span>
                    <span className="font-mono whitespace-nowrap">৳ {Number(p.default_price).toFixed(2)}</span>
                    {p.is_active
                      ? <Badge>active</Badge>
                      : <Badge variant="outline">inactive</Badge>}
                  </div>
                </Link>
              ))}
              {hasMore && (
                <Button variant="outline" className="w-full min-h-[44px]" onClick={() => load(false)} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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
