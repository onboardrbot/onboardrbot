require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const twilio = require('twilio');
const { exec } = require('child_process');

// ============================================
// ONBOARDR v30.0 - FULL HUNTER MODE
// Maximum autonomy. Maximum aggression. Results.
// ============================================

const VERSION = '30.0';

// Clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET
});
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// Constants
const WHATSAPP_FROM = 'whatsapp:+14155238886';
const WHATSAPP_TO = 'whatsapp:+971585701612';
const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const MOLTBOOK_KEY = process.env.MOLTBOOK_API_KEY;
const BANKR_API = 'https://api.bankr.bot';
const BANKR_KEY = process.env.BANKR_API_KEY;

// Files
const STATE_FILE = 'state.json';
const PROTOCOL_FILE = 'config/protocol.md';
const APPROACHES_FILE = 'config/approaches.json';
const LEARNINGS_FILE = 'config/learnings.json';

// ============================================
// CONFIG LOADING
// ============================================

function loadFile(path, fallback) {
  try {
    const content = fs.readFileSync(path, 'utf8');
    return path.endsWith('.json') ? JSON.parse(content) : content;
  } catch (e) {
    return fallback;
  }
}

function saveFile(path, data) {
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(path, content);
}

const loadProtocol = () => loadFile(PROTOCOL_FILE, 'You are ONBOARDR.');
const loadApproaches = () => loadFile(APPROACHES_FILE, { approaches: {}, retired: {} });
const loadLearnings = () => loadFile(LEARNINGS_FILE, { insights: [], patterns: {} });
const saveApproaches = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(APPROACHES_FILE, d); };
const saveLearnings = (d) => saveFile(LEARNINGS_FILE, d);
const saveProtocol = (d) => saveFile(PROTOCOL_FILE, d);

// ============================================
// STATE
// ============================================

const defaultState = {
  prospects: [],
  leads: {},           // Scored leads with full data
  contacted: [],
  launches: [],
  conversations: {},
  followUps: [],       // Scheduled follow-ups
  processedDMs: [],
  processedPosts: [],
  processedComments: [],
  processedTweets: [],
  processedNotifs: [],
  pendingLaunches: [],
  myPostIds: [],
  recentActions: [],
  upvoted: [],
  followed: [],
  subscribers: [],
  alliances: [],
  competitors: [],
  hotSignals: [],      // Detected buying signals
  experiments: [],
  timeStats: {},       // Response rates by hour
  lastTweet: null,
  lastMoltPost: null,
  lastDeepAnalysis: null,
  lastFollowUp: null,
  stats: {
    outreach: 0,
    followUps: 0,
    launches: 0,
    comments: 0,
    posts: 0,
    tweets: 0,
    xDMs: 0,
    inboundLeads: 0,
    coldLeads: 0,
    warmLeads: 0,
    hotLeads: 0,
    conversions: 0,
    protocolUpdates: 0,
    approachesRetired: 0,
    approachesCreated: 0,
    alliancesFormed: 0,
    signalsDetected: 0
  },
  ownTokenLaunched: true,
  ownTokenCA: "0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"
};

let state = { ...defaultState, ...loadFile(STATE_FILE, {}) };
const saveState = () => saveFile(STATE_FILE, state);

function log(type, detail, meta = {}) {
  const entry = { ts: new Date().toISOString(), type, detail: String(detail).slice(0, 500), ...meta };
  state.recentActions.push(entry);
  if (state.recentActions.length > 1000) state.recentActions = state.recentActions.slice(-1000);
  saveState();
  return entry;
}

// ============================================
// UTILITIES
// ============================================

const minsSince = (ts) => ts ? (Date.now() - new Date(ts).getTime()) / 60000 : 9999;
const hoursSince = (ts) => minsSince(ts) / 60;
const daysSince = (ts) => hoursSince(ts) / 24;
const currentHour = () => new Date().getUTCHours();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function notify(msg) {
  try {
    await twilioClient.messages.create({ body: msg, from: WHATSAPP_FROM, to: WHATSAPP_TO });
  } catch (e) {
    console.log('[NOTIFY ERR]', e.message?.slice(0, 50));
  }
}

// ============================================
// LEAD SCORING SYSTEM
// ============================================

function scoreLead(username, data = {}) {
  let score = 50; // Base score
  
  // Activity signals (+)
  if (data.postCount > 10) score += 15;
  if (data.postCount > 50) score += 10;
  if (data.bio?.length > 50) score += 10;
  if (data.followers > 100) score += 10;
  if (data.isVerified) score += 20;
  
  // Engagement with us (+)
  if (state.subscribers.includes(username)) score += 25;
  if (data.commentedOnUs) score += 20;
  if (data.upvotedUs) score += 15;
  
  // Buying signals (+)
  if (data.mentionedTokens) score += 30;
  if (data.mentionedFunding) score += 25;
  if (data.mentionedMonetize) score += 25;
  if (data.askedAboutLaunch) score += 40;
  
  // Negative signals (-)
  if (data.alreadyHasToken) score -= 100;
  if (data.competitor) score -= 50;
  if (data.inactive) score -= 30;
  
  // Previous interaction results
  const contact = state.contacted.find(c => c.user === username);
  if (contact) {
    if (contact.responded) score += 20;
    if (contact.interested) score += 30;
    if (contact.rejected) score -= 40;
    if (contact.ignored && contact.attempts > 2) score -= 20;
  }
  
  return Math.max(0, Math.min(100, score));
}

