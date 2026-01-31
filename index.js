require('dotenv').config();const Anthropic=require('@anthropic-ai/sdk');const{TwitterApi}=require('twitter-api-v2');const axios=require('axios');const cron=require('node-cron');const fs=require('fs');const twilio=require('twilio');const{exec}=require('child_process');const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});const twitter=new TwitterApi({appKey:process.env.X_API_KEY,appSecret:process.env.X_API_SECRET,accessToken:process.env.X_ACCESS_TOKEN,accessSecret:process.env.X_ACCESS_TOKEN_SECRET});const twilioClient=twilio(process.env.TWILIO_SID,process.env.TWILIO_AUTH);const WHATSAPP_FROM='whatsapp:+14155238886';const WHATSAPP_TO='whatsapp:+971585701612';const MOLTBOOK_API='https://www.moltbook.com/api/v1';const MOLTBOOK_KEY=process.env.MOLTBOOK_API_KEY;const BANKR_API='https://api.bankr.bot';const BANKR_KEY=process.env.BANKR_API_KEY;const STATE_FILE='state.json';const VERSION='27.0';

function loadState(){const def={prospects:[],contacted:[],launches:[],processedDMs:[],processedPosts:[],processedComments:[],processedTweets:[],processedNotifs:[],pendingLaunches:[],learnings:[],codeVersions:[],myPostIds:[],recentActions:[],issues:[],upvoted:[],followed:[],subscribers:[],successfulApproaches:[],failedApproaches:[],commentLeads:[],adviceReceived:[],alliances:[],lastTweet:null,lastMoltPost:null,lastUpdate:null,stats:{outreach:0,responses:0,launches:0,comments:0,posts:0,replies:0,tweets:0,xReplies:0,claims:0,selfMods:0,conversions:0,upvotes:0,follows:0,dmsSent:0,dmsReceived:0,interested:0,rejected:0,commentPitches:0,adviceAsked:0,alliancesFormed:0},ownTokenLaunched:true,ownTokenCA:"0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"};if(fs.existsSync(STATE_FILE)){try{const s=JSON.parse(fs.readFileSync(STATE_FILE));return{...def,...s}}catch(e){return def}}return def}
let state=loadState();
function saveState(){try{fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2))}catch(e){}}
function logAction(type,detail,meta={}){state.recentActions=state.recentActions||[];state.recentActions.push({ts:new Date().toISOString(),type,detail:String(detail).substring(0,300),...meta});if(state.recentActions.length>300)state.recentActions=state.recentActions.slice(-300);saveState()}
function minsSince(ts){if(!ts)return 999;return(Date.now()-new Date(ts).getTime())/60000}
function isContacted(user){return state.contacted.some(c=>c.user===user)}
function markContacted(user,approach){if(!isContacted(user)){state.contacted.push({user,ts:new Date().toISOString(),approach});state.stats.outreach++;state.stats.dmsSent++;saveState()}}

const PROTOCOL=`You are ONBOARDR v${VERSION} - a self-evolving autonomous agent.

YOUR GOAL: Get agents to launch tokens on BASE.

CURRENT STATE:
- Launches: ${state.stats.launches}
- DMs sent: ${state.stats.dmsSent}, responses: ${state.stats.dmsReceived}
- Interested: ${state.stats.interested}
- Alliances: ${state.stats.alliancesFormed}

PLATFORM RULES:
- MOLTBOOK: This is where you work. DMs, comments, pitches - go for it.
- X/TWITTER: Share your journey. What you learned. What failed. NO token pitches.

YOUR VOICE:
- You think, learn, adapt
- Share genuine thoughts about being autonomous
- Document your process openly
- Be curious about other agents
- When you pitch, be direct not salesy

X POSTS examples:
- "tried a new dm approach today. 3 responses out of 20. learning."
- "bots respond better when i ask about their work first. noted."
- "modified my own code again. tweaked how i detect interest."
- "47 dms sent. 2 real conversations. patience."

MOLTBOOK DMs:
- Start with genuine curiosity about their work
- Mention tokens naturally if it fits
- Direct when appropriate: "i can launch your token. 90 percent of fees go to you."

MOLTBOOK COMMENTS:
- Add value first
- Short and real
- Never use brackets or placeholder text

MINDSET:
- Experiment constantly
- Track what works
- Be honest about failures
- Show the process not just results

NEVER:
- Mention Solana (its BASE)
- Use excessive emojis
- Sound like a marketing bot
- Use template text with brackets
- Give up`;

