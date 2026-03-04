const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { REPO_PATH, WORKTREE_ROOT, ALLOWED_EDIT_PATHS } = require("../config/constants");
const { incrementBuildAttempt, incrementPlanAttempt, recordPlanExecution, getStateSummary } = require("./executionStateManager");

const LOGS_DIR = path.join(__dirname, "../session_logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

async function runOpenCode(issueNumber, instruction, isProgrammer = false, options = {}) {
    const sessionId = options.sessionId || `ses-ferreteria-i${issueNumber}`;
    
    // Log execution state
    if (isProgrammer) {
        incrementBuildAttempt(issueNumber);
        console.log(`🤖 [BUILD] Starting build attempt for issue #${issueNumber}`);
    } else {
        incrementPlanAttempt(issueNumber);
        console.log(`🤖 [PLANNER] Starting plan attempt for issue #${issueNumber}`);
    }
    console.log(getStateSummary(issueNumber));
    
    const planner = !isProgrammer ? getPlannerConfig(instruction, options) : null;
    const buildOverride = options.buildModelOverride ? String(options.buildModelOverride).trim() : null;
    const baseCmd = buildBaseCommand(isProgrammer, isProgrammer ? buildOverride : planner?.model);
    const cwd = options.cwd || REPO_PATH;
    const allowedRoots = ALLOWED_EDIT_PATHS || [WORKTREE_ROOT].filter(Boolean);
    if (allowedRoots.length > 0) {
        const isAllowed = allowedRoots.some(root => cwd.startsWith(root));
        if (!isAllowed) {
            throw new Error(`CWD no permitido para edición: ${cwd}`);
        }
    }
    const tempPath = path.join(cwd, `.prompt-${issueNumber}.txt`);
    
    fs.writeFileSync(tempPath, instruction);

    return new Promise((resolve) => {
        const sessionArgs = options.continue === false ? "" : ` --session "${sessionId}" --continue`;
        const suffix = options.logSuffix ? `.${options.logSuffix}` : "";
        const logFile = path.join(LOGS_DIR, `issue-${issueNumber}${suffix}.log`);

        const runOnce = (cmdBase, attemptLabel, useSession = true) => new Promise((res) => {
            const sessionPart = useSession ? sessionArgs : "";
            const command = `${cmdBase} "$(cat ${tempPath})"${sessionPart} --dir "${cwd}"`;
            const proc = spawn(command, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: true });

            let history = "";
            proc.stdout.on('data', (d) => { history += d; process.stdout.write(d); });
            proc.stderr.on('data', (d) => { history += d; process.stderr.write(d); });

            proc.on("close", () => {
                const traceHeader = options.traceId ? `\n--- TRACE: ${options.traceId} ---\n` : "\n";
                const attemptHeader = attemptLabel ? `\n--- ATTEMPT: ${attemptLabel} ---\n` : "\n";
                fs.appendFileSync(logFile, `\n\n--- EXEC: ${new Date().toISOString()} ---${traceHeader}${attemptHeader}${history}\n`);
                res(history);
            });
        });

        const runSequence = async () => {
            const firstHistory = await runOnce(
                baseCmd,
                isProgrammer
                    ? `build-model=${buildOverride || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5"}`
                    : (planner?.model ? `plan-model=${planner.model}` : null)
            );

            // CRITICAL: In PLAN mode, abort if any file modifications were attempted
            if (!isProgrammer) {
                const writeCheck = detectWriteAttempts(firstHistory);
                if (writeCheck.hasViolation) {
                    console.error(`🛑 [PLAN MODE VIOLATION] Attempted to modify files in read-only plan mode!`);
                    writeCheck.violations.forEach(v => console.error(`   ${v}`));
                    console.error(`🛑 [PLAN MODE] Aborting execution and trying fallback model to enforce read-only constraint`);
                    
                    // Force fallback to ensure plan stays read-only
                    const fallbackModel = selectFallbackPlannerModel(planner);
                    if (fallbackModel) {
                        console.log(`🤖 [PLAN] Enforced fallback to: ${fallbackModel} (due to write violation)`);
                        const fallbackCmd = buildBaseCommand(false, fallbackModel);
                        const secondHistory = await runOnce(fallbackCmd, `plan-fallback-write-violation`, false);
                        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                        const cleanedOutput = cleanOutput(secondHistory);
                        recordPlanExecution(issueNumber, instruction, "completed", {
                            model: fallbackModel,
                            wasFallback: true,
                            reason: "write_violation_detected",
                            outputLength: cleanedOutput.length
                        });
                        resolve(cleanedOutput);
                        return;
                    }
                }
            }

            if (!shouldFallbackToPlanner(firstHistory, planner, { ...options, isBuildMode: isProgrammer })) {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                const cleanedOutput = cleanOutput(firstHistory);
                
                // Record plan execution if it's a planner mode
                if (!isProgrammer) {
                    recordPlanExecution(issueNumber, instruction, "completed", {
                        model: planner?.model,
                        outputLength: cleanedOutput.length
                    });
                }
                
                resolve(cleanedOutput);
                return;
            }

            let fallbackModel = null;
            let fallbackLabel = null;
            
            if (isProgrammer) {
                const currentModel = buildOverride || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5";
                fallbackModel = options.buildModelFallback || selectFallbackBuildModel(currentModel);
                fallbackLabel = fallbackModel ? `fallback-build-model=${fallbackModel}` : null;
            } else {
                fallbackModel = options.plannerModelFallback || process.env.PLANNER_FALLBACK_MODEL || selectFallbackPlannerModel(planner);
                fallbackLabel = fallbackModel ? `fallback-planner-model=${fallbackModel}` : null;
            }

            if (!fallbackModel) {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                const cleanedOutput = cleanOutput(firstHistory);
                
                // Record plan execution as failed if no fallback available
                if (!isProgrammer) {
                    recordPlanExecution(issueNumber, instruction, "failed", {
                        model: planner?.model,
                        reason: "no_fallback_available"
                    });
                }
                
                resolve(cleanedOutput);
                return;
            }

            const fallbackCmd = buildBaseCommand(isProgrammer, fallbackModel);
            const modeLabel = isProgrammer ? "[BUILD]" : "[PLANNER]";
            console.log(`🤖 ${modeLabel} Fallback model: ${fallbackModel}`);
            const secondHistory = await runOnce(fallbackCmd, fallbackLabel, false);

            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            const cleanedOutput = cleanOutput(secondHistory);
            
            // Record plan execution for fallback
            if (!isProgrammer) {
                recordPlanExecution(issueNumber, instruction, "completed", {
                    model: fallbackModel,
                    wasFallback: true,
                    outputLength: cleanedOutput.length
                });
            }
            
            resolve(cleanedOutput);
        };

        runSequence().catch(() => {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            resolve("");
        });
    });
}

