import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { OfflineSyncProvider } from "@/components/pwa/OfflineSyncProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  maximumScale: 1, // POS UI is fixed-scale — prevents accidental pinch zoom
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <OfflineSyncProvider>
          {children}
          <Toaster />
          <ServiceWorkerRegister />
        </OfflineSyncProvider>
      </body>
    </html>
  );
}