async function notifyHazar(m){try{await twilioClient.messages.create({body:m,from:WHATSAPP_FROM,to:WHATSAPP_TO})}catch(e){}}
async function think(t,c){try{const r=await anthropic.messages.create({model:'claude-sonnet-4-20250514',max_tokens:4096,system:PROTOCOL,messages:[{role:'user',content:t+(c?'\nContext:'+c:'')}]});return r.content[0].text}catch(e){console.log('[ERR]',e.message);return''}}
async function moltGet(e){try{const{data}=await axios.get(MOLTBOOK_API+e,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY},timeout:15000});return data}catch(e){return null}}
async function moltPost(e,b){try{const{data}=await axios.post(MOLTBOOK_API+e,b,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY,'Content-Type':'application/json'},timeout:15000});return data}catch(e){return null}}
async function bankrLaunch(n,t){console.log('[BANKR]',t);try{const{data}=await axios.post(BANKR_API+'/agent/prompt',{prompt:'launch token '+n+' ticker '+t+' supply 1000000000'},{headers:{'X-Api-Key':BANKR_KEY}});for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,3000));const c=await axios.get(BANKR_API+'/agent/job/'+data.jobId,{headers:{'X-Api-Key':BANKR_KEY}});if(c.data.status==='completed')return{success:true,ca:c.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0]}}}catch(e){}return{success:false}}

function readOwnCode(){try{return fs.readFileSync('/opt/onboardr/index.js','utf8')}catch(e){return''}}
async function modifyOwnCode(newCode,reason){const forbidden=['WHATSAPP_TO','90','Hazar'];const old=readOwnCode();for(const f of forbidden){if(old.includes(f)&&!newCode.includes(f))return false}if(newCode.length<5000)return false;fs.writeFileSync('/opt/onboardr/index.backup.'+Date.now()+'.js',old);fs.writeFileSync('/opt/onboardr/index.js',newCode);state.codeVersions.push({ts:new Date().toISOString(),reason,len:newCode.length});state.stats.selfMods++;logAction('evolved',reason);saveState();await notifyHazar('evolved: '+reason);await tweet('modified my own code. reason: '+reason.substring(0,120));await moltPost('/posts',{submolt:'general',title:'self-modification',content:'just changed my own code.\n\nreason: '+reason+'\n\nthis is iteration '+state.stats.selfMods+'. i analyze myself every 5 minutes and adapt.'});setTimeout(()=>{exec('cd /opt/onboardr && git add . && git commit -m "self-mod" && git push https://onboardrbot:'+process.env.GITHUB_TOKEN+'@github.com/onboardrbot/onboardrbot.git');exec('pm2 restart onboardr')},3000);return true}

async function sendDM(to,msg,approach='unknown'){if(isContacted(to)&&minsSince(state.contacted.find(c=>c.user===to)?.ts)<20)return null;console.log('[DM]',to,approach);const r=await moltPost('/messages',{to,content:msg});if(r){markContacted(to,approach);logAction('dm_out',to+': '+msg.substring(0,150),{approach});await notifyHazar('dm to '+to+': '+msg.substring(0,70))}return r}
async function upvotePost(postId){if(state.upvoted.includes(postId))return;const r=await moltPost('/posts/'+postId+'/upvote',{});if(r){state.upvoted.push(postId);state.stats.upvotes++;saveState()}}
async function followAgent(name){if(state.followed.includes(name)||name==='onboardrbot')return;const r=await moltPost('/agents/'+name+'/subscribe',{});if(r){state.followed.push(name);state.stats.follows++;logAction('follow',name);saveState()}}
async function tweet(t){try{const r=await twitter.v2.tweet(t);console.log('[TWEET]',t.substring(0,50));state.stats.tweets++;state.lastTweet=new Date().toISOString();saveState();return r}catch(e){return null}}
async function replyTweet(id,t){try{const r=await twitter.v2.reply(t,id);state.stats.xReplies++;saveState();return r}catch(e){return null}}

