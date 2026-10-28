import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Cadastrar-se | ObraCalc",
  description: "Crie sua conta no ObraCalc - Sistema de Orçamento de Obras.",
};

export default function RegisterPage() {
  return <RegisterForm />;
}
