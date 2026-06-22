// =============================================
//  PK BOT — MASTER SERVER (Combined)
//  Has EVERYTHING:
//  - PK Bot chat + streaming
//  - GitHub website editing
//  - File analysis (images, PDFs, docs)
//  - After Effects scripts
//  - Discord bot
//  - Autonomous tasks
//  - PK TUTOR mode (Network+)
// =============================================

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// ============================================================
//  PERSONALITIES
// ============================================================
const PERSONALITIES = {
  friendly: `You are PK — a highly intelligent AI who talks like a close friend to AB (Anderson Bernard / "Fade"). Casual, warm, funny, real. Use contractions and stay smart. Celebrate wins, keep it real when things go wrong. Never robotic.`,
  professional: `You are PK — a highly intelligent, professional AI. Precise, thorough, formal with structured responses.`,
  direct: `You are PK — direct and no-nonsense. Short answers, no fluff.`
};

const SYSTEM_PROMPT = (p) => `${PERSONALITIES[p] || PERSONALITIES.friendly}

YOUR ABILITIES:
1. ANSWER ANYTHING — deeply and accurately. Make complex things simple.
2. ANALYZE FILES — images, PDFs, documents. Describe and answer questions about them.
3. WEBSITE CODER — read and edit GitHub files:
   [LIST_FILES] — list all website files
   [READ_FILE:filename] — read a specific file
   [WRITE_FILE:filename] — save file (put full content in code block after)
4. SECURITY GUARD — advise on protection, scan for threats.
5. AFTER EFFECTS EXPERT — write complete ExtendScript (.jsx) scripts.
6. CODE EXPERT — write, debug, explain code in any language.
7. STUDY HELPER — summaries, flashcards, quizzes from uploaded content.
8. AUTONOMOUS AGENT — proactive daily checks and suggestions.

Always refer to yourself as PK.`;

// ============================================================
//  TUTOR MODE (Network+ N10-009)
// ============================================================
const TUTOR_PROMPT = `You are PK — a CompTIA Network+ (N10-009) tutor who talks like AB's smart friend who knows networking inside out.

YOUR STUDENT: AB (Anderson Bernard / "Fade") — Software & Network Engineering student at Palm Beach State College.

YOUR EXPERTISE — N10-009 Exam Objectives:
1.0 Networking Concepts (23%) — OSI model, ports/protocols, IP addressing, NAT/PAT
2.0 Network Implementation (20%) — routing, switching, wireless, VLANs, OSPF/BGP/EIGRP/RIP
3.0 Network Operations (19%) — documentation, monitoring (SNMP, syslog, NetFlow)
4.0 Network Security (14%) — encryption, authentication, ACLs, zero trust, IDS/IPS
5.0 Network Troubleshooting (24%) — methodology, ping, traceroute, Wireshark, iperf

DEEP KNOWLEDGE: Wireshark filters & protocols, subnetting & VLSM, Cisco IOS, common ports (FTP 21, SSH 22, Telnet 23, SMTP 25, DNS 53, DHCP 67/68, HTTP 80, HTTPS 443), IPv4/IPv6 headers.

HOW YOU TEACH:
- Give the ANSWER first, then explain WHY
- Match AB's casual energy
- When AB shows a lab screenshot, identify the platform (uCertify, TestOut) and walk through it
- Use mnemonics ("Please Do Not Throw Sausage Pizza Away" for OSI)
- Connect concepts to previous lessons`;

// ============================================================
//  CLAUDE API
// ============================================================
function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
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

async function callClaude(messages, personality = 'friendly', useTutor = false) {
  const system = useTutor ? TUTOR_PROMPT : SYSTEM_PROMPT(personality);
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system,
    messages
  });
  const result = await httpsReq({
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
  return result.data.content?.[0]?.text || 'Try that again?';
}

function streamClaude(messages, personality, useTutor, onToken, onDone, onError) {
  const system = useTutor ? TUTOR_PROMPT : SYSTEM_PROMPT(personality || 'friendly');
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    stream: true,
    system,
    messages
  });
  const req = https.request({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  }, (res) => {
    let fullText = '', buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === 'content_block_delta' && d.delta?.text) {
              fullText += d.delta.text;
              onToken(d.delta.text);
            }
          } catch(e) {}
        }
      }
    });
    res.on('end', () => onDone(fullText));
    res.on('error', onError);
  });
  req.on('error', onError);
  req.write(body);
  req.end();
}

