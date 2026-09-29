import mammoth from "mammoth";

import { assertSafeRemoteUrl, cleanSourceText, isAllowedHost } from "@/lib/ingest/security";

const maxBytes = 10 * 1024 * 1024;

export async function parseTextSource(text: string) {
  const cleaned = cleanSourceText(text);
  if (!cleaned) throw new Error("Source text is empty");
  return cleaned;
}

export async function parseFile(file: File) {
  if (file.size > maxBytes) throw new Error("File exceeds the 10 MB limit");
  const data = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    if (data.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF file");
    // Loaded only for PDFs: pdfjs needs native canvas helpers that text and URL ingest never should.
    ensurePdfGlobals();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data });
    try {
      return cleanSourceText((await parser.getText()).text);
    } finally {
      await parser.destroy();
    }
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    if (data.subarray(0, 2).toString() !== "PK") throw new Error("Invalid DOCX file");
    return cleanSourceText((await mammoth.extractRawText({ buffer: data })).value);
  }

  if (file.type === "text/plain" || file.type === "text/markdown" || /\.(txt|md)$/.test(name)) {
    return parseTextSource(data.toString("utf8"));
  }

  throw new Error("Unsupported file type");
}

/** A URL source that could not be read. Carries the site's HTTP status when there is one. */
export class RemoteSourceError extends Error {
  constructor(
    message: string,
    readonly code: "http_error" | "domain_not_allowed" | "unreachable" | "not_text" | "too_large",
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "RemoteSourceError";
  }
}

const statusText: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 410: "Gone", 429: "Too Many Requests" };

/** Plain explanation of a failed fetch, always naming the HTTP code the site returned. */
export function describeHttpStatus(status: number, host: string) {
  const code = `HTTP ${status}${statusText[status] ? ` ${statusText[status]}` : ""}`;
  if (status === 401 || status === 403) {
    return `${host} refused the request (${code}). The site blocks automated readers or needs a sign in. Copy the article text and use Paste text instead.`;
  }
  if (status === 404 || status === 410) return `${host} could not find that page (${code}). Check the link and try again.`;
  if (status === 429) return `${host} is limiting requests right now (${code}). Try again later, or paste the text instead.`;
  if (status >= 500) return `${host} had a server error (${code}). Try again later.`;
  return `${host} returned ${code}, so the page could not be read.`;
}

const maxRedirects = 3;

/** Fetches a public page from an allowed site. Every redirect hop is checked again. */
export async function parseRemoteSource(value: string, allowedDomains: readonly string[] = []) {
  let url = assertSafeRemoteUrl(value);
  let response: Response | null = null;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isAllowedHost(url.hostname, allowedDomains)) {
      throw new RemoteSourceError(
        `${url.hostname} is not on the list of supported sites. Supported: ${allowedDomains.join(", ")}. For other sites, copy the text and use Paste text.`,
        "domain_not_allowed",
      );
    }
    try {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" } });
    } catch {
      throw new RemoteSourceError(`Could not reach ${url.hostname}. Check the link, or paste the text instead.`, "unreachable");
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    if (hop === maxRedirects) throw new RemoteSourceError(`${url.hostname} redirected too many times.`, "unreachable", response.status);
    url = assertSafeRemoteUrl(new URL(location, url).toString());
  }
  if (!response) throw new RemoteSourceError(`Could not reach ${url.hostname}.`, "unreachable");
  if (!response.ok) throw new RemoteSourceError(describeHttpStatus(response.status, url.hostname), "http_error", response.status);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) throw new RemoteSourceError("The page is larger than the 10 MB limit.", "too_large");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/") && !contentType.includes("json")) {
    throw new RemoteSourceError("That link is not a text or HTML page. Upload the file instead.", "not_text");
  }
  const body = await response.text();
  return parseTextSource(contentType.includes("html") || /^\s*<(!doctype|html)/i.test(body) ? htmlToText(body) : body);
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: ", ", ndash: "-", hellip: "..." };

/**
 * Readable text from an HTML page: prefers <main> or <article>, drops scripts, styles, navigation
 * and markup, keeps paragraph breaks. Without this, tags and attributes become "concepts".
 */
export function htmlToText(html: string) {
  let source = html.replace(/<!--[\s\S]*?-->/g, " ");
  const main = source.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.replace(/<[^>]+>/g, "").trim().length > 400) source = main;
  // A tag, reading quoted attribute values whole: wiki pages put JSON with ">" inside attributes.
  const tag = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
  const text = source
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form|template|iframe|math)\b[\s\S]*?<\/\1>/gi, " ")
    // Citation markers and reference lists are not teaching text.
    .replace(new RegExp(`<sup\\b${tag}class=(["'])[^"']*reference[^"']*\\1${tag}>[\\s\\S]*?</sup>`, "gi"), " ")
    .replace(new RegExp(`<(ol|ul|div)\\b${tag}class=(["'])[^"']*(references|reflist|navbox|mw-references)[^"']*\\2${tag}>[\\s\\S]*?</\\1>`, "gi"), " ")
    .replace(new RegExp(`<(br|/p|/div|/li|/h[1-6]|/tr|/section|/article)\\b${tag}>`, "gi"), "\n")
    .replace(new RegExp(`<li\\b${tag}>`, "gi"), "\n- ")
    .replace(new RegExp(`<${tag}>`, "g"), " ");
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .filter((line) => !looksLikeData(line))
    .join("\n")
    .trim();
}

/** A line of leftover page data (JSON, template parameters) rather than readable text. */
export function looksLikeData(line: string) {
  const marks = (line.match(/":|\{"|"\}|\\n/g) ?? []).length;
  return marks >= 3 && marks * 12 > line.length / 4;
}

/**
 * pdfjs references DOMMatrix when it loads. Text extraction never renders, so when the native canvas
 * helper is unavailable a minimal identity matrix is enough to let the module load.
 */
function ensurePdfGlobals() {
  const scope = globalThis as Record<string, unknown>;
  if (typeof scope.DOMMatrix === "undefined") {
    scope.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
      translate() {
        return this;
      }
      scale() {
        return this;
      }
      invertSelf() {
        return this;
      }
    };
  }
}
