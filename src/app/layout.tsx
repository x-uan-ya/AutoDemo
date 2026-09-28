import type { Metadata } from "next";
import { Navbar } from "@/components/layout/navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoDemo — Turn Any Website Into a Demo Video",
  description:
    "AutoDemo explores your website, plans the walkthrough, and generates a narrated product demo.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col">
          <Navbar />
          {children}
        </div>
      </body>
    </html>
  );
}
