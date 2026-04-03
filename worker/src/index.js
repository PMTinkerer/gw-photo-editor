const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const COST_PER_IMAGE = 0.134;
const ALLOWED_ORIGIN = "https://pmtinkerer.github.io";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = [ALLOWED_ORIGIN];
  if (env?.ENVIRONMENT === "development") allowed.push("http://localhost:8787");
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gw-photo-editor-worker",
  };
}

function ghUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_LOGS_REPO}/contents/${path}`;
}

async function readRawFile(env, path) {
  const resp = await fetch(ghUrl(env, path), { headers: ghHeaders(env) });
  if (!resp.ok) return "";
  const data = await resp.json();
  return data.content ? atob(data.content.replace(/\n/g, "")) : "";
}

async function readJsonl(env, path) {
  const raw = await readRawFile(env, path);
  return raw.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function appendToLog(env, filePath, entry, retries = 3) {
  const url = ghUrl(env, filePath);
  const hdrs = ghHeaders(env);
  for (let i = 0; i < retries; i++) {
    try {
      const get = await fetch(url, { headers: hdrs });
      let existing = "";
      let sha;
      if (get.ok) {
        const file = await get.json();
        existing = file.content ? decodeURIComponent(escape(atob(file.content.replace(/\n/g, "")))) : "";
        sha = file.sha;
      } else if (get.status !== 404) {
        throw new Error(`GET ${filePath}: ${get.status}`);
      }
      const body = { message: `Log: ${filePath}`, content: utf8ToBase64(existing + JSON.stringify(entry) + "\n") };
      if (sha) body.sha = sha;
      const put = await fetch(url, { method: "PUT", headers: hdrs, body: JSON.stringify(body) });
      if (put.ok) return;
      if (put.status === 409 && i < retries - 1) continue;
      throw new Error(`PUT ${filePath}: ${put.status}`);
    } catch (err) {
      if (i === retries - 1) console.error(`Log failed ${filePath}:`, err.message);
    }
  }
}

async function callGemini(env, contents) {
  const start = Date.now();
  const resp = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "3:2", imageSize: "2K" },
      },
      tools: [{ googleSearch: {} }],
    }),
  });
  if (!resp.ok) throw { status: resp.status, body: await resp.text() };

  const parts = (await resp.json()).candidates?.[0]?.content?.parts;
  if (!parts) throw { status: 500, body: "No content in Gemini response" };

  let responseText = "";
  let resultImageBase64 = null;
  const modelParts = [];
  for (const p of parts) {
    if (p.text) { responseText += p.text; modelParts.push({ text: p.text }); }
    if (p.inlineData) { resultImageBase64 = p.inlineData.data; modelParts.push({ inlineData: p.inlineData }); }
    if (p.thoughtSignature) modelParts.push({ thoughtSignature: p.thoughtSignature });
  }
  if (!resultImageBase64) throw { status: 502, body: "Gemini did not return an image. " + responseText };
  return { responseText, resultImageBase64, modelParts, durationMs: Date.now() - start };
}

function makeSubLog(id, sessionId, propName, iterNum, prompt, followUp, gemini) {
  return {
    id, session_id: sessionId, created_at: new Date().toISOString(),
    property_name: propName, iteration_number: iterNum,
    prompt_text: prompt, follow_up_text: followUp,
    model: GEMINI_MODEL, aspect_ratio: "3:2", image_size: "2K",
    grounding_enabled: true, response_text: gemini.responseText,
    cost_estimate: COST_PER_IMAGE, duration_ms: gemini.durationMs, error: null,
  };
}

async function handleGenerate(request, env, ctx) {
  const fd = await request.formData();
  const image = fd.get("image"), prompt = fd.get("prompt") || "", propertyName = fd.get("property_name");
  const sessionId = fd.get("session_id") || crypto.randomUUID();
  if (!image || !propertyName) return { error: "image and property_name required", status: 400 };

  const gemini = await callGemini(env, [{
    role: "user",
    parts: [
      { inlineData: { mimeType: image.type || "image/jpeg", data: bufToBase64(await image.arrayBuffer()) } },
      { text: prompt },
    ],
  }]);
  const id = `sub_${crypto.randomUUID().slice(0, 12)}`;
  ctx.waitUntil(appendToLog(env, "submissions.jsonl", makeSubLog(id, sessionId, propertyName, 1, prompt, null, gemini)));
  return {
    data: { session_id: sessionId, submission_id: id, result_image_base64: gemini.resultImageBase64,
      response_text: gemini.responseText, model_parts: gemini.modelParts,
      iteration_number: 1, cost_estimate: COST_PER_IMAGE },
    status: 200,
  };
}

async function handleIterate(request, env, ctx) {
  const { session_id, follow_up_text, conversation_history, iteration_number, property_name } = await request.json();
  if (!session_id || !follow_up_text || !conversation_history) {
    return { error: "session_id, follow_up_text, and conversation_history required", status: 400 };
  }
  const gemini = await callGemini(env, [...conversation_history, { role: "user", parts: [{ text: follow_up_text }] }]);
  const id = `sub_${crypto.randomUUID().slice(0, 12)}`;
  const iterNum = (iteration_number || 1) + 1;
  ctx.waitUntil(appendToLog(env, "submissions.jsonl", makeSubLog(id, session_id, property_name || "", iterNum, null, follow_up_text, gemini)));
  return {
    data: { submission_id: id, result_image_base64: gemini.resultImageBase64,
      response_text: gemini.responseText, model_parts: gemini.modelParts,
      iteration_number: iterNum, cost_estimate: COST_PER_IMAGE },
    status: 200,
  };
}

async function handleFeedback(request, env, ctx) {
  const { submission_id, session_id, score, feedback_text, issues_detected, will_resubmit } = await request.json();
  if (!submission_id || !session_id) return { error: "submission_id and session_id required", status: 400 };
  const id = `fb_${crypto.randomUUID().slice(0, 12)}`;
  ctx.waitUntil(appendToLog(env, "feedback.jsonl", {
    id, submission_id, session_id, created_at: new Date().toISOString(),
    score: score ?? null, feedback_text: feedback_text || "",
    issues_detected: issues_detected || [], resubmitted: will_resubmit || false,
  }));
  return { data: { feedback_id: id }, status: 200 };
}

async function handleDashboard(env) {
  const [subs, fb] = await Promise.all([readJsonl(env, "submissions.jsonl"), readJsonl(env, "feedback.jsonl")]);
  const today = new Date().toISOString().slice(0, 10);
  const scores = fb.filter((f) => f.score).map((f) => f.score);
  const scoreDist = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
  scores.forEach((s) => scoreDist[s]++);

  const issueCounts = {};
  fb.forEach((f) => (f.issues_detected || []).forEach((i) => { issueCounts[i] = (issueCounts[i] || 0) + 1; }));

  const sessMap = {};
  subs.forEach((s) => {
    const se = sessMap[s.session_id] ||= { session_id: s.session_id, property_name: s.property_name, first_date: s.created_at, iterations: 0, cost: 0, _scores: [] };
    se.iterations++; se.cost += s.cost_estimate || 0;
  });
  fb.forEach((f) => { if (f.score && sessMap[f.session_id]) sessMap[f.session_id]._scores.push(f.score); });
  const recent = Object.values(sessMap).sort((a, b) => b.first_date.localeCompare(a.first_date)).slice(0, 20);
  recent.forEach((s) => { s.avg_score = s._scores.length ? +(s._scores.reduce((a, b) => a + b, 0) / s._scores.length).toFixed(1) : null; delete s._scores; });

  return {
    data: {
      total_sessions: new Set(subs.map((s) => s.session_id)).size,
      total_submissions: subs.length,
      total_cost: Math.round(subs.reduce((sum, s) => sum + (s.cost_estimate || 0), 0) * 100) / 100,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
      submissions_today: subs.filter((s) => s.created_at?.startsWith(today)).length,
      score_distribution: scoreDist, common_issues: Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).map(([issue, count]) => ({ issue, count })),
      recent_sessions: recent,
    },
    status: 200,
  };
}

async function handleExport(env) {
  const [subs, fb] = await Promise.all([readJsonl(env, "submissions.jsonl"), readJsonl(env, "feedback.jsonl")]);
  return { data: { submissions: subs, feedback: fb }, status: 200 };
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith("/api/admin/")) {
        if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_PASSWORD}`) return json({ error: "Unauthorized" }, 401, cors);
        let result;
        if (path === "/api/admin/dashboard") result = await handleDashboard(env);
        else if (path === "/api/admin/export") result = await handleExport(env);
        else return json({ error: "Not found" }, 404, cors);
        return json(result.data, result.status, cors);
      }

      let result;
      if (path === "/api/generate" && request.method === "POST") result = await handleGenerate(request, env, ctx);
      else if (path === "/api/iterate" && request.method === "POST") result = await handleIterate(request, env, ctx);
      else if (path === "/api/feedback" && request.method === "POST") result = await handleFeedback(request, env, ctx);
      else return json({ error: "Not found" }, 404, cors);

      if (result.error) return json({ error: result.error }, result.status, cors);
      return json(result.data, result.status, cors);
    } catch (err) {
      if (err.status && err.body) {
        console.error("Upstream error:", err.status, err.body);
        return json({ error: "upstream_error", status: err.status }, 502, cors);
      }
      console.error("Worker error:", err);
      return json({ error: "internal_error" }, 500, cors);
    }
  },
};
