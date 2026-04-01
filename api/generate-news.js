export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { team1, team2, score } = req.body;

    const prompt = `
Write a short exciting football news article.

Match: ${team1} vs ${team2}
Score: ${score}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    console.log("Gemini raw:", data);

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No result";

    res.status(200).json({ text });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
