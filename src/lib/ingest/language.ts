export type DetectedLanguage = "en" | "roman_ur" | "ur" | "mixed";

// Common Roman Urdu function words. Chosen to rarely appear in English text.
const romanUrduMarkers = new Set([
  "hai", "hain", "ka", "ki", "ke", "ko", "se", "mein", "main", "aap", "ap", "hum", "tum", "yeh", "ye",
  "woh", "wo", "kya", "kyun", "kaise", "nahi", "nahin", "acha", "theek", "samajh", "zaroor", "matlab",
  "phir", "lekin", "aur", "bhi", "sirf", "karna", "karein", "kar", "raha", "rahi", "tha", "thi",
  "hoga", "hogi", "chahiye", "agar", "jab", "kyunke", "kuch", "bohat", "bahut",
]);

/** Cheap heuristic language detection. Good enough to route prompts, not a linguistic claim. */
export function detectLanguage(text: string): DetectedLanguage {
  const sample = text.slice(0, 20_000);
  const urduScript = (sample.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (urduScript > latin) return "ur";

  const words = sample.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!words.length) return "en";
  const markers = words.filter((word) => romanUrduMarkers.has(word)).length;
  const ratio = markers / words.length;
  if (ratio > 0.12) return "roman_ur";
  if (ratio > 0.04) return "mixed";
  return "en";
}
