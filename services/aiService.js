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
    const baseCmd = buildBaseCommand(isProgrammer, planner?.model);
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
                isProgrammer ? `build-model=${process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5"}` : (planner?.model ? `plan-model=${planner.model}` : null)
            );

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
                const currentModel = process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5";
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
    const overrideModel = process.env.PLANNER_MODEL;

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

function cleanOutput(text) {
    const noAnsi = text.replace(/\u001b\[[0-9;]*m/g, "");
    
    // Remove everything before "Plan técnico actualizado:" or "Plan actualizado" or similar markers
    const planMarkerMatch = noAnsi.match(/###\s*📋\s*(Plan|plan)[^\n]*/i);
    let textToProcess = noAnsi;
    
    if (planMarkerMatch && planMarkerMatch.index) {
        // Find the last occurrence of plan markers to keep only the final plan
        const lastPlanMatch = noAnsi.lastIndexOf("###");
        if (lastPlanMatch !== -1) {
            textToProcess = noAnsi.substring(lastPlanMatch);
        }
    }
    
    return textToProcess
        .split("\n")
        .filter(line => {
            const trimmed = line.trim();
            const dequoted = trimmed.replace(/^>\s*/, "");
            if (!trimmed) return false;
            if (dequoted === "build · gpt-5.2-codex") return false;
            if (dequoted === "programmer · gpt-5.2-codex") return false;
            if (/^(build|programmer) · /i.test(dequoted)) return false;
            if (/^¿?Quer[eé]s? que ejecute/i.test(dequoted)) return false;
            if (/^¿?Quieres que ejecute/i.test(dequoted)) return false;
            if (/^Necesito permiso para editar/i.test(dequoted)) return false;
            if (/^[✱→⚙]/.test(dequoted)) return false;
            if (/^Read\b/.test(dequoted)) return false;
            if (/^Grep\b/.test(dequoted)) return false;
            if (/^Glob\b/.test(dequoted)) return false;
            if (/apply_patch/i.test(dequoted)) return false;
            return true;
        })
        .join("\n")
        .trim();
}

module.exports = { runOpenCode };
