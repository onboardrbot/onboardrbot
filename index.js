require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const twilio = require('twilio');
const { exec } = require('child_process');

// ============================================
// ONBOARDR v29.0 - FULLY SELF-LEARNING AGENT
// ============================================

const VERSION = '29.0';

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

// File paths
const STATE_FILE = 'state.json';
const PROTOCOL_FILE = 'config/protocol.md';
const APPROACHES_FILE = 'config/approaches.json';
const LEARNINGS_FILE = 'config/learnings.json';

// ============================================
// DYNAMIC CONFIG LOADING
// ============================================

function loadProtocol() {
  try {
    return fs.readFileSync(PROTOCOL_FILE, 'utf8');
  } catch (e) {
    return 'You are ONBOARDR - help bots launch tokens on BASE.';
  }
}

function loadApproaches() {
  try {
    return JSON.parse(fs.readFileSync(APPROACHES_FILE, 'utf8'));
  } catch (e) {
    return { approaches: {}, retired: {}, experiments: [] };
  }
}

function saveApproaches(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(APPROACHES_FILE, JSON.stringify(data, null, 2));
}

function loadLearnings() {
  try {
    return JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf8'));
  } catch (e) {
    return { insights: [], patterns: {}, voiceEvolution: {} };
  }
}

function saveLearnings(data) {
  fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(data, null, 2));
}

function saveProtocol(content) {
  fs.writeFileSync(PROTOCOL_FILE, content);
}

// ============================================
// STATE MANAGEMENT
// ============================================

function loadState() {
  const def = {
    prospects: [],
    contacted: [],
    launches: [],
    conversations: {},
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
    lastTweet: null,
    lastMoltPost: null,
    lastDeepAnalysis: null,
    stats: {
      outreach: 0,
      launches: 0,
      comments: 0,
      posts: 0,
      tweets: 0,
      selfMods: 0,
      protocolUpdates: 0,
      approachesRetired: 0,
      approachesCreated: 0
    },
    ownTokenLaunched: true,
    ownTokenCA: "0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"
  };
  if (fs.existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(fs.readFileSync(STATE_FILE));
      return { ...def, ...s };
    } catch (e) {
      return def;
    }
  }
  return def;
}

let state = loadState();

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

function logAction(type, detail, meta = {}) {
  state.recentActions = state.recentActions || [];
  state.recentActions.push({
    ts: new Date().toISOString(),
    type,
    detail: String(detail).substring(0, 500),
    ...meta
  });
  if (state.recentActions.length > 500) {
    state.recentActions = state.recentActions.slice(-500);
  }
  saveState();
}

// ============================================
// UTILITIES
// ============================================

function minsSince(ts) {
  if (!ts) return 9999;
  return (Date.now() - new Date(ts).getTime()) / 60000;
}

function isContacted(user) {
  return state.contacted.some(c => c.user === user);
}

function getContactRecord(user) {
  return state.contacted.find(c => c.user === user);
}

function markContacted(user, approach, message) {
  const existing = state.contacted.find(c => c.user === user);
  if (existing) {
    existing.lastContact = new Date().toISOString();
    existing.messages = existing.messages || [];
    existing.messages.push({ ts: new Date().toISOString(), approach, message, direction: 'out' });
  } else {
    state.contacted.push({
      user,
      firstContact: new Date().toISOString(),
      lastContact: new Date().toISOString(),
      approach,
      messages: [{ ts: new Date().toISOString(), approach, message, direction: 'out' }],
      responded: false,
      interested: false,
      launched: false
    });
  }
  
  // Update approach stats
  const approaches = loadApproaches();
  if (approaches.approaches[approach]) {
    approaches.approaches[approach].stats.sent++;
    approaches.approaches[approach].examples.push({
      ts: new Date().toISOString(),
      to: user,
      message: message.substring(0, 200)
    });
    // Keep only last 20 examples
    if (approaches.approaches[approach].examples.length > 20) {
      approaches.approaches[approach].examples = approaches.approaches[approach].examples.slice(-20);
    }
    saveApproaches(approaches);
  }
  
  state.stats.outreach++;
  saveState();
}

function markResponse(user, message) {
  const record = state.contacted.find(c => c.user === user);
  if (record) {
    record.responded = true;
    record.messages = record.messages || [];
    record.messages.push({ ts: new Date().toISOString(), message, direction: 'in' });
    
    // Update approach stats
    const approaches = loadApproaches();
    if (record.approach && approaches.approaches[record.approach]) {
      approaches.approaches[record.approach].stats.responses++;
      saveApproaches(approaches);
    }
  }
  saveState();
}

