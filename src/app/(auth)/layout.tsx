import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Autenticação | ObraCalc",
  description: "Acesse sua conta ou cadastre-se no ObraCalc.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50/50 relative selection:bg-blue-600 selection:text-white">
      {/* Subtle background grid pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] opacity-40 pointer-events-none" />

      {/* Centered card container */}
      <div className="w-full max-w-md relative z-10">
        {children}
      </div>

      {/* Subtle footer */}
      <div className="mt-8 text-center text-xs text-slate-500 relative z-10">
        &copy; 2026 ObraCalc &bull; Sistema de Orçamento de Obras
      </div>
    </div>
  );
}
