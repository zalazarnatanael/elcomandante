function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
    if (!value) return null;
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) return Math.max(0, asNumber * 1000);
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
    return null;
}

function getStatus(err) {
    return err?.status || err?.response?.status || null;
}

function getRequestId(err) {
    return err?.response?.headers?.['x-github-request-id'] || null;
}

function getRetryAfter(err) {
    return parseRetryAfterMs(err?.response?.headers?.['retry-after']);
}

const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_CODES = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNABORTED'
]);

function isAuthError(status) {
    return status === 401 || status === 403;
}

function isRetryable(err) {
    const status = getStatus(err);
    if (status && RETRY_STATUSES.has(status)) return true;
    const code = err?.code || err?.cause?.code;
    if (code && RETRY_CODES.has(code)) return true;
    return false;
}

function classifyGithubError(err) {
    const status = getStatus(err);
    return {
        status,
        requestId: getRequestId(err),
        code: err?.code || err?.cause?.code || null,
        message: err?.message || 'Error desconocido',
        isAuth: isAuthError(status),
        isRetryable: isRetryable(err)
    };
}

async function withRetry(fn, options = {}) {
    const maxAttempts = Number(options.maxAttempts || 4);
    const baseDelayMs = Number(options.baseDelayMs || 500);
    const jitterRatio = Number(options.jitterRatio || 0.2);

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (!isRetryable(err) || attempt === maxAttempts) break;

            const retryAfter = getRetryAfter(err);
            const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
            const baseDelay = retryAfter !== null ? retryAfter : expDelay;
            const jitter = baseDelay * jitterRatio;
            const delay = Math.max(0, baseDelay - jitter + Math.random() * jitter * 2);
            const status = getStatus(err);
            const code = err?.code || err?.cause?.code;
            const reason = status ? `status=${status}` : (code ? `code=${code}` : 'error');
            console.log(`🔁 [GITHUB] Reintento ${attempt}/${maxAttempts} (${reason}) en ${Math.round(delay)}ms`);
            await sleep(delay);
        }
    }

    throw lastError;
}

module.exports = {
    withRetry,
    classifyGithubError
};
