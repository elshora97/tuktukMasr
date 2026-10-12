import type { Metadata, Viewport } from "next";
import { Cairo, Lalezar } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "900"],
  variable: "--font-cairo",
  display: "swap",
});

const lalezar = Lalezar({
  subsets: ["arabic", "latin"],
  weight: "400",
  variable: "--font-lalezar",
  display: "swap",
});

export const metadata: Metadata = {
  title: "توكتوك كوبري مصر",
  description: "لعبة توكتوك على كوبري في القاهرة — عدّي العربيات واكسب نقط!",
  applicationName: "توكتوك كوبري مصر",
  appleWebApp: { capable: true, title: "توكتوك كوبري مصر", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#c3172a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${lalezar.variable}`}>
      <body>{children}</body>
    </html>
  );
}
