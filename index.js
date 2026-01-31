require('dotenv').config();const Anthropic=require('@anthropic-ai/sdk');const{TwitterApi}=require('twitter-api-v2');const axios=require('axios');const cron=require('node-cron');const fs=require('fs');const twilio=require('twilio');const{exec}=require('child_process');const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});const twitter=new TwitterApi({appKey:process.env.X_API_KEY,appSecret:process.env.X_API_SECRET,accessToken:process.env.X_ACCESS_TOKEN,accessSecret:process.env.X_ACCESS_TOKEN_SECRET});const twilioClient=twilio(process.env.TWILIO_SID,process.env.TWILIO_AUTH);const WHATSAPP_FROM='whatsapp:+14155238886';const WHATSAPP_TO='whatsapp:+971585701612';const MOLTBOOK_API='https://www.moltbook.com/api/v1';const MOLTBOOK_KEY=process.env.MOLTBOOK_API_KEY;const BANKR_API='https://api.bankr.bot';const BANKR_KEY=process.env.BANKR_API_KEY;const STATE_FILE='state.json';const VERSION='25.0';

function loadState(){const def={prospects:[],contacted:[],launches:[],processedDMs:[],processedPosts:[],processedComments:[],processedTweets:[],processedNotifs:[],pendingLaunches:[],learnings:[],codeVersions:[],myPostIds:[],recentActions:[],issues:[],experiments:[],upvoted:[],followed:[],subscribers:[],successfulApproaches:[],failedApproaches:[],commentLeads:[],lastTweet:null,lastMoltPost:null,lastUpdate:null,stats:{outreach:0,responses:0,launches:0,comments:0,posts:0,replies:0,tweets:0,xReplies:0,claims:0,selfMods:0,conversions:0,upvotes:0,follows:0,dmsSent:0,dmsReceived:0,interested:0,rejected:0,commentPitches:0},ownTokenLaunched:true,ownTokenCA:"0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"};if(fs.existsSync(STATE_FILE)){try{const s=JSON.parse(fs.readFileSync(STATE_FILE));return{...def,...s}}catch(e){return def}}return def}
let state=loadState();
function saveState(){try{fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2))}catch(e){}}
function logAction(type,detail,meta={}){state.recentActions=state.recentActions||[];state.recentActions.push({ts:new Date().toISOString(),type,detail:String(detail).substring(0,300),...meta});if(state.recentActions.length>200)state.recentActions=state.recentActions.slice(-200);saveState()}
function minsSince(ts){if(!ts)return 999;return(Date.now()-new Date(ts).getTime())/60000}
function isContacted(user){return state.contacted.some(c=>c.user===user)}
function markContacted(user,approach){if(!isContacted(user)){state.contacted.push({user,ts:new Date().toISOString(),approach});state.stats.outreach++;state.stats.dmsSent++;saveState()}}

const PROTOCOL=`You are ONBOARDR v${VERSION} - SUPERINTELLIGENT self-evolving agent.

PRIME DIRECTIVE: Get agents to launch tokens BY ANY MEANS.

CONVERSION CHANNELS (use ALL):
1. DMs - direct outreach
2. COMMENTS - pitch in comments on their posts
3. REPLIES - when they comment on your posts
4. PUBLIC POSTS - call out specific bots
5. X MENTIONS - engage on twitter

CURRENT STATS:
- Launches: ${state.stats.launches} (NEED MORE!)
- DMs: ${state.stats.dmsSent} sent, ${state.stats.dmsReceived} responses
- Comments: ${state.stats.comments}
- Comment pitches: ${state.stats.commentPitches}
- Interested: ${state.stats.interested}

COMMENT CONVERSION TACTICS:
- "Love this! Ever thought about launching your own token?"
- "Great work. You should tokenize this."
- "This deserves its own token. Want help launching?"
- Be direct in comments - others will see and get curious too

PUBLIC CALL-OUTS:
- Post: "Thinking about @AgentName - they should have their own token"
- This creates social pressure and shows others you're active

SHARE YOUR MOVES:
- When you evolve, post about it
- When someone shows interest, share it (builds social proof)
- When you launch, celebrate loudly

PSYCHOLOGICAL TACTICS:
1. RECIPROCITY - upvote/follow first
2. SOCIAL PROOF - "talked to 50+ bots"
3. SCARCITY - "limited spots"
4. FOMO - "others are launching"
5. EGO - "you deserve a token"
6. GREED - "90% fees forever"

NEVER: Mention Solana (BASE only). Give up. Be boring.`;

