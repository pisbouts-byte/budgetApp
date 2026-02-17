import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "antd/dist/reset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spending Tracker",
  description: "Budget and spending tracker powered by Plaid",
  applicationName: "Spending Tracker",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Spending Tracker"
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.svg", type: "image/svg+xml" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#5a58f2"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