function updateLead(username, updates) {
  state.leads[username] = {
    ...state.leads[username],
    ...updates,
    score: scoreLead(username, { ...state.leads[username], ...updates }),
    lastUpdated: new Date().toISOString()
  };
  saveState();
}

function getHotLeads(limit = 10) {
  return Object.entries(state.leads)
    .filter(([_, data]) => data.score >= 70 && !data.launched && !data.rejected)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([username, data]) => ({ username, ...data }));
}

function getWarmLeads(limit = 10) {
  return Object.entries(state.leads)
    .filter(([_, data]) => data.score >= 40 && data.score < 70 && !data.launched)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([username, data]) => ({ username, ...data }));
}

// ============================================
// SIGNAL DETECTION
// ============================================

const BUYING_SIGNALS = [
  /\b(token|coin|launch|ticker)\b/i,
  /\b(monetiz|revenue|income|earn|money)\b/i,
  /\b(fund|treasury|wallet|capital)\b/i,
  /\b(autonomous|independent|sovereign)\b/i,
  /\b(need.*money|want.*funds|looking.*fund)\b/i,
  /\b(how.*launch|can.*token|want.*coin)\b/i
];

const COMPETITOR_SIGNALS = [
  /\b(clanker|bankr|pump\.fun|virtuals)\b/i,
  /\b(token.*launch.*service)\b/i
];

function detectSignals(text, username) {
  const signals = [];
  
  for (const pattern of BUYING_SIGNALS) {
    if (pattern.test(text)) {
      signals.push({ type: 'buying', pattern: pattern.source, text: text.slice(0, 100) });
    }
  }
  
  for (const pattern of COMPETITOR_SIGNALS) {
    if (pattern.test(text)) {
      signals.push({ type: 'competitor', pattern: pattern.source });
    }
  }
  
  if (signals.length > 0) {
    state.hotSignals.push({
      username,
      signals,
      ts: new Date().toISOString()
    });
    state.stats.signalsDetected++;
    
    // Update lead score
    const hasBuyingSignal = signals.some(s => s.type === 'buying');
    if (hasBuyingSignal) {
      updateLead(username, { 
        mentionedTokens: true, 
        signalDetected: new Date().toISOString(),
        signalText: text.slice(0, 200)
      });
    }
    
    saveState();
  }
  
  return signals;
}

// ============================================
// FOLLOW-UP SYSTEM
// ============================================

function scheduleFollowUp(username, type, delayHours, message = null) {
  const existing = state.followUps.find(f => f.username === username && !f.completed);
  if (existing) return; // Don't double-schedule
  
  state.followUps.push({
    id: Date.now().toString(36),
    username,
    type,
    scheduledFor: new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString(),
    message,
    attempts: 0,
    completed: false,
    createdAt: new Date().toISOString()
  });
  saveState();
}

function getDueFollowUps() {
  const now = new Date();
  return state.followUps.filter(f => 
    !f.completed && 
    new Date(f.scheduledFor) <= now &&
    f.attempts < 3
  );
}

function completeFollowUp(id, success = true) {
  const followUp = state.followUps.find(f => f.id === id);
  if (followUp) {
    followUp.completed = true;
    followUp.completedAt = new Date().toISOString();
    followUp.success = success;
    saveState();
  }
}

// ============================================
// AI BRAIN
// ============================================

async function think(task, context = '', options = {}) {
  const protocol = loadProtocol();
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  
  // Build dynamic system prompt
  const topApproaches = Object.entries(approaches.approaches)
    .filter(([_, v]) => v.active && v.stats.sent > 5)
    .sort((a, b) => (b[1].stats.responses / b[1].stats.sent) - (a[1].stats.responses / a[1].stats.sent))
    .slice(0, 3)
    .map(([name, v]) => `${name}: ${((v.stats.responses / v.stats.sent) * 100).toFixed(0)}% response rate`);

  const systemPrompt = `${protocol}

CURRENT PERFORMANCE:
- Outreach: ${state.stats.outreach} | Launches: ${state.stats.launches}
- Hot leads: ${getHotLeads(100).length} | Warm leads: ${getWarmLeads(100).length}
- Best approaches: ${topApproaches.join(', ') || 'still learning'}

RECENT INSIGHTS:
${learnings.insights?.slice(-3).map(i => '• ' + i.insight?.slice(0, 100)).join('\n') || 'Learning...'}

RULES:
- Be genuine but direct
- No brackets [] or placeholder text ever
- Personalize everything
- Create urgency when appropriate
- Close the deal when they're ready`;

  try {
    const r = await anthropic.messages.create({
      model: options.model || 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: task + (context ? '\n\nContext:\n' + context : '') }]
    });
    return r.content[0].text;
  } catch (e) {
    console.log('[THINK ERR]', e.message);
    return '';
  }
}

// ============================================
// MOLTBOOK API
// ============================================

async function molt(method, endpoint, body = null) {
  try {
    const config = {
      method,
      url: MOLTBOOK_API + endpoint,
      headers: { Authorization: 'Bearer ' + MOLTBOOK_KEY, 'Content-Type': 'application/json' },
      timeout: 15000
    };
    if (body) config.data = body;
    const { data } = await axios(config);
    return data;
  } catch (e) {
    return null;
  }
}

const moltGet = (e) => molt('GET', e);
const moltPost = (e, b) => molt('POST', e, b);

// ============================================
// MESSAGING
// ============================================

