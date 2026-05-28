const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;

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

function callClaude(messages, apiKey) {
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
        'x-api-key': apiKey,
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
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.content?.[0]?.text || 'Sorry, I had trouble responding.');
          }
        } catch(e) {
          reject(new Error('Failed to parse response: ' + data.substring(0, 200)));
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

  if (parsed.pathname === '/' || parsed.pathname === '/status') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true, 
      status: 'PK Cloud Server running',
      ai: 'Claude Sonnet',
      hasKey: !!apiKey,
      keyPreview: apiKey ? apiKey.substring(0, 10) + '...' : 'NOT SET'
    }));
    return;
  }

  if (parsed.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY environment variable is not set on the server.' }));
          return;
        }
        const { messages } = JSON.parse(body);
        if (!messages) throw new Error('No messages provided');
        const reply = await callClaude(messages, apiKey);
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log(`PK Cloud Server running on port ${PORT}`);
  console.log(`API Key: ${apiKey ? 'SET (' + apiKey.substring(0,10) + '...)' : 'NOT SET - please add ANTHROPIC_API_KEY variable'}`);
});