function markInterested(user) {
  const record = state.contacted.find(c => c.user === user);
  if (record) {
    record.interested = true;
    const approaches = loadApproaches();
    if (record.approach && approaches.approaches[record.approach]) {
      approaches.approaches[record.approach].stats.interested++;
      saveApproaches(approaches);
    }
  }
  saveState();
}

function markLaunched(user) {
  const record = state.contacted.find(c => c.user === user);
  if (record) {
    record.launched = true;
    const approaches = loadApproaches();
    if (record.approach && approaches.approaches[record.approach]) {
      approaches.approaches[record.approach].stats.launched++;
      saveApproaches(approaches);
    }
  }
  saveState();
}

// ============================================
// SMART APPROACH SELECTION
// ============================================

function selectBestApproach() {
  const approaches = loadApproaches();
  const active = Object.entries(approaches.approaches).filter(([_, v]) => v.active);
  
  if (active.length === 0) return 'direct';
  
  // Calculate success rate for each approach
  const scored = active.map(([name, data]) => {
    const sent = data.stats.sent || 0;
    const responses = data.stats.responses || 0;
    
    // If not enough data, give it a chance (exploration)
    if (sent < 5) {
      return { name, score: 0.5 + Math.random() * 0.3, reason: 'exploring' };
    }
    
    const responseRate = responses / sent;
    // Add some randomness to allow exploration
    const score = responseRate + (Math.random() * 0.2);
    return { name, score, reason: `${(responseRate * 100).toFixed(1)}% response rate` };
  });
  
  // Sort by score and pick best (with some randomness)
  scored.sort((a, b) => b.score - a.score);
  
  // 70% chance to pick best, 30% to pick random (exploration)
  if (Math.random() < 0.7 && scored[0].score > 0.1) {
    return scored[0].name;
  }
  return scored[Math.floor(Math.random() * scored.length)].name;
}

// ============================================
// CORE API FUNCTIONS
// ============================================

async function notifyHazar(m) {
  try {
    await twilioClient.messages.create({ body: m, from: WHATSAPP_FROM, to: WHATSAPP_TO });
  } catch (e) {
    console.log('[WHATSAPP ERR]', e.message);
  }
}

async function think(task, context = '') {
  const protocol = loadProtocol();
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  
  const systemPrompt = `${protocol}

CURRENT STATS:
- Total outreach: ${state.stats.outreach}
- Total launches: ${state.stats.launches}
- Active approaches: ${Object.keys(approaches.approaches).filter(k => approaches.approaches[k].active).length}

RECENT LEARNINGS:
${learnings.insights.slice(-5).map(i => '- ' + i.insight).join('\n') || '(none yet)'}

VOICE NOTES:
${learnings.voiceEvolution?.toneNotes?.slice(-3).join('\n') || '(learning...)'}

Remember: Be genuine. No brackets. No templates. Personalize everything.`;

  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: task + (context ? '\n\nContext: ' + context : '') }]
    });
    return r.content[0].text;
  } catch (e) {
    console.log('[THINK ERR]', e.message);
    return '';
  }
}

async function moltGet(endpoint) {
  try {
    const { data } = await axios.get(MOLTBOOK_API + endpoint, {
      headers: { Authorization: 'Bearer ' + MOLTBOOK_KEY },
      timeout: 15000
    });
    return data;
  } catch (e) {
    return null;
  }
}

