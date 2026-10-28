import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar Senha | ObraCalc",
  description: "Recupere o acesso à sua conta ObraCalc.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