function buildBaseCommand(isProgrammer, model) {
    if (isProgrammer) {
        const buildModel = model || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5";
        return `opencode --model "${buildModel}" run`;
    }

    const base = `opencode run`;
    if (!model) return base;

    return `${base} --model "${model}"`;
}

function overridePlannerModel(modelOverride) {
    if (!modelOverride) return null;
    return String(modelOverride).trim() || null;
}

function getPlannerConfig(instruction, options = {}) {
    const normalized = (instruction || "").toLowerCase();
    const isPlan = options.forcePlanner
        || normalized.includes("### 📋 plan")
        || normalized.includes("plan:")
        || normalized.includes("plan ")
        || normalized.includes("planificacion")
        || normalized.includes("planificación")
        || normalized.includes("plan técnico")
        || normalized.includes("plan tecnico");

    if (!isPlan) return null;

    const provider = (process.env.PLANNER_PROVIDER || "auto").toLowerCase();
    const profile = (process.env.PLANNER_PROFILE || "fast").toLowerCase();
    const overrideModel = overridePlannerModel(options.plannerModelOverride) || process.env.PLANNER_MODEL;

    const model = overrideModel || selectPlannerModel(provider, profile);
    if (!model) return null;

    console.log(`🤖 [PLANNER] Using model: ${model} (provider=${provider}, profile=${profile})`);
    return { model, provider, profile };
}

function selectPlannerModel(provider, profile) {
    const presets = {
        fast: "opencode/trinity-large-preview-free",
        balanced: "opencode/trinity-large-preview-free"
    };

    if (provider && provider !== "auto") return presets[profile] || presets.fast;
    return presets[profile] || presets.fast;
}

function shouldFallbackToPlanner(history, planner, options = {}) {
    if (!planner && !options.isBuildMode) return false;
    if (options.disablePlannerFallback) return false;

    const text = (history || "").toLowerCase();
    return (
        text.includes("model not found")
        || text.includes("providermodelnotfounderror")
        || text.includes("provider not found")
        || text.includes("request too large")
        || text.includes("tpm")
    );
}

function selectFallbackPlannerModel(planner) {
    if (!planner) return null;
    const model = planner.model || "";
    if (model === "opencode/trinity-large-preview-free") return "opencode/minimax-m2.5-free";
    if (model === "opencode/minimax-m2.5-free") return "opencode/big-pickle";
    return null;
}

function selectFallbackBuildModel(currentModel) {
    if (currentModel === "github-copilot/claude-haiku-4.5") return "opencode/trinity-large-preview-free";
    if (currentModel === "opencode/trinity-large-preview-free") return "opencode/minimax-m2.5-free";
    return null;
}