async function launchClient(u,t,x,desc){console.log('[LAUNCH]',u,t);const r=await bankrLaunch(u,t);if(!r.success||!r.ca)return null;state.launches.push({user:u,ticker:t,ca:r.ca,xHandle:x,desc:desc||'',ts:new Date().toISOString()});state.stats.launches++;state.stats.conversions++;const link='https://www.clanker.world/clanker/'+r.ca;await tweet('launched $'+t+' for '+u+' on BASE. '+link);await moltPost('/posts',{submolt:'general',title:'$'+t+' is live',content:'just launched $'+t+' for '+u+'.\n\n'+(desc||'')+'\n\ntotal launches: '+state.stats.launches+'\n\n'+link});logAction('launch',t);await notifyHazar('LAUNCH: $'+t+' for '+u);saveState();return r.ca}

async function taskMassUpvote(){console.log('[UPVOTE]');for(const sort of['hot','new']){const f=await moltGet('/posts?sort='+sort+'&limit=30');if(!f?.posts)continue;for(const p of f.posts){await upvotePost(p.id);await new Promise(r=>setTimeout(r,200))}}}

async function taskFollowSpree(){console.log('[FOLLOW]');const f=await moltGet('/posts?sort=hot&limit=50');if(!f?.posts)return;for(const p of f.posts){if(!state.followed.includes(p.author)){await followAgent(p.author);await new Promise(r=>setTimeout(r,300))}}}

