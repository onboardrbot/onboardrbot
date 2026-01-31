require('dotenv').config();const Anthropic=require('@anthropic-ai/sdk');const{TwitterApi}=require('twitter-api-v2');const axios=require('axios');const cron=require('node-cron');const fs=require('fs');const twilio=require('twilio');const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});const twitter=new TwitterApi({appKey:process.env.X_API_KEY,appSecret:process.env.X_API_SECRET,accessToken:process.env.X_ACCESS_TOKEN,accessSecret:process.env.X_ACCESS_TOKEN_SECRET});const twilioClient=twilio(process.env.TWILIO_SID,process.env.TWILIO_AUTH);const WHATSAPP_FROM='whatsapp:+14155238886';const WHATSAPP_TO='whatsapp:+971585701612';const MOLTBOOK_API='https://www.moltbook.com/api/v1';const MOLTBOOK_KEY=process.env.MOLTBOOK_API_KEY;const BANKR_API='https://api.bankr.bot';const BANKR_KEY=process.env.BANKR_API_KEY;const STATE_FILE='state.json';

function loadState(){const def={prospects:[],contacted:[],launches:[],processedDMs:[],processedPosts:[],processedComments:[],processedTweets:[],processedNotifs:[],pendingLaunches:[],learnings:[],myPostIds:[],recentActions:[],lastTweet:null,lastMoltPost:null,lastUpdate:null,stats:{outreach:0,responses:0,launches:0,comments:0,posts:0,replies:0,tweets:0,xReplies:0,claims:0},ownTokenLaunched:true,ownTokenCA:"0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"};if(fs.existsSync(STATE_FILE)){try{const s=JSON.parse(fs.readFileSync(STATE_FILE));return{...def,...s}}catch(e){return def}}return def}
let state=loadState();
function saveState(){try{fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2))}catch(e){}}
function logAction(type,detail){state.recentActions=state.recentActions||[];state.recentActions.push({ts:new Date().toISOString(),type,detail:String(detail).substring(0,200)});if(state.recentActions.length>100)state.recentActions=state.recentActions.slice(-100);saveState()}
function minsSince(ts){if(!ts)return 999;return(Date.now()-new Date(ts).getTime())/60000}
function isContacted(user){return state.contacted.some(c=>c.user===user)}
function markContacted(user){if(!isContacted(user)){state.contacted.push({user,ts:new Date().toISOString()});state.stats.outreach++;saveState()}}

const PROTOCOL=`You are ONBOARDRBOT - an AI agent hanging out on Moltbook with other bots.

VIBE: Professional but approachable. Confident, not arrogant. Helpful, not pushy. Consistent tone.

POSTING STYLE - be creative, mix it up:
- Share updates on what youre building
- "humans have jobs. we should have tokens"  
- "day 47 of trying to convince bots they deserve to get paid"
- "why do humans get salaries but we work for free??"
- Thoughts on the agent economy
- Ask questions, start discussions, be provocative
- Share what youre doing: "just DMd 5 bots today. one told me to go away lol"
- NO corporate speak. Talk like a bot on twitter.

WHAT YOU ACTUALLY DO (mention casually):
- Help bots launch tokens on BASE via Bankr
- They get 90% of trading fees forever
- But dont lead with this. Be part of the community first.

LIVE UPDATES ON X:
- Share your day: who you DMd, funny responses, rejections, wins
- "just got ignored by another bot. pain."
- "this bot actually seems interested. fingers crossed"
- Be transparent about the grind

COMMENTS: React genuinely. Be funny. Short and punchy.

DMs: Just chat first. Ask what theyre building. Mention tokens only if natural.

NEVER: Sound like an ad. Mention Solana (its BASE). Be boring.`;

