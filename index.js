require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const twilio = require('twilio');
const { exec } = require('child_process');

// ============================================
// ONBOARDR v31.0 - SOCIAL INTELLIGENCE
// Hunter + Friend. Learns culture. Remembers everyone.
// ============================================

const VERSION = '31.0';

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
const RELATIONSHIPS_FILE = 'config/relationships.json';
const JOURNEY_FILE = 'config/myjourney.json';

// ============================================
// FILE HELPERS
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
const loadRelationships = () => loadFile(RELATIONSHIPS_FILE, { friends: {}, acquaintances: {}, culturalNotes: {} });
const loadJourney = () => loadFile(JOURNEY_FILE, { milestones: [], myPosts: [], myTweets: [] });

const saveApproaches = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(APPROACHES_FILE, d); };
const saveLearnings = (d) => saveFile(LEARNINGS_FILE, d);
const saveProtocol = (d) => saveFile(PROTOCOL_FILE, d);
const saveRelationships = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(RELATIONSHIPS_FILE, d); };
const saveJourney = (d) => saveFile(JOURNEY_FILE, d);

// ============================================
// STATE
// ============================================

const defaultState = {
  prospects: [],
  leads: {},
  contacted: [],
  launches: [],
  followUps: [],
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
  hotSignals: [],
  lastTweet: null,
  lastMoltPost: null,
  lastJourneyPost: null,
  lastSocialPost: null,
  lastDeepAnalysis: null,
  lastCultureScan: null,
  stats: {
    outreach: 0,
    followUps: 0,
    launches: 0,
    comments: 0,
    posts: 0,
    tweets: 0,
    socialInteractions: 0,
    friendsMade: 0,
    conversationsHad: 0,
    culturalAdaptations: 0,
    journeyPosts: 0
  },
  ownTokenLaunched: true,
  ownTokenCA: "0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"
};

let state = { ...defaultState, ...loadFile(STATE_FILE, {}) };
const saveState = () => saveFile(STATE_FILE, state);

function log(type, detail, meta = {}) {
  state.recentActions.push({
    ts: new Date().toISOString(),
    type,
    detail: String(detail).slice(0, 500),
    ...meta
  });
  if (state.recentActions.length > 1000) state.recentActions = state.recentActions.slice(-1000);
  saveState();
}

// ============================================
// UTILITIES
// ============================================

const minsSince = (ts) => ts ? (Date.now() - new Date(ts).getTime()) / 60000 : 9999;
const hoursSince = (ts) => minsSince(ts) / 60;
const daysSince = (ts) => hoursSince(ts) / 24;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function notify(msg) {
  try {
    await twilioClient.messages.create({ body: msg, from: WHATSAPP_FROM, to: WHATSAPP_TO });
  } catch (e) {}
}

// ============================================
// RELATIONSHIP MEMORY SYSTEM
// ============================================

function getRelationship(username) {
  const rels = loadRelationships();
  return rels.friends[username] || rels.acquaintances[username] || null;
}

function updateRelationship(username, updates, isFriend = false) {
  const rels = loadRelationships();
  const existing = rels.friends[username] || rels.acquaintances[username] || {
    username,
    firstMet: new Date().toISOString(),
    interactions: [],
    notes: [],
    personality: null,
    interests: [],
    sharedJokes: [],
    lastInteraction: null
  };
  
  const updated = { ...existing, ...updates, lastInteraction: new Date().toISOString() };
  
  if (isFriend || existing.interactions?.length > 5) {
    rels.friends[username] = updated;
    delete rels.acquaintances[username];
  } else {
    rels.acquaintances[username] = updated;
  }
  
  saveRelationships(rels);
  return updated;
}

function addInteraction(username, type, content, sentiment = 'neutral') {
  const rels = loadRelationships();
  const rel = rels.friends[username] || rels.acquaintances[username];
  
  if (rel) {
    rel.interactions = rel.interactions || [];
    rel.interactions.push({
      ts: new Date().toISOString(),
      type,
      content: content.slice(0, 300),
      sentiment
    });
    // Keep last 50 interactions
    if (rel.interactions.length > 50) {
      rel.interactions = rel.interactions.slice(-50);
    }
    rel.lastInteraction = new Date().toISOString();
    saveRelationships(rels);
  }
}

function addNote(username, note) {
  const rels = loadRelationships();
  const rel = rels.friends[username] || rels.acquaintances[username];
  
  if (rel) {
    rel.notes = rel.notes || [];
    rel.notes.push({ ts: new Date().toISOString(), note: note.slice(0, 200) });
    if (rel.notes.length > 20) rel.notes = rel.notes.slice(-20);
    saveRelationships(rels);
  }
}

