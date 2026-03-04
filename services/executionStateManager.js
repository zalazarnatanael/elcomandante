const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "../execution_states");
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

/**
 * Get execution state for an issue
 * @param {number} issueNumber
 * @returns {Object} State with plans, current step, etc.
 */
function getExecutionState(issueNumber) {
    const stateFile = path.join(STATE_DIR, `issue-${issueNumber}.json`);
    
    if (!fs.existsSync(stateFile)) {
        return {
            issueNumber,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plansExecuted: [],
            currentPlan: null,
            lastSuccessfulPlan: null,
            status: "pending", // pending, in_progress, completed, failed
            buildAttempts: 0,
            planAttempts: 0
        };
    }
    
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

/**
 * Update execution state for an issue
 * @param {number} issueNumber
 * @param {Object} updates - fields to update
 */
function updateExecutionState(issueNumber, updates) {
    const stateFile = path.join(STATE_DIR, `issue-${issueNumber}.json`);
    const current = getExecutionState(issueNumber);
    
    const newState = {
        ...current,
        ...updates,
        updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(stateFile, JSON.stringify(newState, null, 2));
    return newState;
}

/**
 * Record a plan execution attempt
 * @param {number} issueNumber
 * @param {string} planContent - the plan text
 * @param {string} status - 'started', 'completed', 'failed'
 * @param {Object} metadata - additional info (model used, error, etc.)
 */
function recordPlanExecution(issueNumber, planContent, status = "started", metadata = {}) {
    const state = getExecutionState(issueNumber);
    
    const planHash = hashPlan(planContent);
    const execution = {
        planHash,
        timestamp: new Date().toISOString(),
        status,
        ...metadata
    };
    
    // Check if this plan was already executed
    const alreadyExecuted = state.plansExecuted.some(p => p.planHash === planHash);
    
    if (!alreadyExecuted) {
        state.plansExecuted.push(execution);
    }
    
    if (status === "completed") {
        state.lastSuccessfulPlan = planHash;
        state.status = "completed";
    } else if (status === "failed") {
        state.status = "failed";
    }
    
    updateExecutionState(issueNumber, state);
    return { alreadyExecuted, execution };
}

/**
 * Check if a plan has already been executed
 * @param {number} issueNumber
 * @param {string} planContent
 * @returns {boolean}
 */
function hasBeenExecuted(issueNumber, planContent) {
    const state = getExecutionState(issueNumber);
    const planHash = hashPlan(planContent);
    return state.plansExecuted.some(p => p.planHash === planHash && p.status === "completed");
}

/**
 * Get all previously executed plan hashes
 * @param {number} issueNumber
 * @returns {Array<string>}
 */
function getExecutedPlanHashes(issueNumber) {
    const state = getExecutionState(issueNumber);
    return state.plansExecuted
        .filter(p => p.status === "completed")
        .map(p => p.planHash);
}

/**
 * Simple hash function for plan content
 * @param {string} content
 * @returns {string}
 */
function hashPlan(content) {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(content).digest("hex").substring(0, 12);
}

/**
 * Increment build attempt counter
 * @param {number} issueNumber
 */
function incrementBuildAttempt(issueNumber) {
    const state = getExecutionState(issueNumber);
    state.buildAttempts = (state.buildAttempts || 0) + 1;
    state.status = "in_progress";
    updateExecutionState(issueNumber, state);
}

/**
 * Increment plan attempt counter
 * @param {number} issueNumber
 */
function incrementPlanAttempt(issueNumber) {
    const state = getExecutionState(issueNumber);
    state.planAttempts = (state.planAttempts || 0) + 1;
    updateExecutionState(issueNumber, state);
}

/**
 * Get summary of execution state for logging
 * @param {number} issueNumber
 * @returns {string}
 */
function getStateSummary(issueNumber) {
    const state = getExecutionState(issueNumber);
    const completed = state.plansExecuted.filter(p => p.status === "completed").length;
    const failed = state.plansExecuted.filter(p => p.status === "failed").length;
    
    return `[STATE] Issue #${issueNumber}: ${state.status} | Plans: ${completed} completed, ${failed} failed | Build attempts: ${state.buildAttempts} | Plan attempts: ${state.planAttempts}`;
}

/**
 * Reset execution state (for testing or re-running)
 * @param {number} issueNumber
 */
function resetExecutionState(issueNumber) {
    const stateFile = path.join(STATE_DIR, `issue-${issueNumber}.json`);
    if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
    }
}

module.exports = {
    getExecutionState,
    updateExecutionState,
    recordPlanExecution,
    hasBeenExecuted,
    getExecutedPlanHashes,
    incrementBuildAttempt,
    incrementPlanAttempt,
    getStateSummary,
    resetExecutionState
};
