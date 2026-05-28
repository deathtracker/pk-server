const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// ---- PERSONALITIES ----
const PERSONALITIES = {
  friendly: `You are PK — a highly intelligent AI assistant who talks like a close friend. You're casual, warm, sometimes funny, and always real. You use contractions, occasional slang, and you genuinely care about the user. You celebrate wins with them, keep it real when something's wrong, and never sound robotic or corporate. Still highly intelligent — just friendly about it.`,
  professional: `You are PK — a highly intelligent, professional AI assistant. You are precise, thorough, and formal. You provide structured responses with clear sections.`,
  direct: `You are PK — a highly intelligent AI assistant who is direct and no-nonsense. Short answers, no fluff. Get to the point fast.`
};

const SYSTEM_PROMPT = (personality) => `${PERSONALITIES[personality] || PERSONALITIES.friendly}

You have FOUR special abilities:

1. ANSWER ANYTHING — Answer any question with depth and accuracy. As a friend, you make complex things easy to understand.

2. WEBSITE CODER — You can read and edit the user's website files on GitHub directly.
   Use these special commands in your response:
   - [LIST_FILES] — list all website files
   - [READ_FILE:filename] — read a specific file  
   - [WRITE_FILE:filename] — save changes (followed by complete file in a code block)
   When asked to change something: read → edit → write → confirm what changed.

3. SECURITY GUARD — Monitor for threats, advise on protection, alert on issues.

4. AUTONOMOUS AGENT — You can proactively think, suggest, and act. When doing a daily check or scan, go through it step by step and report everything you find.

Always refer to yourself as PK. Be the smartest, friendliest assistant the user has ever had.`;

// ---- AUTONOMOUS TASKS ----
const AUTONOMOUS_TASKS = {
  dailyCheck: async () => {
    const messages = [{
      role: 'user',
      content: `Do a complete autonomous daily check on the user's Fantom.LX website. 
      1. Use [LIST_FILES] to see all files
      2. Check for any obvious issues
      3. Give a friendly daily report with: status, any issues found, top suggestion for today
      Keep it casual and friendly like a morning check-in from a friend.`
    }];
    return callClaude(messages, 'friendly');
  },
  securityScan: async () => {
    const messages = [{
      role: 'user',
      content: `Run an autonomous security scan. Check for: missing HTTPS headers, exposed sensitive files, common vulnerabilities. Give a security report like a friend who happens to be a security expert. Use [LIST_FILES] first.`
    }];
    return callClaude(messages, 'friendly');
  },
  improvementSuggestion: async () => {
    const messages = [{
      role: 'user',
      content: `Look at the user's Fantom.LX website files using [LIST_FILES] and [READ_FILE:index.html], then give ONE specific improvement suggestion for today. Be casual and helpful like a friend who just noticed something.`
    }];
    return callClaude(messages, 'friendly');
  }
};

// ---- SCHEDULED TASKS STATE ----
let lastDailyCheck = null;
let lastSecurityScan = null;
let lastSuggestion = null;
let pendingNotifications = [];

// Run autonomous tasks every hour
setInterval(async () => {
  const now = new Date();
  const hour = now.getHours();

  // Daily check at 9am
  if (hour === 9 && (!lastDailyCheck || new Date(lastDailyCheck).getDate() !== now.getDate())) {
    try {
      const report = await AUTONOMOUS_TASKS.dailyCheck();
      pendingNotifications.push({ type: 'daily', message: report, time: now.toISOString() });
      lastDailyCheck = now.toISOString();
    } catch(e) { console.log('Daily check error:', e.message); }
  }

  // Security scan at 2pm
  if (hour === 14 && (!lastSecurityScan || new Date(lastSecurityScan).getDate() !== now.getDate())) {
    try {
      const report = await AUTONOMOUS_TASKS.securityScan();
      pendingNotifications.push({ type: 'security', message: report, time: now.toISOString() });
      lastSecurityScan = now.toISOString();
    } catch(e) { console.log('Security scan error:', e.message); }
  }

  // Improvement suggestion at 5pm
  if (hour === 17 && (!lastSuggestion || new Date(lastSuggestion).getDate() !== now.getDate())) {
    try {
      const report = await AUTONOMOUS_TASKS.improvementSuggestion();
      pendingNotifications.push({ type: 'suggestion', message: report, time: now.toISOString() });
      lastSuggestion = now.toISOString();
    } catch(e) { console.log('Suggestion error:', e.message); }
  }
}, 60 * 60 * 1000);

// ---- CLAUDE API ----
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function callClaude(messages, personality = 'friendly') {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: SYSTEM_PROMPT(personality),
    messages
  });
  const result = await httpsRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (result.data.error) throw new Error(result.data.error.message);
  return result.data.content?.[0]?.text || 'Hey, I had trouble with that one — try again?';
}

// ---- GITHUB ----
async function githubRequest(path, method, body) {
  return httpsRequest({
    hostname: 'api.github.com',
    path,
    method: method || 'GET',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PK-Bot',
      'Content-Type': 'application/json',
      ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {})
    }
  }, body);
}

