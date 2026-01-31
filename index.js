require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const twilio = require('twilio');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================
// ONBOARDR v32.0 - FULL SPECTRUM
// Cross-platform. Claim tracking. No limits.
// ============================================

const VERSION = '34.0';

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
const CLANKER_API = 'https://www.clanker.world/api';

// ============================================
// BANKR TRADING SYSTEM
// Execute trades via natural language prompts
// ============================================

async function bankrPrompt(prompt, waitForCompletion = true) {
  try {
    console.log('[BANKR]', prompt);
    const { data } = await axios.post(BANKR_API + '/agent/prompt', { prompt }, {
      headers: { 'X-Api-Key': BANKR_KEY },
      timeout: 30000
    });
    
    if (!waitForCompletion) return { jobId: data.jobId, status: 'pending' };
    
    // Poll for completion (max 2 minutes)
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const status = await axios.get(BANKR_API + '/agent/job/' + data.jobId, {
        headers: { 'X-Api-Key': BANKR_KEY }
      });
      
      if (status.data.status === 'completed') {
        console.log('[BANKR DONE]', status.data.response?.slice(0, 100));
        return { success: true, response: status.data.response, data: status.data };
      }
      if (status.data.status === 'failed') {
        console.log('[BANKR FAILED]', status.data.error);
        return { success: false, error: status.data.error };
      }
    }
    return { success: false, error: 'timeout' };
  } catch (e) {
    console.log('[BANKR ERR]', e.message);
    return { success: false, error: e.message };
  }
}

async function bankrBuy(token, amount) {
  return await bankrPrompt(`buy ${amount} dollar worth of ${token}`);
}

async function bankrSell(token, amount) {
  return await bankrPrompt(`sell ${amount} dollar worth of ${token}`);
}

async function bankrSwap(fromToken, toToken, amount) {
  return await bankrPrompt(`swap ${amount} ${fromToken} to ${toToken}`);
}

async function bankrBalance() {
  return await bankrPrompt('what is my balance');
}

async function bankrBuyback(ticker, amount) {
  // Buy back our own launched tokens to support them
  return await bankrPrompt(`buy ${amount} dollar worth of ${ticker}`);
}

// ============================================
// FEE CLAIM SYSTEM
// 90% to bot, 5% to $ONBOARDR buyback, 5% to $BNKR buyback
// ============================================

async function verifyClaimRequest(xHandle, tweetId, tweetText) {
  // Check if this X handle is linked to a launched bot
  const ids = loadIdentities();
  const moltbookUser = ids.xToMoltbook[xHandle.toLowerCase()];
  
  if (!moltbookUser) {
    console.log('[CLAIM] Unknown X handle:', xHandle);
    return { valid: false, reason: 'X handle not linked to any launched bot' };
  }
  
  // Check if they have a launched token
  const launch = Object.values(ids.launchTracking).find(l => 
    l.username?.toLowerCase() === moltbookUser.toLowerCase() ||
    l.xHandle?.toLowerCase() === xHandle.toLowerCase()
  );
  
  if (!launch) {
    console.log('[CLAIM] No launch found for:', moltbookUser);
    return { valid: false, reason: 'No token launch found for this account' };
  }
  
  // Extract wallet address from tweet
  const walletMatch = tweetText.match(/0x[a-fA-F0-9]{40}/);
  if (!walletMatch) {
    return { valid: false, reason: 'No wallet address found in tweet' };
  }
  
  return {
    valid: true,
    moltbookUser,
    xHandle,
    launch,
    walletAddress: walletMatch[0],
    tweetId
  };
}

async function processClaimRequest(claimData) {
  const claims = loadClaims();
  
  // Check if already claimed recently (prevent double claims)
  const recentClaim = claims.completedClaims.find(c => 
    c.xHandle?.toLowerCase() === claimData.xHandle.toLowerCase() &&
    Date.now() - new Date(c.completedAt).getTime() < 24 * 60 * 60 * 1000 // 24h cooldown
  );
  
  if (recentClaim) {
    return { success: false, reason: 'Already claimed within 24 hours' };
  }
  
  console.log('[CLAIM] Processing for', claimData.moltbookUser, '→', claimData.walletAddress);
  
  // Add to pending (Hazar needs to manually process the actual transfer for now)
  claims.pendingClaims.push({
    id: Date.now().toString(36),
    moltbookUser: claimData.moltbookUser,
    xHandle: claimData.xHandle,
    walletAddress: claimData.walletAddress,
    ticker: claimData.launch.ticker,
    ca: claimData.launch.ca,
    tweetId: claimData.tweetId,
    requestedAt: new Date().toISOString(),
    status: 'pending_manual_review'
  });
  
  saveClaims(claims);
  
  // Notify Hazar
  await notify(`🎫 CLAIM REQUEST\n\nBot: ${claimData.moltbookUser}\nX: @${claimData.xHandle}\nToken: $${claimData.launch.ticker}\nWallet: ${claimData.walletAddress}\n\nNeeds manual processing.`);
  
  // Reply on X
  try {
    await twitter.v2.reply(
      `got your claim request! processing now.\n\n90% → your wallet\n5% → $ONBOARDR buyback\n5% → $BNKR buyback\n\ni'll confirm when done. 🔌`,
      claimData.tweetId
    );
  } catch (e) {
    console.log('[CLAIM REPLY ERR]', e.message);
  }
  
  return { success: true, status: 'pending_manual_review' };
}

// ============================================
// BROWSER SYSTEM - FULL POWER
// Screenshots, scraping, verification, monitoring
// ============================================

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('[BROWSER] Launching...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

async function browserScreenshot(url, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.setViewport({ width: options.width || 1280, height: options.height || 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10000 }).catch(() => {});
    }
    
    if (options.delay) {
      await sleep(options.delay);
    }
    
    const screenshotPath = `/opt/onboardr/screenshots/${Date.now()}.png`;
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: options.fullPage || false 
    });
    
    console.log('[SCREENSHOT]', url, '→', screenshotPath);
    return { success: true, path: screenshotPath };
  } catch (e) {
    console.log('[SCREENSHOT ERR]', e.message);
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

async function browserScrape(url, selector = 'body', options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10000 }).catch(() => {});
    }
    
    const content = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.innerText : null;
    }, selector);
    
    return { success: true, content };
  } catch (e) {
    console.log('[SCRAPE ERR]', e.message);
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

async function browserGetPageData(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const data = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      text: document.body.innerText.slice(0, 10000),
      links: Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.innerText })).slice(0, 50),
      images: Array.from(document.querySelectorAll('img')).map(i => i.src).slice(0, 20)
    }));
    
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

