'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ThemeControl() {
  const { setTheme } = useTheme();
  const t = useTranslations('shell');
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={t('appearance')} title={t('appearance')}>
        <Sun className="dark:hidden" aria-hidden="true" /><Moon className="hidden dark:block" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => setTheme('light')}><Sun aria-hidden="true" />{t('theme_light')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme('dark')}><Moon aria-hidden="true" />{t('theme_dark')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme('system')}><Monitor aria-hidden="true" />{t('theme_system')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
