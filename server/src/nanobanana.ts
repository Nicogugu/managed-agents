// Génération d'images via Gemini Nano Banana (gemini-3.1-flash-image-preview).
// Doc: https://ai.google.dev/gemini-api/docs/image-generation

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";

export type GeneratedImage = {
  data: Buffer;
  mimeType: string;
};

export async function generateImage(opts: {
  prompt: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";
  imageSize?: "512" | "1K" | "2K" | "4K";
}): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: opts.aspectRatio || "16:9",
        imageSize: opts.imageSize || "1K",
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as any;
  const parts = json.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p: any) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error(`Pas d'image dans la réponse Gemini: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return {
    data: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}

export function slugifyForFilename(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
