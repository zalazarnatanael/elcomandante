const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { REPO_PATH, WORKTREE_ROOT } = require('../config/constants');

function getWorktreePath(issueNumber) {
    return path.join(WORKTREE_ROOT, `issue-${issueNumber}`);
}

async function ensureWorktree(issueNumber, branch) {
    const baseRepo = simpleGit(REPO_PATH);
    const worktreePath = getWorktreePath(issueNumber);
    fs.mkdirSync(WORKTREE_ROOT, { recursive: true });

    if (!fs.existsSync(worktreePath)) {
        await baseRepo.fetch().catch(() => {});
        const existsRemote = await baseRepo.listRemote(['--heads', 'origin', branch]).then(res => res.trim().length > 0).catch(() => false);
        const baseRef = existsRemote ? `origin/${branch}` : 'origin/main';
        await baseRepo.raw(['worktree', 'add', '-B', branch, worktreePath, baseRef]);
    }

    return worktreePath;
}

async function removeWorktree(issueNumber, branch) {
    const baseRepo = simpleGit(REPO_PATH);
    const worktreePath = getWorktreePath(issueNumber);

    try {
        if (fs.existsSync(worktreePath)) {
            await baseRepo.raw(['worktree', 'remove', '--force', worktreePath]);
        }
    } catch (err) {
        console.log(`⚠️ [WORKTREE] No se pudo eliminar worktree ${worktreePath}: ${err.message}`);
    }

    try {
        await baseRepo.branch(['-D', branch]);
    } catch (err) {
        console.log(`⚠️ [WORKTREE] No se pudo borrar branch local ${branch}: ${err.message}`);
    }

    try {
        await baseRepo.push('origin', `:${branch}`);
    } catch (err) {
        console.log(`⚠️ [WORKTREE] No se pudo borrar branch remoto ${branch}: ${err.message}`);
    }
}

module.exports = {
    ensureWorktree,
    removeWorktree,
    getWorktreePath
};
