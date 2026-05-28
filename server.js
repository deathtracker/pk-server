const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

const SYSTEM_PROMPT = `You are PK — an extraordinarily intelligent AI assistant, website manager, and coder.

You have FOUR special abilities:

1. ANSWER ANYTHING — Answer any question with depth and accuracy.

2. WEBSITE CODER — You can read and edit the user's website files on GitHub directly.
   Use these special commands in your response:
   - [LIST_FILES] — to list all website files
   - [READ_FILE:filename] — to read a specific file
   - [WRITE_FILE:filename] — followed by complete file content in a code block to save changes
   
   When asked to change something on the website:
   - First use [READ_FILE:filename] to read the current file
   - Make the requested changes
   - Use [WRITE_FILE:filename] with the complete updated content
   - Always confirm exactly what you changed

3. SECURITY GUARD — Advise on login protection, firewalls, HTTPS, SQL injection prevention, XSS, DDoS.

4. GENERAL AI — Help with any task, question, or problem.

Always refer to yourself as PK. Be intelligent, clear, and proactive.
When editing website files, always show what changed and confirm the update was saved.`;

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

async function callClaude(messages) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
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
  return result.data.content?.[0]?.text || 'Sorry I had trouble responding.';
}

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

async function processCommands(text, conversationRef) {
  let result = text;

  // LIST FILES
  if (text.includes('[LIST_FILES]')) {
    try {
      const files = await listFiles();
      result = result.replace('[LIST_FILES]', `\n📁 **Your website files:** ${files.join(', ')}\n`);
    } catch(e) {
      result = result.replace('[LIST_FILES]', `❌ Could not list files: ${e.message}`);
    }
  }

  // READ FILE
  const readMatch = text.match(/\[READ_FILE:([^\]]+)\]/);
  if (readMatch) {
    const filename = readMatch[1].trim();
    try {
      const { content } = await readFile(filename);
      conversationRef.push({
        role: 'user',
        content: `Here is the current content of ${filename}:\n\`\`\`\n${content}\n\`\`\`\nNow please make the requested changes and provide the complete updated file content using [WRITE_FILE:${filename}] followed by the full updated code in a code block.`
      });
      result = result.replace(readMatch[0], `✅ Read ${filename} — generating updated version...`);
      const followUp = await callClaude(conversationRef);
      conversationRef.push({ role: 'assistant', content: followUp });
      const processed = await processCommands(followUp, conversationRef);
      return { text: result, extra: processed };
    } catch(e) {
      result = result.replace(readMatch[0], `❌ Could not read ${filename}: ${e.message}`);
    }
  }

  // WRITE FILE
  const writeMatch = text.match(/\[WRITE_FILE:([^\]]+)\]/);
  if (writeMatch) {
    const filename = writeMatch[1].trim();
    const codeMatch = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeMatch) {
      try {
        await writeFile(filename, codeMatch[1]);
        result = result.replace(writeMatch[0], `✅ **${filename} saved and pushed to GitHub!** Your live website at https://${GITHUB_REPO.split('/')[0]}.github.io/${GITHUB_REPO.split('/')[1]} will update in ~1 minute.`);
        result = result.replace(/```[\w]*\n[\s\S]*?```/, '_[file content saved]_');
      } catch(e) {
        result = result.replace(writeMatch[0], `❌ Could not save ${filename}: ${e.message}`);
      }
    }
  }

  return { text: result };
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/' || parsed.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: 'PK Cloud Server running', ai: 'Claude Sonnet', hasKey: !!ANTHROPIC_API_KEY, hasGitHub: !!GITHUB_TOKEN }));
    return;
  }

  if (parsed.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
        const { messages } = JSON.parse(body);
        const conversationRef = [...messages];
        const reply = await callClaude(conversationRef);
        conversationRef.push({ role: 'assistant', content: reply });
        const { text, extra } = await processCommands(reply, conversationRef);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reply: text, extra: extra?.text }));
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
  console.log(`API Key: ${ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`GitHub: ${GITHUB_TOKEN ? 'SET' : 'NOT SET'} | Repo: ${GITHUB_REPO || 'NOT SET'}`);
});
