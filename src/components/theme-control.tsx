'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ThemeControl() {
  const { setTheme } = useTheme();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Choose appearance" title="Choose appearance">
        <Sun className="dark:hidden" aria-hidden="true" /><Moon className="hidden dark:block" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => setTheme('light')}><Sun aria-hidden="true" />Light</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme('dark')}><Moon aria-hidden="true" />Dark</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme('system')}><Monitor aria-hidden="true" />Use system setting</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
