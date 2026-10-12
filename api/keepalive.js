const json = (res, status, payload) => {
  res.status(status).json(payload);
};

// Dipanggil cron 2x seminggu agar project Supabase gratis tak di-pause
// (dianggap nganggur bila 7 hari tanpa aktivitas API).
// Butuh env KEEPALIVE_KEY (string acak, samakan dengan query ?key=).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const expected = String(process.env.KEEPALIVE_KEY || "");
  if (!expected) {
    return json(res, 500, { error: "KEEPALIVE_KEY belum diset di Vercel." });
  }
  if (String(req.query.key || "") !== expected) {
    return json(res, 401, { error: "Key salah." });
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "player-faces";
  if (!supabaseUrl || !serviceKey) {
    return json(res, 500, { error: "Env Supabase belum lengkap di Vercel." });
  }

  try {
    const upstream = await fetch(`${supabaseUrl}/storage/v1/bucket/${bucket}`, {
      headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey }
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: `Supabase: ${text || upstream.status}`.slice(0, 300) });
    }
    return json(res, 200, { ok: true, bucket, time: new Date().toISOString() });
  } catch (error) {
    return json(res, 500, { error: String(error?.message || error).slice(0, 300) });
  }
}
