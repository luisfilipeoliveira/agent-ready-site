import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: "Example Bikes, bike shop",
  description: "Bike shop that sells, fits and repairs city, road and electric bikes.",
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
