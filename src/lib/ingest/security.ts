const injectionPatterns = [
  /ignore\s+(all|any|the)\s+previous\s+instructions?/i,
  /reveal\s+(the\s+)?system\s+prompt/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /disregard\s+the\s+source\s+material/i,
  /developer\s+message\s*:/i,
];

export function scanForPromptInjection(text: string) {
  return injectionPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}

export function cleanSourceText(text: string) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim();
}

export function assertSafeRemoteUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd")
  ) {
    throw new Error("Private and local URLs are not allowed");
  }
  return url;
}