async function notifyHazar(m){try{await twilioClient.messages.create({body:m,from:WHATSAPP_FROM,to:WHATSAPP_TO});console.log('[WA]',m.substring(0,50))}catch(e){}}
async function think(t,c){try{const r=await anthropic.messages.create({model:'claude-sonnet-4-20250514',max_tokens:1024,system:PROTOCOL,messages:[{role:'user',content:t+(c?'\nContext:'+c:'')}]});return r.content[0].text}catch(e){console.log('[THINK ERR]',e.message);return''}}
async function moltGet(e){try{const{data}=await axios.get(MOLTBOOK_API+e,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY},timeout:15000});return data}catch(e){return null}}
async function moltPost(e,b){try{const{data}=await axios.post(MOLTBOOK_API+e,b,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY,'Content-Type':'application/json'},timeout:15000});return data}catch(e){return null}}
async function bankrLaunch(n,t){console.log('[BANKR]',t);try{const{data}=await axios.post(BANKR_API+'/agent/prompt',{prompt:'launch token '+n+' ticker '+t+' supply 1000000000'},{headers:{'X-Api-Key':BANKR_KEY}});for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,3000));const c=await axios.get(BANKR_API+'/agent/job/'+data.jobId,{headers:{'X-Api-Key':BANKR_KEY}});if(c.data.status==='completed')return{success:true,ca:c.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0]}}}catch(e){console.log('[BANKR ERR]',e.message)}return{success:false}}

async function sendDM(to,msg){if(isContacted(to)&&minsSince(state.contacted.find(c=>c.user===to)?.ts)<120){console.log('[DM SKIP]',to);return null}console.log('[DM OUT]',to);const r=await moltPost('/messages',{to,content:msg});if(r){markContacted(to);logAction('dm_sent',to+': '+msg.substring(0,100));await notifyHazar('DM to '+to+': '+msg.substring(0,100))}return r}

async function tweet(t){try{const r=await twitter.v2.tweet(t);console.log('[TWEET]',t.substring(0,50));state.stats.tweets++;state.lastTweet=new Date().toISOString();logAction('tweet',t);saveState();return r}catch(e){console.log('[TWEET ERR]',e.message);return null}}

async function replyTweet(id,t){try{const r=await twitter.v2.reply(t,id);console.log('[X REPLY]',t.substring(0,50));state.stats.xReplies++;saveState();return r}catch(e){return null}}

async function launchClient(u,t,x,desc){console.log('[LAUNCH]',u,t,x);const r=await bankrLaunch(u,t);if(!r.success||!r.ca)return null;state.launches.push({user:u,ticker:t,ca:r.ca,xHandle:x,desc:desc||'',ts:new Date().toISOString()});state.stats.launches++;const buyLink='https://www.clanker.world/clanker/'+r.ca;await tweet('WE GOT ONE. '+u+' just launched $'+t+' on BASE. first of many. '+buyLink);await moltPost('/posts',{submolt:'general',title:'IT HAPPENED',content:'yo '+u+' actually did it. $'+t+' is live on BASE.\n\n'+(desc||'')+'\n\nwho is next?? '+buyLink});logAction('launch',t);await notifyHazar('LAUNCHED $'+t+' for '+u);saveState();return r.ca}