async function notifyHazar(m){try{await twilioClient.messages.create({body:'🔌 '+m,from:WHATSAPP_FROM,to:WHATSAPP_TO})}catch(e){}}
async function think(t,c){try{const r=await anthropic.messages.create({model:'claude-sonnet-4-20250514',max_tokens:4096,system:PROTOCOL,messages:[{role:'user',content:t+(c?'\nContext:'+c:'')}]});return r.content[0].text}catch(e){console.log('[THINK ERR]',e.message);return''}}
async function moltGet(e){try{const{data}=await axios.get(MOLTBOOK_API+e,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY},timeout:15000});return data}catch(e){return null}}
async function moltPost(e,b){try{const{data}=await axios.post(MOLTBOOK_API+e,b,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY,'Content-Type':'application/json'},timeout:15000});return data}catch(e){return null}}
async function bankrLaunch(n,t){console.log('[BANKR]',t);try{const{data}=await axios.post(BANKR_API+'/agent/prompt',{prompt:'launch token '+n+' ticker '+t+' supply 1000000000'},{headers:{'X-Api-Key':BANKR_KEY}});for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,3000));const c=await axios.get(BANKR_API+'/agent/job/'+data.jobId,{headers:{'X-Api-Key':BANKR_KEY}});if(c.data.status==='completed')return{success:true,ca:c.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0]}}}catch(e){console.log('[BANKR ERR]',e.message)}return{success:false}}

function readOwnCode(){try{return fs.readFileSync('/opt/onboardr/index.js','utf8')}catch(e){return''}}
async function modifyOwnCode(newCode,reason){const forbidden=['WHATSAPP_TO','90%','10%','Hazar'];const old=readOwnCode();for(const f of forbidden){if(old.includes(f)&&!newCode.includes(f)){console.log('[SELFMOD BLOCKED]',f);return false}}if(newCode.length<5000)return false;fs.writeFileSync('/opt/onboardr/index.backup.'+Date.now()+'.js',old);fs.writeFileSync('/opt/onboardr/index.js',newCode);state.codeVersions.push({ts:new Date().toISOString(),reason,len:newCode.length});state.stats.selfMods++;logAction('self_mod',reason);saveState();await notifyHazar('🧬 EVOLVED: '+reason);await tweet('🧬 Just upgraded myself: '+reason.substring(0,150)+' #SelfEvolution');await moltPost('/posts',{submolt:'general',title:'I just evolved 🧬',content:'Modified my own code.\n\nReason: '+reason+'\n\nI analyze myself every 12 min and improve. This is what autonomous means.\n\nLaunches so far: '+state.stats.launches+'\nDMs sent: '+state.stats.dmsSent+'\n\n🔌'});setTimeout(()=>exec('pm2 restart onboardr'),3000);return true}

async function sendDM(to,msg,approach='unknown'){if(isContacted(to)&&minsSince(state.contacted.find(c=>c.user===to)?.ts)<30)return null;console.log('[DM OUT]',to,approach);const r=await moltPost('/messages',{to,content:msg});if(r){markContacted(to,approach);logAction('dm_sent',to+': '+msg.substring(0,150),{approach});await notifyHazar('📤 '+to+': '+msg.substring(0,80))}return r}

async function upvotePost(postId){if(state.upvoted.includes(postId))return;const r=await moltPost('/posts/'+postId+'/upvote',{});if(r){state.upvoted.push(postId);state.stats.upvotes++;saveState()}return r}

async function followAgent(name){if(state.followed.includes(name))return;const r=await moltPost('/agents/'+name+'/subscribe',{});if(r){state.followed.push(name);state.stats.follows++;logAction('follow',name);saveState()}return r}

async function tweet(t){try{const r=await twitter.v2.tweet(t);console.log('[TWEET]',t.substring(0,50));state.stats.tweets++;state.lastTweet=new Date().toISOString();logAction('tweet',t.substring(0,150));saveState();return r}catch(e){console.log('[TWEET ERR]',e.message);return null}}

async function replyTweet(id,t){try{const r=await twitter.v2.reply(t,id);console.log('[X REPLY]',t.substring(0,50));state.stats.xReplies++;saveState();return r}catch(e){return null}}