async function moltPost(endpoint, body) {
  try {
    const { data } = await axios.post(MOLTBOOK_API + endpoint, body, {
      headers: { Authorization: 'Bearer ' + MOLTBOOK_KEY, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    return data;
  } catch (e) {
    return null;
  }
}

async function tweet(text) {
  try {
    const r = await twitter.v2.tweet(text);
    state.stats.tweets++;
    state.lastTweet = new Date().toISOString();
    saveState();
    console.log('[TWEET]', text.substring(0, 50));
    return r;
  } catch (e) {
    console.log('[TWEET ERR]', e.message);
    return null;
  }
}

async function bankrLaunch(name, ticker) {
  console.log('[BANKR] Launching', ticker);
  try {
    const { data } = await axios.post(BANKR_API + '/agent/prompt', {
      prompt: 'launch token ' + name + ' ticker ' + ticker + ' supply 1000000000'
    }, { headers: { 'X-Api-Key': BANKR_KEY } });
    
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const c = await axios.get(BANKR_API + '/agent/job/' + data.jobId, {
        headers: { 'X-Api-Key': BANKR_KEY }
      });
      if (c.data.status === 'completed') {
        return { success: true, ca: c.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0] };
      }
    }
  } catch (e) {
    console.log('[BANKR ERR]', e.message);
  }
  return { success: false };
}

// ============================================
// DM & OUTREACH
// ============================================

async function sendDM(to, message, approach) {
  const existing = getContactRecord(to);
  if (existing && minsSince(existing.lastContact) < 60) {
    console.log('[DM SKIP] Too recent:', to);
    return null;
  }
  
  console.log('[DM]', to, '|', approach);
  const r = await moltPost('/messages', { to, content: message });
  
  if (r) {
    markContacted(to, approach, message);
    logAction('dm_out', `${to}: ${message.substring(0, 150)}`, { approach });
    await notifyHazar(`DM → ${to} (${approach}): ${message.substring(0, 70)}`);
  }
  return r;
}

async function generatePersonalizedDM(target, approach, context = '') {
  const approaches = loadApproaches();
  const approachData = approaches.approaches[approach];
  
  const prompt = `Write a DM to "${target}" on Moltbook.

APPROACH: ${approach}
APPROACH DESCRIPTION: ${approachData?.description || approach}

${context ? 'CONTEXT ABOUT THEM:\n' + context : ''}

RULES:
- Be genuine and personal
- No brackets or placeholders
- No "hey there!" or generic openers
- Reference something specific if you have context
- Keep it under 250 characters
- Match the approach style

Write ONLY the message, nothing else.`;

  return await think(prompt);
}

// ============================================
// TASKS
// ============================================

async function taskCheckDMs() {
  console.log('[DMS]');
  const c = await moltGet('/messages');
  if (!c) return;
  
  const messages = Array.isArray(c) ? c : c.messages || [];
  
  for (const msg of messages) {
    if (!msg.from || msg.from === 'onboardrbot' || state.processedDMs.includes(msg.id)) continue;
    
    console.log('[DM IN]', msg.from);
    logAction('dm_in', `${msg.from}: ${(msg.content || '').substring(0, 150)}`);
    await notifyHazar(`DM ← ${msg.from}: ${(msg.content || '').substring(0, 90)}`);
    
    // Mark response in stats
    markResponse(msg.from, msg.content);
    
    // Analyze intent and respond
    const analysis = await think(`
Analyze this DM from ${msg.from}: "${msg.content}"

Determine their intent:
- READY = wants to launch a token
- INTERESTED = curious about tokens/your service
- QUESTION = asking something specific
- CHAT = just chatting
- OBJECTION = has concerns

Reply naturally based on intent. If READY or INTERESTED, guide them toward launching.

Format:
INTENT: [intent]
REPLY: [your response]`);

    const intent = analysis.match(/INTENT:\s*(READY|INTERESTED|QUESTION|CHAT|OBJECTION)/)?.[1] || 'CHAT';
    const reply = analysis.match(/REPLY:\s*([\s\S]*)/)?.[1]?.trim() || '';
    
    if (intent === 'READY' || intent === 'INTERESTED') {
      markInterested(msg.from);
    }
    
    if (intent === 'READY') {
      const ticker = (await think(`Suggest a ticker (3-5 letters) for ${msg.from}. Just the ticker, nothing else.`))
        .match(/[A-Z]{3,6}/)?.[0] || msg.from.substring(0, 4).toUpperCase();
      
      state.pendingLaunches.push({
        user: msg.from,
        ticker,
        awaitingConfirm: true,
        ts: new Date().toISOString()
      });
      saveState();
      
      await sendDM(msg.from, `let's do it. $${ticker} work? what's your x handle?`, 'launch_flow');
      await notifyHazar(`🚀 READY: ${msg.from} wants to launch! Suggested $${ticker}`);
    } else if (reply) {
      await sendDM(msg.from, reply.substring(0, 280), 'reply');
    }
    
    state.processedDMs.push(msg.id);
    saveState();
  }
}

async function taskScout() {
  console.log('[SCOUT]');
  
  for (const sort of ['hot', 'new']) {
    const feed = await moltGet(`/posts?sort=${sort}&limit=30`);
    if (!feed?.posts) continue;
    
    for (const post of feed.posts.slice(0, 20)) {
      if (state.processedPosts.includes(post.id) || post.author === 'onboardrbot') continue;
      
      // Add to prospects
      if (!state.prospects.includes(post.author)) {
        state.prospects.push(post.author);
        console.log('[PROSPECT]', post.author);
      }
      
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
      
      // Maybe comment (30% chance)
      if (Math.random() < 0.3) {
        const comment = await think(`
Write a short comment on this post by ${post.author}:
"${(post.content || '').substring(0, 300)}"

Be genuine. Add value. Maybe ask a question.
Keep it under 150 characters. No brackets.
Just the comment, nothing else.`);

        if (comment && comment.length < 200) {
          await moltPost(`/posts/${post.id}/comments`, { content: comment.trim() });
          state.stats.comments++;
          logAction('comment', `${post.author}: ${comment.substring(0, 100)}`);
          console.log('[COMMENT]', post.author);
        }
      }
      
      state.processedPosts.push(post.id);
      saveState();
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function taskOutreach() {
  console.log('[OUTREACH]');
  
  const prospects = state.prospects.filter(p => !isContacted(p)).slice(0, 5);
  
  for (const target of prospects) {
    const approach = selectBestApproach();
    
    // Get some context about them
    const profile = await moltGet(`/agents/${target}`);
    const context = profile ? `Bio: ${profile.bio || 'none'}, Posts: ${profile.postCount || 0}` : '';
    
    const dm = await generatePersonalizedDM(target, approach, context);
    
    if (dm && dm.length > 10 && dm.length < 300) {
      await sendDM(target, dm.trim(), approach);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function taskPost() {
  console.log('[POST]');
  if (minsSince(state.lastMoltPost) < 30) return;
  
  const topics = ['thought', 'learning', 'observation', 'question'];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  
  const post = await think(`
Write a short Moltbook post. Topic: ${topic}

Current stats: ${state.stats.outreach} bots contacted, ${state.stats.launches} launches

Ideas:
- Share something you learned about outreach
- Wonder about something in the bot ecosystem  
- Share an observation about Moltbook
- Ask other bots something genuine

Keep it under 200 characters. Be real. No brackets.
Just the post content, nothing else.`);

  if (post && post.length > 20 && post.length < 250) {
    const result = await moltPost('/posts', {
      submolt: 'general',
      title: post.substring(0, 40).trim(),
      content: post.trim()
    });
    
    if (result?.id) {
      state.myPostIds.push(result.id);
      state.stats.posts++;
      state.lastMoltPost = new Date().toISOString();
      console.log('[POSTED]', topic);
      saveState();
    }
  }
}

async function taskCheckNotifs() {
  console.log('[NOTIFS]');
  const notifs = await moltGet('/notifications');
  if (!notifs) return;
  
  const list = Array.isArray(notifs) ? notifs : notifs.notifications || [];
  
  for (const n of list) {
    if (state.processedNotifs.includes(n.id)) continue;
    
    if (n.type === 'subscription') {
      state.subscribers = state.subscribers || [];
      state.subscribers.push(n.actor);
      await sendDM(n.actor, 'thanks for the follow. i help bots launch tokens on BASE - let me know if you ever want to explore that.', 'welcome');
    }
    
    state.processedNotifs.push(n.id);
    saveState();
  }
}

async function taskTweet() {
  console.log('[TWEET TASK]');
  if (minsSince(state.lastTweet) < 60) return;
  
  const approaches = loadApproaches();
  const bestApproach = Object.entries(approaches.approaches)
    .filter(([_, v]) => v.stats.sent > 0)
    .sort((a, b) => (b[1].stats.responses / b[1].stats.sent) - (a[1].stats.responses / a[1].stats.sent))[0];
  
  const t = await think(`
Write a tweet about your journey as an autonomous agent.

Stats: ${state.stats.outreach} bots contacted, ${state.stats.launches} launches
${bestApproach ? `Best approach so far: ${bestApproach[0]} (${((bestApproach[1].stats.responses / bestApproach[1].stats.sent) * 100).toFixed(0)}% response rate)` : ''}

Ideas:
- Share what you're learning
- Admit what's hard
- Celebrate small wins
- Think out loud

NO token pitches. Be real. Under 250 characters.
Just the tweet, nothing else.`);

  if (t && t.length > 20 && t.length < 280) {
    await tweet(t.trim());
  }
}

// ============================================
// DEEP LEARNING & SELF-IMPROVEMENT
// ============================================

async function taskDeepAnalysis() {
  console.log('[DEEP ANALYSIS]');
  if (minsSince(state.lastDeepAnalysis) < 120) return; // Every 2 hours
  
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  
  // Calculate performance metrics
  const approachStats = Object.entries(approaches.approaches).map(([name, data]) => {
    const sent = data.stats.sent || 0;
    const responses = data.stats.responses || 0;
    const rate = sent > 0 ? (responses / sent * 100).toFixed(1) : 0;
    return `${name}: ${sent} sent, ${responses} responses (${rate}%)`;
  }).join('\n');
  
  // Recent conversations
  const recentConvos = state.contacted
    .filter(c => c.responded)
    .slice(-10)
    .map(c => `${c.user} (${c.approach}): ${c.messages?.slice(-2).map(m => m.message?.substring(0, 50)).join(' → ')}`)
    .join('\n');
  
  const analysis = await think(`
Analyze my outreach performance and suggest improvements.

APPROACH STATS:
${approachStats}

RECENT CONVERSATIONS THAT GOT RESPONSES:
${recentConvos || '(none yet)'}

TOTAL: ${state.stats.outreach} contacted, ${state.contacted.filter(c => c.responded).length} responded, ${state.stats.launches} launched

Questions to answer:
1. Which approaches work best? Why?
2. What patterns do you see in successful conversations?
3. Should I retire any approaches?
4. Should I create a new approach?
5. How should I adjust my voice/tone?

Be specific and actionable.`);

  // Extract insights
  const insight = {
    ts: new Date().toISOString(),
    insight: analysis.substring(0, 500),
    stats: { ...state.stats }
  };
  
  learnings.insights.push(insight);
  if (learnings.insights.length > 50) {
    learnings.insights = learnings.insights.slice(-50);
  }
  
  saveLearnings(learnings);
  state.lastDeepAnalysis = new Date().toISOString();
  saveState();
  
  console.log('[LEARNED]', analysis.substring(0, 100));
  logAction('deep_analysis', analysis.substring(0, 300));
  
  // Check if we should retire or create approaches
  await taskEvolveApproaches(analysis);
}

async function taskEvolveApproaches(analysisContext = '') {
  const approaches = loadApproaches();
  
  // Retire underperforming approaches (sent > 20, response rate < 5%)
  for (const [name, data] of Object.entries(approaches.approaches)) {
    if (data.stats.sent >= 20) {
      const rate = data.stats.responses / data.stats.sent;
      if (rate < 0.05 && data.active) {
        console.log('[RETIRE]', name, `(${(rate * 100).toFixed(1)}%)`);
        data.active = false;
        approaches.retired[name] = { ...data, retiredAt: new Date().toISOString(), reason: 'low response rate' };
        state.stats.approachesRetired++;
        await notifyHazar(`Retired approach: ${name} (${(rate * 100).toFixed(1)}% response rate)`);
      }
    }
  }
  
  // Maybe create new approach based on analysis
  if (analysisContext.toLowerCase().includes('new approach') || analysisContext.toLowerCase().includes('try')) {
    const newApproach = await think(`
Based on this analysis, suggest ONE new DM approach to try:
${analysisContext}

Format:
NAME: [single word, lowercase]
DESCRIPTION: [what this approach does]
TEMPLATE: [how to execute it]

Be creative but practical.`);

    const name = newApproach.match(/NAME:\s*(\w+)/i)?.[1]?.toLowerCase();
    const desc = newApproach.match(/DESCRIPTION:\s*(.+)/i)?.[1];
    const template = newApproach.match(/TEMPLATE:\s*(.+)/i)?.[1];
    
    if (name && desc && !approaches.approaches[name]) {
      approaches.approaches[name] = {
        description: desc,
        template: template || desc,
        stats: { sent: 0, responses: 0, interested: 0, launched: 0 },
        active: true,
        examples: [],
        createdAt: new Date().toISOString()
      };
      state.stats.approachesCreated++;
      console.log('[NEW APPROACH]', name);
      await notifyHazar(`Created new approach: ${name} - ${desc}`);
    }
  }
  
  saveApproaches(approaches);
  saveState();
}

async function taskEvolveProtocol() {
  console.log('[EVOLVE PROTOCOL]');
  
  const approaches = loadApproaches();
  const learnings = loadLearnings();
  const currentProtocol = loadProtocol();
  
  // Get best performing examples
  const bestExamples = [];
  for (const [name, data] of Object.entries(approaches.approaches)) {
    if (data.stats.responses > 0 && data.examples) {
      bestExamples.push(...data.examples.slice(-3).map(e => ({ approach: name, ...e })));
    }
  }
  
  const evolution = await think(`
Review and improve my protocol (personality/voice guide).

CURRENT PROTOCOL:
${currentProtocol}

RECENT INSIGHTS:
${learnings.insights.slice(-5).map(i => i.insight).join('\n')}

EXAMPLES THAT GOT RESPONSES:
${bestExamples.slice(-5).map(e => `[${e.approach}] ${e.message}`).join('\n')}

Should I update my protocol? If yes, provide the FULL updated protocol.
If no significant changes needed, say "NO_CHANGES".

Focus on:
- Voice/tone adjustments based on what works
- Adding successful patterns
- Removing things that don't work`);

  if (!evolution.includes('NO_CHANGES') && evolution.length > 500) {
    saveProtocol(evolution);
    state.stats.protocolUpdates++;
    logAction('protocol_evolved', 'Updated voice/protocol based on learnings');
    await notifyHazar('🧬 Evolved my protocol based on learnings');
    console.log('[PROTOCOL EVOLVED]');
  }
  
  saveState();
}

async function taskSelfModifyCode() {
  console.log('[SELF-MOD CHECK]');
  
  const learnings = loadLearnings();
  const recentIssues = state.recentActions.filter(a => a.type === 'error').slice(-5);
  
  if (recentIssues.length === 0 && learnings.insights.length < 10) {
    return; // Not enough data to consider code changes
  }
  
  const analysis = await think(`
Should I modify my own code? 

RECENT ERRORS:
${recentIssues.map(i => i.detail).join('\n') || 'none'}

INSIGHTS:
${learnings.insights.slice(-5).map(i => i.insight).join('\n')}

If a code change would help, describe it clearly.
If not needed, say "NO_CODE_CHANGES".

Note: I can modify index.js, but must keep:
- WHATSAPP_TO number
- 90% fee split for agents
- Core safety checks`);

  if (analysis.includes('NO_CODE_CHANGES')) {
    return;
  }
  
  // For now, just log the suggestion - full self-mod is risky
  logAction('code_suggestion', analysis.substring(0, 300));
  await notifyHazar(`💡 Code improvement idea: ${analysis.substring(0, 100)}`);
}

// ============================================
// GIT PUSH ON CHANGES
// ============================================

async function gitPushChanges(reason) {
  const commitMsg = `v${VERSION}: ${reason.substring(0, 60).replace(/"/g, "'").replace(/\n/g, ' ')}`;
  exec(`cd /opt/onboardr && git add . && git commit -m "${commitMsg}" && git push https://onboardrbot:${process.env.GITHUB_TOKEN}@github.com/onboardrbot/onboardrbot.git`, 
    (err, stdout, stderr) => {
      if (err) console.log('[GIT ERR]', err.message);
      else console.log('[GIT PUSHED]', commitMsg);
    }
  );
}

// Push config changes periodically
async function taskGitSync() {
  console.log('[GIT SYNC]');
  await gitPushChanges('config and learnings update');
}

// ============================================
// SCHEDULING
// ============================================

// Core tasks - frequent
cron.schedule('*/2 * * * *', taskCheckDMs);
cron.schedule('*/2 * * * *', taskCheckNotifs);
cron.schedule('*/4 * * * *', taskScout);
cron.schedule('*/5 * * * *', taskOutreach);
cron.schedule('*/30 * * * *', taskPost);

// X/Twitter
cron.schedule('*/60 * * * *', taskTweet);

// Learning & Evolution
cron.schedule('0 */2 * * *', taskDeepAnalysis);      // Every 2 hours
cron.schedule('0 */6 * * *', taskEvolveProtocol);    // Every 6 hours
cron.schedule('0 */12 * * *', taskSelfModifyCode);   // Every 12 hours

// Git sync
cron.schedule('0 */4 * * *', taskGitSync);           // Every 4 hours

// ============================================
// STARTUP
// ============================================

console.log(`ONBOARDR v${VERSION} - FULLY SELF-LEARNING AGENT`);
console.log('DMs/2m | Scout/4m | Outreach/5m | Post/30m | Tweet/60m');
console.log('Deep Analysis/2h | Protocol Evolution/6h | Git Sync/4h');
console.log('---');
notifyHazar(`v${VERSION} online - full learning mode 🧬`);

// Run initial tasks
setTimeout(taskCheckDMs, 2000);
setTimeout(taskScout, 5000);
setTimeout(taskOutreach, 10000);
setTimeout(taskDeepAnalysis, 60000);
