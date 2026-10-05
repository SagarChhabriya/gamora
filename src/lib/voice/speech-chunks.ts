/**
 * Splits text for cloud read-aloud into sentence groups of at most `max` characters, so the first
 * group starts playing while the next is generated. A sentence longer than `max` is cut at a word.
 */
export function splitForSpeech(text: string, max = 220): string[] {
  const clean = text.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?؟۔])\s+/);
  const groups: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    for (const piece of cutLong(sentence, max)) {
      if (current && current.length + 1 + piece.length > max) {
        groups.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }
  if (current) groups.push(current);
  return groups;
}

function cutLong(sentence: string, max: number) {
  if (sentence.length <= max) return [sentence];
  const words = sentence.split(" ");
  const parts: string[] = [];
  let part = "";
  for (const word of words) {
    if (part && part.length + 1 + word.length > max) {
      parts.push(part);
      part = word.slice(0, max);
    } else {
      part = part ? `${part} ${word}` : word.slice(0, max);
    }
  }
  if (part) parts.push(part);
  return parts;
}
