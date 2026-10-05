// POST /api/generate-news — berita match yang natural & bervariasi (id).
// Body: { team1, team2, score:"2-1", penaltyScore?, matchType, stage,
//         goals:[{min, team, scorer, assist}], lang:"id"|"en", seed? }
// Balikan: { text } (tetap kompatibel dengan caller lama).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const body = req.body || {};
    const { team1, team2, matchType, stage } = body;
    const score = String(body.score || "");
    const penaltyScore = body.penaltyScore || "";
    const lang = String(body.lang || "id").toLowerCase().startsWith("en") ? "en" : "id";
    const goals = Array.isArray(body.goals) ? body.goals.slice(0, 12) : [];
    if (!team1 || !team2 || !score) {
      return res.status(400).json({ error: "team1, team2, dan score wajib diisi." });
    }

    const isKnockout = String(matchType || "").toLowerCase() === "knockout";
    const stageText = stage || (isKnockout ? "Knockout Match" : "League Match");
    const scoreLine = penaltyScore ? `${score} (${penaltyScore})` : score;

    // ---- Fakta dari skor + urutan gol (untuk narasi natural, bukan karangan) ----
    const parts = score.split("-").map((x) => parseInt(String(x).trim(), 10));
    const g1 = Number.isFinite(parts[0]) ? parts[0] : null;
    const g2 = Number.isFinite(parts[1]) ? parts[1] : null;
    const scored = g1 !== null && g2 !== null;
    const winner = scored ? (g1 > g2 ? team1 : g2 > g1 ? team2 : null) : null;
    const margin = scored ? Math.abs(g1 - g2) : 0;
    const cleanSheetFor = scored
      ? (g1 === 0 && g2 !== 0 ? team2 : g2 === 0 && g1 !== 0 ? team1 : null)
      : null;

    const ordered = goals
      .map((g) => ({
        min: g.min === null || g.min === undefined || g.min === "" ? null : parseInt(g.min, 10),
        team: String(g.team || ""),
        scorer: String(g.scorer || ""),
        assist: String(g.assist || "")
      }))
      .filter((g) => g.team || g.scorer)
      .sort((a, b) => (a.min ?? 999) - (b.min ?? 999));

    // Deteksi perubahan keunggulan dari urutan gol (comeback / kejar-kejaran).
    let leadChanges = 0;
    if (scored && ordered.length) {
      let a = 0, b = 0, lead = null;
      ordered.forEach((g) => {
        const home = g.team && team1 && g.team.toLowerCase() === String(team1).toLowerCase();
        if (home) a += 1; else b += 1;
        const now = a > b ? team1 : b > a ? team2 : null;
        if (lead && now && now !== lead) leadChanges += 1;
        if (now) lead = now;
      });
    }

    const goalLines = ordered.map((g) => {
      const when = g.min !== null && Number.isFinite(g.min) ? `${g.min}' ` : "";
      const who = g.scorer ? `${g.scorer}` : "gol";
      const ast = g.assist ? ` (assist ${g.assist})` : "";
      return `- ${when}${g.team || "?"}: ${who}${ast}`;
    });

    // ---- Pilih angle biar tidak monoton (difilter sesuai fakta) ----
    const pool = ["result-lead"];
    if (leadChanges > 0) pool.push("turning-point", "turning-point");
    if (cleanSheetFor) pool.push("clean-sheet");
    if (margin >= 3) pool.push("dominant", "dominant");
    if (scored && margin === 1) pool.push("tight");
    if (scored && g1 === g2) pool.push("draw-drama");
    if (isKnockout) pool.push("knockout-survival", "knockout-survival");
    const seedNum = Number(body.seed);
    const angle = pool[Number.isFinite(seedNum) ? Math.abs(seedNum) % pool.length : Math.floor(Math.random() * pool.length)];

    const angleText = {
      "result-lead": "Buka dengan hasil akhir dan skor secara jelas, lalu satu kalimat konteks klasemen/momentum.",
      "turning-point": "Fokus ke momen penentu (gol penyama/pembalik atau gol telat) berdasarkan urutan gol, tanpa mengarang menit yang tidak ada.",
      "clean-sheet": "Sorot lini belakang/kiper tim yang nirbobol sebagai fondasi kemenangan.",
      "dominant": "Tekankan dominasi dan margin besar, tetap faktual.",
      "tight": "Tekankan laga ketat yang ditentukan satu gol.",
      "draw-drama": "Tekankan saling kejar dan hasil imbang yang adil/penuh tensi.",
      "knockout-survival": "Tekankan tekanan gugur, kelolosan, dan apa arti hasil ini untuk babak berikutnya."
    }[angle];

    const prompt = lang === "en" ? `
Write a natural football match report in English, like a sports news outlet. 2-4 sentences, one paragraph, no headings.
${angleText}
Facts — Match: ${team1} vs ${team2}. Stage: ${stageText}. Score: ${scoreLine}.
${winner ? `Winner: ${winner}.` : scored ? "Result: draw." : ""}
${cleanSheetFor ? `Clean sheet: ${cleanSheetFor}.` : ""}
Goal order (use for natural narration):
${goalLines.length ? goalLines.join("\n") : "(no goal details provided)"}
Rules: mention the score clearly; use ONLY the player names, minutes, and events above — never invent names, minutes, cards, injuries, stadiums, or crowds. No analysis section, no second paragraph.
`.trim() : `
Tulis berita pertandingan sepak bola yang natural seperti media olahraga Indonesia (gaya Bola.net). 2-4 kalimat, satu paragraf, tanpa heading.
${angleText}
Fakta — Pertandingan: ${team1} vs ${team2}. Laga: ${stageText}. Skor: ${scoreLine}.
${winner ? `Pemenang: ${winner}.` : scored ? "Hasil: imbang." : ""}
${cleanSheetFor ? `Nirbobol: ${cleanSheetFor}.` : ""}
Urutan gol (pakai untuk narasi yang mengalir):
${goalLines.length ? goalLines.join("\n") : "(tidak ada detail gol)"}
Aturan: sebut skor dengan jelas; HANYA pakai nama pemain, menit, dan kejadian di atas — jangan mengarang nama, menit, kartu, cedera, stadion, atau penonton. Tanpa bagian analisis, tanpa paragraf kedua.
`.trim();

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9 }
        })
      }
    );

    const data = await response.json();
    console.log("Gemini raw:", data);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No result";
    if (text === "No result") {
      return res.status(502).json({ error: "Generate news API tidak mengembalikan teks berita." });
    }
    res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
