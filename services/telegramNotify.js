const fs = require('fs');
const path = require('path');
const https = require('https');
const { TELEGRAM_CHAT_ID } = require('../config/constants');

let cachedConfig = null;

function loadOpenClawTelegramConfig() {
    if (cachedConfig) return cachedConfig;
    try {
        const baseDir = path.join(__dirname, '..');
        const configPath = path.join(baseDir, 'openclaw.json');
        const raw = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(raw);
        const token = config?.channels?.telegram?.botToken || '';

        let chatId = '';
        const sessionsPath = path.join(baseDir, 'agents', 'main', 'sessions', 'sessions.json');
        if (fs.existsSync(sessionsPath)) {
            const sessionsRaw = fs.readFileSync(sessionsPath, 'utf8');
            const sessions = JSON.parse(sessionsRaw);
            const entries = Object.values(sessions);
            const match = entries.find(e => e?.deliveryContext?.channel === 'telegram' && typeof e?.deliveryContext?.to === 'string');
            if (match && match.deliveryContext.to.includes(':')) {
                chatId = match.deliveryContext.to.split(':')[1] || '';
            }
        }

        cachedConfig = { token, chatId };
        return cachedConfig;
    } catch (err) {
        cachedConfig = { token: '', chatId: '' };
        return cachedConfig;
    }
}

function sendTelegramMessage(message) {
    const openClawConfig = loadOpenClawTelegramConfig();
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.OPENCLAW_TELEGRAM_BOT_TOKEN || openClawConfig.token;
    const chatId = TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || process.env.OPENCLAW_TELEGRAM_CHAT_ID || openClawConfig.chatId;

    if (!token || !chatId) {
        console.log('⚠️ [TELEGRAM] Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.');
        return Promise.resolve(false);
    }

    const payload = JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true
    });

    return new Promise(resolve => {
        const req = https.request({
            method: 'POST',
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendMessage`,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, res => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
        });

        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

module.exports = {
    sendTelegramMessage
};
