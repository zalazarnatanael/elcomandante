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

function formatFeedback(feedbackItems) {
    return feedbackItems
        .map(item => {
            const body = truncateText(item.body.replace(/\s+/g, " ").trim(), 700);
            return `- ${item.author}: ${body}`;
        })
        .join("\n");
}

function buildPlanPrompt(issue, session, isNew) {
    const base = isNew
        ? `Analiza: ${issue.title}. Descripción: ${issue.body}. Genera un ### 📋 Plan.`
        : "Actualiza el plan técnico según el feedback en los comentarios.";

    const lastPlan = session.plans.length > 0 ? session.plans[session.plans.length - 1] : null;
    const recentFeedback = session.feedback.slice(-5);

    const contextParts = [];
    if (lastPlan && lastPlan.body) {
        contextParts.push("Plan previo:\n" + lastPlan.body.trim());
    }
    if (recentFeedback.length > 0) {
        contextParts.push("Feedback reciente:\n" + formatFeedback(recentFeedback));
    }

    if (contextParts.length === 0) return base;
    return `${base}\n\nContexto acumulado:\n${contextParts.join("\n\n")}`;
}

module.exports = {
    loadSession,
    saveSession,
    updateSessionWithComments,
    buildPlanPrompt
};
