// src/app/(erp)/dashboard/products/[id]/page.tsx
// Product detail: show info, barcodes, activate button.

'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, QrCode, CheckCircle2, Loader2 } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  code: string;
  product_type: string;
  is_serialized: boolean;
  track_batches: boolean;
  is_active: boolean;
  is_featured: boolean;
  reference_cost: string;
  default_price: string;
  alert_quantity: string;
  warranty_period_months: number | null;
  short_description: string | null;
  description: string | null;
  category: { id: string; name: string; code: string };
  brand: { id: string; name: string } | null;
  unit: { id: string; name: string; code: string };
}

interface Barcode {
  id: string;
  code: string;
  symbology: string;
  is_primary: boolean;
  package_quantity: string;
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [barcodes, setBarcodes] = useState<Barcode[]>([]);
  const [activating, setActivating] = useState(false);
  const [newBarcode, setNewBarcode] = useState({ code: '', symbology: 'CODE128', is_primary: false });
  const [addingBarcode, setAddingBarcode] = useState(false);

  useEffect(() => {
    // Fetch product (we use the list endpoint with id filter — no detail endpoint yet)
    fetch(`/api/v1/products?limit=200`)
      .then(r => r.json())
      .then(d => {
        const p = d.items?.find((x: Product) => x.id === id);
        setProduct(p ?? null);
      });
    fetch(`/api/v1/products/${id}/barcodes`)
      .then(r => r.json())
      .then(d => setBarcodes(d.items ?? []));
  }, [id]);

  async function handleActivate() {
    setActivating(true);
    try {
      const idempotencyKey = `activate-${id}-${Date.now()}`;
      const res = await fetch(`/api/v1/products/${id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Activation failed');
        if (data?.error?.details?.errors) {
          console.error('Validation errors:', data.error.details.errors);
        }
        return;
      }
      toast.success('Product activated');
      setProduct(p => p ? { ...p, is_active: true } : p);
    } finally {
      setActivating(false);
    }
  }

  async function handleAddBarcode(e: React.FormEvent) {
    e.preventDefault();
    setAddingBarcode(true);
    try {
      const idempotencyKey = `barcode-${id}-${Date.now()}`;
      const res = await fetch(`/api/v1/products/${id}/barcodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          ...(newBarcode.symbology === 'QR' ? {} : { code: newBarcode.code }),
          symbology: newBarcode.symbology,
          is_primary: newBarcode.is_primary,
          package_quantity: 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to add barcode');
        return;
      }
      setBarcodes(prev => [...prev, data]);
      setNewBarcode({ code: '', symbology: 'CODE128', is_primary: false });
      toast.success('Barcode added');
    } finally {
      setAddingBarcode(false);
    }
  }

  if (!product) {
    return <div className="flex items-center justify-center min-h-96"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/products')}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to products
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="font-mono">{product.code}</Badge>
            <Badge variant="secondary">{product.product_type}</Badge>
            {product.is_serialized && <Badge variant="outline">serialized</Badge>}
            {product.is_featured && <Badge>featured</Badge>}
            {product.is_active
              ? <Badge><CheckCircle2 className="h-3 w-3 mr-1" />active</Badge>
              : <Badge variant="outline">inactive</Badge>}
          </div>
        </div>
        {!product.is_active && (
          <Button onClick={handleActivate} disabled={activating}>
            {activating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Activate
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Category" value={`${product.category?.name} (${product.category?.code})`} />
            <Row label="Brand" value={product.brand?.name ?? '—'} />
            <Row label="Unit" value={`${product.unit?.name} (${product.unit?.code})`} />
            <Row label="Default Price" value={`৳ ${Number(product.default_price).toFixed(2)}`} />
            <Row label="Reference Cost" value={`৳ ${Number(product.reference_cost).toFixed(6)}`} />
            <Row label="Alert Qty" value={product.alert_quantity} />
            <Row label="Warranty" value={product.warranty_period_months ? `${product.warranty_period_months} months` : '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Barcodes</CardTitle>
            <CardDescription>One barcode can be primary. QR codes are server-generated signed payloads.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {barcodes.length === 0 ? (
              <div className="text-sm text-muted-foreground">No barcodes yet.</div>
            ) : (
              <div className="space-y-1">
                {barcodes.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-sm border-b pb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{b.symbology}</Badge>
                      <code className="text-xs break-all">{b.code.slice(0, 60)}{b.code.length > 60 ? '...' : ''}</code>
                    </div>
                    {b.is_primary && <Badge>primary</Badge>}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddBarcode} className="space-y-2 pt-2 border-t">
              <div className="grid grid-cols-2 gap-2">
                <Select value={newBarcode.symbology} onValueChange={v => setNewBarcode({ ...newBarcode, symbology: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CODE128">CODE128</SelectItem>
                    <SelectItem value="CODE39">CODE39</SelectItem>
                    <SelectItem value="EAN13">EAN13</SelectItem>
                    <SelectItem value="EAN8">EAN8</SelectItem>
                    <SelectItem value="UPCA">UPC-A</SelectItem>
                    <SelectItem value="QR"><QrCode className="h-3 w-3 inline mr-1" />QR (signed)</SelectItem>
                  </SelectContent>
                </Select>
                {newBarcode.symbology !== 'QR' && (
                  <Input
                    placeholder="Barcode value"
                    value={newBarcode.code}
                    onChange={e => setNewBarcode({ ...newBarcode, code: e.target.value })}
                    required
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="primary"
                  checked={newBarcode.is_primary}
                  onChange={e => setNewBarcode({ ...newBarcode, is_primary: e.target.checked })}
                />
                <Label htmlFor="primary" className="text-sm">Mark as primary</Label>
              </div>
              <Button type="submit" size="sm" disabled={addingBarcode}>
                {addingBarcode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Add Barcode
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