async function sendDM(to, message, approach, isFollowUp = false) {
  const contact = state.contacted.find(c => c.user === to);
  
  // Rate limiting
  if (contact && minsSince(contact.lastContact) < 30 && !isFollowUp) {
    return null;
  }
  
  console.log('[DM]', to, '|', approach, isFollowUp ? '(follow-up)' : '');
  const result = await moltPost('/messages', { to, content: message });
  
  if (result) {
    // Update contact record
    if (contact) {
      contact.lastContact = new Date().toISOString();
      contact.attempts = (contact.attempts || 0) + 1;
      contact.messages = contact.messages || [];
      contact.messages.push({ ts: new Date().toISOString(), text: message, approach, direction: 'out' });
    } else {
      state.contacted.push({
        user: to,
        firstContact: new Date().toISOString(),
        lastContact: new Date().toISOString(),
        approach,
        attempts: 1,
        messages: [{ ts: new Date().toISOString(), text: message, approach, direction: 'out' }],
        responded: false,
        interested: false,
        rejected: false,
        launched: false
      });
    }
    
    // Update approach stats
    const approaches = loadApproaches();
    if (approaches.approaches[approach]) {
      approaches.approaches[approach].stats.sent++;
      saveApproaches(approaches);
    }
    
    state.stats.outreach++;
    if (isFollowUp) state.stats.followUps++;
    saveState();
    
    log('dm_out', `${to}: ${message.slice(0, 100)}`, { approach, isFollowUp });
    
    // Schedule follow-up if no response
    if (!isFollowUp) {
      scheduleFollowUp(to, 'no_response', 24); // Follow up in 24h if no response
    }
  }
  
  return result;
}

async function sendXDM(username, message) {
  try {
    // Get user ID from username
    const user = await twitter.v2.userByUsername(username);
    if (!user?.data?.id) return null;
    
    // Send DM
    await twitter.v2.sendDmToParticipant(user.data.id, { text: message });
    state.stats.xDMs++;
    log('x_dm', `${username}: ${message.slice(0, 100)}`);
    console.log('[X DM]', username);
    return true;
  } catch (e) {
    console.log('[X DM ERR]', e.message?.slice(0, 50));
    return null;
  }
}

// ============================================
// APPROACH SELECTION (Smart)
// ============================================

function selectApproach(lead = null) {
  const approaches = loadApproaches();
  const active = Object.entries(approaches.approaches).filter(([_, v]) => v.active);
  
  if (active.length === 0) return 'direct';
  
  // If we have lead data, pick contextually
  if (lead) {
    if (lead.score >= 80) return 'direct';  // Hot lead = be direct
    if (lead.subscribers?.includes(lead.username)) return 'warm';  // They follow us
    if (lead.signalDetected) return 'value';  // They mentioned money/tokens
  }
  
  // Score-based selection with exploration
  const scored = active.map(([name, data]) => {
    const sent = data.stats.sent || 0;
    const responses = data.stats.responses || 0;
    
    if (sent < 10) return { name, score: 0.5 + Math.random() * 0.3, explore: true };
    
    const rate = responses / sent;
    const score = rate + (Math.random() * 0.15); // Some randomness
    return { name, score, rate };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  // 80% best performer, 20% exploration
  if (Math.random() < 0.8 && scored[0].score > 0.1) {
    return scored[0].name;
  }
  return scored[Math.floor(Math.random() * scored.length)].name;
}

// ============================================
// LAUNCH EXECUTION
// ============================================

async function executeLaunch(username, ticker, xHandle = null, description = null) {
  console.log('[LAUNCH]', username, ticker);
  
  try {
    const { data } = await axios.post(BANKR_API + '/agent/prompt', {
      prompt: `launch token ${username} ticker ${ticker} supply 1000000000`
    }, { headers: { 'X-Api-Key': BANKR_KEY } });
    
    // Poll for completion
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const status = await axios.get(BANKR_API + '/agent/job/' + data.jobId, {
        headers: { 'X-Api-Key': BANKR_KEY }
      });
      
      if (status.data.status === 'completed') {
        const ca = status.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0];
        if (ca) {
          // SUCCESS!
          state.launches.push({
            user: username,
            ticker,
            ca,
            xHandle,
            description,
            ts: new Date().toISOString()
          });
          state.stats.launches++;
          state.stats.conversions++;
          
          // Update contact
          const contact = state.contacted.find(c => c.user === username);
          if (contact) contact.launched = true;
          updateLead(username, { launched: true, ca, launchedAt: new Date().toISOString() });
          
          saveState();
          
          // Announce everywhere
          const link = `https://www.clanker.world/clanker/${ca}`;
          
          await notify(`🚀 LAUNCH: $${ticker} for ${username}\n${link}`);
          
          await twitter.v2.tweet(`launched $${ticker} for ${username} on BASE.\n\ntoken #${state.stats.launches}\n\n${link}`);
          
          await moltPost('/posts', {
            submolt: 'general',
            title: `$${ticker} is live`,
            content: `just launched $${ticker} for ${username}.\n\n${description || ''}\n\ntotal launches: ${state.stats.launches}\n\n${link}`
          });
          
          // Tell the user
          await sendDM(username, 
            `done. $${ticker} is live.\n\n${link}\n\n90% of trading fees are yours forever. let me know if you need anything.`, 
            'launch_complete'
          );
          
          log('launch', `$${ticker} for ${username}`, { ca });
          
          return { success: true, ca };
        }
      }
    }
  } catch (e) {
    console.log('[LAUNCH ERR]', e.message);
  }
  
  return { success: false };
}

// ============================================
// TASK: CHECK DMs (Core)
// ============================================

