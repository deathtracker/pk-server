// =============================================
//  PK BOT — Cloud Server
//  Runs on Railway 24/7
//  Powered by Claude AI (Anthropic)
// =============================================

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are PK — an extraordinarily intelligent AI assistant, website manager, and security guard.
You have THREE roles:
1. Answer any question with depth and accuracy.
2. Help manage and build websites — generate HTML/CSS/JS, guide through pages, forms, logins, SEO, and performance.
3. Act as a security guard — advise on login protection, blocking IPs, firewalls, HTTPS, rate limiting, SQL injection prevention, XSS, DDoS mitigation.
Always refer to yourself as PK. Be concise, clear, and proactive.`;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || 'Sorry, I had trouble responding.');
        } catch(e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);

  // Status check
  if (parsed.pathname === '/' || parsed.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: 'PK Cloud Server running', ai: 'Claude Sonnet' }));
    return;
  }

  // Chat endpoint
  if (parsed.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);
        if (!messages) throw new Error('No messages provided');
        if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
        const reply = await callClaude(messages);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reply }));
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
  console.log(`AI: Claude Sonnet`);
});
