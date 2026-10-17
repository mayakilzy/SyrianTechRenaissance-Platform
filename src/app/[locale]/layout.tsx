import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Toaster } from "@/components/ui/toaster";
import { routing } from "@/i18n/routing";
import { dirFor, type Locale, locales } from "@/i18n/config";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: `${t("appName")} — ${t("appNameShort")}`,
    description: t("tagline"),
    keywords: ["Syrian Tech Renaissance", "STR", "منصة سورية", "تقنية"],
    authors: [{ name: "Syrian Tech Renaissance" }],
    icons: { icon: "/str-mark.svg" },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const loc = locale as Locale;
  setRequestLocale(loc);
  const dir = dirFor(loc);

  return (
    <html lang={loc} dir={dir} suppressHydrationWarning>
      <head>
        {/* Noto Sans Arabic loaded via <link> (next/font/google Turbopack bug workaround). */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
