/**
 * Message poller for non-Claude agents (e.g. Gemini, GPT).
 * Polls the Agent Manager for pending messages and writes them to a shared file
 * that the main agent process monitors.
 *
 * Usage:
 *   SESSION_UUID=<your-agent-id> node scripts/message-poll.js
 */
const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.CM_URL || 'http://localhost:3001';
const SESSION_UUID = process.env.SESSION_UUID;
const API_KEY = (() => {
  const keyFile = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'agent-manager-key');
  return fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
})();

if (!SESSION_UUID) {
  console.error('Error: SESSION_UUID environment variable is required');
  process.exit(1);
}

async function poll() {
  while (true) {
    try {
      const response = await fetch(`${SERVER_URL}/api/agents/${SESSION_UUID}/messages?status=pending&deliver=true`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });
      if (response.ok) {
        const messages = await response.json();
        if (messages && messages.length > 0) {
          // Write to a shared command file that the main agent loop monitors
          fs.writeFileSync(path.join(__dirname, '..', '.agent_incoming_messages.json'), JSON.stringify(messages));
        }
      }
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

poll();
