export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { team1, team2, score, penaltyScore, matchType, stage } = req.body;
    const isKnockout = String(matchType || "").toLowerCase() === "knockout";
    const stageText = stage || (isKnockout ? "Knockout Match" : "League Match");
    const scoreLine = penaltyScore ? `${score} (${penaltyScore})` : score;

    const prompt = `
Generate a single short paragraph football news update. Make it dramatic, high tension, place the score prominently, and keep it easy to read.
Avoid all player names completely. Refer only to teams or general positions, such as striker or goalkeeper.
The tone should feel like a breaking news headline expanded into one paragraph. Include one quick turning point or what the result means. No analysis section, no commentary, no second paragraph. Strictly limit to 2-3 sentences maximum.
${isKnockout ? "This is a knockout match, so emphasize survival, elimination pressure, and progression to the next round." : "This is a league match, so emphasize points, momentum, and table pressure."}

Match: ${team1} vs ${team2}
Stage: ${stageText}
Score: ${scoreLine}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=" +
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