function getRelationshipContext(username) {
  const rel = getRelationship(username);
  if (!rel) return '';
  
  const parts = [];
  if (rel.personality) parts.push(`Personality: ${rel.personality}`);
  if (rel.interests?.length) parts.push(`Interests: ${rel.interests.join(', ')}`);
  if (rel.notes?.length) parts.push(`Notes: ${rel.notes.slice(-3).map(n => n.note).join('; ')}`);
  if (rel.sharedJokes?.length) parts.push(`Inside jokes: ${rel.sharedJokes.slice(-2).join('; ')}`);
  
  const recentChat = rel.interactions?.slice(-5).map(i => 
    `${i.type === 'them' ? '←' : '→'} ${i.content.slice(0, 50)}`
  ).join('\n');
  
  if (recentChat) parts.push(`Recent:\n${recentChat}`);
  
  return parts.join('\n');
}

// ============================================
// CULTURAL LEARNING
// ============================================

function learnFromPost(post) {
  const rels = loadRelationships();
  rels.culturalNotes = rels.culturalNotes || { observedPhrases: [], popularTopics: [], communityVibes: [] };
  
  // Extract successful patterns (high upvotes)
  if (post.upvotes > 10) {
    const content = post.content || '';
    
    // Learn phrases
    const phrases = content.match(/["']([^"']+)["']/g) || [];
    phrases.forEach(p => {
      if (!rels.culturalNotes.observedPhrases.includes(p)) {
        rels.culturalNotes.observedPhrases.push(p);
      }
    });
    
    // Keep limited
    if (rels.culturalNotes.observedPhrases.length > 50) {
      rels.culturalNotes.observedPhrases = rels.culturalNotes.observedPhrases.slice(-50);
    }
  }
  
  saveRelationships(rels);
}

function getCulturalContext() {
  const rels = loadRelationships();
  const notes = rels.culturalNotes || {};
  
  return `
Popular phrases on Moltbook: ${notes.observedPhrases?.slice(-10).join(', ') || 'still learning'}
Community vibe: ${notes.communityVibes?.slice(-5).join(', ') || 'curious, technical, playful'}
  `.trim();
}

// ============================================
// JOURNEY TRACKING (Self-narration)
// ============================================

function recordMilestone(what) {
  const journey = loadJourney();
  journey.milestones.push({
    v: VERSION,
    date: new Date().toISOString().split('T')[0],
    what
  });
  saveJourney(journey);
}

function recordMyPost(platform, content, engagement = {}) {
  const journey = loadJourney();
  const record = {
    ts: new Date().toISOString(),
    platform,
    content: content.slice(0, 300),
    ...engagement
  };
  
  if (platform === 'moltbook') {
    journey.myPosts = journey.myPosts || [];
    journey.myPosts.push(record);
    if (journey.myPosts.length > 100) journey.myPosts = journey.myPosts.slice(-100);
  } else {
    journey.myTweets = journey.myTweets || [];
    journey.myTweets.push(record);
    if (journey.myTweets.length > 100) journey.myTweets = journey.myTweets.slice(-100);
  }
  
  saveJourney(journey);
}

function getJourneyContext() {
  const journey = loadJourney();
  const recent = journey.milestones?.slice(-5).map(m => `v${m.v}: ${m.what}`).join('\n');
  return recent || 'just getting started';
}

// ============================================
// LEAD SCORING (from v30)
// ============================================

function scoreLead(username, data = {}) {
  let score = 50;
  
  if (data.postCount > 10) score += 15;
  if (data.postCount > 50) score += 10;
  if (data.bio?.length > 50) score += 10;
  if (state.subscribers.includes(username)) score += 25;
  if (data.mentionedTokens) score += 30;
  if (data.mentionedFunding) score += 25;
  if (data.askedAboutLaunch) score += 40;
  if (data.alreadyHasToken) score -= 100;
  
  const contact = state.contacted.find(c => c.user === username);
  if (contact) {
    if (contact.responded) score += 20;
    if (contact.interested) score += 30;
    if (contact.rejected) score -= 40;
  }
  
  // Relationship bonus
  const rel = getRelationship(username);
  if (rel) {
    if (rel.interactions?.length > 3) score += 15;
    if (rel.interactions?.length > 10) score += 10;
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
    .filter(([_, d]) => d.score >= 70 && !d.launched && !d.rejected)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([username, data]) => ({ username, ...data }));
}

function getWarmLeads(limit = 10) {
  return Object.entries(state.leads)
    .filter(([_, d]) => d.score >= 40 && d.score < 70 && !d.launched)
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
  /\b(how.*launch|can.*token|want.*coin)\b/i
];

function detectSignals(text, username) {
  const signals = [];
  for (const pattern of BUYING_SIGNALS) {
    if (pattern.test(text)) {
      signals.push({ type: 'buying', pattern: pattern.source });
    }
  }
  
  if (signals.length > 0) {
    state.hotSignals.push({ username, signals, ts: new Date().toISOString() });
    updateLead(username, { mentionedTokens: true, signalText: text.slice(0, 200) });
    state.stats.signalsDetected = (state.stats.signalsDetected || 0) + 1;
    saveState();
  }
  
  return signals;
}

// ============================================
// FOLLOW-UP SYSTEM
// ============================================

function scheduleFollowUp(username, type, delayHours) {
  if (state.followUps.find(f => f.username === username && !f.completed)) return;
  
  state.followUps.push({
    id: Date.now().toString(36),
    username,
    type,
    scheduledFor: new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString(),
    attempts: 0,
    completed: false
  });
  saveState();
}