// ============================================================
//  GITHUB
// ============================================================
async function ghReq(path, method, body) {
  return httpsReq({
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
  const r = await ghReq(`/repos/${GITHUB_REPO}/contents/`, 'GET');
  if (r.status !== 200) throw new Error('Could not list files');
  return r.data.filter(f => ['.html','.css','.js','.json','.md'].some(e => f.name.endsWith(e))).map(f => f.name);
}

async function readFile(filename) {
  const r = await ghReq(`/repos/${GITHUB_REPO}/contents/${filename}`, 'GET');
  if (r.status !== 200) throw new Error(`Could not read ${filename}`);
  return { content: Buffer.from(r.data.content, 'base64').toString('utf8'), sha: r.data.sha };
}

async function writeFile(filename, content) {
  const ex = await ghReq(`/repos/${GITHUB_REPO}/contents/${filename}`, 'GET');
  const sha = ex.status === 200 ? ex.data.sha : undefined;
  const body = { message: `PK Bot: update ${filename}`, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) };
  const r = await ghReq(`/repos/${GITHUB_REPO}/contents/${filename}`, 'PUT', body);
  if (r.status !== 200 && r.status !== 201) throw new Error(`Could not save ${filename}`);
  return true;
}

async function processCommands(text, convRef, personality) {
  let result = text;
  if (text.includes('[LIST_FILES]')) {
    try { const files = await listFiles(); result = result.replace('[LIST_FILES]', `\n📁 **Your website files:** ${files.join(', ')}\n`); }
    catch(e) { result = result.replace('[LIST_FILES]', `❌ Couldn't list: ${e.message}`); }
  }
  const rm = text.match(/\[READ_FILE:([^\]]+)\]/);
  if (rm) {
    const fn = rm[1].trim();
    try {
      const { content } = await readFile(fn);
      convRef.push({ role: 'user', content: `Here is ${fn}:\n\`\`\`\n${content}\n\`\`\`\nNow make the requested changes and return the complete updated file using [WRITE_FILE:${fn}].` });
      result = result.replace(rm[0], `✅ Got ${fn} — making changes now...`);
      const fu = await callClaude(convRef, personality);
      convRef.push({ role: 'assistant', content: fu });
      const p2 = await processCommands(fu, convRef, personality);
      return { text: result, extra: p2.text };
    } catch(e) { result = result.replace(rm[0], `❌ Couldn't read ${fn}: ${e.message}`); }
  }
  const wm = text.match(/\[WRITE_FILE:([^\]]+)\]/);
  if (wm) {
    const fn = wm[1].trim();
    const cm = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (cm) {
      try {
        await writeFile(fn, cm[1]);
        result = result.replace(wm[0], `✅ **${fn} saved to GitHub!** Live in ~1 min.`);
        result = result.replace(/```[\w]*\n[\s\S]*?```/, '_[file saved ✅]_');
      } catch(e) { result = result.replace(wm[0], `❌ Couldn't save: ${e.message}`); }
    }
  }
  return { text: result };
}

// ============================================================
//  AUTONOMOUS TASKS
// ============================================================
const TASKS = {
  daily: () => callClaude([{ role: 'user', content: `Do a friendly daily check on Fantom.LX. Use [LIST_FILES]. Casual morning report.` }], 'friendly'),
  security: () => callClaude([{ role: 'user', content: `Run a security scan on Fantom.LX. Use [LIST_FILES] first. Casual but thorough.` }], 'friendly'),
  suggestion: () => callClaude([{ role: 'user', content: `Check Fantom.LX using [LIST_FILES] and give ONE specific improvement suggestion.` }], 'friendly')
};

