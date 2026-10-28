import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ObraCalc - Orçamento de Obras",
    template: "%s | ObraCalc",
  },
  description:
    "Sistema profissional de gestão e orçamento de obras da construção civil brasileira com tabelas SINAPI, SICRO, cálculo de BDI e composições de custos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans antialiased text-slate-900 bg-slate-50">
        <div className="flex min-h-screen flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
