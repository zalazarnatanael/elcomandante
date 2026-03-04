const fs = require("fs");
const path = require("path");

const SESSION_DIR = path.join(__dirname, "../session_logs");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

function getSessionPath(issueNumber) {
    return path.join(SESSION_DIR, `issue-${issueNumber}.json`);
}

function loadSession(issueNumber) {
    const sessionPath = getSessionPath(issueNumber);
    if (!fs.existsSync(sessionPath)) {
        return {
            issueNumber,
            lastCommentId: 0,
            plans: [],
            feedback: []
        };
    }
    try {
        const raw = fs.readFileSync(sessionPath, "utf8");
        const parsed = JSON.parse(raw);
        return {
            issueNumber,
            lastCommentId: parsed.lastCommentId || 0,
            plans: Array.isArray(parsed.plans) ? parsed.plans : [],
            feedback: Array.isArray(parsed.feedback) ? parsed.feedback : []
        };
    } catch (e) {
        return {
            issueNumber,
            lastCommentId: 0,
            plans: [],
            feedback: []
        };
    }
}

function saveSession(issueNumber, session) {
    const sessionPath = getSessionPath(issueNumber);
    const payload = {
        issueNumber,
        lastCommentId: session.lastCommentId || 0,
        plans: session.plans || [],
        feedback: session.feedback || []
    };
    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2));
}

function isFeedbackComment(comment) {
    if (!comment || !comment.body) return false;
    if (comment.body.includes("### 📋 Plan")) return false;
    if (comment.user && typeof comment.user.login === "string") {
        if (comment.user.login.includes("github-actions")) return false;
    }
    if (/^\s*✅ \*\*PR:\*\*/.test(comment.body)) return false;
    if (/^\s*🚀 \*\*Código aplicado\.\*\*/.test(comment.body)) return false;
    return true;
}

function updateSessionWithComments(session, comments) {
    const lastId = session.lastCommentId || 0;
    const newComments = comments
        .filter(c => typeof c.id === "number" && c.id > lastId)
        .sort((a, b) => a.id - b.id);

    newComments.forEach(comment => {
        if (isFeedbackComment(comment)) {
            session.feedback.push({
                id: comment.id,
                author: comment.user ? comment.user.login : "unknown",
                createdAt: comment.created_at,
                body: comment.body
            });
        }
    });

    if (newComments.length > 0) {
        session.lastCommentId = newComments[newComments.length - 1].id;
    }

    return session;
}

function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…`;
}

function stripModelErrors(text) {
    if (!text) return text;
    const errorPatterns = [
        /ProviderModelNotFoundError/gi,
        /Model not found:/gi,
        /Error: Request too large/gi,
        /TPM/gi
    ];
    return text
        .split("\n")
        .filter(line => !errorPatterns.some(re => re.test(line)))
        .join("\n");
}

function formatFeedback(feedbackItems) {
    return feedbackItems
        .map(item => {
            const cleaned = stripModelErrors(item.body).replace(/\s+/g, " ").trim();
            const body = truncateText(cleaned, 700);
            return `- ${item.author}: ${body}`;
        })
        .join("\n");
}

function buildPlanPrompt(issue, session, isNew) {
    const planStyle = (process.env.PLAN_STYLE || "short").toLowerCase();
    const base = isNew
        ? `Analiza: ${issue.title}. Descripción: ${issue.body}. Genera un ### 📋 Plan${planStyle === "short" ? " corto" : ""}.`
        : "Actualiza el plan técnico según el feedback en los comentarios.";

    // CRITICAL: Enforce read-only mode
    const readOnlyInstruction = `\n⚠️ STRICTLY READ-ONLY MODE:\n- Do NOT use Edit, Write, Delete, or any modification tools\n- Only use Read, Grep, Glob for analysis if absolutely needed\n- Output ONLY the technical plan with numbered tasks (# Todos checklist)\n- Format: ### 📋 Plan [description]\n[numbered list]\n# Todos\n[ ] Task 1\n[ ] Task 2\n- NO tool output, NO logs, NO file diffs`;

    const lastPlan = session.plans.length > 0 ? session.plans[session.plans.length - 1] : null;
    const recentFeedback = session.feedback.slice(planStyle === "short" ? -2 : -5);

    const contextParts = [];
    if (lastPlan && lastPlan.body) {
        const trimmedPlan = planStyle === "short"
            ? truncateText(lastPlan.body.trim().replace(/\s+/g, " "), 600)
            : lastPlan.body.trim();
        contextParts.push("Plan previo:\n" + trimmedPlan);
    }
    if (recentFeedback.length > 0) {
        contextParts.push("Feedback reciente:\n" + formatFeedback(recentFeedback));
    }

    if (planStyle === "short") {
        const shortInstruction = "Plan breve en 3-5 puntos, sin detalles extensos.";
        const prompt = contextParts.length === 0 
            ? `${base}\n${shortInstruction}`
            : `${base}\n${shortInstruction}\n\nContexto acumulado:\n${contextParts.join("\n\n")}`;
        return prompt + readOnlyInstruction;
    }

    const prompt = contextParts.length === 0 
        ? base
        : `${base}\n\nContexto acumulado:\n${contextParts.join("\n\n")}`;
    return prompt + readOnlyInstruction;
}

module.exports = {
    loadSession,
    saveSession,
    updateSessionWithComments,
    buildPlanPrompt
};
