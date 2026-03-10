import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta/models";

type EmojiRequest = {
  title: string;
};

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      return JSON.parse(slice);
    }
  }
  throw new Error("Failed to parse JSON from model response.");
}

export async function POST(request: Request) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
  }

  let payload: EmojiRequest;
  try {
    payload = (await request.json()) as EmojiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const title = String(payload.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  const prompt = `Return ONLY valid JSON with this shape:
{
  "emoji": string
}
Rules:
- The emoji must be a single emoji character that best represents the expense title.
- Do not include any additional text.
Expense title: "${title}"`;

  const response = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: errorText || "Gemini API error" }, { status: 500 });
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return NextResponse.json({ error: "Empty response from model" }, { status: 500 });
  }

  try {
    const json = extractJson(text) as { emoji?: string };
    const emoji = String(json?.emoji ?? "").trim();
    if (!emoji) {
      return NextResponse.json({ error: "Missing emoji in response" }, { status: 500 });
    }
    return NextResponse.json({ emoji }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse response" },
      { status: 500 }
    );
  }
}
