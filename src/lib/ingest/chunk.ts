export type SourceChunk = {
  index: number;
  text: string;
  tokens: number;
};

export function chunkText(text: string, targetTokens = 320, overlapTokens = 40): SourceChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: SourceChunk[] = [];
  const step = Math.max(1, targetTokens - overlapTokens);

  for (let start = 0; start < words.length; start += step) {
    const chunkWords = words.slice(start, start + targetTokens);
    if (chunkWords.length === 0) break;
    chunks.push({
      index: chunks.length,
      text: chunkWords.join(" "),
      tokens: chunkWords.length,
    });
    if (start + targetTokens >= words.length) break;
  }

  return chunks;
}
