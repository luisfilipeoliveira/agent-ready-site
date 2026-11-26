import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: "Jane Doe, product designer",
  description: "Product designer who turns messy checkout and onboarding flows into products people finish.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Home</Link> <Link href="/about">About</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