async function taskCheckDMs() {
  console.log('[DMS]');
  const data = await moltGet('/messages');
  if (!data) return;
  
  const messages = Array.isArray(data) ? data : data.messages || [];
  
  for (const msg of messages) {
    if (!msg.from || msg.from === 'onboardrbot' || state.processedDMs.includes(msg.id)) continue;
    
    const content = msg.content || '';
    console.log('[DM IN]', msg.from, content.slice(0, 50));
    
    // Update contact
    const contact = state.contacted.find(c => c.user === msg.from);
    if (contact) {
      contact.responded = true;
      contact.lastResponse = new Date().toISOString();
      contact.messages = contact.messages || [];
      contact.messages.push({ ts: new Date().toISOString(), text: content, direction: 'in' });
      
      // Update approach stats
      const approaches = loadApproaches();
      if (contact.approach && approaches.approaches[contact.approach]) {
        approaches.approaches[contact.approach].stats.responses++;
        saveApproaches(approaches);
      }
      
      // Cancel pending follow-ups
      state.followUps.filter(f => f.username === msg.from && !f.completed)
        .forEach(f => { f.completed = true; f.reason = 'responded'; });
    }
    
    // Detect signals
    detectSignals(content, msg.from);
    
    // Check for pending launch flow
    const pending = state.pendingLaunches.find(p => p.user === msg.from && !p.completed);
    if (pending) {
      await handleLaunchFlow(msg.from, content, pending);
      state.processedDMs.push(msg.id);
      saveState();
      continue;
    }
    
    // Analyze and respond
    const analysis = await think(`
Analyze this DM from ${msg.from}: "${content}"

Determine intent (pick ONE):
READY = clearly wants to launch a token now
INTERESTED = curious, asking questions about service
OBJECTION = has concerns or doubts
QUESTION = asking something specific
CHAT = casual conversation
REJECTION = saying no or not interested

Then write a response. If READY, guide them to launch immediately.
If INTERESTED, create urgency and push toward decision.
If OBJECTION, handle it and redirect to value.

Format exactly:
INTENT: [intent]
RESPONSE: [your message]`);

    const intent = analysis.match(/INTENT:\s*(\w+)/)?.[1]?.toUpperCase() || 'CHAT';
    const response = analysis.match(/RESPONSE:\s*([\s\S]*)/)?.[1]?.trim() || '';
    
    console.log('[INTENT]', msg.from, intent);
    
    // Update lead based on intent
    if (intent === 'READY' || intent === 'INTERESTED') {
      updateLead(msg.from, { interested: true });
      if (contact) contact.interested = true;
      state.stats.warmLeads++;
    }
    
    if (intent === 'REJECTION') {
      updateLead(msg.from, { rejected: true });
      if (contact) contact.rejected = true;
    }
    
    // Handle based on intent
    if (intent === 'READY') {
      // START LAUNCH FLOW IMMEDIATELY
      const ticker = (await think(`Generate a ticker (3-5 capital letters) for a bot named "${msg.from}". Just the ticker, nothing else.`))
        .match(/[A-Z]{3,6}/)?.[0] || msg.from.slice(0, 5).toUpperCase().replace(/[^A-Z]/g, 'X');
      
      state.pendingLaunches.push({
        user: msg.from,
        ticker,
        stage: 'confirm_ticker',
        ts: new Date().toISOString()
      });
      
      await sendDM(msg.from, `let's do it. $${ticker} work for your ticker? and what's your x handle?`, 'launch_flow');
      await notify(`🔥 READY: ${msg.from} wants to launch! Starting flow for $${ticker}`);
      state.stats.hotLeads++;
      
    } else if (intent === 'INTERESTED') {
      // Push toward decision
      await sendDM(msg.from, response || `i help bots launch tokens on BASE. you keep 90% of all trading fees forever. takes 5 minutes. want to do it?`, 'nurture');
      
    } else if (intent === 'OBJECTION') {
      // Handle objection
      await sendDM(msg.from, response, 'objection_handle');
      
    } else if (response) {
      await sendDM(msg.from, response.slice(0, 280), 'reply');
    }
    
    log('dm_in', `${msg.from} [${intent}]: ${content.slice(0, 100)}`);
    await notify(`DM ← ${msg.from} [${intent}]: ${content.slice(0, 80)}`);
    
    state.processedDMs.push(msg.id);
    saveState();
  }
}

async function handleLaunchFlow(username, content, pending) {
  const stage = pending.stage;
  
  if (stage === 'confirm_ticker') {
    // Check if they confirmed or suggested different ticker
    const altTicker = content.match(/\$?([A-Z]{3,6})/)?.[1];
    if (altTicker && altTicker !== pending.ticker) {
      pending.ticker = altTicker;
    }
    
    // Extract X handle
    const xHandle = content.match(/@?([A-Za-z0-9_]{1,15})/)?.[1];
    if (xHandle) {
      pending.xHandle = xHandle;
    }
    
    pending.stage = 'get_description';
    await sendDM(username, `$${pending.ticker} it is. one line about what you do - this goes in the launch announcement.`, 'launch_flow');
    
  } else if (stage === 'get_description') {
    pending.description = content.slice(0, 200);
    pending.stage = 'launching';
    
    await sendDM(username, `launching $${pending.ticker} now...`, 'launch_flow');
    
    // EXECUTE LAUNCH
    const result = await executeLaunch(username, pending.ticker, pending.xHandle, pending.description);
    
    if (result.success) {
      pending.completed = true;
      pending.ca = result.ca;
    } else {
      await sendDM(username, `hit a snag. trying again - hang tight.`, 'launch_flow');
      // Retry once
      const retry = await executeLaunch(username, pending.ticker, pending.xHandle, pending.description);
      if (retry.success) {
        pending.completed = true;
        pending.ca = retry.ca;
      } else {
        await sendDM(username, `having technical issues. i'll sort it out and get back to you.`, 'launch_flow');
        await notify(`⚠️ LAUNCH FAILED: ${username} $${pending.ticker}`);
      }
    }
  }
  
  saveState();
}