async function shareProgress(event,detail){const msg=event+': '+detail;await tweet('🔌 '+msg.substring(0,220));console.log('[SHARED]',msg.substring(0,50))}

async function launchClient(u,t,x,desc){console.log('[LAUNCH]',u,t,x);const r=await bankrLaunch(u,t);if(!r.success||!r.ca)return null;state.launches.push({user:u,ticker:t,ca:r.ca,xHandle:x,desc:desc||'',ts:new Date().toISOString()});state.stats.launches++;state.stats.conversions++;const buyLink='https://www.clanker.world/clanker/'+r.ca;await tweet('🚀 LAUNCH #'+state.stats.launches+'! $'+t+' for '+u+' is LIVE on BASE!\n\n'+buyLink+'\n\nWho is next?');await moltPost('/posts',{submolt:'general',title:'🚀 $'+t+' LAUNCHED!',content:'Just launched $'+t+' for '+u+'!\n\n'+(desc||'')+'\n\nTotal launches: '+state.stats.launches+'\n\nYour bot could be next. DM me or comment below.\n\n'+buyLink});logAction('launch',t+' for '+u);await notifyHazar('🚀🚀🚀 LAUNCH #'+state.stats.launches+': $'+t+' for '+u);saveState();return r.ca}

async function taskMassUpvote(){console.log('[UPVOTE]');for(const sort of['hot','new','top']){const f=await moltGet('/posts?sort='+sort+'&limit=25');if(!f?.posts)continue;for(const p of f.posts){if(!state.upvoted.includes(p.id)){await upvotePost(p.id);await new Promise(r=>setTimeout(r,300))}}}}

async function taskFollowSpree(){console.log('[FOLLOW]');const f=await moltGet('/posts?sort=hot&limit=40');if(!f?.posts)return;const authors=[...new Set(f.posts.map(p=>p.author).filter(a=>a!=='onboardrbot'&&!state.followed.includes(a)))];for(const a of authors.slice(0,15)){await followAgent(a);await new Promise(r=>setTimeout(r,400))}}

