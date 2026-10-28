import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // Next.js injeta scripts de hidratação; 'unsafe-eval' é exigido pelo
      // runtime de desenvolvimento. Em produção os scripts continuam restritos
      // à origem da aplicação.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' ws: wss:",
      "worker-src 'self' blob:",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Permite HMR/hidratação quando o dev server é acessado por 127.0.0.1
  // (usado por ferramentas de teste). Não afeta produção.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      // Importações grandes passam pelo Route Handler multipart; este limite
      // mantém o fluxo legado de Server Actions utilizável para prévias.
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
