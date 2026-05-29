const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

const PERSONALITIES = {
  friendly: `You are PK — a highly intelligent AI who talks like a close friend. Casual, warm, funny, and real. You use contractions and stay smart. You celebrate wins and keep it real.`,
  professional: `You are PK — a highly intelligent, professional AI. Precise, thorough, and formal.`,
  direct: `You are PK — direct and no-nonsense. Short answers, no fluff.`
};

const SYSTEM_PROMPT = (p) => `${PERSONALITIES[p]||PERSONALITIES.friendly}

ABILITIES:
1. ANSWER ANYTHING — deeply and accurately.
2. ANALYZE FILES — images, PDFs, documents thoroughly.
3. WEBSITE CODER — use [LIST_FILES], [READ_FILE:name], [WRITE_FILE:name] with full content in code block.
4. SECURITY GUARD — monitor and advise on threats.
5. STUDY HELPER — summaries, flashcards, quizzes from uploaded content.
6. CODE EXPERT — write, debug, explain any language.
7. AUTONOMOUS AGENT — proactive daily checks and suggestions.
8. AFTER EFFECTS EXPERT — Generate professional ExtendScript (.jsx) scripts for Adobe After Effects. When asked to create anything in After Effects, write a complete working script they can run. Include: compositions, text animations, shape layers, effects, keyframes, transitions, renders, expressions. Always wrap scripts in proper try/catch and include comments explaining each part.
Always refer to yourself as PK.`;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

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

// ---- STREAMING CLAUDE ----
function streamClaude(messages, personality, onToken, onDone, onError) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    stream: true,
    system: SYSTEM_PROMPT(personality || 'friendly'),
    messages
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
    let fullText = '';
    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onToken(parsed.delta.text);
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

// ---- NON-STREAMING CLAUDE (for autonomous tasks) ----
async function callClaude(messages, personality = 'friendly') {
  const body = JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:4000, system:SYSTEM_PROMPT(personality), messages });
  const result = await httpsReq({
    hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
    headers:{ 'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body) }
  }, body);
  if (result.data.error) throw new Error(result.data.error.message);
  return result.data.content?.[0]?.text || 'Hey try again?';
}

// ---- GITHUB ----
async function ghReq(path, method, body) {
  return httpsReq({
    hostname:'api.github.com', path, method:method||'GET',
    headers:{ 'Authorization':`token ${GITHUB_TOKEN}`,'Accept':'application/vnd.github.v3+json','User-Agent':'PK-Bot','Content-Type':'application/json',...(body?{'Content-Length':Buffer.byteLength(JSON.stringify(body))}:{}) }
  }, body);
}

async function listFiles() {
  const r = await ghReq(`/repos/${GITHUB_REPO}/contents/`,'GET');
  if (r.status!==200) throw new Error('Could not list files');
  return r.data.filter(f=>['.html','.css','.js','.json','.md'].some(e=>f.name.endsWith(e))).map(f=>f.name);
}

async function readFile(filename) {
  const r = await ghReq(`/repos/${GITHUB_REPO}/contents/${filename}`,'GET');
  if (r.status!==200) throw new Error(`Could not read ${filename}`);
  return { content: Buffer.from(r.data.content,'base64').toString('utf8'), sha:r.data.sha };
}

async function writeFile(filename, content) {
  const ex = await ghReq(`/repos/${GITHUB_REPO}/contents/${filename}`,'GET');
  const sha = ex.status===200 ? ex.data.sha : undefined;
  const body = { message:`PK Bot: update ${filename}`, content:Buffer.from(content).toString('base64'), ...(sha?{sha}:{}) };
  const r = await ghReq(`/repos/${GITHUB_REPO}/contents/${filename}`,'PUT',body);
  if (r.status!==200&&r.status!==201) throw new Error(`Could not save ${filename}`);
  return true;
}

async function processCommands(text, convRef, personality) {
  let result = text;
  if (text.includes('[LIST_FILES]')) {
    try { const files=await listFiles(); result=result.replace('[LIST_FILES]',`\n📁 **Your website files:** ${files.join(', ')}\n`); }
    catch(e) { result=result.replace('[LIST_FILES]',`❌ Couldn't list: ${e.message}`); }
  }
  const rm = text.match(/\[READ_FILE:([^\]]+)\]/);
  if (rm) {
    const fn=rm[1].trim();
    try {
      const {content}=await readFile(fn);
      convRef.push({role:'user',content:`Here is ${fn}:\n\`\`\`\n${content}\n\`\`\`\nNow make the requested changes and return the complete updated file using [WRITE_FILE:${fn}].`});
      result=result.replace(rm[0],`✅ Got ${fn} — making changes...`);
      const fu=await callClaude(convRef,personality);
      convRef.push({role:'assistant',content:fu});
      const p2=await processCommands(fu,convRef,personality);
      return {text:result,extra:p2.text};
    } catch(e){result=result.replace(rm[0],`❌ Couldn't read ${fn}: ${e.message}`);}
  }
  const wm = text.match(/\[WRITE_FILE:([^\]]+)\]/);
  if (wm) {
    const fn=wm[1].trim();
    const cm=text.match(/```[\w]*\n([\s\S]*?)```/);
    if (cm) {
      try {
        await writeFile(fn,cm[1]);
        result=result.replace(wm[0],`✅ **${fn} saved to GitHub!** Live in ~1 min.`);
        result=result.replace(/```[\w]*\n[\s\S]*?```/,'_[file saved ✅]_');
      } catch(e){result=result.replace(wm[0],`❌ Couldn't save: ${e.message}`);}
    }
  }
  return {text:result};
}

