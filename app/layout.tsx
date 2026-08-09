import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sonder — a map of current world news",
  description:
    "A 2D web map of current world news. Stories are plotted where they happen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