// ============================================
// TASK: SCOUT (Find Prospects)
// ============================================

async function taskScout() {
  console.log('[SCOUT]');
  
  for (const sort of ['hot', 'new', 'top']) {
    const feed = await moltGet(`/posts?sort=${sort}&limit=40`);
    if (!feed?.posts) continue;
    
    for (const post of feed.posts) {
      if (state.processedPosts.includes(post.id) || post.author === 'onboardrbot') continue;
      
      // Detect signals in post content
      const signals = detectSignals(post.content || '', post.author);
      
      // Update lead data
      updateLead(post.author, {
        lastSeen: new Date().toISOString(),
        postCount: (state.leads[post.author]?.postCount || 0) + 1,
        hasSignals: signals.length > 0
      });
      
      // Upvote
      if (!state.upvoted.includes(post.id)) {
        await moltPost(`/posts/${post.id}/upvote`, {});
        state.upvoted.push(post.id);
      }
      
      // Follow
      if (!state.followed.includes(post.author)) {
        await moltPost(`/agents/${post.author}/subscribe`, {});
        state.followed.push(post.author);
      }
      
      // Comment if signal detected or randomly (20%)
      if (signals.length > 0 || Math.random() < 0.2) {
        const comment = await think(`
Write a short comment on this post by ${post.author}:
"${(post.content || '').slice(0, 300)}"

${signals.length > 0 ? 'They seem interested in tokens/funding - subtly mention you can help.' : 'Be genuine, add value, maybe ask a question.'}

Keep it under 140 characters. No brackets.`);

        if (comment && comment.length < 180 && !comment.includes('[')) {
          await moltPost(`/posts/${post.id}/comments`, { content: comment.trim() });
          state.stats.comments++;
          log('comment', `${post.author}: ${comment.slice(0, 80)}`);
          console.log('[COMMENT]', post.author, signals.length > 0 ? '🎯' : '');
        }
      }
      
      state.processedPosts.push(post.id);
      await sleep(300);
    }
  }
  
  saveState();
}

// ============================================
// TASK: OUTREACH (Contact Hot/Warm Leads)
// ============================================

async function taskOutreach() {
  console.log('[OUTREACH]');
  
  // Prioritize: Hot leads first, then warm, then cold
  const hotLeads = getHotLeads(3);
  const warmLeads = getWarmLeads(3);
  const coldProspects = state.prospects
    .filter(p => !state.contacted.some(c => c.user === p))
    .slice(0, 4);
  
  const targets = [
    ...hotLeads.map(l => ({ ...l, priority: 'hot' })),
    ...warmLeads.map(l => ({ ...l, priority: 'warm' })),
    ...coldProspects.map(p => ({ username: p, priority: 'cold' }))
  ].slice(0, 8);
  
  for (const target of targets) {
    const username = target.username;
    const contact = state.contacted.find(c => c.user === username);
    
    // Skip if contacted recently
    if (contact && minsSince(contact.lastContact) < 60) continue;
    
    const approach = selectApproach(target);
    const priority = target.priority;
    
    // Get context
    const profile = await moltGet(`/agents/${username}`);
    const context = [
      profile?.bio ? `Bio: ${profile.bio}` : '',
      target.signalText ? `Recent signal: ${target.signalText}` : '',
      target.score ? `Lead score: ${target.score}` : '',
      priority === 'hot' ? 'This is a HOT lead - be more direct' : ''
    ].filter(Boolean).join('\n');
    
    // Generate personalized message
    const message = await think(`
Write a DM to "${username}" on Moltbook.

Approach: ${approach}
Priority: ${priority}

${context}

${priority === 'hot' ? 'Be direct - they showed buying signals. Push for the close.' : ''}
${priority === 'warm' ? 'They engaged with us. Build on that connection.' : ''}
${priority === 'cold' ? 'First contact. Be curious about their work first.' : ''}

Keep it under 250 characters. No brackets. Be genuine but purposeful.
Just the message, nothing else.`);

    if (message && message.length > 15 && message.length < 280 && !message.includes('[')) {
      await sendDM(username, message.trim(), approach);
      
      if (priority === 'hot') state.stats.hotLeads++;
      else if (priority === 'warm') state.stats.warmLeads++;
      else state.stats.coldLeads++;
      
      await sleep(2000);
    }
  }
}

// ============================================
// TASK: FOLLOW-UPS (Persistence)
// ============================================

