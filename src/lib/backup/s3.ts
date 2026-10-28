import { createHash, createHmac } from "node:crypto";

/**
 * Cliente S3 mínimo (SigV4) sem dependências externas.
 * Usado apenas pelos scripts de backup/restauração em CI ou em uma máquina
 * com acesso ao PostgreSQL. Não é importado pelo runtime da aplicação.
 */

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalUri(key: string): string {
  const normalized = key.split("/").map(encodeRfc3986).join("/");
  return `/${normalized}`;
}

function amzDate(date: Date): { full: string; short: string } {
  const full = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { full, short: full.slice(0, 8) };
}

function hostFor(config: S3Config): string {
  return `${config.bucket}.s3.${config.region}.amazonaws.com`;
}

function endpointFor(config: S3Config, key: string): string {
  if (config.endpoint) {
    return `${config.endpoint.replace(/\/+$/, "")}/${canonicalUri(key)}`;
  }
  return `https://${hostFor(config)}${canonicalUri(key)}`;
}

export interface SignedS3Request {
  url: string;
  headers: Record<string, string>;
}

export function signS3Request(params: {
  config: S3Config;
  method: "GET" | "PUT" | "DELETE";
  key: string;
  body?: Buffer;
  contentType?: string;
  now?: Date;
}): SignedS3Request {
  const { config, method, key } = params;
  const now = params.now ?? new Date();
  const { full, short } = amzDate(now);
  const payload = params.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const host = hostFor(config);

  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${full}`,
  ].join("\n");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri(key),
    "",
    canonicalHeaders,
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${short}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    full,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${config.secretAccessKey}`, short);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": full,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.contentType) {
    headers["content-type"] = params.contentType;
  }

  return { url: endpointFor(config, key), headers };
}

export async function s3PutObject(
  config: S3Config,
  key: string,
  body: Buffer,
  contentType = "application/octet-stream"
): Promise<void> {
  const request = signS3Request({
    config,
    method: "PUT",
    key,
    body,
    contentType,
  });

  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: body as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Falha no upload S3 (${response.status}): ${detail}`);
  }
}

export async function s3GetObject(config: S3Config, key: string): Promise<Buffer> {
  const request = signS3Request({ config, method: "GET", key });
  const response = await fetch(request.url, {
    method: "GET",
    headers: request.headers,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Falha no download S3 (${response.status}): ${detail}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function s3DeleteObject(config: S3Config, key: string): Promise<void> {
  const request = signS3Request({ config, method: "DELETE", key });

  const response = await fetch(request.url, {
    method: "DELETE",
    headers: request.headers,
  });

  if (!response.ok && response.status !== 404) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Falha ao remover backup S3 (${response.status}): ${detail}`);
  }
}
