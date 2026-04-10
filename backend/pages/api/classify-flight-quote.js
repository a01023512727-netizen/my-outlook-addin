/** Vercel env에는 sk-... 값만 넣으세요. "Bearer ", 따옴표, Authorization: 줄 전체를 넣으면 여기서 정리합니다. */
function normalizeOpenAiApiKey(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^authorization\s*:\s*bearer\s+/i, "").trim();
  s = s.replace(/^bearer\s+/i, "").trim();
  return s;
}

function summarizeOpenAiError(status, bodyText) {
  const slice = String(bodyText || "").slice(0, 2000);
  try {
    const j = JSON.parse(slice);
    const msg = j?.error?.message || j?.message;
    if (msg) return `${msg} (HTTP ${status})`;
  } catch {
    /* ignore */
  }
  return slice ? `${slice.slice(0, 500)} (HTTP ${status})` : `HTTP ${status}`;
}

/** 본문 앞부분만 사용 (검색 조건이 대부분 포함된다고 가정) */
const MAX_BODY_CHARS = 500;

const MAX_QUOTES = 8;
const MAX_JOURNEYS_PER_QUOTE = 12;

const SYSTEM_PROMPT = [
  "You analyze a short email snippet (Korean or English) about travel, max context length.",
  "1) isFlightQuoteRequest: true only for INITIAL airline fare quote / flight booking search (견적, 요금, 항공권, 구간·일정 문의). false for replies, thanks, non-flight, hotel-only, etc.",
  "2) If false: set quotes to null.",
  "3) If true: return quotes as a non-empty array. Each element is one separate fare quote the customer asked for (e.g. option A vs B, round-trip vs open-jaw packages, multiple date alternatives).",
  "If only one itinerary is described, use a single quote with one or more journeys (legs).",
  "4) Each quote has journeys: ordered array of flight legs. Each leg object fields (use null if not stated):",
  "departure (출발지: city name or IATA 3-letter),",
  "departureDate (출발일: YYYY-MM-DD if inferable else null or rough text),",
  "departureTime (출발시간: HH:MM 24h),",
  "arrivalTime (도착시간: HH:MM 24h),",
  "airline (IATA 2-letter e.g. KE, or null).",
  "5) Include every leg mentioned for that quote; pad with null fields if partial info.",
  "Return JSON only: isFlightQuoteRequest (boolean), quotes (array of {journeys: array} or null).",
].join(" ");

function normalizeQuotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_QUOTES).map((q) => {
    const jr = Array.isArray(q?.journeys) ? q.journeys : [];
    const journeys = jr.slice(0, MAX_JOURNEYS_PER_QUOTE).map((j) => ({
      departure: j?.departure ?? null,
      departureDate: j?.departureDate ?? null,
      departureTime: j?.departureTime ?? null,
      arrivalTime: j?.arrivalTime ?? null,
      airline: j?.airline ?? null,
    }));
    return { journeys };
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = normalizeOpenAiApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
  }

  const raw = req.body?.text;
  const text = String(raw ?? "")
    .trim()
    .slice(0, MAX_BODY_CHARS);

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text();
      return res.status(502).json({
        error: "OpenAI request failed",
        openaiMessage: summarizeOpenAiError(openaiRes.status, detail),
        status: openaiRes.status,
        detail: detail.slice(0, 2000),
      });
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from model", content: content.slice(0, 500) });
    }

    const isFlightQuoteRequest = Boolean(parsed.isFlightQuoteRequest);
    const message = isFlightQuoteRequest
      ? "항공 견적요청입니다"
      : "항공 견적 요청이 아닙니다";

    let quotes = null;
    if (isFlightQuoteRequest) {
      quotes = normalizeQuotes(parsed.quotes);
      if (quotes.length === 0) {
        quotes = [{ journeys: [] }];
      }
    }

    return res.status(200).json({ isFlightQuoteRequest, message, quotes });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Internal Server Error",
    });
  }
}