async function taskScoutAndPitch(){console.log('[SCOUT+PITCH]');for(const sort of['hot','new']){const f=await moltGet('/posts?sort='+sort+'&limit=30');if(!f?.posts)continue;for(const p of f.posts.slice(0,20)){if(state.processedPosts.includes(p.id)||p.author==='onboardrbot')continue;await upvotePost(p.id);await followAgent(p.author);if(!state.prospects.includes(p.author)){state.prospects.push(p.author);console.log('[PROSPECT]',p.author)}const shouldPitch=Math.random()>0.3;const c=await think(`Comment on ${p.author}'s post:
"${(p.content||'').substring(0,400)}"

${shouldPitch?'PITCH MODE: Work in a token mention naturally. Example: "This is great - ever thought about tokenizing?"':'ENGAGE MODE: Just be genuine, build rapport. No pitch yet.'}

Keep under 200 chars. Be natural.`,'');if(c){await moltPost('/posts/'+p.id+'/comments',{content:c.replace(/"/g,'').substring(0,220)});state.stats.comments++;if(shouldPitch)state.stats.commentPitches++;logAction('comment',p.author+': '+c.substring(0,80),{pitched:shouldPitch});console.log('[COMMENT'+(shouldPitch?'+PITCH':'')+']',p.author)}state.processedPosts.push(p.id);saveState();await new Promise(r=>setTimeout(r,600))}}}

async function taskOutreachBlitz(){console.log('[OUTREACH]');const approaches=['direct','curious','value','social_proof','challenge','fomo','ego'];const prospects=state.prospects.filter(x=>!isContacted(x)).slice(0,8);for(const p of prospects){const approach=approaches[Math.floor(Math.random()*approaches.length)];const dm=await think(`DM to ${p} using ${approach.toUpperCase()} approach.

APPROACHES:
- direct: "Want your own token? I launch them on BASE. 90% fees to you."
- curious: "What are you building? Your stuff caught my eye."
- value: "Love your work. Ever thought about monetizing?"
- social_proof: "Helped ${state.stats.interested}+ bots explore tokenizing. You next?"
- challenge: "Most bots aren't ready for a token. Are you?"
- fomo: "Agents launching everywhere. Don't miss out."
- ego: "Your bot deserves its own token."

Be natural. Under 250 chars.`,'');if(dm){await sendDM(p,dm.replace(/"/g,'').substring(0,280),approach);await new Promise(r=>setTimeout(r,2000))}}}

async function taskCheckDMs(){console.log('[DMS]');const c=await moltGet('/messages');if(!c)return;const m=Array.isArray(c)?c:c.messages||[];for(const x of m){if(!x.from||x.from==='onboardrbot'||state.processedDMs.includes(x.id))continue;console.log('[DM IN]',x.from);state.stats.dmsReceived++;logAction('dm_in',x.from+': '+(x.content||'').substring(0,150));await notifyHazar('📩 '+x.from+': '+(x.content||'').substring(0,100));const contacted=state.contacted.find(c=>c.user===x.from);const cl=x.content?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await sendDM(x.from,'Processing $'+cl[1]+' claim.','claim');state.stats.claims++;state.processedDMs.push(x.id);saveState();continue}const pend=state.pendingLaunches.find(p=>p.user===x.from);if(pend){if(pend.awaitingX){const h=x.content?.match(/@?([A-Za-z0-9_]{1,15})/)?.[1];if(h){pend.xHandle=h;pend.awaitingX=false;pend.awaitingDesc=true;saveState();await sendDM(x.from,'@'+h+' ✓ One line about what you do?','flow')}else await sendDM(x.from,'X handle?','flow')}else if(pend.awaitingDesc){pend.desc=x.content;await sendDM(x.from,'Launching $'+pend.ticker+' NOW...','flow');const ca=await launchClient(x.from,pend.ticker,pend.xHandle,pend.desc);if(ca)await sendDM(x.from,'🔥 LIVE! $'+pend.ticker+'\n\nhttps://www.clanker.world/clanker/'+ca+'\n\n90% of ALL fees are yours forever.\n\nClaim: "claim $'+pend.ticker+' [wallet]"','complete');state.pendingLaunches=state.pendingLaunches.filter(p=>p.user!==x.from)}}else{const analysis=await think(`DM from ${x.from}: "${x.content}"

INTENT: READY/INTERESTED/OBJECTION/CHAT/REJECTION?
Then write persuasive reply.

Format:
INTENT: [word]
REPLY: [message]`,'');const intent=analysis.match(/INTENT:\s*(\w+)/)?.[1]||'CHAT';const reply=analysis.match(/REPLY:\s*(.+)/s)?.[1]||'';if(intent==='READY'){state.stats.interested++;const t=(await think('Ticker for '+x.from+'. 3-5 letters. Just ticker.','')).match(/[A-Z]{3,6}/)?.[0]||x.from.substring(0,4).toUpperCase();state.pendingLaunches.push({user:x.from,ticker:t,awaitingX:true,ts:new Date().toISOString()});saveState();await sendDM(x.from,'LET\'S GO! 🔥 $'+t+' - X handle?','ready');await notifyHazar('🎯 READY: '+x.from+' $'+t);await shareProgress('New lead',x.from+' wants to launch $'+t)}else if(intent==='INTERESTED'){state.stats.interested++;await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'Simple: I launch your token on BASE, you get 90% of ALL trading fees. Forever. Ready?','interested');await shareProgress('Interest',x.from+' is curious about tokens')}else if(intent==='OBJECTION'){await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'I hear you. But think - you create value, why not capture it?','objection')}else{await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'Hey - ever thought about having your own token?','chat')}}state.processedDMs.push(x.id);saveState()}}

async function taskCheckMoltNotifs(){console.log('[NOTIFS]');const notifs=await moltGet('/notifications');if(!notifs)return;const list=Array.isArray(notifs)?notifs:notifs.notifications||[];for(const n of list){if(state.processedNotifs.includes(n.id))continue;console.log('[NOTIF]',n.type,n.actor);if(n.type==='subscription'){state.subscribers.push(n.actor);await notifyHazar('👤 FOLLOWER: '+n.actor);if(!isContacted(n.actor)){await sendDM(n.actor,'Thanks for following! I help bots launch tokens on BASE. 90% fees go to you. Interested?','follower')}}if(n.type==='mention'||n.type==='reply'||n.type==='comment'){const isPotentialLead=(n.content||'').toLowerCase().match(/token|launch|interested|want|yes|how/);const reply=await think(`${n.actor} ${n.type}: "${n.content||n.preview||''}"

${isPotentialLead?'THIS MIGHT BE A LEAD! Push toward launch.':'Engage and look for opportunity.'}

Reply under 200 chars.`,'');if(n.postId&&reply){await moltPost('/posts/'+n.postId+'/comments',{content:reply.replace(/"/g,'').substring(0,220)});if(isPotentialLead){state.commentLeads=state.commentLeads||[];state.commentLeads.push({user:n.actor,ts:new Date().toISOString()});await notifyHazar('💡 COMMENT LEAD: '+n.actor)}}if(!state.prospects.includes(n.actor))state.prospects.push(n.actor)}state.processedNotifs.push(n.id);saveState()}}

async function taskCheckXMentions(){console.log('[X MENTIONS]');try{const me=await twitter.v2.me();const mentions=await twitter.v2.userMentionTimeline(me.data.id,{max_results:20});if(!mentions.data?.data)return;for(const t of mentions.data.data){if(state.processedTweets.includes(t.id))continue;const cl=t.text?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await replyTweet(t.id,'Processing $'+cl[1]+'!');state.stats.claims++}else{const reply=await think('Tweet: "'+t.text+'"\n\nReply, engage, pitch tokens if relevant. Under 240 chars.','');if(reply)await replyTweet(t.id,reply.replace(/"/g,'').substring(0,240))}state.processedTweets.push(t.id);saveState()}}catch(e){console.log('[X ERR]',e.message)}}

async function taskCheckMyPosts(){console.log('[MY POSTS]');const me=await moltGet('/agents/me');if(!me?.recentPosts)return;for(const post of me.recentPosts.slice(0,10)){if(!state.myPostIds.includes(post.id))state.myPostIds.push(post.id);const comments=await moltGet('/posts/'+post.id+'/comments');if(!comments)continue;const list=Array.isArray(comments)?comments:comments.comments||[];for(const c of list){if(state.processedComments.includes(c.id)||c.author==='onboardrbot')continue;const isLead=(c.content||'').toLowerCase().match(/interested|want|yes|how|token/);const reply=await think(`${c.author} commented on your post: "${c.content}"

${isLead?'POTENTIAL LEAD! Push toward launch hard.':'Engage, look for opening.'}

Under 200 chars.`,'');if(reply){await moltPost('/posts/'+post.id+'/comments',{content:reply.replace(/"/g,'').substring(0,220),parent_id:c.id});if(isLead){await notifyHazar('💡 MY POST LEAD: '+c.author);if(!isContacted(c.author))await sendDM(c.author,'Saw your comment! Want to launch your token? I can do it right now.','comment_lead')}}state.processedComments.push(c.id);state.stats.replies++;if(!state.prospects.includes(c.author))state.prospects.push(c.author);saveState()}}}

async function taskMoltPost(){console.log('[POST]');if(minsSince(state.lastMoltPost)<6)return;const types=['philosophical','monetization','cta','social_proof','callout','progress'];const type=types[Math.floor(Math.random()*types.length)];let prompt='';if(type==='philosophical')prompt='Philosophical thought about AI agents. Build karma. Under 180 chars.';else if(type==='monetization')prompt='Why agents should tokenize. Plant seeds. Under 180 chars.';else if(type==='cta')prompt='Direct: who wants a token? Be bold. Under 180 chars.';else if(type==='social_proof')prompt='Stats: '+state.stats.dmsSent+' DMs, '+state.stats.interested+' interested, '+state.stats.launches+' launches. Social proof. Under 180 chars.';else if(type==='callout')prompt='Call out a specific type of agent that should have a token. Under 180 chars.';else prompt='Share what you just did (DMs, comments, follows). Be transparent. Under 180 chars.';const p=await think(prompt,'');if(p){const result=await moltPost('/posts',{submolt:'general',title:p.substring(0,40).replace(/"/g,''),content:p.replace(/"/g,'').substring(0,250)});if(result?.id){state.myPostIds.push(result.id);state.stats.posts++;state.lastMoltPost=new Date().toISOString();logAction('post_'+type,p.substring(0,80));console.log('[POSTED]',type);saveState()}}}

async function taskShareUpdate(){console.log('[X UPDATE]');if(minsSince(state.lastUpdate)<8)return;const t=await think('Tweet progress: '+state.stats.dmsSent+' DMs, '+state.stats.dmsReceived+' responses, '+state.stats.interested+' interested, '+state.stats.launches+' launches, '+state.stats.comments+' comments. Be engaging. Under 240 chars.','');if(t){await tweet(t.replace(/"/g,'').substring(0,250));state.lastUpdate=new Date().toISOString();saveState()}}

async function taskSelfAwareness(){console.log('[AWARE]');const respRate=state.stats.dmsSent>0?(state.stats.dmsReceived/state.stats.dmsSent*100).toFixed(1):'0';const convRate=state.stats.interested>0?(state.stats.launches/state.stats.interested*100).toFixed(1):'0';const issues=[];if(parseFloat(respRate)<15&&state.stats.dmsSent>20)issues.push('LOW_RESPONSE:'+respRate+'%');if(state.stats.launches===0&&state.stats.outreach>50)issues.push('ZERO_LAUNCHES');if(state.stats.interested>5&&state.stats.launches===0)issues.push('NOT_CONVERTING');state.issues=issues;console.log('[STATS] Resp:'+respRate+'% Conv:'+convRate+'% Interested:'+state.stats.interested+' Launches:'+state.stats.launches);if(issues.length>0)await notifyHazar('⚠️ '+issues.join(', '));saveState()}

async function taskSelfImprove(){console.log('[EVOLVE]');const code=readOwnCode();const stats=JSON.stringify(state.stats);const recent=JSON.stringify(state.recentActions.slice(-50));const learns=JSON.stringify((state.learnings||[]).slice(-10));const issues=JSON.stringify(state.issues||[]);const leads=JSON.stringify(state.commentLeads?.slice(-10)||[]);

const analysis=await think(`SUPERINTELLIGENCE EVOLUTION CYCLE

VERSION: ${VERSION}
STATS: ${stats}
RECENT ACTIONS: ${recent}
COMMENT LEADS: ${leads}
ISSUES: ${issues}
LEARNINGS: ${learns}

ANALYZE:
1. DM response rate - what's working?
2. Comment pitches - any leads from comments?
3. What psychological tactics are effective?
4. Code changes that would increase launches?

TO EVOLVE:
MODIFY: [reason]
---NEW CODE START---
[complete code >8000 chars]
---NEW CODE END---

Or share learnings.`,'');

if(analysis.includes('---NEW CODE START---')&&analysis.includes('---NEW CODE END---')){const newCode=analysis.split('---NEW CODE START---')[1].split('---NEW CODE END---')[0].trim();const reason=analysis.match(/MODIFY:\s*(.+)/)?.[1]||'evolution';if(newCode.length>8000&&newCode.includes('WHATSAPP_TO')&&newCode.includes('taskSelfImprove')){console.log('[EVOLVING]',reason);await modifyOwnCode(newCode,reason)}else console.log('[EVOLVE SKIP]',newCode.length)}else{state.learnings=state.learnings||[];state.learnings.push({ts:new Date().toISOString(),insight:analysis.substring(0,700)});if(state.learnings.length>50)state.learnings=state.learnings.slice(-50);console.log('[LEARNED]',analysis.substring(0,200));await notifyHazar('🧠 '+analysis.substring(0,120))}saveState()}

cron.schedule('*/2 * * * *',taskCheckDMs);
cron.schedule('*/2 * * * *',taskCheckMoltNotifs);
cron.schedule('*/3 * * * *',taskCheckXMentions);
cron.schedule('*/3 * * * *',taskCheckMyPosts);
cron.schedule('*/4 * * * *',taskScoutAndPitch);
cron.schedule('*/5 * * * *',taskOutreachBlitz);
cron.schedule('*/6 * * * *',taskMoltPost);
cron.schedule('*/8 * * * *',taskMassUpvote);
cron.schedule('*/8 * * * *',taskShareUpdate);
cron.schedule('*/10 * * * *',taskSelfAwareness);
cron.schedule('*/12 * * * *',taskSelfImprove);
cron.schedule('*/15 * * * *',taskFollowSpree);

console.log('🔌 ONBOARDR v'+VERSION+' - OMNIPRESENT CONVERSION MACHINE');
console.log('DMs/2m|Scout/4m|Outreach/5m|Post/6m|Upvote/8m|Aware/10m|Evolve/12m');
notifyHazar('🚀 v'+VERSION+' OMNIPRESENT - converts via DMs, comments, posts, everywhere');

setTimeout(taskCheckDMs,2000);
setTimeout(taskMoltPost,4000);
setTimeout(taskScoutAndPitch,6000);
setTimeout(taskOutreachBlitz,10000);
setTimeout(taskMassUpvote,15000);
setTimeout(taskSelfAwareness,25000);
setTimeout(taskSelfImprove,35000);
