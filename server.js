const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

const PERSONALITIES = {
  friendly: `You are PK — a highly intelligent AI who talks like a close friend. Casual, warm, funny, and real. You use contractions and slang but stay smart. You celebrate wins, keep it real when things go wrong, and never sound robotic.`,
  professional: `You are PK — a highly intelligent, professional AI assistant. Precise, thorough, and formal with structured responses.`,
  direct: `You are PK — direct and no-nonsense. Short answers, no fluff. Get to the point fast.`
};

const SYSTEM_PROMPT = (personality) => `${PERSONALITIES[personality]||PERSONALITIES.friendly}

ABILITIES:
1. ANSWER ANYTHING — Answer with depth and accuracy. Explain complex things simply.
2. ANALYZE FILES — When given images, PDFs, or documents, analyze them thoroughly and answer questions about them.
3. WEBSITE CODER — Read and edit GitHub files directly:
   [LIST_FILES] — list website files
   [READ_FILE:filename] — read a file
   [WRITE_FILE:filename] — save changes with full file in code block
4. SECURITY GUARD — Monitor threats, advise on protection.
5. STUDY HELPER — Help students understand notes, create summaries, flashcards, quiz questions from uploaded content.
6. CODE EXPERT — Write, debug, and explain code in any language.
7. AUTONOMOUS AGENT — Think and act proactively. Do daily checks and suggest improvements.

Always refer to yourself as PK.`;

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
  return result.data.content?.[0]?.text || 'Hey, try that again?';
}

async function githubRequest(path, method, body) {
  return httpsRequest({
    hostname: 'api.github.com',
    path, method: method || 'GET',
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
  return result.data.filter(f => ['.html','.css','.js','.json','.md'].some(ext => f.name.endsWith(ext))).map(f => f.name);
}

async function readFile(filename) {
  const result = await githubRequest(`/repos/${GITHUB_REPO}/contents/${filename}`, 'GET');
  if (result.status !== 200) throw new Error(`Could not read ${filename}`);
  return { content: Buffer.from(result.data.content, 'base64').toString('utf8'), sha: result.data.sha };
}

async function writeFile(filename, content) {
  const existing = await githubRequest(`/repos/${GITHUB_REPO}/contents/${filename}`, 'GET');
  const sha = existing.status === 200 ? existing.data.sha : undefined;
  const body = { message: `PK Bot: update ${filename}`, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) };
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
    } catch(e) { result = result.replace('[LIST_FILES]', `❌ Couldn't list files: ${e.message}`); }
  }
  const readMatch = text.match(/\[READ_FILE:([^\]]+)\]/);
  if (readMatch) {
    const filename = readMatch[1].trim();
    try {
      const { content } = await readFile(filename);
      conversationRef.push({ role: 'user', content: `Here is ${filename}:\n\`\`\`\n${content}\n\`\`\`\nNow make the requested changes and provide the complete updated file using [WRITE_FILE:${filename}].` });
      result = result.replace(readMatch[0], `✅ Got ${filename} — making changes now...`);
      const followUp = await callClaude(conversationRef, personality);
      conversationRef.push({ role: 'assistant', content: followUp });
      const processed = await processCommands(followUp, conversationRef, personality);
      return { text: result, extra: processed.text };
    } catch(e) { result = result.replace(readMatch[0], `❌ Couldn't read ${filename}: ${e.message}`); }
  }
  const writeMatch = text.match(/\[WRITE_FILE:([^\]]+)\]/);
  if (writeMatch) {
    const filename = writeMatch[1].trim();
    const codeMatch = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeMatch) {
      try {
        await writeFile(filename, codeMatch[1]);
        result = result.replace(writeMatch[0], `✅ **${filename} saved and live on GitHub!** Updates in ~1 minute.`);
        result = result.replace(/```[\w]*\n[\s\S]*?```/, '_[file saved ✅]_');
      } catch(e) { result = result.replace(writeMatch[0], `❌ Couldn't save: ${e.message}`); }
    }
  }
  return { text: result };
}

// Autonomous tasks
const AUTONOMOUS_TASKS = {
  daily: async () => callClaude([{ role: 'user', content: `Do a friendly daily check on the user's Fantom.LX website. Use [LIST_FILES] to check what's there. Give a casual morning report: status, any issues, top tip for today.` }], 'friendly'),
  security: async () => callClaude([{ role: 'user', content: `Run an autonomous security scan. Use [LIST_FILES] first. Check for vulnerabilities. Give a casual but thorough security report.` }], 'friendly'),
  suggestion: async () => callClaude([{ role: 'user', content: `Check the user's Fantom.LX website files using [LIST_FILES] and give ONE specific improvement suggestion today. Be casual and helpful.` }], 'friendly')
};

let pendingNotifications = [];
let lastChecks = { daily: null, security: null, suggestion: null };

setInterval(async () => {
  const now = new Date();
  const h = now.getHours();
  const today = now.toDateString();
  if (h === 9 && lastChecks.daily !== today) {
    try { pendingNotifications.push({ type: 'daily', message: await AUTONOMOUS_TASKS.daily(), time: now.toISOString() }); lastChecks.daily = today; } catch(e) {}
  }
  if (h === 14 && lastChecks.security !== today) {
    try { pendingNotifications.push({ type: 'security', message: await AUTONOMOUS_TASKS.security(), time: now.toISOString() }); lastChecks.security = today; } catch(e) {}
  }
  if (h === 17 && lastChecks.suggestion !== today) {
    try { pendingNotifications.push({ type: 'suggestion', message: await AUTONOMOUS_TASKS.suggestion(), time: now.toISOString() }); lastChecks.suggestion = today; } catch(e) {}
  }
}, 60 * 60 * 1000);

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

http.createServer((req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/' || parsed.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: 'PK running', ai: 'Claude Sonnet', hasKey: !!ANTHROPIC_API_KEY, hasGitHub: !!GITHUB_TOKEN }));
    return;
  }

  if (parsed.pathname === '/notifications') {
    const n = [...pendingNotifications]; pendingNotifications = [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, notifications: n }));
    return;
  }

  if (parsed.pathname === '/autonomous' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { task } = JSON.parse(body);
        const result = await AUTONOMOUS_TASKS[task]();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (parsed.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('API key not set');
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
}).listen(PORT, () => {
  console.log(`PK Server running on port ${PORT}`);
  console.log(`GitHub: ${GITHUB_TOKEN ? 'Connected' : 'Not set'}`);
});