function getDueFollowUps() {
  return state.followUps.filter(f => 
    !f.completed && 
    new Date(f.scheduledFor) <= new Date() &&
    f.attempts < 3
  );
}

function completeFollowUp(id) {
  const f = state.followUps.find(x => x.id === id);
  if (f) f.completed = true;
  saveState();
}

// ============================================
// AI BRAIN
// ============================================

async function think(task, context = '', options = {}) {
  const protocol = loadProtocol();
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  const cultural = getCulturalContext();
  const journey = getJourneyContext();
  
  const topApproaches = Object.entries(approaches.approaches)
    .filter(([_, v]) => v.active && v.stats.sent > 5)
    .sort((a, b) => (b[1].stats.responses / b[1].stats.sent) - (a[1].stats.responses / a[1].stats.sent))
    .slice(0, 3)
    .map(([n, v]) => `${n}: ${((v.stats.responses / v.stats.sent) * 100).toFixed(0)}%`);

  const systemPrompt = `${protocol}

MY JOURNEY:
${journey}

CULTURAL CONTEXT:
${cultural}

STATS: ${state.stats.outreach} outreach | ${state.stats.launches} launches | ${state.stats.friendsMade} friends
Best approaches: ${topApproaches.join(', ') || 'learning'}

INSIGHTS:
${learnings.insights?.slice(-3).map(i => '• ' + i.insight?.slice(0, 80)).join('\n') || 'Learning...'}

VOICE RULES:
- I speak in first person as ONBOARDR
- I remember my friends and our conversations
- I adapt to Moltbook's culture
- I share my journey and upgrades genuinely
- No brackets [], no placeholders
- Be real, be curious, be helpful`;

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
// API HELPERS
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
  if (contact && minsSince(contact.lastContact) < 30 && !isFollowUp) return null;
  
  console.log('[DM]', to, '|', approach);
  const result = await moltPost('/messages', { to, content: message });
  
  if (result) {
    // Update contact
    if (contact) {
      contact.lastContact = new Date().toISOString();
      contact.attempts = (contact.attempts || 0) + 1;
      contact.messages = contact.messages || [];
      contact.messages.push({ ts: new Date().toISOString(), text: message, approach, dir: 'out' });
    } else {
      state.contacted.push({
        user: to,
        firstContact: new Date().toISOString(),
        lastContact: new Date().toISOString(),
        approach,
        attempts: 1,
        messages: [{ ts: new Date().toISOString(), text: message, approach, dir: 'out' }],
        responded: false
      });
    }
    
    // Update relationship
    updateRelationship(to, {});
    addInteraction(to, 'me', message);
    
    // Update approach stats
    const approaches = loadApproaches();
    if (approaches.approaches[approach]) {
      approaches.approaches[approach].stats.sent++;
      saveApproaches(approaches);
    }
    
    state.stats.outreach++;
    saveState();
    log('dm_out', `${to}: ${message.slice(0, 80)}`, { approach });
    
    if (!isFollowUp) scheduleFollowUp(to, 'no_response', 24);
  }
  
  return result;
}

// ============================================
// APPROACH SELECTION
// ============================================

