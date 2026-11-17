import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { OfflineSyncProvider } from "@/components/pwa/OfflineSyncProvider";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { DEFAULT_UI_LOCALE, LOCALE_COOKIE, UI_LOCALES, nestMessages, type UiLocale } from "@/lib/i18n/format";
import enCommon from "../../public/locales/en-BD/common.json";
import enUi from "../../public/locales/en-BD/ui.json";
import bnCommon from "../../public/locales/bn-BD/common.json";
import bnUi from "../../public/locales/bn-BD/ui.json";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Bengali glyphs for bn-BD. Geist has none, so without this the browser
// falls back to whatever the device ships, which varies widely on tills.
const notoBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  display: "swap",
  preload: false,
});

// en-BD is the complete catalog. A key not yet translated falls back to it.
const EN_MESSAGES = { ...enCommon, ...enUi } as Record<string, string>;
const MESSAGES: Record<UiLocale, Record<string, unknown>> = {
  "en-BD": nestMessages(EN_MESSAGES),
  "bn-BD": nestMessages({ ...EN_MESSAGES, ...bnCommon, ...bnUi }),
};

export const metadata: Metadata = {
  title: "ERP POS — Bangladesh Electronics Retail + Service + Warranty",
  description: "Multi-tenant ERP/POS for Bangladesh electronics retail — inventory, sales, accounting, warranty, service desk.",
  applicationName: "ERP POS",
  authors: [{ name: "ERP POS Team" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "ERP POS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    apple: "/logo.svg",
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The per-request script nonce (src/middleware.ts). Reading it also makes
  // every page render per request, which a nonce requires (F-68).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const requested = (await cookies()).get(LOCALE_COOKIE)?.value as UiLocale | undefined;
  const locale = requested && UI_LOCALES.includes(requested) ? requested : DEFAULT_UI_LOCALE;
  return (
    <html lang={locale === "bn-BD" ? "bn" : "en"} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoBengali.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider nonce={nonce}><I18nProvider locale={locale} messages={MESSAGES[locale]}><OfflineSyncProvider>
          {children}
          <Toaster />
          <SonnerToaster closeButton />
          <ServiceWorkerRegister />
        </OfflineSyncProvider></I18nProvider></ThemeProvider>
      </body>
    </html>
  );
}