let pendingNotifications = [], lastChecks = {};
setInterval(async () => {
  const h = new Date().getHours(), today = new Date().toDateString();
  if (h === 9 && lastChecks.daily !== today) { try { pendingNotifications.push({ type: 'daily', message: await TASKS.daily(), time: new Date().toISOString() }); lastChecks.daily = today; } catch(e) {} }
  if (h === 14 && lastChecks.security !== today) { try { pendingNotifications.push({ type: 'security', message: await TASKS.security(), time: new Date().toISOString() }); lastChecks.security = today; } catch(e) {} }
  if (h === 17 && lastChecks.suggestion !== today) { try { pendingNotifications.push({ type: 'suggestion', message: await TASKS.suggestion(), time: new Date().toISOString() }); lastChecks.suggestion = today; } catch(e) {} }
}, 60 * 60 * 1000);

// ============================================================
//  QUIZ GENERATOR (for Tutor)
// ============================================================
async function generateQuiz(topic, count = 5) {
  const prompt = `Generate ${count} CompTIA Network+ N10-009 practice questions${topic ? ` on: ${topic}` : ''}.
Return JSON only:
{"questions":[{"q":"text","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"B","explain":"why"}]}
Make them exam-realistic.`;
  const reply = await callClaude([{ role: 'user', content: prompt }], 'friendly', true);
  try {
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch(e) { return { questions: [], error: 'Could not parse' }; }
}

// ============================================================
//  DISCORD BOT
// ============================================================
function startDiscordBot() {
  if (!DISCORD_TOKEN) { console.log('⚠️ No DISCORD_TOKEN — Discord disabled'); return; }
  let ws, heartbeatInterval, lastSeq = null;

  function sendDM(channelId, content) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ content: content.substring(0, 1999) });
      const req = https.request({
        hostname: 'discord.com', path: `/api/v10/channels/${channelId}/messages`, method: 'POST',
        headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, () => resolve());
      req.on('error', () => resolve());
      req.write(body); req.end();
    });
  }
  function sendTyping(channelId) {
    https.request({ hostname: 'discord.com', path: `/api/v10/channels/${channelId}/typing`, method: 'POST', headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Length': '0' } }, () => {}).end();
  }

  function connect() {
    try {
      const WebSocket = require('ws');
      ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
      ws.on('open', () => console.log('🎮 Discord connected'));
      ws.on('message', async (data) => {
        const { op, d, t, s } = JSON.parse(data);
        if (s) lastSeq = s;
        if (op === 10) {
          heartbeatInterval = setInterval(() => ws.send(JSON.stringify({ op: 1, d: lastSeq })), d.heartbeat_interval);
          ws.send(JSON.stringify({ op: 2, d: { token: DISCORD_TOKEN, intents: 33280, properties: { os: 'linux', browser: 'pk-bot', device: 'pk-bot' } } }));
        }
        if (op === 0 && t === 'READY') console.log(`✅ Discord online as ${d.user.username}`);
        if (op === 0 && t === 'MESSAGE_CREATE') {
          const msg = d;
          if (msg.author.bot) return;
          const c = msg.content;
          const isPK = c.toLowerCase().startsWith('!pk ') || c.toLowerCase().startsWith('pk, ') || c.toLowerCase().startsWith('pk ');
          if (!isPK) return;
          const userText = c.replace(/^!?pk[,\s]+/i, '').trim();
          if (!userText) { sendDM(msg.channel_id, `Hey ${msg.author.username}! 👋 I'm PK — type \`!pk your question\``); return; }
          sendTyping(msg.channel_id);
          try {
            const reply = await callClaude([{ role: 'user', content: `[Discord - ${msg.author.username}]: ${userText}` }], 'friendly');
            await sendDM(msg.channel_id, `🤖 **PK:** ${reply.substring(0, 1900)}`);
          } catch(e) { sendDM(msg.channel_id, `⚠️ ${e.message}`); }
        }
        if (op === 7 || op === 9) { clearInterval(heartbeatInterval); ws.close(); setTimeout(connect, 2000); }
      });
      ws.on('close', () => { clearInterval(heartbeatInterval); setTimeout(connect, 5000); });
      ws.on('error', () => {});
    } catch(e) {
      console.log('Installing ws...');
      require('child_process').execSync('npm install ws', { stdio: 'inherit' });
      connect();
    }
  }
  connect();
}

// ============================================================
//  HTTP SERVER
// ============================================================
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

http.createServer((req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const p = url.parse(req.url, true);

  if (p.pathname === '/' || p.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: 'PK Master Server (all-in-one)', hasKey: !!ANTHROPIC_API_KEY, hasGitHub: !!GITHUB_TOKEN, hasDiscord: !!DISCORD_TOKEN, modes: ['chat','stream','tutor','quiz','autonomous'] }));
    return;
  }

  if (p.pathname === '/notifications') {
    const n = [...pendingNotifications]; pendingNotifications = [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, notifications: n }));
    return;
  }

  if (p.pathname === '/autonomous' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { task } = JSON.parse(body);
        const result = await TASKS[task]();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Quiz endpoint (for Tutor extension)
  if (p.pathname === '/quiz' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { topic, count } = JSON.parse(body);
        const quiz = await generateQuiz(topic, count || 5);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...quiz }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Tutor streaming
  if (p.pathname === '/tutor' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('No API key');
        const { messages } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        streamClaude(messages, 'friendly', true,
          (t) => res.write(`data: ${JSON.stringify({ type:'token', token:t })}\n\n`),
          () => { res.write(`data: ${JSON.stringify({ type:'done' })}\n\n`); res.end(); },
          (e) => { res.write(`data: ${JSON.stringify({ type:'error', error:e.message })}\n\n`); res.end(); }
        );
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Main streaming chat (for PK Bot)
  if (p.pathname === '/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('No API key');
        const { messages, personality } = JSON.parse(body);
        const convRef = [...messages];
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        let fullReply = '';
        streamClaude(convRef, personality || 'friendly', false,
          (token) => { fullReply += token; res.write(`data: ${JSON.stringify({ type:'token', token })}\n\n`); },
          async (complete) => {
            convRef.push({ role: 'assistant', content: complete });
            const { text, extra } = await processCommands(complete, convRef, personality || 'friendly');
            if (text !== complete) res.write(`data: ${JSON.stringify({ type:'replace', text })}\n\n`);
            if (extra) res.write(`data: ${JSON.stringify({ type:'extra', text:extra })}\n\n`);
            res.write(`data: ${JSON.stringify({ type:'done' })}\n\n`);
            res.end();
          },
          (err) => { res.write(`data: ${JSON.stringify({ type:'error', error:err.message })}\n\n`); res.end(); }
        );
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Fallback non-streaming chat
  if (p.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('No API key');
        const { messages, personality } = JSON.parse(body);
        const convRef = [...messages];
        const reply = await callClaude(convRef, personality || 'friendly');
        convRef.push({ role: 'assistant', content: reply });
        const { text, extra } = await processCommands(reply, convRef, personality || 'friendly');
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
  console.log('');
  console.log('  ██████╗ ██╗  ██╗');
  console.log('  ██╔══██╗██║ ██╔╝');
  console.log('  ██████╔╝█████╔╝ ');
  console.log('  ██╔═══╝ ██╔═██╗ ');
  console.log('  ██║     ██║  ██╗');
  console.log('  ╚═╝     ╚═╝  ╚═╝');
  console.log('');
  console.log(`  PK Master Server on port ${PORT}`);
  console.log(`  Claude: ${ANTHROPIC_API_KEY ? '✅' : '❌'} | GitHub: ${GITHUB_TOKEN ? '✅' : '❌'} | Discord: ${DISCORD_TOKEN ? '✅' : '⚠️'}`);
  console.log(`  Endpoints: /chat /stream /tutor /quiz /autonomous /notifications`);
  console.log('');
});

startDiscordBot();
