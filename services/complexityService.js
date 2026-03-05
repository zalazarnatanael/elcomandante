const { runOpenCode } = require("./aiService");

function normalizeComplexity(text) {
  const value = (text || "").toLowerCase();
  const match = value.match(/\b(simple|medium|complex)\b/);
  return match ? match[1] : "medium";
}

async function classifyComplexity(issueNumber, issueTitle, plan, options = {}) {
  const prompt = [
    "Clasifica la complejidad de la tarea en una sola palabra:",
    "simple, medium o complex.",
    "",
    `Titulo: ${issueTitle}`,
    "",
    "Plan:",
    plan,
    "",
    "Responde SOLO con la palabra: simple, medium o complex."
  ].join("\n");

  const sessionId = options.sessionId || `complexity-${issueNumber}-${Date.now()}`;
  const model = options.model;
  const res = await runOpenCode(issueNumber, prompt, false, {
    sessionId,
    continue: false,
    logSuffix: "complexity",
    traceId: options.traceId,
    plannerModelOverride: model,
    disablePlannerFallback: false
  });

  return normalizeComplexity(res);
}

module.exports = {
  classifyComplexity,
  normalizeComplexity
};