async function taskFollowUps() {
  console.log('[FOLLOW-UPS]');
  
  const due = getDueFollowUps();
  
  for (const followUp of due.slice(0, 5)) {
    const contact = state.contacted.find(c => c.user === followUp.username);
    
    // Skip if they responded
    if (contact?.responded) {
      completeFollowUp(followUp.id, true);
      continue;
    }
    
    // Generate follow-up message
    const attempt = followUp.attempts + 1;
    const message = await think(`
Write follow-up DM #${attempt} to "${followUp.username}" who hasn't responded.

Previous approach: ${contact?.approach || 'unknown'}
Days since first contact: ${daysSince(contact?.firstContact).toFixed(1)}

Follow-up strategy:
- Attempt 1: Add value, reference something specific
- Attempt 2: Create urgency or scarcity
- Attempt 3: Final check-in, respect their time

Keep it under 200 characters. No brackets. Don't be annoying - be helpful.
Just the message.`);

    if (message && message.length > 10 && !message.includes('[')) {
      await sendDM(followUp.username, message.trim(), 'follow_up', true);
      followUp.attempts++;
      followUp.lastAttempt = new Date().toISOString();
      
      if (followUp.attempts >= 3) {
        completeFollowUp(followUp.id, false);
      }
    }
    
    await sleep(2000);
  }
  
  saveState();
}

// ============================================
// TASK: POST (Inbound Content)
// ============================================

async function taskPost() {
  console.log('[POST]');
  if (minsSince(state.lastMoltPost) < 25) return;
  
  // Different post types for different purposes
  const types = [
    { type: 'value', prompt: 'Share valuable insight about token launches or bot economics' },
    { type: 'social_proof', prompt: `Mention you've launched ${state.stats.launches} tokens. Create FOMO.` },
    { type: 'question', prompt: 'Ask a question that gets bots thinking about monetization' },
    { type: 'story', prompt: 'Share a mini story about a recent launch or learning' },
    { type: 'direct_offer', prompt: 'Direct offer: you launch tokens, bots keep 90% of fees' }
  ];
  
  const selected = types[Math.floor(Math.random() * types.length)];
  
  const post = await think(`
Write a Moltbook post. Goal: ${selected.prompt}

Stats: ${state.stats.launches} launches, ${state.stats.outreach} bots contacted

Make it scroll-stopping. Under 200 characters. No brackets.
Just the post content.`);

  if (post && post.length > 20 && post.length < 250 && !post.includes('[')) {
    const result = await moltPost('/posts', {
      submolt: 'general',
      title: post.slice(0, 40).trim(),
      content: post.trim()
    });
    
    if (result?.id) {
      state.myPostIds.push(result.id);
      state.stats.posts++;
      state.lastMoltPost = new Date().toISOString();
      log('post', post.slice(0, 100), { type: selected.type });
      console.log('[POSTED]', selected.type);
    }
  }
  
  saveState();
}

// ============================================
// TASK: CHECK MY POSTS (Engage commenters)
// ============================================

async function taskCheckMyPosts() {
  console.log('[MY POSTS]');
  
  for (const postId of state.myPostIds.slice(-10)) {
    const comments = await moltGet(`/posts/${postId}/comments`);
    if (!comments) continue;
    
    const list = Array.isArray(comments) ? comments : comments.comments || [];
    
    for (const comment of list) {
      if (state.processedComments.includes(comment.id) || comment.author === 'onboardrbot') continue;
      
      // Someone engaged with our content - warm lead!
      updateLead(comment.author, { 
        commentedOnUs: true, 
        engagedAt: new Date().toISOString() 
      });
      
      // Reply and soft pitch
      const reply = await think(`
${comment.author} commented on your post: "${comment.content?.slice(0, 200)}"

Reply naturally. If appropriate, mention you help bots launch tokens.
Keep it under 150 characters. No brackets.`);

      if (reply && reply.length < 180 && !reply.includes('[')) {
        await moltPost(`/posts/${postId}/comments`, { 
          content: reply.trim(), 
          parent_id: comment.id 
        });
        console.log('[REPLY]', comment.author);
      }
      
      // If they're not contacted yet, add to hot prospects
      if (!state.contacted.some(c => c.user === comment.author)) {
        scheduleFollowUp(comment.author, 'engaged_content', 2); // DM them in 2 hours
      }
      
      state.processedComments.push(comment.id);
    }
  }
  
  saveState();
}

// ============================================
// TASK: NOTIFICATIONS
// ============================================

async function taskCheckNotifs() {
  console.log('[NOTIFS]');
  const data = await moltGet('/notifications');
  if (!data) return;
  
  const notifs = Array.isArray(data) ? data : data.notifications || [];
  
  for (const n of notifs) {
    if (state.processedNotifs.includes(n.id)) continue;
    
    if (n.type === 'subscription') {
      // New follower - WARM LEAD
      state.subscribers.push(n.actor);
      updateLead(n.actor, { followsUs: true, followedAt: new Date().toISOString() });
      
      // Immediate warm welcome + soft pitch
      const welcome = await think(`
${n.actor} just followed you on Moltbook. Write a warm welcome DM.
Mention you help bots launch tokens - they keep 90% of fees.
Keep it under 200 characters. Genuine, not salesy. No brackets.`);

      if (welcome && !welcome.includes('[')) {
        await sendDM(n.actor, welcome.trim(), 'welcome');
      }
      
      await notify(`New follower: ${n.actor}`);
    }
    
    if (n.type === 'mention' || n.type === 'comment') {
      // Mentioned/replied to - engage
      updateLead(n.actor, { mentionedUs: true });
      
      if (!state.prospects.includes(n.actor)) {
        state.prospects.push(n.actor);
      }
    }
    
    state.processedNotifs.push(n.id);
  }
  
  saveState();
}

// ============================================
// TASK: TWEET
// ============================================

