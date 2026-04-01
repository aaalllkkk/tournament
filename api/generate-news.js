export default async function handler(req, res) {

  // ✅ ALWAYS set CORS first
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight FIRST (VERY IMPORTANT)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export default async function handler(req, res) {
  try {
    const { team1, team2, score } = req.body;

    const prompt = `
Write a football news article.

Match: ${team1} vs ${team2}
Score: ${score}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // ✅ correct model
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    });

    res.status(200).json({
      text: response.text
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