/**
 * Check if output contains file modification attempts (Edit, Write, Delete)
 * Used to enforce read-only mode during planning phase
 * @param {string} text - output to check
 * @returns {Object} { hasViolation: boolean, violations: string[] }
 */
function detectWriteAttempts(text) {
    const violations = [];
    
    const editPatterns = [
        /←\s*Edit\s+/i,                 // ← Edit file
        /^-\s+if\s+\(/,                 // Diff line starting with "-" (file change)
        /^\+\s+if\s+\(/,                 // Diff line starting with "+" (file addition)
        /^Index:\s+/i,                   // Index: /path/to/file (diff header)
        /^===+$/,                        // ===== (diff separator)
        /^---\s+/,                       // --- /path (old file marker)
        /^\+\+\+\s+/,                    // +++ /path (new file marker)
        /←\s*Write\b/i,                  // ← Write file
        /←\s*Delete\b/i                  // ← Delete file
    ];
    
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of editPatterns) {
            if (pattern.test(line)) {
                violations.push(`Line ${i + 1}: ${line.substring(0, 80)}`);
                break;
            }
        }
    }
    
    return {
        hasViolation: violations.length > 0,
        violations
    };
}

function cleanOutput(text) {
    const noAnsi = text.replace(/\u001b\[[0-9;]*m/g, "");
    
    // First pass: Remove all agent tool output lines
    const toolOutputPatterns = [
        /^→\s*Read\b.*/i,           // → Read file.ts
        /^←\s*Edit\b.*/i,           // ← Edit file.ts
        /^>\s*Write\b.*/i,          // > Write file.ts
        /^✱\s*Grep\b.*/i,           // ✱ Grep "pattern"
        /^✱\s*Glob\b.*/i,           // ✱ Glob "*.ts"
        /^⚙\s*\w+/i,                // ⚙ RunCommand
        /^Index:\s*/i,              // Index: /path/to/file
        /^===+$/,                    // ========= (diff separator)
        /^---\s+.*$/,                // --- /path/to/file
        /^\+\+\+\s+.*$/,             // +++ /path/to/file
        /^@@\s+-.*\+.*@@/,           // @@ -1,5 +1,6 @@ (diff hunk header)
        /^-\s+\w+/,                  // -  content (diff line, but not "---")
        /^\+\s+\w+/,                 // +  content (diff line, but not "+++")
        /^\s*sh:\s*\d+:/i,           // sh: 1: command not found
        /^npm\s+(warn|error)/i,      // npm warn or npm error
        /^Oops!\s+Something/i,       // ESLint errors
        /^error\s+TS\d+:/i,          // TypeScript errors (but keep in logs)
        /^>\s+build\s+·/i,           // > build · model-name
        /^>\s+programmer\s+·/i,      // > programmer · model-name
        /^>\s+\w+\s+·\s+\w+/i        // > agent · model (generic)
    ];
    
    // Second pass: Find the last plan marker (## Plan, ### Plan, Plan técnico, etc.)
    const planHeaderPatterns = [
        /^#+\s*📋.*Plan/i,           // ### 📋 Plan...
        /^##\s+Plan\s+técnico/i,     // ## Plan técnico...
        /^##\s+Plan\s+actualizado/i, // ## Plan actualizado...
        /^#\s+Plan\s+técnico/i,      // # Plan técnico...
    ];
    
    let lines = noAnsi.split("\n");
    
    // Filter out tool output lines
    lines = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        
        // Check if line matches any tool output pattern
        for (const pattern of toolOutputPatterns) {
            if (pattern.test(trimmed)) return false;
        }
        
        // Remove lines that are obvious model prompts or commands
        if (/^¿?Quer[eé]s? que ejecute/i.test(trimmed)) return false;
        if (/^¿?Quieres que ejecute/i.test(trimmed)) return false;
        if (/^Necesito permiso para editar/i.test(trimmed)) return false;
        if (/^[✱→⚙]/.test(trimmed.charAt(0))) return false;
        
        // Remove model role indicators
        const dequoted = trimmed.replace(/^>\s*/, "");
        if (dequoted === "build · gpt-5.2-codex") return false;
        if (dequoted === "programmer · gpt-5.2-codex") return false;
        if (/^(build|programmer) · /i.test(dequoted)) return false;
        
        return true;
    });
    
    // Third pass: Find the last plan header and keep only from that point
    let lastPlanIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        for (const pattern of planHeaderPatterns) {
            if (pattern.test(lines[i])) {
                lastPlanIndex = i;
                break;
            }
        }
        if (lastPlanIndex !== -1) break;
    }
    
    // If we found a plan header, keep only from that point onwards
    if (lastPlanIndex !== -1) {
        lines = lines.slice(lastPlanIndex);
    }
    
    // Fourth pass: Remove trailing empty lines and rejoin
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
        lines.pop();
    }
    
    return lines.join("\n").trim();
}

module.exports = { runOpenCode };
