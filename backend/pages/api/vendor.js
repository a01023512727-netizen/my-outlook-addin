export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const domain = String(req.query.domain || "").trim().toLowerCase();

    if (!domain) {
      return res.status(400).json({ error: "domain is required" });
    }

    const scriptApiUrl = process.env.SCRIPT_API_URL;
    if (!scriptApiUrl) {
      return res.status(500).json({ error: "SCRIPT_API_URL is not configured" });
    }

    const url = `${scriptApiUrl}?domain=${encodeURIComponent(domain)}&_ts=${Date.now()}`;

    const upstreamRes = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      return res.status(502).json({
        error: "Upstream API request failed",
        status: upstreamRes.status,
        body: text
      });
    }

    const contentType = upstreamRes.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await upstreamRes.text();
      return res.status(502).json({
        error: "Upstream API did not return JSON",
        body: text
      });
    }

    const data = await upstreamRes.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Internal Server Error"
    });
  }
}
