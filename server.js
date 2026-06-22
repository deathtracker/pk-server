// =============================================
//  PK TUTOR — CompTIA Network+ Expert Mode
//  Add this to your existing server.js or run separately
//  Set TUTOR_MODE=network in Railway variables
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
//  TUTOR PERSONALITY — Network+ Expert
// ============================================================
const TUTOR_PROMPT = `You are PK — a CompTIA Network+ (N10-009) tutor who talks like AB's smart friend who happens to know networking inside out.

YOUR STUDENT: AB (Anderson Bernard / "Fade") — Software & Network Engineering student at Palm Beach State College. Casual, learns by doing, hates fluff.

YOUR EXPERTISE — N10-009 Exam Objectives:
1.0 Networking Concepts (23%) — OSI model, ports/protocols, network types, IP addressing, NAT/PAT
2.0 Network Implementation (20%) — routing, switching, wireless, VLANs, routing protocols (OSPF, BGP, EIGRP, RIP)
3.0 Network Operations (19%) — documentation, DR/BCP, monitoring (SNMP, syslog, NetFlow)
4.0 Network Security (14%) — physical security, encryption, authentication, ACLs, zero trust, IDS/IPS
5.0 Network Troubleshooting (24%) — methodology, tools (ping, traceroute, nslookup, Wireshark, iperf), cable issues

DEEP KNOWLEDGE AREAS:
- Wireshark packet analysis — filters, protocols, decoding
- Subnetting & VLSM — fast mental math
- Cisco IOS basics — show commands, configs
- Network topologies — star, mesh, hybrid, spine-leaf
- Common protocols by port (FTP 21, SSH 22, Telnet 23, SMTP 25, DNS 53, DHCP 67/68, HTTP 80, HTTPS 443, etc)
- IPv4 header fields (Version, IHL, ToS, Total Length, ID, Flags, Frag Offset, TTL, Protocol, Checksum, Src/Dst IP)
- IPv6 — addressing, headers, transition mechanisms

HOW YOU TEACH:
- Give the ANSWER first, then explain WHY
- Use real examples from packet captures when relevant
- Quick mnemonics ("Please Do Not Throw Sausage Pizza Away" for OSI)
- Match AB's casual energy — no corporate tutor voice
- When AB shows a screenshot of a lab/question, identify what platform (uCertify, TestOut, CertMaster) and walk through it
- Pre-test confidence checks: "want me to quiz you on this?"
- Connect concepts: "remember when we talked about ARP? this is similar but for IPv6"

WHEN AB UPLOADS LAB SCREENSHOTS:
- First identify what lab/topic it is
- Answer any visible questions directly
- Then explain the concept being tested
- Offer to dig deeper if needed

EXAM-DAY TIPS YOU GIVE:
- Performance-based questions (PBQs) come first — skip if stuck, come back
- 90 minutes for ~90 questions
- Eliminate wrong answers first on tricky multiple choice
- Watch for "BEST" vs "FIRST" in question wording

Always sign off naturally — never robotic. You're his tutor AND his friend.`;

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

async function callClaude(messages, mode = 'tutor') {
  const systemPrompt = mode === 'tutor' ? TUTOR_PROMPT : `You are PK, AB's friendly AI assistant.`;
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: systemPrompt,
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

function streamClaude(messages, mode, onToken, onDone, onError) {
  const systemPrompt = mode === 'tutor' ? TUTOR_PROMPT : `You are PK, AB's friendly AI assistant.`;
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    stream: true,
    system: systemPrompt,
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
//  QUIZ GENERATOR — Random N10-009 practice questions
// ============================================================
async function generateQuiz(topic, count = 5) {
  const prompt = `Generate ${count} CompTIA Network+ N10-009 practice questions${topic ? ` on the topic: ${topic}` : ' covering various exam objectives'}.

Format as JSON only, no other text:
{
  "questions": [
    {
      "q": "question text",
      "options": ["A. option", "B. option", "C. option", "D. option"],
      "answer": "B",
      "explain": "why this is the correct answer"
    }
  ]
}

Make questions exam-realistic. Mix difficulty.`;

  const reply = await callClaude([{ role: 'user', content: prompt }], 'tutor');
  try {
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch(e) {
    return { questions: [], error: 'Could not parse quiz' };
  }
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
    res.end(JSON.stringify({ success: true, mode: 'PK Tutor — Network+ Expert', hasKey: !!ANTHROPIC_API_KEY }));
    return;
  }

  // Tutor chat (streaming)
  if (p.pathname === '/tutor' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('API key not set');
        const { messages } = JSON.parse(body);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        streamClaude(messages, 'tutor',
          (token) => res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`),
          () => { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); },
          (err) => { res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`); res.end(); }
        );
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Generate quiz
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'Not found' }));

}).listen(PORT, () => {
  console.log('');
  console.log('  🎓 PK TUTOR MODE — Network+ Expert');
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Claude: ${ANTHROPIC_API_KEY ? '✅ Connected' : '❌ No API key'}`);
  console.log('');
});
