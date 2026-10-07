const json = (res, status, payload) => {
  res.status(status).json(payload);
};

const API_BASE = "https://v3.football.api-sports.com";

// Musim kompetisi Eropa berjalan Agu-Jul (2026-27 = season 2026).
const defaultSeason = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= 7 ? year : year - 1;
};

const cleanText = (value, max = 80) => String(value || "").trim().slice(0, max);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return json(res, 500, {
      error: "API_FOOTBALL_KEY belum diset di Vercel. Daftar gratis di api-football (100 req/hari), lalu isi env tersebut."
    });
  }

  const action = cleanText(req.query.action, 20);
  const callApi = async (path) => {
    const upstream = await fetch(`${API_BASE}${path}`, {
      headers: { "x-apisports-key": apiKey }
    });
    const remaining = upstream.headers.get("x-ratelimit-requests-remaining");
    const text = await upstream.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!upstream.ok) {
      const msg = data?.message || data?.errors || text || `Upstream ${upstream.status}`;
      throw { status: upstream.status === 429 ? 429 : 502, message: String(typeof msg === "string" ? msg : JSON.stringify(msg)).slice(0, 300), remaining };
    }
    if (data?.errors && Object.keys(data.errors).length) {
      throw { status: 502, message: JSON.stringify(data.errors).slice(0, 300), remaining };
    }
    return { data, remaining };
  };

  try {
    if (action === "search") {
      const q = cleanText(req.query.team);
      if (!q) return json(res, 400, { error: "Parameter team wajib diisi." });
      const { data, remaining } = await callApi(`/teams?search=${encodeURIComponent(q)}`);
      const teams = (data?.response || []).map((item) => ({
        id: item?.team?.id,
        name: item?.team?.name,
        country: item?.team?.country,
        logo: item?.team?.logo
      })).filter((item) => item.id);
      return json(res, 200, { teams, remaining });
    }

    if (action === "last") {
      const teamId = parseInt(req.query.team, 10);
      if (!Number.isFinite(teamId)) return json(res, 400, { error: "Parameter team (id API) wajib diisi." });
      const season = parseInt(req.query.season, 10) || defaultSeason();
      const { data, remaining } = await callApi(`/fixtures?team=${teamId}&season=${season}&last=5`);
      const fixtures = (data?.response || [])
        .filter((item) => item?.fixture?.status?.short === "FT")
        .map((item) => ({
          id: item?.fixture?.id,
          date: item?.fixture?.date,
          league: item?.league?.name,
          home: item?.teams?.home?.name,
          away: item?.teams?.away?.name,
          score: `${item?.goals?.home ?? "-"}-${item?.goals?.away ?? "-"}`
        }))
        .filter((item) => item.id);
      return json(res, 200, { fixtures, season, remaining });
    }

    if (action === "lineup") {
      const fixtureId = parseInt(req.query.fixture, 10);
      const teamId = parseInt(req.query.team, 10);
      if (!Number.isFinite(fixtureId)) return json(res, 400, { error: "Parameter fixture wajib diisi." });
      const { data, remaining } = await callApi(`/fixtures/lineups?fixture=${fixtureId}`);
      const rows = data?.response || [];
      const entry = (Number.isFinite(teamId) && rows.find((row) => row?.team?.id === teamId)) || rows[0];
      if (!entry) return json(res, 404, { error: "Lineup tak tersedia untuk laga ini (coba laga lain).", remaining });
      const slim = (list) => (list || []).map((slot) => ({
        name: slot?.player?.name || "",
        number: slot?.player?.number || null,
        pos: slot?.player?.pos || "",
        grid: slot?.player?.grid || ""
      })).filter((slot) => slot.name);
      return json(res, 200, {
        team: entry?.team?.name || "",
        formation: entry?.formation || "",
        coach: entry?.coach?.name || "",
        xi: slim(entry?.startXI),
        subs: slim(entry?.substitutes),
        remaining
      });
    }

    return json(res, 400, { error: "action tak dikenal: search | last | lineup." });
  } catch (error) {
    const status = error?.status || 500;
    return json(res, status, {
      error: error?.message || "Gagal mengambil formasi real-life.",
      remaining: error?.remaining ?? null
    });
  }
}
