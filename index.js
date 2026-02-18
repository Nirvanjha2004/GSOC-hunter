const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// The "Fake Website" to keep the bot alive
app.get('/', (req, res) => {
  res.send('GSoC Hunter Bot is running! 🚀');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

require('dotenv').config();
const axios = require('axios');
const winston = require('winston');

// --- CONFIGURATION ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const POLL_INTERVAL = 60000; // Check every 60 seconds
const HEARTBEAT_INTERVAL = 60 * 60 * 1000; // Send "I'm alive" every 1 hour

const TARGETS = [
  { owner: 'oaiedu', repo: 'devops-opensource-agent', filters: {} },
  { owner: 'oaiedu', repo: 'assessment-platform-admin', filters: {} },
  { owner: 'oaiedu', repo: 'dora-quizz', filters: {} },
  { owner: 'learningequality', repo: 'studio', filters: { labels: 'help wanted' } },
  { owner: 'learningequality', repo: 'kolibri', filters: { labels: 'help wanted' } },
  { owner: 'learningequality', repo: 'kolibri-design-system', filters: { labels: 'help wanted' } }
];

// Initialize "lastChecked" to NOW so we don't get spammed with old issues on startup
let lastChecked = new Date().toISOString();

// Memory to store IDs of issues we have already alerted
// This prevents the bot from shouting about the same issue if a comment is added
const seenIssues = new Set();

// --- LOGGER SETUP ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'bot.log' }),
    new winston.transports.Console()
  ],
});

// --- DISCORD LOGGING HELPER ---
async function sendSystemLogToDiscord(message, type = 'INFO') {
  const colors = {
    'INFO': 3447003, // Blue
    'ERROR': 15548997, // Red
    'SUCCESS': 5763719 // Green
  };

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [{
        title: `🤖 System Log: ${type}`,
        description: message,
        color: colors[type] || 3447003,
        timestamp: new Date().toISOString()
      }]
    });
  } catch (error) {
    console.error("Failed to send log to Discord");
  }
}

// --- MAIN ENGINE ---
async function checkRepos() {
  logger.info("🔄 Starting scan cycle...");

  // 1. Capture the start time BEFORE we fetch. 
  // This ensures we don't miss issues created while the fetch is happening.
  const currentScanTime = new Date().toISOString();

  for (const target of TARGETS) {
    await fetchIssuesForRepo(target);
  }
  
  // 2. Update the global timestamp
  lastChecked = currentScanTime;
}

async function fetchIssuesForRepo(target) {
  const { owner, repo, filters } = target;
  
  try {
    const params = { state: 'open', since: lastChecked, ...filters };
    
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      headers: { 
        Authorization: `token ${GITHUB_TOKEN}`,
        // 3. Force GitHub to give us fresh data, bypassing their CDN cache
        'Cache-Control': 'no-cache',
        'If-None-Match': '' 
      },
      params: params
    });

    // 4. Filter logic: No PRs, and MUST NOT be in our "seen" memory
    const newIssues = response.data.filter(issue => {
      if (issue.pull_request) return false; // Ignore Pull Requests
      if (seenIssues.has(issue.id)) return false; // Ignore if we already saw it
      return true;
    });

    if (newIssues.length > 0) {
      logger.info(`🚨 Found ${newIssues.length} new issues in ${repo}`);
      for (const issue of newIssues) {
        // Add to memory so we don't alert again
        seenIssues.add(issue.id);
        await sendIssueAlert(issue, target);
      }
    }

    // Optional: Prune memory if it gets too big (prevent memory leaks over months)
    if (seenIssues.size > 5000) {
      seenIssues.clear();
      logger.info("🧹 Cleared internal issue cache to save memory.");
    }

  } catch (error) {
    const errorMsg = `Error checking ${owner}/${repo}: ${error.message}`;
    logger.error(errorMsg);
    
    // Only alert Discord if it's NOT a 404 (repo missing)
    if (error.response && error.response.status !== 404) {
       await sendSystemLogToDiscord(errorMsg, 'ERROR');
    }
  }
}

async function sendIssueAlert(issue, target) {
  // Calculate if this is "Freshly Created" or "Just Updated"
  const created = new Date(issue.created_at);
  const updated = new Date(issue.updated_at);
  // If the difference is small (e.g., < 2 mins), it's brand new. Otherwise, it might be an old issue with a new label.
  const isBrandNew = (updated - created) < 120000; 

  const alertTitle = isBrandNew ? `🔥 New Issue: ${target.repo}` : `🏷️ New Label/Update: ${target.repo}`;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      username: "GSoC Hunter",
      embeds: [{
        title: alertTitle,
        description: `**${issue.title}**\n[Click to View on GitHub](${issue.html_url})`,
        color: isBrandNew ? 5763719 : 16776960, // Green for new, Yellow for updates
        footer: { text: "Go solve it!" },
        timestamp: new Date().toISOString(),
        fields: [
          { name: "Labels", value: issue.labels.map(l => l.name).join(', ') || "None" }
        ]
      }]
    });
  } catch (err) {
    logger.error("Failed to send Discord alert.");
  }
}

// --- INIT ---
async function startBot() {
  const startMsg = `🚀 Bot started! Monitoring ${TARGETS.length} repos with anti-caching enabled.`;
  logger.info(startMsg);
  await sendSystemLogToDiscord(startMsg, 'SUCCESS');

  // 1. Run the Scanner every 60 seconds
  setInterval(checkRepos, POLL_INTERVAL);
  checkRepos(); // Run immediately on start

  // 2. Run the Heartbeat every 1 Hour
  setInterval(async () => {
    await sendSystemLogToDiscord("❤️ Bot is still running and healthy.", 'INFO');
  }, HEARTBEAT_INTERVAL);
}

startBot();