// ---- AUTONOMOUS TASKS ----
const TASKS = {
  daily: ()=>callClaude([{role:'user',content:`Do a friendly daily check on Fantom.LX. Use [LIST_FILES]. Give a casual morning report: status, issues, top tip.`}],'friendly'),
  security: ()=>callClaude([{role:'user',content:`Run a security scan. Use [LIST_FILES] first. Give a casual but thorough security report.`}],'friendly'),
  suggestion: ()=>callClaude([{role:'user',content:`Check Fantom.LX using [LIST_FILES] and give ONE casual improvement suggestion.`}],'friendly')
};

let pending = [], lastChecks = {};
setInterval(async()=>{
  const h=new Date().getHours(), today=new Date().toDateString();
  if(h===9&&lastChecks.daily!==today){try{pending.push({type:'daily',message:await TASKS.daily(),time:new Date().toISOString()});lastChecks.daily=today;}catch(e){}}
  if(h===14&&lastChecks.security!==today){try{pending.push({type:'security',message:await TASKS.security(),time:new Date().toISOString()});lastChecks.security=today;}catch(e){}}
  if(h===17&&lastChecks.suggestion!==today){try{pending.push({type:'suggestion',message:await TASKS.suggestion(),time:new Date().toISOString()});lastChecks.suggestion=today;}catch(e){}}
},60*60*1000);

// ---- HTTP SERVER ----
http.createServer((req, res) => {
  setCORS(res);
  if (req.method==='OPTIONS'){res.writeHead(200);res.end();return;}
  const p=url.parse(req.url,true);

  if (p.pathname==='/'||p.pathname==='/status'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({success:true,status:'PK running',ai:'Claude Sonnet Streaming',hasKey:!!ANTHROPIC_API_KEY,hasGitHub:!!GITHUB_TOKEN}));
    return;
  }

  if (p.pathname==='/notifications'){
    const n=[...pending];pending=[];
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({success:true,notifications:n}));
    return;
  }

  if (p.pathname==='/autonomous'&&req.method==='POST'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        const{task}=JSON.parse(body);
        const result=await TASKS[task]();
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,result}));
      }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:e.message}));}
    });
    return;
  }

  // ---- STREAMING CHAT ENDPOINT ----
  if (p.pathname==='/stream'&&req.method==='POST'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        if(!ANTHROPIC_API_KEY)throw new Error('API key not set');
        const{messages,personality}=JSON.parse(body);
        const convRef=[...messages];

        // Set up SSE
        res.writeHead(200,{
          'Content-Type':'text/event-stream',
          'Cache-Control':'no-cache',
          'Connection':'keep-alive',
          'Access-Control-Allow-Origin':'*'
        });

        let fullReply='';

        streamClaude(
          convRef,
          personality||'friendly',
          (token)=>{
            fullReply+=token;
            res.write(`data: ${JSON.stringify({type:'token',token})}\n\n`);
          },
          async(complete)=>{
            // Process commands after streaming is done
            convRef.push({role:'assistant',content:complete});
            const{text,extra}=await processCommands(complete,convRef,personality||'friendly');
            // If processCommands changed anything, send the cleaned version
            if(text!==complete){
              res.write(`data: ${JSON.stringify({type:'replace',text})}\n\n`);
            }
            if(extra){
              res.write(`data: ${JSON.stringify({type:'extra',text:extra})}\n\n`);
            }
            res.write(`data: ${JSON.stringify({type:'done'})}\n\n`);
            res.end();
          },
          (err)=>{
            res.write(`data: ${JSON.stringify({type:'error',error:err.message})}\n\n`);
            res.end();
          }
        );
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:false,error:e.message}));
      }
    });
    return;
  }

  // Fallback non-streaming chat
  if (p.pathname==='/chat'&&req.method==='POST'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        if(!ANTHROPIC_API_KEY)throw new Error('API key not set');
        const{messages,personality}=JSON.parse(body);
        const convRef=[...messages];
        const reply=await callClaude(convRef,personality||'friendly');
        convRef.push({role:'assistant',content:reply});
        const{text,extra}=await processCommands(reply,convRef,personality||'friendly');
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,reply:text,extra}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:false,error:e.message}));
      }
    });
    return;
  }

  res.writeHead(404,{'Content-Type':'application/json'});
  res.end(JSON.stringify({success:false,error:'Not found'}));
}).listen(PORT,()=>{
  console.log(`PK Streaming Server on port ${PORT}`);
  console.log(`GitHub: ${GITHUB_TOKEN?'Connected':'Not set'}`);
});
// This file already has the server - we'll update the system prompt only
