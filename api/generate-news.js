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

  try {
    const { team1, team2, score } = req.body;

    const prompt = `
Write a short exciting football match report.

Match: ${team1} vs ${team2}
Final Score: ${score}

Make it sound like professional sports news.
Include a headline and 2–3 sentences.
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No result";

    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
