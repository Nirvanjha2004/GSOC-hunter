const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// The "Fake Website"
app.get('/', (req, res) => {
  res.send('GSoC Hunter Bot is running! 🚀');
});

// Keep the server alive
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
  { owner: 'PalisadoesFoundation', repo: 'talawa-admin', filters: { assignee: 'none' } }
];

let lastChecked = new Date().toISOString();

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
// Only sends important system messages, not "scanning..." noise
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

  for (const target of TARGETS) {
    await fetchIssuesForRepo(target);
  }
  
  lastChecked = new Date().toISOString();
}

async function fetchIssuesForRepo(target) {
  const { owner, repo, filters } = target;
  
  try {
    const params = { state: 'open', since: lastChecked, ...filters };
    
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
      params: params
    });

    const newIssues = response.data.filter(i => !i.pull_request);

    if (newIssues.length > 0) {
      logger.info(`🚨 Found ${newIssues.length} issues in ${repo}`);
      for (const issue of newIssues) {
        await sendIssueAlert(issue, target);
      }
    }

  } catch (error) {
    const errorMsg = `Error checking ${owner}/${repo}: ${error.message}`;
    logger.error(errorMsg);
    
    // 🔥 Send ERROR to Discord so you know something is wrong
    if (error.response && error.response.status !== 404) {
       await sendSystemLogToDiscord(errorMsg, 'ERROR');
    }
  }
}

async function sendIssueAlert(issue, target) {
  await axios.post(DISCORD_WEBHOOK_URL, {
    username: "GSoC Hunter",
    embeds: [{
      title: `🔥 New Issue: ${target.repo}`,
      description: `**${issue.title}**\n[Click to View](${issue.html_url})`,
      color: 5763719,
      footer: { text: "Go solve it!" },
      timestamp: new Date().toISOString()
    }]
  });
}

// --- INIT ---
async function startBot() {
  const startMsg = `🚀 Bot started on Laptop! Monitoring ${TARGETS.length} repos.`;
  logger.info(startMsg);
  await sendSystemLogToDiscord(startMsg, 'SUCCESS');

  // 1. Run the Scanner every 60 seconds
  setInterval(checkRepos, POLL_INTERVAL);
  checkRepos();

  // 2. Run the Heartbeat every 1 Hour
  setInterval(async () => {
    await sendSystemLogToDiscord("❤️ I am still running properly.", 'INFO');
  }, HEARTBEAT_INTERVAL);
}

startBot();