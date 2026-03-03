const http = require("http");

const PORT = process.env.OPENCLAW_EXPAND_PORT || 3030;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/expand") {
    try {
      const { prompt } = await readJson(req);
      if (!prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Missing prompt" }));
      }

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          input: prompt,
        }),
      });

      const data = await r.json();
      if (!r.ok) {
        res.writeHead(r.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(data));
      }

      const outputs = Array.isArray(data?.output) ? data.output : [];
      const textFromContent = outputs
        .flatMap(o => Array.isArray(o?.content) ? o.content : [])
        .map(c => c?.text || c?.output_text || "")
        .filter(Boolean)
        .join("\n");

      const text = data?.output_text || textFromContent || "";

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ text }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`openclaw_expand_server listening on http://127.0.0.1:${PORT}`);
});
