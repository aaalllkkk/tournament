const json = (res, status, payload) => {
  res.status(status).json(payload);
};

const cleanStoragePath = (value) => String(value || "")
  .replace(/\\/g, "/")
  .replace(/^\/+/, "")
  .replace(/\.\.+/g, "")
  .replace(/\/+/g, "/")
  .trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "player-faces";

  if (!supabaseUrl || !serviceKey) {
    return json(res, 500, { error: "Supabase env belum diset di Vercel." });
  }

  try {
    const paths = [...new Set((req.body?.paths || []).map(cleanStoragePath).filter(Boolean))];
    if (!paths.length) return json(res, 200, { deleted: 0 });

    let deleted = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const endpoint = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${bucket}`;
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prefixes: chunk })
      });
      const text = await response.text();
      if (!response.ok) return json(res, response.status, { error: text || "Delete Supabase gagal." });
      deleted += chunk.length;
    }

    return json(res, 200, { deleted });
  } catch (error) {
    console.error("Supabase delete failed:", error);
    return json(res, 500, { error: error.message });
  }
}
