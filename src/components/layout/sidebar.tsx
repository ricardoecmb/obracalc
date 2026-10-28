"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebarStore } from "@/lib/store/sidebar-store";
import {
  LayoutDashboard,
  Building2,
  Users,
  Calculator,
  Layers,
  Package,
  Percent,
  Upload,
  FileText,
  Settings,
  Sparkles,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Obras",
    href: "/projects",
    icon: Building2,
  },
  {
    label: "Clientes",
    href: "/clients",
    icon: Users,
  },
  {
    label: "Orçamentos",
    href: "/budgets",
    icon: Calculator,
  },
  {
    label: "Composições",
    href: "/compositions",
    icon: Layers,
  },
  {
    label: "Insumos",
    href: "/resources",
    icon: Package,
  },
  {
    label: "Atualização de Preços",
    href: "/prices",
    icon: TrendingUp,
  },
  {
    label: "BDI",
    href: "/bdi",
    icon: Percent,
  },
  {
    label: "Importação",
    href: "/import",
    icon: Upload,
  },
  {
    label: "Relatórios",
    href: "/reports",
    icon: FileText,
  },
  {
    label: "Assistente IA",
    href: "/assistant",
    icon: Sparkles,
  },
  {
    label: "Configurações",
    href: "/settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, isMobileOpen, toggleCollapse, setMobileOpen } =
    useSidebarStore();

  const isLinkActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* ========================================================================= */}
      {/* MOBILE BACKDROP & DRAWER */}
      {/* ========================================================================= */}
      {isMobileOpen && (
        <div
          role="presentation"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 lg:hidden transition-opacity duration-300"
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 text-white flex flex-col border-r border-slate-800 shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Navegação móvel"
      >
        {/* Mobile Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Calculator className="w-5 h-5" />
            </div>
            <div className="flex items-baseline font-bold text-lg tracking-tight">
              <span>Obra</span>
              <span className="text-blue-400">Calc</span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Fechar menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Nav Links */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
          {navItems.map((item) => {
            const active = isLinkActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/80"
                }`}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${active ? "text-white" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Mobile Footer */}
        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center">
          ObraCalc &bull; v0.1.0
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* DESKTOP SIDEBAR */}
      {/* ========================================================================= */}
      <aside
        className={`hidden lg:flex flex-col flex-shrink-0 h-screen sticky top-0 bg-slate-900 text-white border-r border-slate-800 z-30 transition-[width] duration-300 ease-in-out select-none ${
          isCollapsed ? "w-20" : "w-64"
        }`}
        aria-label="Barra lateral principal"
      >
        {/* Desktop Header / Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
          <Link
            href="/dashboard"
            className={`flex items-center gap-3 overflow-hidden ${
              isCollapsed ? "justify-center w-full" : "px-2"
            }`}
          >
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 flex-shrink-0">
              <Calculator className="w-5 h-5" />
            </div>
            {!isCollapsed && (
              <div className="flex items-baseline font-bold text-lg tracking-tight whitespace-nowrap">
                <span>Obra</span>
                <span className="text-blue-400">Calc</span>
              </div>
            )}
          </Link>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-6 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800">
          {navItems.map((item) => {
            const active = isLinkActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                className={`flex items-center rounded-xl text-sm font-medium transition-all group ${
                  isCollapsed
                    ? "justify-center h-11 w-11 mx-auto"
                    : "gap-3 px-3.5 py-2.5"
                } ${
                  active
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/80"
                }`}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition-colors ${
                    active ? "text-white" : "text-slate-400 group-hover:text-white"
                  }`}
                />
                {!isCollapsed && (
                  <span className="truncate whitespace-nowrap">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Desktop Collapse Toggle Footer */}
        <div className="p-3 border-t border-slate-800">
          <button
            type="button"
            onClick={toggleCollapse}
            title={isCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            className={`w-full flex items-center rounded-xl py-2 text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors ${
              isCollapsed ? "justify-center px-0" : "gap-3 px-3.5"
            }`}
            aria-label={
              isCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"
            }
          >
            {isCollapsed ? (
              <ChevronRight className="w-5 h-5 flex-shrink-0" />
            ) : (
              <>
                <ChevronLeft className="w-5 h-5 flex-shrink-0" />
                <span className="text-xs font-medium uppercase tracking-wider">
                  Recolher menu
                </span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
