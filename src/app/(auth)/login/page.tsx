import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar | ObraCalc",
  description: "Acesse sua conta no ObraCalc - Sistema de Orçamento de Obras.",
};

export default function LoginPage() {
  return <LoginForm />;
}