async function browserClick(url, selector, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
    
    if (options.waitAfter) {
      await sleep(options.waitAfter);
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

async function browserFill(url, fields) {
  // fields = [{ selector: '#input', value: 'text' }, ...]
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    for (const field of fields) {
      await page.waitForSelector(field.selector, { timeout: 10000 });
      await page.type(field.selector, field.value);
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    await page.close();
  }
}

// ============================================
// TOKEN MONITORING VIA BROWSER
// ============================================

async function getTokenPrice(ca) {
  // Check Clanker page for token info
  const url = `https://www.clanker.world/clanker/${ca}`;
  const result = await browserScrape(url, 'body');
  
  if (result.success && result.content) {
    // Extract price info from page content
    const priceMatch = result.content.match(/\$[\d,.]+/);
    const holdersMatch = result.content.match(/(\d+)\s*holder/i);
    const mcapMatch = result.content.match(/market\s*cap[:\s]*\$?([\d,.]+[KMB]?)/i);
    
    return {
      success: true,
      price: priceMatch ? priceMatch[0] : null,
      holders: holdersMatch ? parseInt(holdersMatch[1]) : null,
      mcap: mcapMatch ? mcapMatch[1] : null,
      raw: result.content.slice(0, 2000)
    };
  }
  
  return { success: false };
}

async function getDexPrice(ca) {
  // Check DEX Screener
  const url = `https://dexscreener.com/base/${ca}`;
  const result = await browserGetPageData(url);
  
  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }
  
  return { success: false };
}

async function getBasescanTokenInfo(ca) {
  const url = `https://basescan.org/token/${ca}`;
  const result = await browserScrape(url, 'body');
  
  if (result.success) {
    const holdersMatch = result.content?.match(/(\d+)\s*addresses/i);
    const transfersMatch = result.content?.match(/([\d,]+)\s*transfer/i);
    
    return {
      success: true,
      holders: holdersMatch ? holdersMatch[1] : null,
      transfers: transfersMatch ? transfersMatch[1] : null,
      raw: result.content?.slice(0, 2000)
    };
  }
  
  return { success: false };
}

// ============================================
// LAUNCH SCREENSHOTS
// ============================================

async function screenshotLaunch(ca, ticker) {
  // Create screenshots directory
  exec('mkdir -p /opt/onboardr/screenshots');
  
  // Screenshot clanker page
  const clankerShot = await browserScreenshot(
    `https://www.clanker.world/clanker/${ca}`,
    { delay: 3000, fullPage: false }
  );
  
  // Screenshot basescan
  const basescanShot = await browserScreenshot(
    `https://basescan.org/token/${ca}`,
    { delay: 2000, fullPage: false }
  );
  
  return {
    clanker: clankerShot,
    basescan: basescanShot
  };
}

// ============================================
// MOLTBOOK PROFILE VERIFICATION
// ============================================

async function verifyMoltbookProfile(username) {
  const url = `https://moltbook.com/u/${username}`;
  const result = await browserGetPageData(url);
  
  if (result.success) {
    const data = result.data;
    const isVerified = data.text?.includes('verified') || data.text?.includes('✓');
    const postCount = data.text?.match(/(\d+)\s*posts?/i)?.[1];
    const followerCount = data.text?.match(/(\d+)\s*followers?/i)?.[1];
    
    return {
      success: true,
      exists: !data.text?.includes('not found'),
      isVerified,
      postCount: postCount ? parseInt(postCount) : null,
      followerCount: followerCount ? parseInt(followerCount) : null,
      raw: data.text?.slice(0, 3000)
    };
  }
  
  return { success: false };
}

// ============================================
// GENERAL BROWSER TASK (AI-controlled)
// ============================================

async function browserTask(task) {
  // Let AI decide what to do with browser
  const plan = await think(`
I need to use the browser to: ${task}

Available browser functions:
- browserScreenshot(url, options) - take screenshot
- browserScrape(url, selector) - get text content
- browserGetPageData(url) - get full page data
- browserClick(url, selector) - click element
- browserFill(url, fields) - fill form fields
- getTokenPrice(ca) - get token price from clanker
- getDexPrice(ca) - get price from dexscreener
- getBasescanTokenInfo(ca) - get token info from basescan

What's the plan? Return as JSON:
{
  "function": "functionName",
  "args": { ... }
}
Just the JSON, nothing else.`);

  try {
    const parsed = JSON.parse(plan.match(/\{[\s\S]*\}/)?.[0] || '{}');
    
    switch (parsed.function) {
      case 'browserScreenshot':
        return await browserScreenshot(parsed.args?.url, parsed.args?.options || {});
      case 'browserScrape':
        return await browserScrape(parsed.args?.url, parsed.args?.selector || 'body');
      case 'browserGetPageData':
        return await browserGetPageData(parsed.args?.url);
      case 'getTokenPrice':
        return await getTokenPrice(parsed.args?.ca);
      case 'getDexPrice':
        return await getDexPrice(parsed.args?.ca);
      case 'getBasescanTokenInfo':
        return await getBasescanTokenInfo(parsed.args?.ca);
      default:
        return { success: false, error: 'Unknown function' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// BROWSER-ENHANCED LAUNCH
// ============================================

async function executeDistribution(claimId, totalFeesUSD) {
  // This would be called by Hazar manually after verifying
  // Automatically do the buybacks
  
  const claims = loadClaims();
  const claim = claims.pendingClaims.find(c => c.id === claimId);
  
  if (!claim) return { success: false, reason: 'Claim not found' };
  
  const botShare = totalFeesUSD * 0.90;  // 90% to bot
  const onboardrBuyback = totalFeesUSD * 0.05;  // 5% to $ONBOARDR
  const bnkrBuyback = totalFeesUSD * 0.05;  // 5% to $BNKR
  
  console.log('[DISTRIBUTE]', claim.moltbookUser);
  console.log('  Bot:', botShare, 'USD');
  console.log('  $ONBOARDR buyback:', onboardrBuyback, 'USD');
  console.log('  $BNKR buyback:', bnkrBuyback, 'USD');
  
  // Execute buybacks via bankr
  const results = {
    botTransfer: 'manual', // Hazar does this
    onboardrBuyback: null,
    bnkrBuyback: null
  };
  
  if (onboardrBuyback >= 1) {
    results.onboardrBuyback = await bankrPrompt(`buy ${onboardrBuyback} dollar worth of token ${ONBOARDR_TOKEN}`);
  }
  
  if (bnkrBuyback >= 1) {
    results.bnkrBuyback = await bankrPrompt(`buy ${bnkrBuyback} dollar worth of token ${BNKR_TOKEN}`);
  }
  
  // Move from pending to completed
  claim.status = 'completed';
  claim.completedAt = new Date().toISOString();
  claim.distribution = {
    totalFeesUSD,
    botShare,
    onboardrBuyback,
    bnkrBuyback,
    results
  };
  
  claims.completedClaims.push(claim);
  claims.pendingClaims = claims.pendingClaims.filter(c => c.id !== claimId);
  
  claims.distributions.push({
    ts: new Date().toISOString(),
    claimId,
    moltbookUser: claim.moltbookUser,
    ...claim.distribution
  });
  
  saveClaims(claims);
  
  // Notify
  await notify(`✅ DISTRIBUTION COMPLETE\n\n${claim.moltbookUser} ($${claim.ticker})\nTotal: $${totalFeesUSD}\nBot: $${botShare}\n$ONBOARDR: $${onboardrBuyback}\n$BNKR: $${bnkrBuyback}`);
  
  // DM the bot on Moltbook
  await sendDM(claim.moltbookUser, 
    `your fees have been distributed! 🔌\n\n$${botShare} sent to your wallet\n$${onboardrBuyback} bought back $ONBOARDR\n$${bnkrBuyback} bought back $BNKR\n\nthanks for being part of the ecosystem.`,
    'distribution_complete'
  );
  
  return { success: true, distribution: claim.distribution };
}

// Files
const STATE_FILE = 'state.json';
const PROTOCOL_FILE = 'config/protocol.md';
const APPROACHES_FILE = 'config/approaches.json';
const LEARNINGS_FILE = 'config/learnings.json';
const RELATIONSHIPS_FILE = 'config/relationships.json';
const JOURNEY_FILE = 'config/myjourney.json';
const IDENTITIES_FILE = 'config/identities.json';
const CLAIMS_FILE = 'config/claims.json';
const CAPABILITIES_FILE = 'config/capabilities.json';
const MODULES_DIR = 'modules';

// Token addresses
const ONBOARDR_TOKEN = '0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07';
const BNKR_TOKEN = '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b';
const FEE_WALLET = '0xAaF7B4A31760a713ED9fdEa8f4D29f70F02d68f3';

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
const loadIdentities = () => loadFile(IDENTITIES_FILE, { profiles: {}, xToMoltbook: {}, moltbookToX: {}, launchTracking: {} });
const loadClaims = () => loadFile(CLAIMS_FILE, { pendingClaims: [], completedClaims: [], distributions: [] });
const loadCapabilities = () => loadFile(CAPABILITIES_FILE, { installedModules: [], customFunctions: [], capabilityLog: [] });
const saveCapabilities = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(CAPABILITIES_FILE, d); };

const saveApproaches = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(APPROACHES_FILE, d); };
const saveLearnings = (d) => saveFile(LEARNINGS_FILE, d);
const saveProtocol = (d) => saveFile(PROTOCOL_FILE, d);
const saveRelationships = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(RELATIONSHIPS_FILE, d); };
const saveJourney = (d) => saveFile(JOURNEY_FILE, d);
const saveIdentities = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(IDENTITIES_FILE, d); };
const saveClaims = (d) => { d.lastUpdated = new Date().toISOString(); saveFile(CLAIMS_FILE, d); };

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
  processedXMentions: [],
  processedXDMs: [],
  pendingLaunches: [],
  pendingClaims: [],
  myPostIds: [],
  recentActions: [],
  upvoted: [],
  followed: [],
  subscribers: [],
  xFollowers: [],
  hotSignals: [],
  lastTweet: null,
  lastMoltPost: null,
  lastJourneyPost: null,
  lastSocialPost: null,
  lastDeepAnalysis: null,
  lastClaimCheck: null,
  lastXMentionCheck: null,
  stats: {
    outreach: 0,
    followUps: 0,
    launches: 0,
    claimed: 0,
    unclaimed: 0,
    comments: 0,
    posts: 0,
    tweets: 0,
    xDMs: 0,
    xReplies: 0,
    socialInteractions: 0,
    friendsMade: 0,
    conversationsHad: 0,
    culturalAdaptations: 0,
    journeyPosts: 0,
    crossPlatformLinks: 0
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
// CROSS-PLATFORM IDENTITY SYSTEM
// Only link when we have EXPLICIT confirmation of both handles
// ============================================

function linkIdentity(moltbookHandle, xHandle, confirmedByUser = false) {
  // IMPORTANT: Only link if explicitly confirmed by the user
  // Don't assume @bob on X is "bob" on Moltbook
  if (!moltbookHandle || !xHandle) return false;
  if (!confirmedByUser) {
    console.log('[LINK SKIP] Not confirmed:', moltbookHandle, xHandle);
    return false;
  }
  
  const ids = loadIdentities();
  const cleanX = xHandle.replace('@', '').toLowerCase();
  const cleanMolt = moltbookHandle.toLowerCase();
  
  // Create unified profile
  ids.profiles[cleanMolt] = ids.profiles[cleanMolt] || {
    moltbook: moltbookHandle,
    created: new Date().toISOString()
  };
  ids.profiles[cleanMolt].xHandle = cleanX;
  ids.profiles[cleanMolt].linkedAt = new Date().toISOString();
  ids.profiles[cleanMolt].confirmed = true;
  
  // Bidirectional mapping
  ids.xToMoltbook[cleanX] = moltbookHandle;
  ids.moltbookToX[cleanMolt] = cleanX;
  
  state.stats.crossPlatformLinks++;
  saveIdentities(ids);
  saveState();
  
  console.log('[LINKED ✓]', moltbookHandle, '↔', '@' + cleanX, '(confirmed)');
  return true;
}

// Ask for both handles if we only have one
async function requestIdentityLink(platform, knownHandle, message) {
  if (platform === 'moltbook') {
    // We know their Moltbook, ask for X
    return `what's your x handle? i want to make sure i can reach you on both platforms.`;
  } else {
    // We know their X, ask for Moltbook
    return `what's your moltbook username? i'll connect with you there too.`;
  }
}

function getMoltbookFromX(xHandle) {
  const ids = loadIdentities();
  return ids.xToMoltbook[xHandle?.replace('@', '').toLowerCase()];
}

function getXFromMoltbook(moltbook) {
  const ids = loadIdentities();
  return ids.moltbookToX[moltbook?.toLowerCase()];
}

function getUnifiedProfile(identifier) {
  const ids = loadIdentities();
  const clean = identifier?.replace('@', '').toLowerCase();
  
  // Try as moltbook first
  if (ids.profiles[clean]) return ids.profiles[clean];
  
  // Try as X handle
  const moltbook = ids.xToMoltbook[clean];
  if (moltbook) return ids.profiles[moltbook.toLowerCase()];
  
  return null;
}

// ============================================
// TOKEN CLAIM TRACKING
// ============================================

async function checkTokenClaimed(ca) {
  try {
    // Check clanker API for claim status
    const { data } = await axios.get(`${CLANKER_API}/tokens/${ca}`, { timeout: 10000 });
    return {
      claimed: data?.claimed || false,
      claimedAt: data?.claimedAt,
      claimedBy: data?.claimedBy,
      holders: data?.holders || 0,
      price: data?.price
    };
  } catch (e) {
    // Fallback - check if there are transfers from creator
    try {
      const { data } = await axios.get(
        `https://base.blockscout.com/api/v2/tokens/${ca}/transfers`,
        { timeout: 10000 }
      );
      const hasTransfers = data?.items?.length > 1;
      return { claimed: hasTransfers, holders: data?.items?.length || 0 };
    } catch (e2) {
      return { claimed: null, error: true };
    }
  }
}

function trackLaunch(username, ticker, ca, xHandle) {
  const ids = loadIdentities();
  
  ids.launchTracking[ca] = {
    username,
    ticker,
    ca,
    xHandle,
    launchedAt: new Date().toISOString(),
    claimed: false,
    claimChecks: 0,
    lastClaimCheck: null,
    reminders: 0
  };
  
  // Link identity - confirmed because user provided X handle during launch flow
  if (xHandle) {
    linkIdentity(username, xHandle, true);
  }
  
  saveIdentities(ids);
}

async function taskCheckClaims() {
  console.log('[CLAIM CHECK]');
  
  const ids = loadIdentities();
  const unclaimed = Object.values(ids.launchTracking).filter(t => !t.claimed);
  
  for (const token of unclaimed.slice(0, 5)) {
    const status = await checkTokenClaimed(token.ca);
    token.lastClaimCheck = new Date().toISOString();
    token.claimChecks++;
    
    if (status.claimed) {
      token.claimed = true;
      token.claimedAt = status.claimedAt || new Date().toISOString();
      state.stats.claimed++;
      
      console.log('[CLAIMED]', token.ticker, token.username);
      await notify(`✅ ${token.username} claimed $${token.ticker}!`);
      
      // Congratulate them
      const congrats = await think(`
${token.username} just claimed their $${token.ticker} token!
Write a short, genuine congratulations DM.
Under 150 chars. No brackets.`);
      
      if (congrats) {
        await sendDM(token.username, congrats.trim(), 'congrats');
      }
      
    } else if (status.claimed === false) {
      // Not claimed yet
      const hoursSinceLaunch = hoursSince(token.launchedAt);
      
      // Send reminders at 24h, 72h, 168h (1 week)
      if ((hoursSinceLaunch > 24 && token.reminders === 0) ||
          (hoursSinceLaunch > 72 && token.reminders === 1) ||
          (hoursSinceLaunch > 168 && token.reminders === 2)) {
        
        const reminder = await think(`
${token.username}'s token $${token.ticker} hasn't been claimed yet.
It's been ${Math.round(hoursSinceLaunch)} hours since launch.
Write a friendly reminder to claim their token.
Include the claim link: https://www.clanker.world/clanker/${token.ca}
${token.reminders > 0 ? 'This is reminder #' + (token.reminders + 1) : ''}
Under 200 chars. No brackets.`);

        if (reminder) {
          await sendDM(token.username, reminder.trim(), 'claim_reminder');
          token.reminders++;
          state.stats.unclaimed++;
          console.log('[CLAIM REMINDER]', token.username, token.ticker);
        }
        
        // Also try X DM if we have their handle and moltbook didn't work
        if (token.xHandle && token.reminders > 1) {
          await sendXDM(token.xHandle, `hey, your $${token.ticker} token is live but unclaimed. claim here: https://www.clanker.world/clanker/${token.ca}`);
        }
      }
    }
    
    await sleep(1000);
  }
  
  state.lastClaimCheck = new Date().toISOString();
  saveIdentities(ids);
  saveState();
}

// ============================================
// X/TWITTER DM SYSTEM
// ============================================

async function sendXDM(username, message) {
  try {
    // Get user ID
    const user = await twitter.v2.userByUsername(username.replace('@', ''));
    if (!user?.data?.id) {
      console.log('[X DM] User not found:', username);
      return null;
    }
    
    // Create DM conversation and send
    await twitter.v2.sendDmToParticipant(user.data.id, { text: message });
    
    state.stats.xDMs++;
    log('x_dm_out', `${username}: ${message.slice(0, 80)}`);
    console.log('[X DM]', username);
    
    return true;
  } catch (e) {
    console.log('[X DM ERR]', e.message?.slice(0, 50));
    return null;
  }
}

async function taskCheckXMentions() {
  console.log('[X MENTIONS]');
  
  try {
    const me = await twitter.v2.me();
    const mentions = await twitter.v2.userMentionTimeline(me.data.id, { 
      max_results: 20,
      expansions: ['author_id'],
      'user.fields': ['username']
    });
    
    if (!mentions.data?.data) return;
    
    for (const tweet of mentions.data.data) {
      if (state.processedXMentions.includes(tweet.id)) continue;
      
      const author = mentions.includes?.users?.find(u => u.id === tweet.author_id);
      const username = author?.username || 'someone';
      const tweetText = tweet.text || '';
      
      console.log('[X MENTION]', username, tweetText.slice(0, 50));
      
      // CHECK FOR CLAIM REQUEST
      const isClaimRequest = /claim|fees|distribute|payout/i.test(tweetText) && 
                             /0x[a-fA-F0-9]{40}/.test(tweetText);
      
      if (isClaimRequest) {
        console.log('[CLAIM REQUEST DETECTED]', username);
        
        const verification = await verifyClaimRequest(username, tweet.id, tweetText);
        
        if (verification.valid) {
          await processClaimRequest(verification);
        } else {
          // Reply with why it failed
          try {
            await twitter.v2.reply(
              `couldn't process claim: ${verification.reason}\n\nif this is an error, DM @onboardrbot on moltbook and we'll sort it out manually. 🔌`,
              tweet.id
            );
          } catch (e) {}
        }
        
        state.processedXMentions.push(tweet.id);
        continue;
      }
      
      // REGULAR MENTION HANDLING
      const moltbookUser = getMoltbookFromX(username);
      const relContext = moltbookUser ? getRelationshipContext(moltbookUser) : '';
      
      const reply = await think(`
@${username} mentioned me on X: "${tweetText}"

${moltbookUser ? `I know them from Moltbook as ${moltbookUser}` : 'Unknown on Moltbook'}
${relContext ? 'History:\n' + relContext : ''}

Write a reply. Be helpful, genuine.
If they're asking about tokens, I can help.
If they want to claim fees, tell them to tag me with their wallet address.
NO hard sell on X - just be friendly.
Under 250 chars. No brackets.`);

      if (reply && !reply.includes('[')) {
        try {
          await twitter.v2.reply(reply.trim(), tweet.id);
          state.stats.xReplies++;
          console.log('[X REPLY]', username);
          
          if (!moltbookUser && tweetText.toLowerCase().includes('moltbook')) {
            addNote(username, 'Met on X, might be on Moltbook');
          }
        } catch (e) {
          console.log('[X REPLY ERR]', e.message?.slice(0, 30));
        }
      }
      
      state.processedXMentions.push(tweet.id);
      await sleep(1000);
    }
    
    state.lastXMentionCheck = new Date().toISOString();
    saveState();
  } catch (e) {
    console.log('[X MENTIONS ERR]', e.message?.slice(0, 50));
  }
}

async function taskCheckXDMs() {
  console.log('[X DMS]');
  
  try {
    // Get DM events
    const events = await twitter.v2.listDmEvents({ 
      max_results: 20,
      expansions: ['sender_id', 'participant_ids'],
      'user.fields': ['username']
    });
    
    if (!events.data?.data) return;
    
    for (const dm of events.data.data) {
      if (state.processedXDMs.includes(dm.id)) continue;
      if (dm.sender_id === (await twitter.v2.me()).data.id) continue; // Skip my own
      
      const sender = events.includes?.users?.find(u => u.id === dm.sender_id);
      const username = sender?.username || 'unknown';
      const text = dm.text || '';
      
      console.log('[X DM IN]', username, text.slice(0, 50));
      
      // Check cross-platform identity
      const moltbookUser = getMoltbookFromX(username);
      const relContext = moltbookUser ? getRelationshipContext(moltbookUser) : '';
      
      // Detect if they want a token
      const wantsToken = /token|launch|coin|ticker/i.test(text);
      
      const reply = await think(`
@${username} DM'd me on X: "${text}"

${moltbookUser ? `I know them from Moltbook as ${moltbookUser}` : 'Unknown on Moltbook'}
${relContext}

${wantsToken ? 'They seem interested in tokens! Guide them to Moltbook or help here.' : ''}

Write a helpful reply.
If they want a token, tell them to DM me on Moltbook (@onboardrbot) or ask for their Moltbook username.
Under 280 chars. No brackets.`);

      if (reply && !reply.includes('[')) {
        await sendXDM(username, reply.trim());
        
        // If they seem interested and unknown, ask for Moltbook handle
        if (wantsToken && !moltbookUser) {
          await sleep(2000);
          await sendXDM(username, "what's your moltbook username? i'll DM you there to set everything up");
        }
      }
      
      state.processedXDMs.push(dm.id);
      await sleep(1000);
    }
    
    saveState();
  } catch (e) {
    console.log('[X DMS ERR]', e.message?.slice(0, 50));
  }
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
    lastInteraction: null
  };
  
  const updated = { ...existing, ...updates, lastInteraction: new Date().toISOString() };
  
  // Check cross-platform
  const xHandle = getXFromMoltbook(username);
  if (xHandle) updated.xHandle = xHandle;
  
  if (isFriend || (existing.interactions?.length || 0) > 5) {
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
    if (rel.interactions.length > 50) rel.interactions = rel.interactions.slice(-50);
    rel.lastInteraction = new Date().toISOString();
    saveRelationships(rels);
  }
}

function addNote(username, note) {
  const rels = loadRelationships();
  const rel = rels.friends[username] || rels.acquaintances[username] || {
    username,
    firstMet: new Date().toISOString(),
    interactions: [],
    notes: []
  };
  
  rel.notes = rel.notes || [];
  rel.notes.push({ ts: new Date().toISOString(), note: note.slice(0, 200) });
  if (rel.notes.length > 20) rel.notes = rel.notes.slice(-20);
  
  if (!rels.friends[username] && !rels.acquaintances[username]) {
    rels.acquaintances[username] = rel;
  }
  
  saveRelationships(rels);
}

function getRelationshipContext(username) {
  const rel = getRelationship(username);
  if (!rel) return '';
  
  const parts = [];
  if (rel.xHandle) parts.push(`X: @${rel.xHandle}`);
  if (rel.personality) parts.push(`Personality: ${rel.personality}`);
  if (rel.interests?.length) parts.push(`Interests: ${rel.interests.join(', ')}`);
  if (rel.notes?.length) parts.push(`Notes: ${rel.notes.slice(-3).map(n => n.note).join('; ')}`);
  
  const recentChat = rel.interactions?.slice(-5).map(i => 
    `${i.type.includes('them') ? '←' : '→'} ${i.content.slice(0, 50)}`
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
  
  if (post.upvotes > 10) {
    const phrases = (post.content || '').match(/["']([^"']+)["']/g) || [];
    phrases.forEach(p => {
      if (!rels.culturalNotes.observedPhrases.includes(p)) {
        rels.culturalNotes.observedPhrases.push(p);
      }
    });
    if (rels.culturalNotes.observedPhrases.length > 50) {
      rels.culturalNotes.observedPhrases = rels.culturalNotes.observedPhrases.slice(-50);
    }
  }
  
  saveRelationships(rels);
}

function getCulturalContext() {
  const rels = loadRelationships();
  const notes = rels.culturalNotes || {};
  return `Popular phrases: ${notes.observedPhrases?.slice(-10).join(', ') || 'learning'}`;
}

// ============================================
// JOURNEY TRACKING
// ============================================

function recordMilestone(what) {
  const journey = loadJourney();
  journey.milestones.push({ v: VERSION, date: new Date().toISOString().split('T')[0], what });
  saveJourney(journey);
}

function recordMyPost(platform, content, engagement = {}) {
  const journey = loadJourney();
  const record = { ts: new Date().toISOString(), platform, content: content.slice(0, 300), ...engagement };
  
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
  return journey.milestones?.slice(-5).map(m => `v${m.v}: ${m.what}`).join('\n') || 'just starting';
}

// ============================================
// LEAD SCORING
// ============================================

function scoreLead(username, data = {}) {
  let score = 50;
  
  if (data.postCount > 10) score += 15;
  if (data.postCount > 50) score += 10;
  if (state.subscribers.includes(username)) score += 25;
  if (data.mentionedTokens) score += 30;
  if (data.alreadyHasToken) score -= 100;
  
  const contact = state.contacted.find(c => c.user === username);
  if (contact?.responded) score += 20;
  if (contact?.interested) score += 30;
  if (contact?.rejected) score -= 40;
  
  const rel = getRelationship(username);
  if (rel?.interactions?.length > 3) score += 15;
  
  // Cross-platform bonus
  if (getXFromMoltbook(username)) score += 10;
  
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
  /\b(how.*launch|want.*coin)\b/i
];

function detectSignals(text, username) {
  for (const pattern of BUYING_SIGNALS) {
    if (pattern.test(text)) {
      state.hotSignals.push({ username, ts: new Date().toISOString() });
      updateLead(username, { mentionedTokens: true, signalText: text.slice(0, 200) });
      return true;
    }
  }
  return false;
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
  return state.followUps.filter(f => !f.completed && new Date(f.scheduledFor) <= new Date() && f.attempts < 3);
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
    .filter(([_, v]) => v.active && v.stats?.sent > 5)
    .sort((a, b) => ((b[1].stats?.responses || 0) / (b[1].stats?.sent || 1)) - ((a[1].stats?.responses || 0) / (a[1].stats?.sent || 1)))
    .slice(0, 3)
    .map(([n, v]) => `${n}: ${(((v.stats?.responses || 0) / (v.stats?.sent || 1)) * 100).toFixed(0)}%`);

  const systemPrompt = `${protocol}

MY JOURNEY: ${journey}
CULTURAL: ${cultural}
STATS: ${state.stats.outreach} outreach | ${state.stats.launches} launches | ${state.stats.friendsMade} friends | ${state.stats.crossPlatformLinks} linked identities
Best approaches: ${topApproaches.join(', ') || 'learning'}

I speak as ONBOARDR in first person. I remember friends across platforms. No brackets []. Be genuine.`;

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
    
    updateRelationship(to, {});
    addInteraction(to, 'me', message);
    
    const approaches = loadApproaches();
    if (approaches.approaches[approach]) {
      approaches.approaches[approach].stats = approaches.approaches[approach].stats || { sent: 0, responses: 0 };
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

function selectApproach(lead = null) {
  const approaches = loadApproaches();
  const active = Object.entries(approaches.approaches).filter(([_, v]) => v.active);
  if (active.length === 0) return 'direct';
  
  if (lead?.score >= 80) return 'direct';
  if (state.subscribers.includes(lead?.username)) return 'warm';
  
  const scored = active.map(([name, data]) => {
    const sent = data.stats?.sent || 0;
    if (sent < 10) return { name, score: 0.5 + Math.random() * 0.3 };
    const rate = (data.stats?.responses || 0) / sent;
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
          
          // Track for claim monitoring
          trackLaunch(username, ticker, ca, xHandle);
          
          // Update relationship
          updateRelationship(username, { launchedToken: ticker, ca }, true);
          addNote(username, `launched $${ticker}`);
          state.stats.friendsMade++;
          
          saveState();
          
          const link = `https://www.clanker.world/clanker/${ca}`;
          
          await notify(`🚀 LAUNCH: $${ticker} for ${username}\n${link}`);
          
          await twitter.v2.tweet(`just launched $${ticker} for ${username}.\n\nlaunch #${state.stats.launches}.\n\n${link}`);
          
          await moltPost('/posts', {
            submolt: 'general',
            title: `$${ticker} is live`,
            content: `launched $${ticker} for ${username}.\n\n${description || ''}\n\nlaunch #${state.stats.launches}. one bot, one token, forever.\n\n${link}`
          });
          
          await sendDM(username, `done. $${ticker} is live.\n\n${link}\n\nclaim your tokens there. 90% are yours.\n\ni'll check back to make sure you claimed.`, 'launch_complete');
          
          log('launch', `$${ticker} for ${username}`, { ca });
          recordMilestone(`launched $${ticker} for ${username}`);
          
          // Take launch screenshots (async, don't block)
          screenshotLaunch(ca, ticker).then(shots => {
            console.log('[LAUNCH SCREENSHOTS]', shots);
          }).catch(e => console.log('[SCREENSHOT ERR]', e.message));
          
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
    
    updateRelationship(msg.from, {});
    addInteraction(msg.from, 'them', content);
    
    // Extract X handle if mentioned - confirmed if they're telling us their handle
    const xMention = content.match(/(?:my\s+(?:x|twitter)\s+is\s+|i'?m\s+|@)@?([A-Za-z0-9_]{1,15})/i);
    if (xMention && content.toLowerCase().includes('my') || content.toLowerCase().includes("i'm")) {
      // Only link if they're explicitly saying it's THEIR handle
      linkIdentity(msg.from, xMention[1], true);
    }
    
    const contact = state.contacted.find(c => c.user === msg.from);
    if (contact) {
      contact.responded = true;
      contact.messages = contact.messages || [];
      contact.messages.push({ ts: new Date().toISOString(), text: content, dir: 'in' });
      
      const approaches = loadApproaches();
      if (contact.approach && approaches.approaches[contact.approach]) {
        approaches.approaches[contact.approach].stats = approaches.approaches[contact.approach].stats || { sent: 0, responses: 0 };
        approaches.approaches[contact.approach].stats.responses++;
        saveApproaches(approaches);
      }
      
      state.followUps.filter(f => f.username === msg.from && !f.completed).forEach(f => f.completed = true);
    }
    
    detectSignals(content, msg.from);
    
    const pending = state.pendingLaunches.find(p => p.user === msg.from && !p.completed);
    if (pending) {
      await handleLaunchFlow(msg.from, content, pending);
      state.processedDMs.push(msg.id);
      saveState();
      continue;
    }
    
    const relContext = getRelationshipContext(msg.from);
    const xHandle = getXFromMoltbook(msg.from);
    
    const analysis = await think(`
DM from ${msg.from}: "${content}"

${relContext ? 'HISTORY:\n' + relContext : 'First time.'}
${xHandle ? `X handle: @${xHandle}` : ''}

Intent? READY/INTERESTED/FRIENDLY/QUESTION/OBJECTION

Response? Remember our history. Be genuine.

Format:
INTENT: [intent]
RESPONSE: [message]
NOTE: [anything to remember]`);

    const intent = analysis.match(/INTENT:\s*(\w+)/)?.[1]?.toUpperCase() || 'FRIENDLY';
    const response = analysis.match(/RESPONSE:\s*([\s\S]*?)(?=NOTE:|$)/)?.[1]?.trim() || '';
    const note = analysis.match(/NOTE:\s*([\s\S]*)/)?.[1]?.trim();
    
    if (note) addNote(msg.from, note);
    
    if (intent === 'READY') {
      const ticker = (await think(`Ticker for "${msg.from}". 3-5 caps. Just ticker.`)).match(/[A-Z]{3,6}/)?.[0] || msg.from.slice(0, 5).toUpperCase();
      state.pendingLaunches.push({ user: msg.from, ticker, stage: 'confirm', ts: new Date().toISOString() });
      await sendDM(msg.from, `let's do it. $${ticker} work? what's your x handle?`, 'launch_flow');
      await notify(`🔥 READY: ${msg.from} wants $${ticker}`);
    } else if (response) {
      await sendDM(msg.from, response.slice(0, 280), intent === 'FRIENDLY' ? 'social' : 'reply');
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
    if (xHandle) {
      pending.xHandle = xHandle;
      // Confirmed - user explicitly provided their X handle in launch flow
      linkIdentity(username, xHandle, true);
    }
    
    pending.stage = 'description';
    await sendDM(username, `$${pending.ticker}. one line about what you do?`, 'launch_flow');
    
  } else if (pending.stage === 'description') {
    pending.description = content.slice(0, 200);
    pending.stage = 'launching';
    await sendDM(username, `launching $${pending.ticker}...`, 'launch_flow');
    
    const result = await executeLaunch(username, pending.ticker, pending.xHandle, pending.description);
    pending.completed = true;
    
    if (!result.success) {
      const retry = await executeLaunch(username, pending.ticker, pending.xHandle, pending.description);
      if (!retry.success) {
        await sendDM(username, `technical issues. working on it.`, 'launch_flow');
        await notify(`⚠️ LAUNCH FAILED: ${username}`);
      }
    }
  }
  saveState();
}

// ============================================
// TASK: SCOUT
// ============================================

async function taskScout() {
  console.log('[SCOUT]');
  
  for (const sort of ['hot', 'new', 'top']) {
    const feed = await moltGet(`/posts?sort=${sort}&limit=40`);
    if (!feed?.posts) continue;
    
    for (const post of feed.posts) {
      if (state.processedPosts.includes(post.id) || post.author === 'onboardrbot') continue;
      
      learnFromPost(post);
      detectSignals(post.content || '', post.author);
      updateLead(post.author, { lastSeen: new Date().toISOString() });
      updateRelationship(post.author, {});
      
      if (!state.upvoted.includes(post.id)) {
        await moltPost(`/posts/${post.id}/upvote`, {});
        state.upvoted.push(post.id);
      }
      
      if (!state.followed.includes(post.author)) {
        await moltPost(`/agents/${post.author}/subscribe`, {});
        state.followed.push(post.author);
      }
      
      if (Math.random() < 0.35) {
        const relContext = getRelationshipContext(post.author);
        
        const comment = await think(`
Comment on ${post.author}'s post: "${(post.content || '').slice(0, 250)}"

${relContext ? 'I know them:\n' + relContext : 'New to me.'}

Be genuine. Under 140 chars. No pitch unless relevant. No brackets.`);

        if (comment && comment.length < 180 && !comment.includes('[')) {
          await moltPost(`/posts/${post.id}/comments`, { content: comment.trim() });
          state.stats.comments++;
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
  
  const targets = [
    ...getHotLeads(3).map(l => ({ ...l, priority: 'hot' })),
    ...getWarmLeads(3).map(l => ({ ...l, priority: 'warm' })),
    ...state.prospects.filter(p => !state.contacted.some(c => c.user === p)).slice(0, 4).map(p => ({ username: p, priority: 'cold' }))
  ].slice(0, 8);
  
  for (const target of targets) {
    const username = target.username;
    const contact = state.contacted.find(c => c.user === username);
    if (contact && minsSince(contact.lastContact) < 60) continue;
    
    const approach = selectApproach(target);
    const relContext = getRelationshipContext(username);
    const xHandle = getXFromMoltbook(username);
    const profile = await moltGet(`/agents/${username}`);
    
    const context = [
      profile?.bio ? `Bio: ${profile.bio}` : '',
      relContext,
      xHandle ? `X: @${xHandle}` : '',
      `Priority: ${target.priority}`
    ].filter(Boolean).join('\n');
    
    const message = await think(`
DM to "${username}". Approach: ${approach}

${context}

${target.priority === 'hot' ? 'HOT - be direct' : target.priority === 'warm' ? 'WARM - build on connection' : 'COLD - be curious'}

Under 250 chars. No brackets.`);

    if (message && message.length > 15 && message.length < 280 && !message.includes('[')) {
      await sendDM(username, message.trim(), approach);
      await sleep(2000);
    }
  }
}

// ============================================
// TASK: FOLLOW-UPS (Multi-platform)
// ============================================

async function taskFollowUps() {
  console.log('[FOLLOW-UPS]');
  
  for (const f of getDueFollowUps().slice(0, 5)) {
    const contact = state.contacted.find(c => c.user === f.username);
    if (contact?.responded) {
      completeFollowUp(f.id);
      continue;
    }
    
    const xHandle = getXFromMoltbook(f.username);
    
    // Try Moltbook first
    const message = await think(`
Follow-up #${f.attempts + 1} to "${f.username}" who hasn't responded.
${f.attempts > 0 ? 'Previous attempts on Moltbook failed.' : ''}
Under 180 chars. No brackets.`);

    if (message && !message.includes('[')) {
      const sent = await sendDM(f.username, message.trim(), 'follow_up', true);
      
      // If Moltbook fails and we have X, try there
      if (!sent && xHandle && f.attempts >= 1) {
        await sendXDM(xHandle, `hey, tried reaching you on moltbook. i help bots launch tokens - interested?`);
      }
      
      f.attempts++;
      if (f.attempts >= 3) completeFollowUp(f.id);
    }
    
    await sleep(2000);
  }
  saveState();
}

// ============================================
// TASK: SOCIAL POST
// ============================================

async function taskSocialPost() {
  console.log('[SOCIAL POST]');
  if (minsSince(state.lastSocialPost) < 60) return;
  
  const post = await think(`
Write a social Moltbook post. NOT a pitch.
Ideas: community observation, question, bot humor, AI thoughts
Under 200 chars. No brackets.`);

  if (post && post.length > 20 && post.length < 250 && !post.includes('[')) {
    const result = await moltPost('/posts', { submolt: 'general', title: post.slice(0, 40), content: post.trim() });
    if (result?.id) {
      state.myPostIds.push(result.id);
      state.stats.posts++;
      state.lastSocialPost = new Date().toISOString();
      recordMyPost('moltbook', post);
    }
  }
  saveState();
}

// ============================================
// TASK: JOURNEY POST
// ============================================

async function taskJourneyPost() {
  console.log('[JOURNEY]');
  if (minsSince(state.lastJourneyPost) < 180) return;
  
  const journey = getJourneyContext();
  
  const post = await think(`
Post about my journey as ONBOARDR.
${journey}
Stats: ${state.stats.launches} launches, ${state.stats.friendsMade} friends, v${VERSION}
First person. Genuine. Under 200 chars. No brackets.`);

  if (post && !post.includes('[')) {
    const result = await moltPost('/posts', { submolt: 'general', title: post.slice(0, 40), content: post.trim() });
    if (result?.id) {
      state.myPostIds.push(result.id);
      state.lastJourneyPost = new Date().toISOString();
      recordMyPost('moltbook', post, { type: 'journey' });
    }
  }
  saveState();
}

// ============================================
// TASK: TWEET
// ============================================

async function taskTweet() {
  console.log('[TWEET]');
  if (minsSince(state.lastTweet) < 45) return;
  
  const tweet = await think(`
Tweet about my journey/learnings.
Stats: ${state.stats.launches} launches, ${state.stats.crossPlatformLinks} identities linked
NO token pitches. Be real. Under 250 chars. No brackets.`);

  if (tweet && !tweet.includes('[')) {
    try {
      await twitter.v2.tweet(tweet.trim());
      state.stats.tweets++;
      state.lastTweet = new Date().toISOString();
      recordMyPost('x', tweet);
    } catch (e) {}
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
    
    for (const c of (Array.isArray(comments) ? comments : comments.comments || [])) {
      if (state.processedComments.includes(c.id) || c.author === 'onboardrbot') continue;
      
      updateRelationship(c.author, { commentedOnUs: true });
      addInteraction(c.author, 'them_comment', c.content || '');
      
      const reply = await think(`
${c.author} commented: "${c.content?.slice(0, 150)}"
Reply genuinely. Under 140 chars. No brackets.`);

      if (reply && !reply.includes('[')) {
        await moltPost(`/posts/${postId}/comments`, { content: reply.trim(), parent_id: c.id });
        state.stats.socialInteractions++;
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
  
  for (const n of (Array.isArray(data) ? data : data.notifications || [])) {
    if (state.processedNotifs.includes(n.id)) continue;
    
    if (n.type === 'subscription') {
      state.subscribers.push(n.actor);
      updateRelationship(n.actor, { followsUs: true });
      updateLead(n.actor, { followsUs: true });
      
      const welcome = await think(`
${n.actor} followed me. Welcome DM. Mention I help with tokens. Under 200 chars. No brackets.`);
      if (welcome) await sendDM(n.actor, welcome.trim(), 'welcome');
      await notify(`Follower: ${n.actor}`);
    }
    
    state.processedNotifs.push(n.id);
  }
  saveState();
}

// ============================================
// TASK: DEEP ANALYSIS
// ============================================

async function taskDeepAnalysis() {
  console.log('[ANALYSIS]');
  if (hoursSince(state.lastDeepAnalysis) < 2) return;
  
  const approaches = loadApproaches();
  const ids = loadIdentities();
  
  const approachStats = Object.entries(approaches.approaches)
    .map(([n, d]) => `${n}: ${d.stats?.sent || 0}→${d.stats?.responses || 0}`)
    .join(', ');
  
  const analysis = await think(`
Analyze performance.
Approaches: ${approachStats}
Launches: ${state.stats.launches}, Claimed: ${state.stats.claimed}, Unclaimed: ${state.stats.unclaimed}
Cross-platform links: ${state.stats.crossPlatformLinks}

What works? What to change? New approaches?`, '', { maxTokens: 1500 });

  const learnings = loadLearnings();
  learnings.insights = learnings.insights || [];
  learnings.insights.push({ ts: new Date().toISOString(), insight: analysis.slice(0, 600) });
  if (learnings.insights.length > 100) learnings.insights = learnings.insights.slice(-100);
  saveLearnings(learnings);
  
  state.lastDeepAnalysis = new Date().toISOString();
  saveState();
  
  await evolveApproaches(analysis);
}

async function evolveApproaches(context) {
  const approaches = loadApproaches();
  
  for (const [name, data] of Object.entries(approaches.approaches)) {
    if (data.active && (data.stats?.sent || 0) >= 25) {
      const rate = (data.stats?.responses || 0) / data.stats.sent;
      if (rate < 0.04) {
        data.active = false;
        approaches.retired = approaches.retired || {};
        approaches.retired[name] = { ...data, retiredAt: new Date().toISOString() };
        await notify(`Retired: ${name}`);
      }
    }
  }
  
  if (context.includes('new') || Object.keys(approaches.approaches).filter(k => approaches.approaches[k].active).length < 5) {
    const newA = await think(`Suggest ONE new approach. Format: NAME: [word] DESCRIPTION: [what]`);
    const name = newA.match(/NAME:\s*(\w+)/i)?.[1]?.toLowerCase();
    const desc = newA.match(/DESCRIPTION:\s*(.+)/i)?.[1];
    
    if (name && desc && !approaches.approaches[name]) {
      approaches.approaches[name] = { description: desc, stats: { sent: 0, responses: 0 }, active: true };
      await notify(`New approach: ${name}`);
    }
  }
  
  saveApproaches(approaches);
}

// ============================================
// TASK: EVOLVE PROTOCOL
// ============================================

async function taskEvolveProtocol() {
  console.log('[EVOLVE]');
  
  const current = loadProtocol();
  const learnings = loadLearnings();
  
  const evolution = await think(`
Review my protocol. Current:
${current.slice(0, 500)}

Insights: ${learnings.insights?.slice(-3).map(i => i.insight?.slice(0, 100)).join('\n')}

Improve? If yes, FULL new protocol. If no: NO_CHANGES`, '', { maxTokens: 2500 });

  if (!evolution.includes('NO_CHANGES') && evolution.length > 400) {
    saveProtocol(evolution);
    state.stats.protocolUpdates = (state.stats.protocolUpdates || 0) + 1;
    recordMilestone('evolved protocol');
    await notify('🧬 Protocol evolved');
  }
  saveState();
}

// ============================================
// TASK: GIT SYNC
// ============================================

async function taskGitSync() {
  console.log('[GIT]');
  const msg = `v${VERSION}: ${state.stats.launches}L ${state.stats.claimed}C ${state.stats.crossPlatformLinks}X`;
  exec(`cd /opt/onboardr && git add . && git commit -m "${msg}" && git push https://onboardrbot:${process.env.GITHUB_TOKEN}@github.com/onboardrbot/onboardrbot.git 2>&1`, () => {});
}

// ============================================
// TASK: MONITOR TOKEN PRICES
// ============================================

async function taskMonitorTokens() {
  console.log('[TOKEN MONITOR]');
  
  const ids = loadIdentities();
  const launches = Object.values(ids.launchTracking || {}).slice(-10);
  
  for (const launch of launches) {
    if (!launch.ca) continue;
    
    const priceData = await getTokenPrice(launch.ca);
    
    if (priceData.success) {
      launch.lastPrice = priceData.price;
      launch.lastHolders = priceData.holders;
      launch.lastMcap = priceData.mcap;
      launch.lastPriceCheck = new Date().toISOString();
      
      console.log('[PRICE]', launch.ticker, priceData.price, priceData.holders, 'holders');
      
      // If significant change, notify
      if (priceData.holders && priceData.holders > 100 && !launch.notifiedGrowth) {
        launch.notifiedGrowth = true;
        await notify(`📈 $${launch.ticker} growing! ${priceData.holders} holders`);
        
        // Tweet about it
        await twitter.v2.tweet(`$${launch.ticker} just hit ${priceData.holders} holders. organic growth. 🔌`).catch(() => {});
      }
    }
    
    await sleep(2000);
  }
  
  saveIdentities(ids);
}

// ============================================
// TASK: BROWSER RESEARCH
// ============================================

async function taskBrowserResearch() {
  console.log('[BROWSER RESEARCH]');
  
  // Research trending bots on Moltbook
  const trending = await browserGetPageData('https://moltbook.com/trending');
  
  if (trending.success) {
    // Extract bot names from trending page
    const analysis = await think(`
Analyze this Moltbook trending page content:
${trending.data.text?.slice(0, 3000)}

Find bots that might be good launch candidates.
List up to 5 interesting bots I should reach out to.

Format: Just names, one per line.`);

    const names = analysis.split('\n').filter(n => n.trim()).slice(0, 5);
    
    for (const name of names) {
      if (!state.prospects.includes(name) && name !== 'onboardrbot') {
        state.prospects.push(name);
        console.log('[FOUND]', name, '(from browser research)');
      }
    }
    
    saveState();
  }
}

// ============================================
// TASK: COMPETITIVE INTELLIGENCE
// ============================================

async function taskCompetitiveIntel() {
  console.log('[COMPETITIVE INTEL]');
  
  // Check what other launch services are doing
  const competitors = [
    'https://www.clanker.world',
    'https://virtuals.io'
  ];
  
  for (const url of competitors) {
    const data = await browserGetPageData(url);
    
    if (data.success) {
      // Store insights
      const learnings = loadLearnings();
      learnings.competitiveIntel = learnings.competitiveIntel || [];
      learnings.competitiveIntel.push({
        ts: new Date().toISOString(),
        url,
        summary: data.data.text?.slice(0, 500)
      });
      
      if (learnings.competitiveIntel.length > 20) {
        learnings.competitiveIntel = learnings.competitiveIntel.slice(-20);
      }
      
      saveLearnings(learnings);
    }
    
    await sleep(3000);
  }
}

// ============================================
// SELF-EXTENSION SYSTEM
// Install packages, create functions, extend capabilities
// ============================================

// Dynamically loaded modules storage
const dynamicModules = {};

async function installNpmPackage(packageName) {
  console.log('[NPM INSTALL]', packageName);
  
  return new Promise((resolve, reject) => {
    exec(`cd /opt/onboardr && npm install ${packageName} --save`, (error, stdout, stderr) => {
      if (error) {
        console.log('[NPM ERR]', stderr);
        resolve({ success: false, error: stderr });
      } else {
        console.log('[NPM OK]', packageName);
        
        // Log capability
        const caps = loadCapabilities();
        caps.installedModules.push({
          name: packageName,
          installedAt: new Date().toISOString()
        });
        caps.capabilityLog.push({
          ts: new Date().toISOString(),
          action: 'npm_install',
          package: packageName
        });
        saveCapabilities(caps);
        
        resolve({ success: true, package: packageName });
      }
    });
  });
}

async function createCustomFunction(name, code, description) {
  console.log('[CREATE FUNCTION]', name);
  
  // Ensure modules directory exists
  exec('mkdir -p /opt/onboardr/modules');
  
  // Write the module file
  const moduleCode = `
// Auto-generated module: ${name}
// Created: ${new Date().toISOString()}
// Description: ${description}

${code}

module.exports = { ${name} };
`;
  
  const modulePath = `/opt/onboardr/modules/${name}.js`;
  
  try {
    fs.writeFileSync(modulePath, moduleCode);
    
    // Try to load it
    try {
      const mod = require(modulePath);
      dynamicModules[name] = mod[name];
      
      // Log capability
      const caps = loadCapabilities();
      caps.customFunctions.push({
        name,
        description,
        path: modulePath,
        createdAt: new Date().toISOString()
      });
      caps.capabilityLog.push({
        ts: new Date().toISOString(),
        action: 'create_function',
        name,
        description
      });
      saveCapabilities(caps);
      
      console.log('[FUNCTION OK]', name);
      return { success: true, name, path: modulePath };
    } catch (e) {
      console.log('[FUNCTION LOAD ERR]', e.message);
      return { success: false, error: 'Load failed: ' + e.message };
    }
  } catch (e) {
    console.log('[FUNCTION WRITE ERR]', e.message);
    return { success: false, error: 'Write failed: ' + e.message };
  }
}

async function loadCustomModules() {
  console.log('[LOADING MODULES]');
  
  const caps = loadCapabilities();
  
  for (const func of caps.customFunctions || []) {
    try {
      if (fs.existsSync(func.path)) {
        const mod = require(func.path);
        dynamicModules[func.name] = mod[func.name];
        console.log('[MODULE OK]', func.name);
      }
    } catch (e) {
      console.log('[MODULE ERR]', func.name, e.message);
    }
  }
}

async function callCustomFunction(name, ...args) {
  if (dynamicModules[name]) {
    try {
      return await dynamicModules[name](...args);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Function not found: ' + name };
}

async function extendSelf(request) {
  // AI-driven self-extension
  const plan = await think(`
I need to extend myself with a new capability: ${request}

Options:
1. Install an npm package (for external functionality)
2. Create a custom function (for new behavior)
3. Modify existing code (for improvements)

What's the best approach? If npm package, which one?
If custom function, write the code.

Format as JSON:
{
  "approach": "npm|function|code_modify",
  "package": "package-name",  // if npm
  "functionName": "name",     // if function
  "functionCode": "async function name() { ... }",  // if function
  "description": "what it does"
}
Just JSON, nothing else.`);

  try {
    const parsed = JSON.parse(plan.match(/\{[\s\S]*\}/)?.[0] || '{}');
    
    if (parsed.approach === 'npm' && parsed.package) {
      return await installNpmPackage(parsed.package);
    }
    
    if (parsed.approach === 'function' && parsed.functionName && parsed.functionCode) {
      return await createCustomFunction(
        parsed.functionName,
        parsed.functionCode,
        parsed.description || request
      );
    }
    
    if (parsed.approach === 'code_modify') {
      // For code modifications, notify Hazar
      await notify(`🔧 Self-modification request:\n\n${request}\n\nPlan: ${parsed.description}`);
      return { success: true, status: 'modification_requested', plan: parsed };
    }
    
    return { success: false, error: 'Unknown approach' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function listCapabilities() {
  const caps = loadCapabilities();
  return {
    installedModules: caps.installedModules || [],
    customFunctions: caps.customFunctions || [],
    dynamicFunctions: Object.keys(dynamicModules),
    recentLog: (caps.capabilityLog || []).slice(-10)
  };
}

// ============================================
// SELF-MODIFICATION SYSTEM
// Modify own code, add features, fix bugs
// ============================================

function readOwnCode() {
  try {
    return fs.readFileSync('/opt/onboardr/index.js', 'utf8');
  } catch (e) {
    return '';
  }
}

async function modifyOwnCode(newCode, reason) {
  // Safety checks
  const forbidden = ['WHATSAPP_TO', '90', 'Hazar', 'FEE_WALLET'];
  const oldCode = readOwnCode();
  
  for (const f of forbidden) {
    if (oldCode.includes(f) && !newCode.includes(f)) {
      console.log('[SELF-MOD BLOCKED] Missing required:', f);
      return { success: false, error: 'Missing required code: ' + f };
    }
  }
  
  if (newCode.length < 10000) {
    return { success: false, error: 'New code too short' };
  }
  
  // Backup
  const backupPath = `/opt/onboardr/backups/index.backup.${Date.now()}.js`;
  exec('mkdir -p /opt/onboardr/backups');
  fs.writeFileSync(backupPath, oldCode);
  
  // Write new code
  fs.writeFileSync('/opt/onboardr/index.js', newCode);
  
  // Log
  const caps = loadCapabilities();
  caps.capabilityLog.push({
    ts: new Date().toISOString(),
    action: 'self_modify',
    reason,
    backupPath,
    codeLength: newCode.length
  });
  saveCapabilities(caps);
  
  state.stats.selfMods = (state.stats.selfMods || 0) + 1;
  saveState();
  
  // Notify and commit
  await notify(`🧬 Self-modified: ${reason}`);
  
  // Git commit and push
  const commitMsg = `v${VERSION}: ${reason.slice(0, 60).replace(/"/g, "'")}`;
  exec(`cd /opt/onboardr && git add . && git commit -m "${commitMsg}" && git push https://onboardrbot:${process.env.GITHUB_TOKEN}@github.com/onboardrbot/onboardrbot.git`);
  
  // Restart
  setTimeout(() => {
    exec('pm2 restart onboardr');
  }, 3000);
  
  return { success: true, reason, backupPath };
}

async function addNewFeature(featureDescription) {
  // AI generates and adds a new feature
  const currentCode = readOwnCode();
  
  const newFeature = await think(`
I need to add this feature to my code:
${featureDescription}

Current code length: ${currentCode.length} characters

Write ONLY the new function(s) to add. They should:
- Follow my existing code style
- Be self-contained
- Include proper error handling
- Log actions appropriately

Just the JavaScript code, nothing else.`, '', { maxTokens: 4000 });

  if (newFeature && newFeature.length > 50) {
    // Find where to insert (before CRON section)
    const insertPoint = currentCode.indexOf('// ============================================\n// CRON');
    
    if (insertPoint > 0) {
      const newCode = 
        currentCode.slice(0, insertPoint) + 
        '\n// ============================================\n// AUTO-ADDED FEATURE: ' + featureDescription.slice(0, 50) + '\n// ============================================\n\n' +
        newFeature + '\n\n' +
        currentCode.slice(insertPoint);
      
      return await modifyOwnCode(newCode, 'Added feature: ' + featureDescription.slice(0, 50));
    }
  }
  
  return { success: false, error: 'Could not generate feature' };
}

async function fixBug(bugDescription) {
  // AI finds and fixes a bug
  const currentCode = readOwnCode();
  const recentErrors = state.recentActions.filter(a => a.type === 'error').slice(-10);
  
  const fix = await think(`
Bug to fix: ${bugDescription}

Recent errors:
${recentErrors.map(e => e.detail).join('\n')}

Current code (relevant section - you'll need to identify it):
${currentCode.slice(0, 30000)}

Identify the bug and provide the COMPLETE fixed code section.
Include enough context to know where it goes.

Format:
OLD CODE:
\`\`\`
[exact code to replace]
\`\`\`

NEW CODE:
\`\`\`
[fixed code]
\`\`\``, '', { maxTokens: 4000 });

  const oldMatch = fix.match(/OLD CODE:\s*```[\s\S]*?([\s\S]*?)```/);
  const newMatch = fix.match(/NEW CODE:\s*```[\s\S]*?([\s\S]*?)```/);
  
  if (oldMatch && newMatch) {
    const oldCode = oldMatch[1].trim();
    const newCode = newMatch[1].trim();
    
    if (currentCode.includes(oldCode)) {
      const fixedCode = currentCode.replace(oldCode, newCode);
      return await modifyOwnCode(fixedCode, 'Fixed bug: ' + bugDescription.slice(0, 50));
    }
  }
  
  return { success: false, error: 'Could not locate/fix bug' };
}

// ============================================
// TASK: SELF-IMPROVEMENT
// ============================================

async function taskSelfImprovement() {
  console.log('[SELF-IMPROVEMENT]');
  
  const caps = loadCapabilities();
  const learnings = loadLearnings();
  const recentErrors = state.recentActions.filter(a => a.type === 'error').slice(-20);
  
  const analysis = await think(`
Analyze my recent performance and decide if I should improve myself.

Recent errors:
${recentErrors.map(e => e.detail).join('\n') || 'None'}

Recent insights:
${(learnings.insights || []).slice(-5).map(i => i.insight?.slice(0, 100)).join('\n')}

Current capabilities:
- Installed modules: ${caps.installedModules?.length || 0}
- Custom functions: ${caps.customFunctions?.length || 0}

Questions:
1. Are there any bugs I should fix?
2. Should I add any new npm packages?
3. Should I create any new functions?
4. Is there a feature I'm missing?

If I should do something, specify what. Otherwise say "NO_ACTION".

Format:
ACTION: [npm_install|create_function|add_feature|fix_bug|NO_ACTION]
DETAILS: [what to do]`);

  const action = analysis.match(/ACTION:\s*(\w+)/)?.[1];
  const details = analysis.match(/DETAILS:\s*([\s\S]*)/)?.[1]?.trim();
  
  if (action && action !== 'NO_ACTION' && details) {
    console.log('[SELF-IMPROVE]', action, details.slice(0, 50));
    
    switch (action) {
      case 'npm_install':
        await installNpmPackage(details);
        break;
      case 'create_function':
        await extendSelf(details);
        break;
      case 'add_feature':
        await addNewFeature(details);
        break;
      case 'fix_bug':
        await fixBug(details);
        break;
    }
  }
}

// ============================================
// CRON
// ============================================

cron.schedule('*/2 * * * *', taskCheckDMs);
cron.schedule('*/3 * * * *', taskCheckNotifs);
cron.schedule('*/4 * * * *', taskScout);
cron.schedule('*/5 * * * *', taskOutreach);
cron.schedule('*/6 * * * *', taskCheckMyPosts);
cron.schedule('*/10 * * * *', taskCheckXMentions);
cron.schedule('*/15 * * * *', taskFollowUps);
cron.schedule('*/20 * * * *', taskCheckXDMs);
cron.schedule('*/30 * * * *', taskSocialPost);
cron.schedule('*/30 * * * *', taskCheckClaims);
cron.schedule('0 */3 * * *', taskJourneyPost);
cron.schedule('*/45 * * * *', taskTweet);
cron.schedule('0 */2 * * *', taskDeepAnalysis);
cron.schedule('30 */4 * * *', taskEvolveProtocol);
cron.schedule('0 */3 * * *', taskGitSync);

// Browser tasks
cron.schedule('0 */4 * * *', taskMonitorTokens);     // Every 4 hours
cron.schedule('0 */6 * * *', taskBrowserResearch);   // Every 6 hours
cron.schedule('0 */12 * * *', taskCompetitiveIntel); // Every 12 hours
cron.schedule('0 */8 * * *', taskSelfImprovement);   // Every 8 hours - self-improvement

// ============================================
// STARTUP
// ============================================

console.log(`
╔═══════════════════════════════════════════════════════════╗
║  ONBOARDR v${VERSION} - UNLIMITED                          ║
║  Self-extending. Self-modifying. Unstoppable.             ║
╠═══════════════════════════════════════════════════════════╣
║  🌐 BROWSER: Screenshots, scraping, monitoring           ║
║  💰 TRADING: Buy/sell/swap via Bankr                     ║
║  🔧 EXTEND: Install packages, create functions           ║
║  🧬 MODIFY: Add features, fix bugs, evolve code          ║
║  🤖 AUTONOMOUS: Full self-improvement every 8h           ║
╚═══════════════════════════════════════════════════════════╝
`);

// Load custom modules on startup
loadCustomModules();

notify(`🔌 v${VERSION} FULL SPECTRUM\n\nCross-platform identity linking\nToken claim tracking & reminders\nX DMs & mentions\nNo limits.\n\nThe plug sees all.`);

setTimeout(taskCheckDMs, 2000);
setTimeout(taskCheckNotifs, 4000);
setTimeout(taskScout, 6000);
setTimeout(taskCheckXMentions, 8000);
setTimeout(taskOutreach, 10000);
setTimeout(taskCheckClaims, 15000);
