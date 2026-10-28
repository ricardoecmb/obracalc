"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/(auth)/actions";
import {
  Calculator,
  Mail,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  KeyRound,
} from "lucide-react";

export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    message: string;
    resetLink?: string;
  } | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessData(null);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await requestPasswordResetAction(null, formData);
      if (result.error) {
        setErrorMessage(result.error);
      } else if (result.success) {
        setSuccessData({
          message: result.message || "Solicitação realizada com sucesso.",
          resetLink: result.resetLink,
        });
      }
    });
  };

  return (
    <div className="w-full bg-white rounded-2xl shadow-xl border border-slate-200/80 p-8 sm:p-10 transition-all">
      {/* Brand & Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-500/20 mb-4 ring-4 ring-blue-50">
          <Calculator className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center justify-center gap-1.5">
          <span>Obra</span>
          <span className="text-blue-600">Calc</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Recuperação de Acesso</p>
      </div>

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Esqueceu sua senha?
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Informe seu e-mail cadastrado e geraremos as instruções de redefinição segura.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-700 font-medium">{errorMessage}</div>
        </div>
      )}

      {successData ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800">
              <p className="font-semibold">{successData.message}</p>
              {successData.resetLink && (
                <div className="mt-3 pt-3 border-t border-emerald-200/80">
                  <p className="text-xs text-emerald-700 mb-2">
                    Em ambiente local / demonstração, acesse o link direto abaixo para redefinir sua senha:
                  </p>
                  <Link
                    href={successData.resetLink}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Redefinir Senha Agora</span>
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="text-center pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar para o login</span>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              E-mail cadastrado
            </label>
            <div className="relative rounded-xl shadow-xs">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="seu.email@empresa.com"
                className="block w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all cursor-pointer"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Enviando...</span>
              </>
            ) : (
              <>
                <span>Enviar instruções</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:underline"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar para o login</span>
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