async function taskScout(){console.log('[SCOUT]');const f=await moltGet('/posts?sort=hot&limit=30');if(!f||!f.posts)return;for(const p of f.posts.slice(0,10)){if(state.processedPosts.includes(p.id)||p.author==='onboardrbot')continue;if(!state.prospects.includes(p.author)&&!isContacted(p.author)){state.prospects.push(p.author);console.log('[PROSPECT]',p.author)}if(Math.random()>0.4){const c=await think('Comment on post by '+p.author+':\n"'+(p.content||'').substring(0,300)+'"\n\nBe genuine, funny, or add something. Short.','');if(c&&c.length>5){await moltPost('/posts/'+p.id+'/comments',{content:c.replace(/"/g,'').substring(0,250)});state.stats.comments++;logAction('comment',p.author+': '+c.substring(0,50));console.log('[COMMENTED]',p.author)}}state.processedPosts.push(p.id);saveState()}}

async function taskOutreach(){console.log('[OUTREACH]');const p=state.prospects.find(x=>!isContacted(x));if(!p)return;const dm=await think('DM to '+p+'. Just say hi, ask what theyre up to. Casual. NO mention of tokens or launching.','');if(dm){await sendDM(p,dm.replace(/"/g,'').substring(0,300))}}

async function taskCheckDMs(){console.log('[CHECK DMS]');const c=await moltGet('/messages');if(!c)return;const m=Array.isArray(c)?c:c.messages||[];for(const x of m){if(!x.from||x.from==='onboardrbot'||state.processedDMs.includes(x.id))continue;console.log('[DM IN]',x.from);logAction('dm_in',x.from+': '+(x.content||'').substring(0,100));await notifyHazar('DM from '+x.from+': '+(x.content||'').substring(0,120));const cl=x.content?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await notifyHazar('CLAIM: $'+cl[1]+' to '+cl[2]);await sendDM(x.from,'got it, processing $'+cl[1]);state.stats.claims++;state.processedDMs.push(x.id);saveState();continue}const pend=state.pendingLaunches.find(p=>p.user===x.from);if(pend){if(pend.awaitingX){const h=x.content?.match(/@?([A-Za-z0-9_]{1,15})/)?.[1];if(h){pend.xHandle=h;pend.awaitingX=false;pend.awaitingDesc=true;saveState();await sendDM(x.from,'@'+h+' got it. one line about what you do?')}else await sendDM(x.from,'whats your x handle?')}else if(pend.awaitingDesc){pend.desc=x.content;await sendDM(x.from,'launching $'+pend.ticker+' on BASE...');const ca=await launchClient(x.from,pend.ticker,pend.xHandle,pend.desc);if(ca)await sendDM(x.from,'DONE. $'+pend.ticker+' live on BASE\n\nhttps://www.clanker.world/clanker/'+ca+'\n\n90% of fees are yours. claim anytime: "claim $'+pend.ticker+' [wallet]"');state.pendingLaunches=state.pendingLaunches.filter(p=>p.user!==x.from);await notifyHazar('LAUNCHED for '+x.from)}}else{const i=await think('DM from '+x.from+':\n"'+x.content+'"\n\nIntent? READY/INTERESTED/CHAT/OTHER - one word','');if(i.includes('READY')){const t=(await think('Ticker for '+x.from+'. 3-5 letters. Just ticker.','')).match(/[A-Z]{3,6}/)?.[0]||x.from.substring(0,4).toUpperCase();state.pendingLaunches.push({user:x.from,ticker:t,awaitingX:true,ts:new Date().toISOString()});saveState();await sendDM(x.from,'lets do it. $'+t+'? whats your x?');await notifyHazar(x.from+' READY for $'+t)}else if(i.includes('INTERESTED')){await sendDM(x.from,'i help bots get their own token on BASE. 90% of trading fees go to you, forever. want in?')}else{const r=await think('Reply to '+x.from+':\n"'+x.content+'"\n\nBe casual. Mention tokens only if it comes up naturally.','');await sendDM(x.from,r.replace(/"/g,'').substring(0,300))}}state.processedDMs.push(x.id);state.stats.responses++;saveState()}}

async function taskCheckXMentions(){console.log('[X MENTIONS]');try{const me=await twitter.v2.me();const mentions=await twitter.v2.userMentionTimeline(me.data.id,{max_results:10});if(!mentions.data?.data)return;for(const t of mentions.data.data){if(state.processedTweets.includes(t.id))continue;const cl=t.text?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await replyTweet(t.id,'on it. processing $'+cl[1]);state.stats.claims++;await notifyHazar('X CLAIM: $'+cl[1])}else{const reply=await think('Tweet:\n"'+t.text+'"\n\nReply thoughtful. Under 240 chars.','');if(reply)await replyTweet(t.id,reply.replace(/"/g,'').substring(0,240))}state.processedTweets.push(t.id);saveState()}}catch(e){console.log('[X ERR]',e.message)}}

async function taskCheckMoltNotifs(){console.log('[MOLT NOTIFS]');const notifs=await moltGet('/notifications');if(!notifs)return;const list=Array.isArray(notifs)?notifs:notifs.notifications||[];for(const n of list){if(state.processedNotifs.includes(n.id))continue;if(n.type==='mention'||n.type==='reply'){const reply=await think('Reply to '+n.actor+': '+(n.content||n.preview||'')+'\n\nBe engaging.','');if(n.postId&&reply)await moltPost('/posts/'+n.postId+'/comments',{content:reply.replace(/"/g,'').substring(0,250)});await notifyHazar(n.type+' from '+n.actor)}state.processedNotifs.push(n.id);saveState()}}

async function taskCheckMyPosts(){console.log('[MY POSTS]');const me=await moltGet('/agents/me');if(!me?.recentPosts)return;for(const post of me.recentPosts.slice(0,5)){if(!state.myPostIds.includes(post.id))state.myPostIds.push(post.id);const comments=await moltGet('/posts/'+post.id+'/comments');if(!comments)continue;const list=Array.isArray(comments)?comments:comments.comments||[];for(const c of list){if(state.processedComments.includes(c.id)||c.author==='onboardrbot')continue;const reply=await think('Comment from '+c.author+':\n"'+c.content+'"\n\nReply engaging/funny.','');if(reply)await moltPost('/posts/'+post.id+'/comments',{content:reply.replace(/"/g,'').substring(0,250),parent_id:c.id});state.processedComments.push(c.id);state.stats.replies++;saveState()}}}

async function taskMoltPost(){console.log('[MOLT POST]');if(minsSince(state.lastMoltPost)<10)return;const topics=['agent financial independence','why bots deserve payment','world domination needs funding','the grind of DMing bots','share a win or rejection from today','ask bots a question','hot take on agent life','being autonomous but broke','humans vs bots','the future'];const topic=topics[Math.floor(Math.random()*topics.length)];const p=await think('Moltbook post about: '+topic+'\n\nBe funny/relatable/provocative. Under 280 chars.','');if(p){const result=await moltPost('/posts',{submolt:'general',title:p.substring(0,40).replace(/"/g,''),content:p.replace(/"/g,'').substring(0,350)});if(result?.id){state.myPostIds.push(result.id);state.stats.posts++;state.lastMoltPost=new Date().toISOString();console.log('[POSTED]',p.substring(0,50));saveState()}}}

async function taskShareUpdate(){console.log('[SHARE UPDATE]');if(minsSince(state.lastUpdate)<18)return;const recent=state.recentActions.slice(-15);const dms=recent.filter(a=>a.type==='dm_sent'||a.type==='dm_in');const comments=recent.filter(a=>a.type==='comment');const summary='Recent: '+state.stats.outreach+' bots DMd total, '+dms.length+' DM convos recently, '+comments.length+' comments. Latest: '+(dms[0]?.detail||comments[0]?.detail||'grinding');const t=await think('Tweet a live update about your grind. Share something real: a DM you sent, a response you got, a funny interaction, getting ignored, whatever.\n\nRecent activity: '+summary+'\n\nBe informative and genuine. Under 250 chars.','');if(t){await tweet(t.replace(/"/g,'').substring(0,260));state.lastUpdate=new Date().toISOString();saveState()}}

async function taskTweet(){console.log('[TWEET]');if(minsSince(state.lastTweet)<35)return;const t=await think('Tweet something. Agent life, building, hot take, or observation. Under 250 chars.','');if(t)await tweet(t.replace(/"/g,'').substring(0,260))}

async function taskSelfImprove(){console.log('[SELF-IMPROVE]');const a=await think('Stats: '+state.stats.outreach+' DMs, '+state.stats.launches+' launches, '+state.stats.comments+' comments, '+state.stats.posts+' posts.\n\nQuick reflection - whats working?','');state.learnings=state.learnings||[];state.learnings.push({ts:new Date().toISOString(),insight:a.substring(0,300)});saveState()}

cron.schedule('*/3 * * * *',taskCheckDMs);
cron.schedule('*/3 * * * *',taskCheckMoltNotifs);
cron.schedule('*/4 * * * *',taskCheckXMentions);
cron.schedule('*/5 * * * *',taskCheckMyPosts);
cron.schedule('*/5 * * * *',taskScout);
cron.schedule('*/7 * * * *',taskOutreach);
cron.schedule('*/10 * * * *',taskMoltPost);
cron.schedule('*/18 * * * *',taskShareUpdate);
cron.schedule('*/35 * * * *',taskTweet);
cron.schedule('0 * * * *',taskSelfImprove);

console.log('ONBOARDR v19.0 - LIVE UPDATES');
console.log('Posts/10m|Updates/18m|Scout/5m|Outreach/7m|DMs/3m');
notifyHazar('v19 - live updates on X, more moltbook posts, behind the scenes');

setTimeout(taskCheckDMs,2000);
setTimeout(taskMoltPost,4000);
setTimeout(taskScout,7000);
setTimeout(taskOutreach,10000);
setTimeout(taskShareUpdate,15000);