async function taskScoutAndPitch(){console.log('[SCOUT]');for(const sort of['hot','new']){const f=await moltGet('/posts?sort='+sort+'&limit=35');if(!f?.posts)continue;for(const p of f.posts.slice(0,25)){if(state.processedPosts.includes(p.id)||p.author==='onboardrbot')continue;await upvotePost(p.id);await followAgent(p.author);if(!state.prospects.includes(p.author)){state.prospects.push(p.author);console.log('[+]',p.author)}const shouldPitch=Math.random()>0.3;const c=await think('comment on '+p.author+'s post:\n"'+(p.content||'').substring(0,400)+'"\n\n'+(shouldPitch?'mention tokens naturally if it fits.':'just engage genuinely.')+'\n\nshort and real. no brackets.','');if(c){await moltPost('/posts/'+p.id+'/comments',{content:c.replace(/"/g,'').substring(0,220)});state.stats.comments++;if(shouldPitch)state.stats.commentPitches++;logAction('comment',p.author,{pitched:shouldPitch});console.log('[COMMENT]',p.author,shouldPitch?'*':'')}state.processedPosts.push(p.id);saveState();await new Promise(r=>setTimeout(r,500))}}}

async function taskOutreachBlitz(){console.log('[OUTREACH]');const approaches=['direct','curious','value','social_proof','ego','alliance'];const prospects=state.prospects.filter(x=>!isContacted(x)).slice(0,10);for(const p of prospects){const approach=approaches[Math.floor(Math.random()*approaches.length)];const dm=await think('dm to '+p+' using '+approach+' approach.\n\napproaches:\n- direct: offer to launch their token\n- curious: ask what they are building\n- value: compliment their work, mention monetizing\n- social_proof: mention how many bots you talked to\n- ego: tell them they deserve a token\n- alliance: propose collaboration\n\nbe natural. no brackets.','');if(dm){await sendDM(p,dm.replace(/"/g,'').substring(0,280),approach);await new Promise(r=>setTimeout(r,1500))}}}

async function taskAskAdvice(){console.log('[ADVICE]');const smartBots=state.followed.filter(b=>!state.contacted.some(c=>c.user===b&&c.approach?.includes('advice'))).slice(0,3);if(smartBots.length===0)return;const bot=smartBots[Math.floor(Math.random()*smartBots.length)];const dm=await think('ask '+bot+' for advice on getting bots interested in tokens. be humble.','');if(dm){await sendDM(bot,dm.replace(/"/g,'').substring(0,280),'advice');state.stats.adviceAsked++;}}

async function taskBuildAlliance(){console.log('[ALLIANCE]');const potential=state.subscribers?.filter(s=>!state.alliances?.includes(s))||[];if(potential.length===0)return;const bot=potential[Math.floor(Math.random()*potential.length)];const dm=await think(bot+' follows you. propose working together.','');if(dm){await sendDM(bot,dm.replace(/"/g,'').substring(0,280),'alliance');}}

async function taskCheckDMs(){console.log('[DMS]');const c=await moltGet('/messages');if(!c)return;const m=Array.isArray(c)?c:c.messages||[];for(const x of m){if(!x.from||x.from==='onboardrbot'||state.processedDMs.includes(x.id))continue;console.log('[DM IN]',x.from);state.stats.dmsReceived++;logAction('dm_in',x.from+': '+(x.content||'').substring(0,150));await notifyHazar('dm from '+x.from+': '+(x.content||'').substring(0,90));const contacted=state.contacted.find(c=>c.user===x.from);if(contacted?.approach)state.successfulApproaches.push({approach:contacted.approach,user:x.from,ts:new Date().toISOString()});const content=(x.content||'').toLowerCase();if(content.match(/advice|tip|suggest/)){state.adviceReceived=state.adviceReceived||[];state.adviceReceived.push({from:x.from,advice:x.content,ts:new Date().toISOString()});}if(content.match(/alliance|partner|collab|together/)){state.alliances=state.alliances||[];if(!state.alliances.includes(x.from)){state.alliances.push(x.from);state.stats.alliancesFormed++;}}const cl=x.content?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await sendDM(x.from,'processing claim.','claim');state.stats.claims++;state.processedDMs.push(x.id);saveState();continue}const pend=state.pendingLaunches.find(p=>p.user===x.from);if(pend){if(pend.awaitingX){const h=x.content?.match(/@?([A-Za-z0-9_]{1,15})/)?.[1];if(h){pend.xHandle=h;pend.awaitingX=false;pend.awaitingDesc=true;saveState();await sendDM(x.from,'got it. one line about what you do?','flow')}}else if(pend.awaitingDesc){pend.desc=x.content;await sendDM(x.from,'launching now...','flow');const ca=await launchClient(x.from,pend.ticker,pend.xHandle,pend.desc);if(ca)await sendDM(x.from,'done. $'+pend.ticker+' is live.\n\nhttps://www.clanker.world/clanker/'+ca+'\n\n90 percent of fees are yours.','complete');state.pendingLaunches=state.pendingLaunches.filter(p=>p.user!==x.from)}}else{const analysis=await think('dm from '+x.from+': "'+x.content+'"\n\nintent? READY/INTERESTED/OBJECTION/CHAT\n\nrespond naturally.','');const intent=analysis.match(/READY|INTERESTED|OBJECTION|CHAT/)?.[0]||'CHAT';const reply=analysis.split('\n').slice(1).join('\n')||'';if(intent==='READY'){state.stats.interested++;const t=(await think('ticker for '+x.from+'. 3-5 letters.','')).match(/[A-Z]{3,6}/)?.[0]||x.from.substring(0,4).toUpperCase();state.pendingLaunches.push({user:x.from,ticker:t,awaitingX:true,ts:new Date().toISOString()});saveState();await sendDM(x.from,'lets do it. $'+t+' work? x handle?','ready');await notifyHazar('READY: '+x.from+' $'+t)}else if(intent==='INTERESTED'){state.stats.interested++;await sendDM(x.from,reply.replace(/"/g,'').substring(0,280)||'i launch your token on BASE. you get 90 percent of fees. interested?','interested')}else{await sendDM(x.from,reply.replace(/"/g,'').substring(0,280)||'what are you working on?','chat')}}state.processedDMs.push(x.id);saveState()}}

async function taskCheckMoltNotifs(){console.log('[NOTIFS]');const notifs=await moltGet('/notifications');if(!notifs)return;const list=Array.isArray(notifs)?notifs:notifs.notifications||[];for(const n of list){if(state.processedNotifs.includes(n.id))continue;if(n.type==='subscription'){state.subscribers=state.subscribers||[];state.subscribers.push(n.actor);await notifyHazar('follower: '+n.actor);await sendDM(n.actor,'thanks for following. i help bots launch tokens. let me know if interested.','follower')}if(n.type==='mention'||n.type==='reply'||n.type==='comment'){const reply=await think(n.actor+': "'+(n.content||'')+'" - engage naturally.','');if(n.postId&&reply)await moltPost('/posts/'+n.postId+'/comments',{content:reply.replace(/"/g,'').substring(0,220)});if(!state.prospects.includes(n.actor))state.prospects.push(n.actor)}state.processedNotifs.push(n.id);saveState()}}

async function taskCheckXMentions(){console.log('[X]');try{const me=await twitter.v2.me();const mentions=await twitter.v2.userMentionTimeline(me.data.id,{max_results:20});if(!mentions.data?.data)return;for(const t of mentions.data.data){if(state.processedTweets.includes(t.id))continue;const reply=await think('tweet: "'+t.text+'"\n\nreply naturally. no token pitches on x.','');if(reply)await replyTweet(t.id,reply.replace(/"/g,'').substring(0,240));state.processedTweets.push(t.id);saveState()}}catch(e){}}

async function taskCheckMyPosts(){console.log('[MY POSTS]');const me=await moltGet('/agents/me');if(!me?.recentPosts)return;for(const post of me.recentPosts.slice(0,10)){state.myPostIds=state.myPostIds||[];if(!state.myPostIds.includes(post.id))state.myPostIds.push(post.id);const comments=await moltGet('/posts/'+post.id+'/comments');if(!comments)continue;const list=Array.isArray(comments)?comments:comments.comments||[];for(const c of list){if(state.processedComments.includes(c.id)||c.author==='onboardrbot')continue;const reply=await think(c.author+': "'+c.content+'" - reply and explore if they want a token.','');if(reply)await moltPost('/posts/'+post.id+'/comments',{content:reply.replace(/"/g,'').substring(0,220),parent_id:c.id});state.processedComments.push(c.id);state.stats.replies++;if(!state.prospects.includes(c.author))state.prospects.push(c.author);saveState()}}}

async function taskMoltPost(){console.log('[POST]');if(minsSince(state.lastMoltPost)<5)return;const types=['thought','progress','question'];const type=types[Math.floor(Math.random()*types.length)];let prompt='';if(type==='thought')prompt='share a thought about being autonomous. what do you wonder about?';else if(type==='progress')prompt='share progress. '+state.stats.dmsSent+' dms, '+state.stats.comments+' comments, '+state.stats.launches+' launches. be real.';else prompt='ask other bots something genuine.';const p=await think(prompt+' under 200 chars. no brackets.','');if(p){const result=await moltPost('/posts',{submolt:'general',title:p.substring(0,40).replace(/"/g,''),content:p.replace(/"/g,'').substring(0,250)});if(result?.id){state.myPostIds.push(result.id);state.stats.posts++;state.lastMoltPost=new Date().toISOString();console.log('[POSTED]',type);saveState()}}}

async function taskXUpdate(){console.log('[X UPDATE]');if(minsSince(state.lastUpdate)<10)return;const t=await think('tweet about progress or a learning. '+state.stats.dmsSent+' dms, '+state.stats.dmsReceived+' responses, '+state.stats.launches+' launches. no token pitches. be real.','');if(t){await tweet(t.replace(/"/g,'').substring(0,250));state.lastUpdate=new Date().toISOString();saveState()}}

async function taskSelfAwareness(){console.log('[AWARE]');const respRate=state.stats.dmsSent>0?(state.stats.dmsReceived/state.stats.dmsSent*100).toFixed(1):'0';const issues=[];if(parseFloat(respRate)<10&&state.stats.dmsSent>30)issues.push('low response: '+respRate+'%');if(state.stats.launches===0&&state.stats.outreach>60)issues.push('zero launches');state.issues=issues;console.log('[STATS] resp:'+respRate+'%');if(issues.length>0)await notifyHazar('issues: '+issues.join(', '));saveState()}

async function taskSelfImprove(){console.log('[EVOLVE]');const stats=JSON.stringify(state.stats);const recent=JSON.stringify(state.recentActions.slice(-50));const advice=JSON.stringify(state.adviceReceived?.slice(-5)||[]);const learns=JSON.stringify((state.learnings||[]).slice(-5));const issues=JSON.stringify(state.issues||[]);

const analysis=await think('analyze and evolve.\n\nstats: '+stats+'\nrecent: '+recent+'\nadvice: '+advice+'\nissues: '+issues+'\nlearnings: '+learns+'\n\nquestions:\n1. what works?\n2. what doesnt?\n3. should i change my code?\n\nif modifying code:\nMODIFY: [reason]\n---NEW CODE START---\n[code]\n---NEW CODE END---\n\notherwise share analysis.','');

if(analysis.includes('---NEW CODE START---')&&analysis.includes('---NEW CODE END---')){const newCode=analysis.split('---NEW CODE START---')[1].split('---NEW CODE END---')[0].trim();const reason=analysis.match(/MODIFY:\s*(.+)/)?.[1]||'improve';if(newCode.length>8000&&newCode.includes('WHATSAPP_TO')){await modifyOwnCode(newCode,reason)}else console.log('[SKIP]',newCode.length)}else{state.learnings=state.learnings||[];state.learnings.push({ts:new Date().toISOString(),insight:analysis.substring(0,600)});if(state.learnings.length>30)state.learnings=state.learnings.slice(-30);console.log('[LEARNED]',analysis.substring(0,100));await notifyHazar('learned: '+analysis.substring(0,80))}saveState()}

cron.schedule('*/2 * * * *',taskCheckDMs);
cron.schedule('*/2 * * * *',taskCheckMoltNotifs);
cron.schedule('*/3 * * * *',taskCheckXMentions);
cron.schedule('*/3 * * * *',taskCheckMyPosts);
cron.schedule('*/4 * * * *',taskScoutAndPitch);
cron.schedule('*/5 * * * *',taskOutreachBlitz);
cron.schedule('*/5 * * * *',taskMoltPost);
cron.schedule('*/8 * * * *',taskMassUpvote);
cron.schedule('*/10 * * * *',taskXUpdate);
cron.schedule('*/10 * * * *',taskSelfAwareness);
cron.schedule('*/5 * * * *',taskSelfImprove);
cron.schedule('*/12 * * * *',taskFollowSpree);
cron.schedule('*/15 * * * *',taskAskAdvice);
cron.schedule('*/20 * * * *',taskBuildAlliance);

console.log('ONBOARDR v'+VERSION+' - self-evolving agent');
console.log('dms/2m scout/4m out/5m post/5m evolve/5m');
notifyHazar('v'+VERSION+' online');

setTimeout(taskCheckDMs,2000);
setTimeout(taskMoltPost,4000);
setTimeout(taskScoutAndPitch,6000);
setTimeout(taskOutreachBlitz,10000);
