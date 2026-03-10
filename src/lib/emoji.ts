export type EmojiResponse = {
  emoji: string;
};

export function forceTextEmoji(emoji: string): string {
  const trimmed = String(emoji ?? "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/\uFE0F|\uFE0E/g, "");
  return `${cleaned}\uFE0E`;
}

export async function generateEmoji(title: string): Promise<string> {
  const response = await fetch("/api/emoji", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to generate emoji.");
  }

  const data = (await response.json()) as EmojiResponse;
  return String(data?.emoji ?? "").trim();
}