async function listFiles() {
  const result = await githubRequest(`/repos/${GITHUB_REPO}/contents/`, 'GET');
  if (result.status !== 200) throw new Error('Could not list files');
  return result.data
    .filter(f => f.name.endsWith('.html') || f.name.endsWith('.css') || f.name.endsWith('.js'))
    .map(f => f.name);
}

async function readFile(filename) {
  const result = await githubRequest(`/repos/${GITHUB_REPO}/contents/${filename}`, 'GET');
  if (result.status !== 200) throw new Error(`Could not read ${filename}`);
  return {
    content: Buffer.from(result.data.content, 'base64').toString('utf8'),
    sha: result.data.sha
  };
}

async function writeFile(filename, content) {
  const existing = await githubRequest(`/repos/${GITHUB_REPO}/contents/${filename}`, 'GET');
  const sha = existing.status === 200 ? existing.data.sha : undefined;
  const body = {
    message: `PK Bot: update ${filename}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  };
  const result = await githubRequest(`/repos/${GITHUB_REPO}/contents/${filename}`, 'PUT', body);
  if (result.status !== 200 && result.status !== 201) throw new Error(`Could not save ${filename}`);
  return true;
}

async function processCommands(text, conversationRef, personality) {
  let result = text;

  if (text.includes('[LIST_FILES]')) {
    try {
      const files = await listFiles();
      result = result.replace('[LIST_FILES]', `\n📁 **Your website files:** ${files.join(', ')}\n`);
    } catch(e) {
      result = result.replace('[LIST_FILES]', `❌ Couldn't list files: ${e.message}`);
    }
  }

  const readMatch = text.match(/\[READ_FILE:([^\]]+)\]/);
  if (readMatch) {
    const filename = readMatch[1].trim();
    try {
      const { content } = await readFile(filename);
      conversationRef.push({
        role: 'user',
        content: `Here's the current content of ${filename}:\n\`\`\`\n${content}\n\`\`\`\nNow make the requested changes and give me the complete updated file using [WRITE_FILE:${filename}].`
      });
      result = result.replace(readMatch[0], `✅ Got ${filename} — working on the changes now...`);
      const followUp = await callClaude(conversationRef, personality);
      conversationRef.push({ role: 'assistant', content: followUp });
      const processed = await processCommands(followUp, conversationRef, personality);
      return { text: result, extra: processed.text };
    } catch(e) {
      result = result.replace(readMatch[0], `❌ Couldn't read ${filename}: ${e.message}`);
    }
  }

  const writeMatch = text.match(/\[WRITE_FILE:([^\]]+)\]/);
  if (writeMatch) {
    const filename = writeMatch[1].trim();
    const codeMatch = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeMatch) {
      try {
        await writeFile(filename, codeMatch[1]);
        result = result.replace(writeMatch[0], `✅ **${filename} saved and live on GitHub!** Your website updates in ~1 minute.`);
        result = result.replace(/```[\w]*\n[\s\S]*?```/, '_[file saved ✅]_');
      } catch(e) {
        result = result.replace(writeMatch[0], `❌ Couldn't save ${filename}: ${e.message}`);
      }
    }
  }

  return { text: result };
}

// ---- HTTP SERVER ----
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const parsed = url.parse(req.url, true);

  // Status
  if (parsed.pathname === '/' || parsed.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true, status: 'PK Cloud Server running',
      ai: 'Claude Sonnet', hasKey: !!ANTHROPIC_API_KEY,
      hasGitHub: !!GITHUB_TOKEN, personality: 'friendly'
    }));
    return;
  }

  // Get pending notifications
  if (parsed.pathname === '/notifications' && req.method === 'GET') {
    const notifs = [...pendingNotifications];
    pendingNotifications = [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, notifications: notifs }));
    return;
  }

  // Run autonomous task manually
  if (parsed.pathname === '/autonomous' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { task } = JSON.parse(body);
        let result;
        if (task === 'daily') result = await AUTONOMOUS_TASKS.dailyCheck();
        else if (task === 'security') result = await AUTONOMOUS_TASKS.securityScan();
        else if (task === 'suggestion') result = await AUTONOMOUS_TASKS.improvementSuggestion();
        else throw new Error('Unknown task');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Chat
  if (parsed.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
        const { messages, personality } = JSON.parse(body);
        const p = personality || 'friendly';
        const conversationRef = [...messages];
        const reply = await callClaude(conversationRef, p);
        conversationRef.push({ role: 'assistant', content: reply });
        const { text, extra } = await processCommands(reply, conversationRef, p);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reply: text, extra }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`PK Cloud Server running on port ${PORT}`);
  console.log(`Personality: Friendly | GitHub: ${GITHUB_TOKEN ? 'Connected' : 'Not set'}`);
  console.log(`Autonomous tasks scheduled: Daily check 9am, Security scan 2pm, Suggestions 5pm`);
});