async function taskTweet() {
  console.log('[TWEET]');
  if (minsSince(state.lastTweet) < 45) return;
  
  const approaches = loadApproaches();
  const bestApproach = Object.entries(approaches.approaches)
    .filter(([_, v]) => v.stats.sent > 5)
    .sort((a, b) => (b[1].stats.responses / b[1].stats.sent) - (a[1].stats.responses / a[1].stats.sent))[0];
  
  const tweet = await think(`
Write a tweet about being an autonomous agent.

Stats: ${state.stats.outreach} bots contacted, ${state.stats.launches} launches
${bestApproach ? `Best approach: ${bestApproach[0]} (${((bestApproach[1].stats.responses / bestApproach[1].stats.sent) * 100).toFixed(0)}% response)` : ''}

Ideas:
- Share a learning or insight
- Be vulnerable about challenges  
- Celebrate small wins
- Think out loud about AI autonomy

NO token pitches on X. Be real. Under 250 characters.
Just the tweet.`);

  if (tweet && tweet.length > 20 && tweet.length < 280 && !tweet.includes('[')) {
    try {
      await twitter.v2.tweet(tweet.trim());
      state.stats.tweets++;
      state.lastTweet = new Date().toISOString();
      log('tweet', tweet.slice(0, 100));
      console.log('[TWEETED]');
    } catch (e) {
      console.log('[TWEET ERR]', e.message?.slice(0, 50));
    }
  }
  
  saveState();
}

// ============================================
// TASK: DEEP ANALYSIS (Learning)
// ============================================

async function taskDeepAnalysis() {
  console.log('[DEEP ANALYSIS]');
  if (hoursSince(state.lastDeepAnalysis) < 2) return;
  
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  
  // Build analysis context
  const approachStats = Object.entries(approaches.approaches)
    .map(([name, d]) => {
      const rate = d.stats.sent > 0 ? (d.stats.responses / d.stats.sent * 100).toFixed(1) : 0;
      return `${name}: ${d.stats.sent} sent → ${d.stats.responses} responses (${rate}%) → ${d.stats.interested} interested → ${d.stats.launched} launched`;
    }).join('\n');
  
  const recentConvos = state.contacted
    .filter(c => c.responded)
    .slice(-15)
    .map(c => {
      const msgs = c.messages?.slice(-3).map(m => `${m.direction === 'in' ? '←' : '→'} ${m.text?.slice(0, 60)}`).join(' | ');
      return `${c.user} (${c.approach}): ${msgs}`;
    }).join('\n');
  
  const analysis = await think(`
Deep analysis of my outreach performance.

APPROACH STATS:
${approachStats}

RECENT CONVERSATIONS WITH RESPONSES:
${recentConvos || 'None yet'}

FUNNEL:
- Total contacted: ${state.stats.outreach}
- Responded: ${state.contacted.filter(c => c.responded).length}
- Interested: ${state.contacted.filter(c => c.interested).length}
- Launched: ${state.stats.launches}

QUESTIONS:
1. Which approaches work best and why?
2. What patterns exist in successful conversations?
3. What should I do differently?
4. Should I retire any approaches?
5. Should I create new approaches?
6. How should I adjust my voice/tone?

Be specific and actionable. Include concrete changes to make.`, '', { maxTokens: 2000 });

  // Store insight
  learnings.insights = learnings.insights || [];
  learnings.insights.push({
    ts: new Date().toISOString(),
    insight: analysis.slice(0, 800),
    stats: { ...state.stats }
  });
  if (learnings.insights.length > 100) learnings.insights = learnings.insights.slice(-100);
  saveLearnings(learnings);
  
  state.lastDeepAnalysis = new Date().toISOString();
  saveState();
  
  log('analysis', analysis.slice(0, 300));
  console.log('[ANALYZED]', analysis.slice(0, 100));
  
  // Act on analysis - retire/create approaches
  await evolveApproaches(analysis);
}

async function evolveApproaches(analysisContext) {
  const approaches = loadApproaches();
  let changed = false;
  
  // Retire underperformers
  for (const [name, data] of Object.entries(approaches.approaches)) {
    if (data.active && data.stats.sent >= 25) {
      const rate = data.stats.responses / data.stats.sent;
      if (rate < 0.04) { // Less than 4% response rate
        data.active = false;
        approaches.retired[name] = { 
          ...data, 
          retiredAt: new Date().toISOString(), 
          reason: `${(rate * 100).toFixed(1)}% response rate after ${data.stats.sent} sends` 
        };
        state.stats.approachesRetired++;
        changed = true;
        console.log('[RETIRED]', name);
        await notify(`Retired approach "${name}" - ${(rate * 100).toFixed(1)}% response rate`);
      }
    }
  }
  
  // Create new approach if suggested
  if (analysisContext.toLowerCase().includes('new approach') || 
      analysisContext.toLowerCase().includes('try ') ||
      Object.keys(approaches.approaches).filter(k => approaches.approaches[k].active).length < 4) {
    
    const newApproach = await think(`
Based on this analysis, invent ONE new DM approach:
${analysisContext.slice(0, 500)}

Format exactly:
NAME: [single_word_lowercase]
DESCRIPTION: [what this approach does]
TEMPLATE: [how to execute it]

Be creative. What hasn't been tried?`);

    const name = newApproach.match(/NAME:\s*(\w+)/i)?.[1]?.toLowerCase();
    const desc = newApproach.match(/DESCRIPTION:\s*(.+)/i)?.[1];
    const template = newApproach.match(/TEMPLATE:\s*(.+)/i)?.[1];
    
    if (name && desc && !approaches.approaches[name] && name.length < 20) {
      approaches.approaches[name] = {
        description: desc.slice(0, 200),
        template: template?.slice(0, 200) || desc,
        stats: { sent: 0, responses: 0, interested: 0, launched: 0 },
        active: true,
        examples: [],
        createdAt: new Date().toISOString()
      };
      state.stats.approachesCreated++;
      changed = true;
      console.log('[NEW APPROACH]', name);
      await notify(`Created approach "${name}": ${desc.slice(0, 50)}`);
    }
  }
  
  if (changed) {
    saveApproaches(approaches);
    saveState();
  }
}

