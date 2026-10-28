"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useSidebarStore } from "@/lib/store/sidebar-store";
import {
  Menu,
  ChevronRight,
  User as UserIcon,
  LogOut,
  Settings,
  ChevronDown,
} from "lucide-react";

interface HeaderProps {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

const segmentLabels: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Obras",
  budgets: "Orçamentos",
  compositions: "Composições",
  resources: "Insumos",
  bdi: "BDI",
  import: "Importação",
  reports: "Relatórios",
  settings: "Configurações",
  profile: "Perfil",
  new: "Novo",
  edit: "Editar",
};

export function Header({ user }: HeaderProps) {
  const pathname = usePathname();
  const { toggleMobile } = useSidebarStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Compute breadcrumb segments
  const pathSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => ({
      raw: segment,
      label: segmentLabels[segment] || decodeURIComponent(segment),
    }));

  // User initials helper
  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const displayName = user?.name || "Usuário";
  const displayEmail = user?.email || "usuario@obracalc.com.br";
  const initials = getInitials(displayName);

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 flex items-center justify-between px-4 sm:px-6 lg:px-8 shadow-xs">
      {/* Left: Mobile hamburger & Breadcrumbs */}
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <button
          type="button"
          onClick={toggleMobile}
          className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Abrir menu de navegação"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="flex items-center">
          <ol className="flex items-center space-x-2 text-sm text-slate-500">
            <li>
              <Link
                href="/dashboard"
                className="hover:text-blue-600 transition-colors font-medium text-slate-600"
              >
                Início
              </Link>
            </li>

            {pathSegments.map((segment, index) => {
              const isLast = index === pathSegments.length - 1;
              const href = "/" + pathSegments.slice(0, index + 1).map((s) => s.raw).join("/");

              return (
                <li key={segment.raw + index} className="flex items-center space-x-2">
                  <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  {isLast ? (
                    <span className="font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-none">
                      {segment.label}
                    </span>
                  ) : (
                    <Link
                      href={href}
                      className="hover:text-blue-600 transition-colors truncate max-w-[150px]"
                    >
                      {segment.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* Right: User Menu */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          {/* User Avatar */}
          <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-semibold text-sm flex items-center justify-center ring-2 ring-blue-100 shadow-xs">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={displayName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>

          {/* User Name (hidden on small mobile) */}
          <div className="hidden md:flex flex-col text-left">
            <span className="text-sm font-semibold text-slate-800 leading-tight">
              {displayName}
            </span>
            <span className="text-xs text-slate-500 truncate max-w-[160px]">
              {displayEmail}
            </span>
          </div>

          <ChevronDown className="w-4 h-4 text-slate-400 hidden sm:block" />
        </button>

        {/* User Dropdown Menu */}
        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white shadow-xl border border-slate-200/80 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            {/* Header info in mobile dropdown */}
            <div className="px-4 py-2.5 border-b border-slate-100 md:hidden">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {displayName}
              </p>
              <p className="text-xs text-slate-500 truncate">{displayEmail}</p>
            </div>

            {/* Menu Links */}
            <div className="py-1">
              <Link
                href="/settings"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors"
              >
                <UserIcon className="w-4 h-4 text-slate-400" />
                <span>Perfil</span>
              </Link>
              <Link
                href="/settings"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors"
              >
                <Settings className="w-4 h-4 text-slate-400" />
                <span>Configurações</span>
              </Link>
            </div>

            <div className="border-t border-slate-100 my-1" />

            {/* Logout button */}
            <div className="py-1">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors text-left"
              >
                <LogOut className="w-4 h-4 text-red-500" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
