import mammoth from "mammoth";

import { assertSafeRemoteUrl, cleanSourceText } from "@/lib/ingest/security";

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

export async function parseRemoteSource(value: string) {
  const url = assertSafeRemoteUrl(value);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Remote source returned ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) throw new Error("Remote source exceeds the 10 MB limit");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/") && !contentType.includes("json")) {
    throw new Error("Remote source must be text or HTML");
  }
  return parseTextSource(await response.text());
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