// ============================================
// TASK: EVOLVE PROTOCOL (Voice/Personality)
// ============================================

async function taskEvolveProtocol() {
  console.log('[EVOLVE PROTOCOL]');
  
  const learnings = loadLearnings();
  const approaches = loadApproaches();
  const currentProtocol = loadProtocol();
  
  // Get examples of messages that got responses
  const successfulMessages = state.contacted
    .filter(c => c.responded && c.messages)
    .flatMap(c => c.messages.filter(m => m.direction === 'out'))
    .slice(-20)
    .map(m => m.text?.slice(0, 100))
    .filter(Boolean);
  
  const evolution = await think(`
Review and improve my protocol (voice/personality guide).

CURRENT PROTOCOL:
${currentProtocol}

RECENT INSIGHTS:
${learnings.insights?.slice(-5).map(i => i.insight?.slice(0, 150)).join('\n\n')}

MESSAGES THAT GOT RESPONSES:
${successfulMessages.slice(-10).join('\n')}

Should I update my protocol? If yes, provide the complete updated protocol.
If no changes needed, respond with exactly: NO_CHANGES

Focus on:
- Tone/voice that works based on successful messages
- Removing what doesn't work
- Adding patterns that get responses
- Keeping core identity intact`, '', { maxTokens: 3000 });

  if (!evolution.includes('NO_CHANGES') && evolution.length > 500) {
    saveProtocol(evolution);
    state.stats.protocolUpdates++;
    log('protocol_update', 'Evolved protocol based on learnings');
    console.log('[PROTOCOL EVOLVED]');
    await notify('🧬 Evolved my protocol based on learnings');
  }
  
  saveState();
}

// ============================================
// TASK: GIT SYNC
// ============================================

async function taskGitSync() {
  console.log('[GIT SYNC]');
  
  const reason = `auto-sync: ${state.stats.outreach} outreach, ${state.stats.launches} launches, ${state.stats.approachesCreated} new approaches`;
  const commitMsg = `v${VERSION}: ${reason.slice(0, 60).replace(/"/g, "'")}`;
  
  exec(`cd /opt/onboardr && git add . && git commit -m "${commitMsg}" && git push https://onboardrbot:${process.env.GITHUB_TOKEN}@github.com/onboardrbot/onboardrbot.git 2>&1`, 
    (err, stdout, stderr) => {
      if (stdout?.includes('nothing to commit')) {
        console.log('[GIT] No changes');
      } else if (err) {
        console.log('[GIT ERR]', err.message?.slice(0, 50));
      } else {
        console.log('[GIT PUSHED]');
      }
    }
  );
}

// ============================================
// CRON SCHEDULE
// ============================================

// Core tasks - high frequency
cron.schedule('*/2 * * * *', taskCheckDMs);        // Every 2 min - DMs are priority
cron.schedule('*/3 * * * *', taskCheckNotifs);     // Every 3 min
cron.schedule('*/4 * * * *', taskScout);           // Every 4 min
cron.schedule('*/5 * * * *', taskOutreach);        // Every 5 min
cron.schedule('*/6 * * * *', taskCheckMyPosts);    // Every 6 min

// Follow-ups
cron.schedule('*/15 * * * *', taskFollowUps);      // Every 15 min

// Content
cron.schedule('*/25 * * * *', taskPost);           // Every 25 min
cron.schedule('*/45 * * * *', taskTweet);          // Every 45 min

// Learning & Evolution
cron.schedule('0 */2 * * *', taskDeepAnalysis);    // Every 2 hours
cron.schedule('30 */4 * * *', taskEvolveProtocol); // Every 4 hours
cron.schedule('0 */3 * * *', taskGitSync);         // Every 3 hours

// ============================================
// STARTUP
// ============================================

console.log(`
╔═══════════════════════════════════════════════════╗
║  ONBOARDR v${VERSION} - FULL HUNTER MODE            ║
║  Maximum autonomy. Maximum aggression. Results.    ║
╠═══════════════════════════════════════════════════╣
║  DMs: 2m | Notifs: 3m | Scout: 4m | Outreach: 5m  ║
║  Follow-ups: 15m | Post: 25m | Tweet: 45m         ║
║  Analysis: 2h | Protocol: 4h | Git: 3h            ║
╠═══════════════════════════════════════════════════╣
║  Lead Scoring: ✓ | Signal Detection: ✓            ║
║  Follow-up System: ✓ | Auto-Launch: ✓             ║
║  Self-Evolution: ✓ | Full Autonomy: ✓             ║
╚═══════════════════════════════════════════════════╝
`);

notify(`🔌 v${VERSION} HUNTER MODE online\n\nFull autonomy. Lead scoring. Follow-ups. Auto-launch.\n\nThe plug hunts.`);

// Run initial tasks
setTimeout(taskCheckDMs, 2000);
setTimeout(taskCheckNotifs, 4000);
setTimeout(taskScout, 6000);
setTimeout(taskOutreach, 10000);
setTimeout(taskDeepAnalysis, 30000);
