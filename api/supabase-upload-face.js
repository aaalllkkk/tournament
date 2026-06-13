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
    const { path, contentType, base64 } = req.body || {};
    const storagePath = cleanStoragePath(path);
    if (!storagePath || !base64) return json(res, 400, { error: "path dan base64 wajib diisi." });
    if (!/^[-a-zA-Z0-9_./]+$/.test(storagePath)) return json(res, 400, { error: "Storage path tidak valid." });

    const fileBuffer = Buffer.from(base64, "base64");
    if (!fileBuffer.length) return json(res, 400, { error: "File kosong." });
    if (fileBuffer.length > 2 * 1024 * 1024) return json(res, 413, { error: "File terlalu besar. Maksimum 2 MB per file." });

    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${bucket}/${encodeURI(storagePath)}`;
    const upload = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": contentType || "application/octet-stream",
        "x-upsert": "true",
        "cache-control": "3600"
      },
      body: fileBuffer
    });

    const text = await upload.text();
    if (!upload.ok) {
      return json(res, upload.status, { error: text || "Upload Supabase gagal." });
    }

    const publicUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${encodeURI(storagePath)}`;
    return json(res, 200, { path: storagePath, publicUrl });
  } catch (error) {
    console.error("Supabase upload failed:", error);
    return json(res, 500, { error: error.message });
  }
}
