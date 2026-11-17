'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type Options = { title: string; description: string; action: string; destructive?: boolean };

/** Keeps the existing confirm/cancel flow inside a keyboard-accessible dialog. */
export function useConfirmation() {
  const [options, setOptions] = useState<Options | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => () => { pending.current?.(false); }, []);

  function confirm(options: Options) {
    if (pending.current) return Promise.resolve(false);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOptions(options);
    return new Promise<boolean>(resolve => { pending.current = resolve; });
  }

  function finish(accepted: boolean) {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(accepted);
  }

  const confirmation = <AlertDialog open={Boolean(options)} onOpenChange={open => { if (!open) finish(false); }}>
    <AlertDialogContent className="motion-reduce:animate-none" onCloseAutoFocus={event => {
      event.preventDefault();
      if (trigger.current?.isConnected) trigger.current.focus();
    }}>
      <AlertDialogHeader><AlertDialogTitle>{options?.title}</AlertDialogTitle><AlertDialogDescription>{options?.description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="min-h-11" onClick={() => finish(false)}>Cancel</AlertDialogCancel>
        <AlertDialogAction className={options?.destructive ? 'min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'min-h-11'} onClick={() => finish(true)}>{options?.action}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;

  return { confirm, confirmation };
}