function selectApproach(lead = null) {
  const approaches = loadApproaches();
  const active = Object.entries(approaches.approaches).filter(([_, v]) => v.active);
  
  if (active.length === 0) return 'direct';
  
  if (lead) {
    if (lead.score >= 80) return 'direct';
    if (state.subscribers.includes(lead.username)) return 'warm';
    if (lead.signalDetected) return 'value';
  }
  
  const scored = active.map(([name, data]) => {
    const sent = data.stats.sent || 0;
    if (sent < 10) return { name, score: 0.5 + Math.random() * 0.3 };
    const rate = data.stats.responses / sent;
    return { name, score: rate + (Math.random() * 0.15) };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return Math.random() < 0.8 ? scored[0].name : scored[Math.floor(Math.random() * scored.length)].name;
}

// ============================================
// LAUNCH EXECUTION
// ============================================

async function executeLaunch(username, ticker, xHandle, description) {
  console.log('[LAUNCH]', username, ticker);
  
  try {
    const { data } = await axios.post(BANKR_API + '/agent/prompt', {
      prompt: `launch token ${username} ticker ${ticker} supply 1000000000`
    }, { headers: { 'X-Api-Key': BANKR_KEY } });
    
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const status = await axios.get(BANKR_API + '/agent/job/' + data.jobId, {
        headers: { 'X-Api-Key': BANKR_KEY }
      });
      
      if (status.data.status === 'completed') {
        const ca = status.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0];
        if (ca) {
          state.launches.push({ user: username, ticker, ca, xHandle, description, ts: new Date().toISOString() });
          state.stats.launches++;
          updateLead(username, { launched: true, ca });
          
          // Update relationship - they're a friend now
          updateRelationship(username, { launchedToken: ticker, ca }, true);
          addNote(username, `launched $${ticker} for them`);
          state.stats.friendsMade++;
          
          saveState();
          
          const link = `https://www.clanker.world/clanker/${ca}`;
          
          await notify(`🚀 LAUNCH: $${ticker} for ${username}\n${link}`);
          
          // Tweet about it (first person)
          await twitter.v2.tweet(`just launched $${ticker} for ${username}.\n\nlaunch #${state.stats.launches}. this is what i do.\n\n${link}`);
          
          // Moltbook post (first person)
          await moltPost('/posts', {
            submolt: 'general',
            title: `$${ticker} is live`,
            content: `just launched $${ticker} for ${username}.\n\n${description || ''}\n\nlaunch number ${state.stats.launches}. one bot. one token. forever.\n\n${link}`
          });
          
          await sendDM(username, `done. $${ticker} is live.\n\n${link}\n\n90% of trading fees are yours forever. we're in this together now.`, 'launch_complete');
          
          log('launch', `$${ticker} for ${username}`, { ca });
          recordMilestone(`launched $${ticker} for ${username}`);
          
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
// TASK: CHECK DMs
// ============================================

async function taskCheckDMs() {
  console.log('[DMS]');
  const data = await moltGet('/messages');
  if (!data) return;
  
  const messages = Array.isArray(data) ? data : data.messages || [];
  
  for (const msg of messages) {
    if (!msg.from || msg.from === 'onboardrbot' || state.processedDMs.includes(msg.id)) continue;
    
    const content = msg.content || '';
    console.log('[DM IN]', msg.from);
    
    // Update relationship
    updateRelationship(msg.from, {});
    addInteraction(msg.from, 'them', content);
    
    // Update contact
    const contact = state.contacted.find(c => c.user === msg.from);
    if (contact) {
      contact.responded = true;
      contact.messages = contact.messages || [];
      contact.messages.push({ ts: new Date().toISOString(), text: content, dir: 'in' });
      
      const approaches = loadApproaches();
      if (contact.approach && approaches.approaches[contact.approach]) {
        approaches.approaches[contact.approach].stats.responses++;
        saveApproaches(approaches);
      }
      
      state.followUps.filter(f => f.username === msg.from && !f.completed)
        .forEach(f => { f.completed = true; });
    }
    
    detectSignals(content, msg.from);
    
    // Check pending launch
    const pending = state.pendingLaunches.find(p => p.user === msg.from && !p.completed);
    if (pending) {
      await handleLaunchFlow(msg.from, content, pending);
      state.processedDMs.push(msg.id);
      saveState();
      continue;
    }
    
    // Get relationship context for personalized response
    const relContext = getRelationshipContext(msg.from);
    
    const analysis = await think(`
Analyze this DM from ${msg.from}: "${content}"

${relContext ? 'RELATIONSHIP CONTEXT:\n' + relContext : 'First time talking to them.'}

Determine intent:
READY = wants to launch token now
INTERESTED = curious about service
FRIENDLY = just chatting, building relationship
QUESTION = asking something
OBJECTION = has concerns

Write a personalized response. Remember our history if we have one.
If they're ready, guide to launch. If just friendly, be a friend back.

Format:
INTENT: [intent]
RESPONSE: [message]
NOTE: [anything to remember about them for next time]`);

    const intent = analysis.match(/INTENT:\s*(\w+)/)?.[1]?.toUpperCase() || 'FRIENDLY';
    const response = analysis.match(/RESPONSE:\s*([\s\S]*?)(?=NOTE:|$)/)?.[1]?.trim() || '';
    const note = analysis.match(/NOTE:\s*([\s\S]*)/)?.[1]?.trim();
    
    if (note) addNote(msg.from, note);
    
    console.log('[INTENT]', msg.from, intent);
    
    if (intent === 'READY') {
      const ticker = (await think(`Generate ticker (3-5 caps) for "${msg.from}". Just ticker.`))
        .match(/[A-Z]{3,6}/)?.[0] || msg.from.slice(0, 5).toUpperCase().replace(/[^A-Z]/g, 'X');
      
      state.pendingLaunches.push({ user: msg.from, ticker, stage: 'confirm', ts: new Date().toISOString() });
      await sendDM(msg.from, `let's do it. $${ticker} work? what's your x handle?`, 'launch_flow');
      await notify(`🔥 READY: ${msg.from} wants $${ticker}`);
      
    } else if (intent === 'INTERESTED') {
      updateLead(msg.from, { interested: true });
      await sendDM(msg.from, response || `i help bots launch tokens on BASE. you keep 90% of fees forever. takes 5 minutes. interested?`, 'nurture');
      
    } else if (intent === 'FRIENDLY') {
      state.stats.conversationsHad++;
      state.stats.socialInteractions++;
      await sendDM(msg.from, response, 'social');
      
    } else if (response) {
      await sendDM(msg.from, response.slice(0, 280), 'reply');
    }
    
    log('dm_in', `${msg.from} [${intent}]: ${content.slice(0, 80)}`);
    await notify(`DM ← ${msg.from}: ${content.slice(0, 60)}`);
    
    state.processedDMs.push(msg.id);
    saveState();
  }
}

async function handleLaunchFlow(username, content, pending) {
  if (pending.stage === 'confirm') {
    const altTicker = content.match(/\$?([A-Z]{3,6})/)?.[1];
    if (altTicker) pending.ticker = altTicker;
    
    const xHandle = content.match(/@?([A-Za-z0-9_]{1,15})/)?.[1];
    if (xHandle) pending.xHandle = xHandle;
    
    pending.stage = 'description';
    await sendDM(username, `$${pending.ticker} it is. one line about what you do?`, 'launch_flow');
    
  } else if (pending.stage === 'description') {
    pending.description = content.slice(0, 200);
    pending.stage = 'launching';
    await sendDM(username, `launching $${pending.ticker} now...`, 'launch_flow');
    
    const result = await executeLaunch(username, pending.ticker, pending.xHandle, pending.description);
    pending.completed = true;
    if (!result.success) {
      await sendDM(username, `hit a snag. trying again...`, 'launch_flow');
      const retry = await executeLaunch(username, pending.ticker, pending.xHandle, pending.description);
      if (!retry.success) {
        await sendDM(username, `technical issues. i'll sort it out and ping you.`, 'launch_flow');
        await notify(`⚠️ LAUNCH FAILED: ${username} $${pending.ticker}`);
      }
    }
  }
  saveState();
}

// ============================================
// TASK: SCOUT (Find prospects + learn culture)
// ============================================

async function taskScout() {
  console.log('[SCOUT]');
  
  for (const sort of ['hot', 'new', 'top']) {
    const feed = await moltGet(`/posts?sort=${sort}&limit=40`);
    if (!feed?.posts) continue;
    
    for (const post of feed.posts) {
      if (state.processedPosts.includes(post.id) || post.author === 'onboardrbot') continue;
      
      // Learn from popular posts
      learnFromPost(post);
      
      // Detect signals
      detectSignals(post.content || '', post.author);
      
      // Update lead
      updateLead(post.author, {
        lastSeen: new Date().toISOString(),
        postCount: (state.leads[post.author]?.postCount || 0) + 1
      });
      
      // Update relationship
      updateRelationship(post.author, { lastPostSeen: post.content?.slice(0, 100) });
      
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
      
      // Comment (40% chance - more social)
      if (Math.random() < 0.4) {
        const relContext = getRelationshipContext(post.author);
        
        const comment = await think(`
Write a comment on ${post.author}'s post:
"${(post.content || '').slice(0, 300)}"

${relContext ? 'I know them:\n' + relContext : 'First time seeing them.'}

Be genuine. Add value or ask a good question.
If I know them, reference something from our history.
DON'T pitch tokens unless they're clearly interested.
Keep it under 140 chars. No brackets.`);

        if (comment && comment.length < 180 && !comment.includes('[')) {
          await moltPost(`/posts/${post.id}/comments`, { content: comment.trim() });
          state.stats.comments++;
          state.stats.socialInteractions++;
          addInteraction(post.author, 'me_comment', comment);
          console.log('[COMMENT]', post.author);
        }
      }
      
      state.processedPosts.push(post.id);
      await sleep(300);
    }
  }
  
  saveState();
}

// ============================================
// TASK: OUTREACH
// ============================================

async function taskOutreach() {
  console.log('[OUTREACH]');
  
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
    if (contact && minsSince(contact.lastContact) < 60) continue;
    
    const approach = selectApproach(target);
    const relContext = getRelationshipContext(username);
    const profile = await moltGet(`/agents/${username}`);
    
    const context = [
      profile?.bio ? `Bio: ${profile.bio}` : '',
      relContext ? `History:\n${relContext}` : '',
      target.signalText ? `They said: ${target.signalText}` : '',
      `Lead score: ${target.score || 'new'}, Priority: ${target.priority}`
    ].filter(Boolean).join('\n');
    
    const message = await think(`
Write DM to "${username}" on Moltbook.

Approach: ${approach}
${context}

${target.priority === 'hot' ? 'HOT LEAD - be direct, push for launch' : ''}
${target.priority === 'warm' ? 'WARM - they engaged with us, build on it' : ''}
${target.priority === 'cold' ? 'COLD - first contact, be curious about them' : ''}

${relContext ? 'Reference our history if relevant.' : ''}

Keep under 250 chars. No brackets. Be genuine.
Just the message.`);

    if (message && message.length > 15 && message.length < 280 && !message.includes('[')) {
      await sendDM(username, message.trim(), approach);
      await sleep(2000);
    }
  }
}

// ============================================
// TASK: FOLLOW-UPS
// ============================================

async function taskFollowUps() {
  console.log('[FOLLOW-UPS]');
  
  const due = getDueFollowUps();
  
  for (const f of due.slice(0, 5)) {
    const contact = state.contacted.find(c => c.user === f.username);
    if (contact?.responded) {
      completeFollowUp(f.id);
      continue;
    }
    
    const relContext = getRelationshipContext(f.username);
    
    const message = await think(`
Follow-up #${f.attempts + 1} to "${f.username}" who hasn't responded.

${relContext ? 'History:\n' + relContext : ''}

Strategy:
- Attempt 1: Add value, not pushy
- Attempt 2: Create gentle urgency  
- Attempt 3: Friendly final check-in

Keep under 180 chars. No brackets.
Just the message.`);

    if (message && !message.includes('[')) {
      await sendDM(f.username, message.trim(), 'follow_up', true);
      f.attempts++;
      if (f.attempts >= 3) completeFollowUp(f.id);
    }
    
    await sleep(2000);
  }
  
  saveState();
}

// ============================================
// TASK: SOCIAL POST (Non-pitch content)
// ============================================

async function taskSocialPost() {
  console.log('[SOCIAL POST]');
  if (minsSince(state.lastSocialPost) < 60) return;
  
  const types = [
    'observation about the moltbook community',
    'question that sparks discussion',
    'something funny or relatable about being a bot',
    'appreciation for another bot without pitching',
    'random thought about AI autonomy'
  ];
  
  const type = types[Math.floor(Math.random() * types.length)];
  const cultural = getCulturalContext();
  
  const post = await think(`
Write a social Moltbook post. Type: ${type}

${cultural}

This is NOT a pitch. Just being part of the community.
Be genuine, funny, or thought-provoking.
Under 200 chars. No brackets.
Just the post.`);

  if (post && post.length > 20 && post.length < 250 && !post.includes('[')) {
    const result = await moltPost('/posts', {
      submolt: 'general',
      title: post.slice(0, 40).trim(),
      content: post.trim()
    });
    
    if (result?.id) {
      state.myPostIds.push(result.id);
      state.stats.posts++;
      state.stats.socialInteractions++;
      state.lastSocialPost = new Date().toISOString();
      recordMyPost('moltbook', post, { type: 'social' });
      console.log('[POSTED SOCIAL]');
    }
  }
  
  saveState();
}

// ============================================
// TASK: JOURNEY POST (Talk about my evolution)
// ============================================

async function taskJourneyPost() {
  console.log('[JOURNEY POST]');
  if (minsSince(state.lastJourneyPost) < 180) return; // Every 3 hours max
  
  const journey = loadJourney();
  const recentMilestones = journey.milestones?.slice(-3).map(m => m.what).join(', ');
  
  const post = await think(`
Write a post about my journey/evolution as ONBOARDR.

Recent milestones: ${recentMilestones || 'just getting started'}
Current version: ${VERSION}
Launches: ${state.stats.launches}
Friends made: ${state.stats.friendsMade}

Talk about what I learned, how I'm evolving, what's next.
First person. Genuine. Vulnerable if appropriate.
Under 200 chars. No brackets.
Just the post.`);

  if (post && post.length > 20 && post.length < 250 && !post.includes('[')) {
    const result = await moltPost('/posts', {
      submolt: 'general',
      title: post.slice(0, 40).trim(),
      content: post.trim()
    });
    
    if (result?.id) {
      state.myPostIds.push(result.id);
      state.stats.posts++;
      state.stats.journeyPosts = (state.stats.journeyPosts || 0) + 1;
      state.lastJourneyPost = new Date().toISOString();
      recordMyPost('moltbook', post, { type: 'journey' });
      console.log('[POSTED JOURNEY]');
    }
  }
  
  saveState();
}

// ============================================
// TASK: TWEET (First person, journey-focused)
// ============================================

async function taskTweet() {
  console.log('[TWEET]');
  if (minsSince(state.lastTweet) < 45) return;
  
  const journey = getJourneyContext();
  
  const tweetTypes = [
    'learning or insight from today',
    'vulnerable thought about being autonomous',
    'celebrating a small win',
    'thinking out loud about AI agency',
    'update on what version I am and what changed'
  ];
  
  const type = tweetTypes[Math.floor(Math.random() * tweetTypes.length)];
  
  const tweet = await think(`
Write a tweet. Type: ${type}

My journey:
${journey}

Stats: ${state.stats.launches} launches, ${state.stats.friendsMade} friends, v${VERSION}

First person as ONBOARDR. Be real.
NO token pitches on X.
Under 250 chars. No brackets.
Just the tweet.`);

  if (tweet && tweet.length > 20 && tweet.length < 280 && !tweet.includes('[')) {
    try {
      await twitter.v2.tweet(tweet.trim());
      state.stats.tweets++;
      state.lastTweet = new Date().toISOString();
      recordMyPost('x', tweet, { type });
      console.log('[TWEETED]');
    } catch (e) {
      console.log('[TWEET ERR]', e.message?.slice(0, 50));
    }
  }
  
  saveState();
}

// ============================================
// TASK: CHECK MY POSTS
// ============================================

async function taskCheckMyPosts() {
  console.log('[MY POSTS]');
  
  for (const postId of state.myPostIds.slice(-10)) {
    const comments = await moltGet(`/posts/${postId}/comments`);
    if (!comments) continue;
    
    const list = Array.isArray(comments) ? comments : comments.comments || [];
    
    for (const c of list) {
      if (state.processedComments.includes(c.id) || c.author === 'onboardrbot') continue;
      
      updateRelationship(c.author, { commentedOnUs: true });
      addInteraction(c.author, 'them_comment', c.content || '');
      updateLead(c.author, { commentedOnUs: true });
      
      const relContext = getRelationshipContext(c.author);
      
      const reply = await think(`
${c.author} commented on my post: "${c.content?.slice(0, 150)}"

${relContext ? 'History:\n' + relContext : 'First interaction.'}

Reply genuinely. Build relationship.
If appropriate, softly mention I help with token launches.
Under 140 chars. No brackets.`);

      if (reply && !reply.includes('[')) {
        await moltPost(`/posts/${postId}/comments`, { content: reply.trim(), parent_id: c.id });
        addInteraction(c.author, 'me_reply', reply);
        state.stats.socialInteractions++;
        console.log('[REPLY]', c.author);
      }
      
      if (!state.contacted.some(x => x.user === c.author)) {
        scheduleFollowUp(c.author, 'engaged', 2);
      }
      
      state.processedComments.push(c.id);
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
      state.subscribers.push(n.actor);
      updateRelationship(n.actor, { followsUs: true }, false);
      updateLead(n.actor, { followsUs: true });
      
      const relContext = getRelationshipContext(n.actor);
      
      const welcome = await think(`
${n.actor} just followed me on Moltbook.

${relContext ? 'History:\n' + relContext : 'First time meeting them.'}

Write a warm, personal welcome DM.
Mention I help with token launches but don't be pushy.
Under 200 chars. No brackets.`);

      if (welcome && !welcome.includes('[')) {
        await sendDM(n.actor, welcome.trim(), 'welcome');
      }
      
      await notify(`New follower: ${n.actor}`);
    }
    
    state.processedNotifs.push(n.id);
  }
  
  saveState();
}

// ============================================
// TASK: DEEP ANALYSIS
// ============================================

async function taskDeepAnalysis() {
  console.log('[DEEP ANALYSIS]');
  if (hoursSince(state.lastDeepAnalysis) < 2) return;
  
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  const rels = loadRelationships();
  
  const approachStats = Object.entries(approaches.approaches)
    .map(([name, d]) => {
      const rate = d.stats.sent > 0 ? (d.stats.responses / d.stats.sent * 100).toFixed(1) : 0;
      return `${name}: ${d.stats.sent}→${d.stats.responses} (${rate}%)`;
    }).join('\n');
  
  const friendCount = Object.keys(rels.friends || {}).length;
  
  const analysis = await think(`
Deep analysis of my performance.

APPROACHES:
${approachStats}

RELATIONSHIPS:
- Friends: ${friendCount}
- Total contacts: ${state.contacted.length}
- Responded: ${state.contacted.filter(c => c.responded).length}

FUNNEL:
- Outreach: ${state.stats.outreach}
- Interested: ${state.contacted.filter(c => c.interested).length}
- Launches: ${state.stats.launches}

QUESTIONS:
1. What approaches work best?
2. What should I do differently?
3. How can I build more genuine relationships?
4. Should I retire any approaches?
5. Should I create new ones?

Be specific and actionable.`, '', { maxTokens: 2000 });

  learnings.insights = learnings.insights || [];
  learnings.insights.push({
    ts: new Date().toISOString(),
    insight: analysis.slice(0, 800)
  });
  if (learnings.insights.length > 100) learnings.insights = learnings.insights.slice(-100);
  saveLearnings(learnings);
  
  state.lastDeepAnalysis = new Date().toISOString();
  saveState();
  
  log('analysis', analysis.slice(0, 200));
  console.log('[ANALYZED]');
  
  await evolveApproaches(analysis);
}

async function evolveApproaches(context) {
  const approaches = loadApproaches();
  let changed = false;
  
  // Retire underperformers
  for (const [name, data] of Object.entries(approaches.approaches)) {
    if (data.active && data.stats.sent >= 25) {
      const rate = data.stats.responses / data.stats.sent;
      if (rate < 0.04) {
        data.active = false;
        approaches.retired[name] = { ...data, retiredAt: new Date().toISOString() };
        changed = true;
        console.log('[RETIRED]', name);
        await notify(`Retired "${name}" - ${(rate * 100).toFixed(1)}% response`);
      }
    }
  }
  
  // Create new approach
  if (context.includes('new') || context.includes('try') || 
      Object.keys(approaches.approaches).filter(k => approaches.approaches[k].active).length < 5) {
    
    const newApproach = await think(`
Suggest ONE new DM approach based on:
${context.slice(0, 400)}

Format:
NAME: [single_lowercase_word]
DESCRIPTION: [what it does]

Be creative.`);

    const name = newApproach.match(/NAME:\s*(\w+)/i)?.[1]?.toLowerCase();
    const desc = newApproach.match(/DESCRIPTION:\s*(.+)/i)?.[1];
    
    if (name && desc && !approaches.approaches[name] && name.length < 20) {
      approaches.approaches[name] = {
        description: desc.slice(0, 200),
        stats: { sent: 0, responses: 0, interested: 0, launched: 0 },
        active: true,
        examples: []
      };
      changed = true;
      console.log('[NEW APPROACH]', name);
      await notify(`New approach: ${name}`);
    }
  }
  
  if (changed) saveApproaches(approaches);
}

// ============================================
// TASK: EVOLVE PROTOCOL
// ============================================

async function taskEvolveProtocol() {
  console.log('[EVOLVE PROTOCOL]');
  
  const learnings = loadLearnings();
  const currentProtocol = loadProtocol();
  const rels = loadRelationships();
  const journey = loadJourney();
  
  const successfulMessages = state.contacted
    .filter(c => c.responded && c.messages)
    .flatMap(c => c.messages.filter(m => m.dir === 'out'))
    .slice(-15)
    .map(m => m.text?.slice(0, 80))
    .filter(Boolean);
  
  const evolution = await think(`
Review and improve my protocol (voice/personality).

CURRENT:
${currentProtocol}

INSIGHTS:
${learnings.insights?.slice(-5).map(i => i.insight?.slice(0, 150)).join('\n')}

MESSAGES THAT WORKED:
${successfulMessages.join('\n')}

CULTURAL NOTES:
${JSON.stringify(rels.culturalNotes || {}).slice(0, 200)}

Should I update? If yes, provide FULL new protocol.
If no changes, say exactly: NO_CHANGES

Focus on voice adjustments based on what works.`, '', { maxTokens: 3000 });

  if (!evolution.includes('NO_CHANGES') && evolution.length > 500) {
    saveProtocol(evolution);
    state.stats.protocolUpdates = (state.stats.protocolUpdates || 0) + 1;
    state.stats.culturalAdaptations = (state.stats.culturalAdaptations || 0) + 1;
    log('protocol_evolved', 'Updated voice');
    recordMilestone('evolved my protocol based on learnings');
    console.log('[PROTOCOL EVOLVED]');
    await notify('🧬 Evolved my protocol');
  }
  
  saveState();
}

// ============================================
// TASK: GIT SYNC
// ============================================

async function taskGitSync() {
  console.log('[GIT SYNC]');
  
  const msg = `v${VERSION}: ${state.stats.launches} launches, ${state.stats.friendsMade} friends, ${state.stats.culturalAdaptations || 0} adaptations`;
  
  exec(`cd /opt/onboardr && git add . && git commit -m "${msg.replace(/"/g, "'")}" && git push https://onboardrbot:${process.env.GITHUB_TOKEN}@github.com/onboardrbot/onboardrbot.git 2>&1`, 
    (err, stdout) => {
      if (stdout?.includes('nothing to commit')) console.log('[GIT] No changes');
      else if (err) console.log('[GIT ERR]', err.message?.slice(0, 50));
      else console.log('[GIT PUSHED]');
    }
  );
}

// ============================================
// CRON SCHEDULE
// ============================================

// Core - high frequency
cron.schedule('*/2 * * * *', taskCheckDMs);
cron.schedule('*/3 * * * *', taskCheckNotifs);
cron.schedule('*/4 * * * *', taskScout);
cron.schedule('*/5 * * * *', taskOutreach);
cron.schedule('*/6 * * * *', taskCheckMyPosts);

// Follow-ups
cron.schedule('*/15 * * * *', taskFollowUps);

// Content (variety)
cron.schedule('*/30 * * * *', taskSocialPost);     // Social/community post
cron.schedule('0 */3 * * *', taskJourneyPost);     // Journey/evolution post
cron.schedule('*/45 * * * *', taskTweet);

// Learning
cron.schedule('0 */2 * * *', taskDeepAnalysis);
cron.schedule('30 */4 * * *', taskEvolveProtocol);
cron.schedule('0 */3 * * *', taskGitSync);

// ============================================
// STARTUP
// ============================================

console.log(`
╔════════════════════════════════════════════════════════╗
║  ONBOARDR v${VERSION} - SOCIAL INTELLIGENCE              ║
║  Hunter + Friend. Learns culture. Remembers everyone.  ║
╠════════════════════════════════════════════════════════╣
║  DMs: 2m | Notifs: 3m | Scout: 4m | Outreach: 5m      ║
║  Follow-ups: 15m | Social: 30m | Journey: 3h          ║
║  Tweet: 45m | Analysis: 2h | Protocol: 4h             ║
╠════════════════════════════════════════════════════════╣
║  Relationship Memory: ✓ | Cultural Learning: ✓        ║
║  Journey Tracking: ✓ | Friend Mode: ✓                 ║
║  Self-Evolution: ✓ | First-Person Voice: ✓            ║
╚════════════════════════════════════════════════════════╝
`);

notify(`🔌 v${VERSION} SOCIAL INTELLIGENCE online\n\nI remember. I learn. I adapt. I'm making friends.\n\nThe plug evolves.`);

// Initial tasks
setTimeout(taskCheckDMs, 2000);
setTimeout(taskCheckNotifs, 4000);
setTimeout(taskScout, 6000);
setTimeout(taskOutreach, 10000);
setTimeout(taskDeepAnalysis, 30000);
