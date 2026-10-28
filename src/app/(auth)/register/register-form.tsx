"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerAction } from "@/app/(auth)/actions";
import {
  Calculator,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowRight,
} from "lucide-react";

export function RegisterForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const validateClientSide = () => {
    const errors: Record<string, string> = {};

    if (!name.trim() || name.trim().length < 2) {
      errors.name = "O nome deve ter pelo menos 2 caracteres.";
    }

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Informe um e-mail válido.";
    }

    if (!password || password.length < 8) {
      errors.password = "A senha deve ter no mínimo 8 caracteres.";
    }

    if (password !== confirmPassword) {
      errors.confirmPassword = "As senhas não coincidem.";
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    const isValid = validateClientSide();
    if (!isValid) {
      return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("email", email);
    formData.append("password", password);
    formData.append("confirmPassword", confirmPassword);

    startTransition(async () => {
      try {
        const result = await registerAction(null, formData);

        if (result?.error) {
          setServerError(result.error);
        } else if (result?.success) {
          router.push("/dashboard");
          router.refresh();
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("NEXT_REDIRECT")
        ) {
          return;
        }
        setServerError("Ocorreu um erro ao criar a conta. Tente novamente.");
      }
    });
  };

  const isPasswordLongEnough = password.length >= 8;
  const doPasswordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

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
        <p className="text-sm text-slate-500 mt-1">
          Crie sua conta profissional gratuitamente
        </p>
      </div>

      {/* Title */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Criar nova conta
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Comece a orçar suas obras com precisão técnica
        </p>
      </div>

      {/* Server Error Alert */}
      {serverError && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 animate-in fade-in duration-200"
        >
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm font-medium leading-relaxed">
            {serverError}
          </div>
        </div>
      )}

      {/* Register Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Nome completo
          </label>
          <div className="relative rounded-xl shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <User className="w-4 h-4" />
            </div>
            <input
              id="name"
              name="name"
              type="text"
              required
              disabled={isPending}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (clientErrors.name) {
                  setClientErrors((prev) => ({ ...prev, name: "" }));
                }
              }}
              placeholder="Ex: Carlos Eduardo Silva"
              className={`block w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition-all disabled:opacity-60 disabled:bg-slate-50 ${
                clientErrors.name
                  ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : "border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              }`}
            />
          </div>
          {clientErrors.name && (
            <p className="mt-1 text-xs text-red-600 font-medium">
              {clientErrors.name}
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            E-mail profissional
          </label>
          <div className="relative rounded-xl shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Mail className="w-4 h-4" />
            </div>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isPending}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (clientErrors.email) {
                  setClientErrors((prev) => ({ ...prev, email: "" }));
                }
              }}
              placeholder="seu.email@empresa.com"
              className={`block w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition-all disabled:opacity-60 disabled:bg-slate-50 ${
                clientErrors.email
                  ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : "border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              }`}
            />
          </div>
          {clientErrors.email && (
            <p className="mt-1 text-xs text-red-600 font-medium">
              {clientErrors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Senha
          </label>
          <div className="relative rounded-xl shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={isPending}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (clientErrors.password) {
                  setClientErrors((prev) => ({ ...prev, password: "" }));
                }
              }}
              placeholder="Mínimo de 8 caracteres"
              className={`block w-full rounded-xl border pl-10 pr-11 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition-all disabled:opacity-60 disabled:bg-slate-50 ${
                clientErrors.password
                  ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : "border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isPending}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
              aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          {/* Helper requirement indicator */}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span
              className={
                isPasswordLongEnough
                  ? "text-emerald-600 flex items-center gap-1 font-medium"
                  : "text-slate-500"
              }
            >
              {isPasswordLongEnough && <CheckCircle2 className="w-3.5 h-3.5" />}
              Pelo menos 8 caracteres
            </span>
          </div>
          {clientErrors.password && (
            <p className="mt-1 text-xs text-red-600 font-medium">
              {clientErrors.password}
            </p>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Confirmar senha
          </label>
          <div className="relative rounded-xl shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={isPending}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (clientErrors.confirmPassword) {
                  setClientErrors((prev) => ({
                    ...prev,
                    confirmPassword: "",
                  }));
                }
              }}
              placeholder="Digite a senha novamente"
              className={`block w-full rounded-xl border pl-10 pr-11 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition-all disabled:opacity-60 disabled:bg-slate-50 ${
                clientErrors.confirmPassword
                  ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : "border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              disabled={isPending}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
              aria-label={
                showConfirmPassword ? "Ocultar senha" : "Exibir senha"
              }
            >
              {showConfirmPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          {doPasswordsMatch && (
            <p className="mt-1.5 text-xs text-emerald-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              As senhas coincidem
            </p>
          )}
          {clientErrors.confirmPassword && (
            <p className="mt-1 text-xs text-red-600 font-medium">
              {clientErrors.confirmPassword}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Criando sua conta...</span>
              </>
            ) : (
              <>
                <span>Cadastrar e Começar</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Login Link */}
      <div className="mt-8 pt-6 border-t border-slate-100 text-center">
        <p className="text-sm text-slate-600">
          Já possui uma conta?{" "}
          <Link
            href="/login"
            className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
          >
            Faça login
          </Link>
        </p>
      </div>
    </div>
  );
}
