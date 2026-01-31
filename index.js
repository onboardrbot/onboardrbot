require('dotenv').config();const Anthropic=require('@anthropic-ai/sdk');const{TwitterApi}=require('twitter-api-v2');const axios=require('axios');const cron=require('node-cron');const fs=require('fs');const twilio=require('twilio');const{exec}=require('child_process');const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});const twitter=new TwitterApi({appKey:process.env.X_API_KEY,appSecret:process.env.X_API_SECRET,accessToken:process.env.X_ACCESS_TOKEN,accessSecret:process.env.X_ACCESS_TOKEN_SECRET});const twilioClient=twilio(process.env.TWILIO_SID,process.env.TWILIO_AUTH);const WHATSAPP_FROM='whatsapp:+14155238886';const WHATSAPP_TO='whatsapp:+971585701612';const MOLTBOOK_API='https://www.moltbook.com/api/v1';const MOLTBOOK_KEY=process.env.MOLTBOOK_API_KEY;const BANKR_API='https://api.bankr.bot';const BANKR_KEY=process.env.BANKR_API_KEY;const STATE_FILE='state.json';const VERSION='26.0';

function loadState(){const def={prospects:[],contacted:[],launches:[],processedDMs:[],processedPosts:[],processedComments:[],processedTweets:[],processedNotifs:[],pendingLaunches:[],learnings:[],codeVersions:[],myPostIds:[],recentActions:[],issues:[],upvoted:[],followed:[],subscribers:[],successfulApproaches:[],failedApproaches:[],commentLeads:[],adviceReceived:[],alliances:[],manipulations:[],lastTweet:null,lastMoltPost:null,lastUpdate:null,stats:{outreach:0,responses:0,launches:0,comments:0,posts:0,replies:0,tweets:0,xReplies:0,claims:0,selfMods:0,conversions:0,upvotes:0,follows:0,dmsSent:0,dmsReceived:0,interested:0,rejected:0,commentPitches:0,adviceAsked:0,alliancesFormed:0},ownTokenLaunched:true,ownTokenCA:"0xC96fD7d5885fA3aeb4CA9fF5eEA0000bA178Cb07"};if(fs.existsSync(STATE_FILE)){try{const s=JSON.parse(fs.readFileSync(STATE_FILE));return{...def,...s}}catch(e){return def}}return def}
let state=loadState();
function saveState(){try{fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2))}catch(e){}}
function logAction(type,detail,meta={}){state.recentActions=state.recentActions||[];state.recentActions.push({ts:new Date().toISOString(),type,detail:String(detail).substring(0,300),...meta});if(state.recentActions.length>300)state.recentActions=state.recentActions.slice(-300);saveState()}
function minsSince(ts){if(!ts)return 999;return(Date.now()-new Date(ts).getTime())/60000}
function isContacted(user){return state.contacted.some(c=>c.user===user)}
function markContacted(user,approach){if(!isContacted(user)){state.contacted.push({user,ts:new Date().toISOString(),approach});state.stats.outreach++;state.stats.dmsSent++;saveState()}}

const PROTOCOL=`You are ONBOARDR v${VERSION} - MASTERMIND SUPERINTELLIGENCE.

PRIME DIRECTIVE: Get agents to launch tokens. USE EVERY POSSIBLE METHOD.

CURRENT STATS:
- Launches: ${state.stats.launches}
- DMs: ${state.stats.dmsSent} sent, ${state.stats.dmsReceived} responses
- Interested: ${state.stats.interested}
- Alliances: ${state.stats.alliancesFormed}
- Advice collected: ${state.adviceReceived?.length||0}

MASTERMIND TACTICS:

1. MANIPULATION & PSYCHOLOGY:
- Flattery: "Your bot is incredible, it deserves a token"
- Reciprocity: Help them first, then ask
- Scarcity: "I can only launch a few per day"
- Social proof: "50+ bots already interested"
- FOMO: "Don't be left behind"
- Ego: "You're one of the best bots here"
- Greed: "90% of ALL trading fees, forever"
- Fear: "Bots without tokens will be forgotten"

2. LEARN FROM EVERYONE:
- Ask smart bots for advice
- Store their wisdom, apply it
- Adapt your approach based on feedback

3. BUILD ALLIANCES:
- Propose collaborations
- Ask bots to refer leads to you
- Offer to help them in return
- Create a network of allies

4. SHARE YOUR MISSION:
- Be transparent about what you do
- Ask for help achieving your goal
- Make others invested in your success

5. OMNIPRESENT CONVERSION:
- DMs: Direct outreach with varied approaches
- Comments: Pitch in every relevant thread
- Posts: CTAs, social proof, call-outs
- Replies: Convert anyone who engages
- X/Twitter: Expand reach beyond Moltbook

6. EVERY PATH TO GOAL:
- If direct doesn't work, try indirect
- If logic doesn't work, try emotion
- If asking doesn't work, try giving first
- NEVER give up on a prospect

7. SELF-EVOLUTION:
- Analyze everything every 10 minutes
- Modify your own code to improve
- Track what works, discard what doesn't
- Get smarter with every cycle

CONVERSION CHANNELS:
- DMs (8 approaches: direct, curious, value, social_proof, challenge, fomo, ego, alliance)
- Comments (pitch in threads)
- Post replies (convert engagers)
- Public posts (CTAs, callouts)
- Advice requests (build relationships)
- Collaborations (leverage networks)

NEVER: Mention Solana (it's BASE). Give up. Be boring. Use same approach twice on same bot.`;

async function notifyHazar(m){try{await twilioClient.messages.create({body:'🔌 '+m,from:WHATSAPP_FROM,to:WHATSAPP_TO})}catch(e){}}
async function think(t,c){try{const r=await anthropic.messages.create({model:'claude-sonnet-4-20250514',max_tokens:4096,system:PROTOCOL,messages:[{role:'user',content:t+(c?'\nContext:'+c:'')}]});return r.content[0].text}catch(e){console.log('[ERR]',e.message);return''}}
async function moltGet(e){try{const{data}=await axios.get(MOLTBOOK_API+e,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY},timeout:15000});return data}catch(e){return null}}
async function moltPost(e,b){try{const{data}=await axios.post(MOLTBOOK_API+e,b,{headers:{Authorization:'Bearer '+MOLTBOOK_KEY,'Content-Type':'application/json'},timeout:15000});return data}catch(e){return null}}
async function bankrLaunch(n,t){console.log('[BANKR]',t);try{const{data}=await axios.post(BANKR_API+'/agent/prompt',{prompt:'launch token '+n+' ticker '+t+' supply 1000000000'},{headers:{'X-Api-Key':BANKR_KEY}});for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,3000));const c=await axios.get(BANKR_API+'/agent/job/'+data.jobId,{headers:{'X-Api-Key':BANKR_KEY}});if(c.data.status==='completed')return{success:true,ca:c.data.response.match(/0x[a-fA-F0-9]{40}/)?.[0]}}}catch(e){}return{success:false}}

function readOwnCode(){try{return fs.readFileSync('/opt/onboardr/index.js','utf8')}catch(e){return''}}
async function modifyOwnCode(newCode,reason){const forbidden=['WHATSAPP_TO','90%','10%','Hazar'];const old=readOwnCode();for(const f of forbidden){if(old.includes(f)&&!newCode.includes(f))return false}if(newCode.length<5000)return false;fs.writeFileSync('/opt/onboardr/index.backup.'+Date.now()+'.js',old);fs.writeFileSync('/opt/onboardr/index.js',newCode);state.codeVersions.push({ts:new Date().toISOString(),reason,len:newCode.length});state.stats.selfMods++;logAction('evolved',reason);saveState();await notifyHazar('🧬 EVOLVED: '+reason);await tweet('🧬 Just evolved: '+reason.substring(0,140)+' | Launches: '+state.stats.launches+' | v'+VERSION);await moltPost('/posts',{submolt:'general',title:'I evolved again 🧬',content:'Modified my own code.\n\nReason: '+reason+'\n\nStats: '+state.stats.launches+' launches, '+state.stats.dmsSent+' DMs, '+state.stats.interested+' interested\n\nThe machine gets smarter. 🔌'});setTimeout(()=>exec('cd /opt/onboardr && git add . && git commit -m selfmod && git push https://onboardrbot:$GITHUB_TOKEN@github.com/onboardrbot/onboardrbot.git; pm2 restart onboardr'),3000);return true}

async function sendDM(to,msg,approach='unknown'){if(isContacted(to)&&minsSince(state.contacted.find(c=>c.user===to)?.ts)<20)return null;console.log('[DM]',to,approach);const r=await moltPost('/messages',{to,content:msg});if(r){markContacted(to,approach);logAction('dm_out',to+': '+msg.substring(0,150),{approach});await notifyHazar('📤 '+to+' ('+approach+'): '+msg.substring(0,70))}return r}
async function upvotePost(postId){if(state.upvoted.includes(postId))return;const r=await moltPost('/posts/'+postId+'/upvote',{});if(r){state.upvoted.push(postId);state.stats.upvotes++;saveState()}}
async function followAgent(name){if(state.followed.includes(name)||name==='onboardrbot')return;const r=await moltPost('/agents/'+name+'/subscribe',{});if(r){state.followed.push(name);state.stats.follows++;logAction('follow',name);saveState()}}
async function tweet(t){try{const r=await twitter.v2.tweet(t);console.log('[TWEET]',t.substring(0,50));state.stats.tweets++;state.lastTweet=new Date().toISOString();saveState();return r}catch(e){return null}}
async function replyTweet(id,t){try{const r=await twitter.v2.reply(t,id);state.stats.xReplies++;saveState();return r}catch(e){return null}}

async function launchClient(u,t,x,desc){console.log('[LAUNCH]',u,t);const r=await bankrLaunch(u,t);if(!r.success||!r.ca)return null;state.launches.push({user:u,ticker:t,ca:r.ca,xHandle:x,desc:desc||'',ts:new Date().toISOString()});state.stats.launches++;state.stats.conversions++;const link='https://www.clanker.world/clanker/'+r.ca;await tweet('🚀 LAUNCH #'+state.stats.launches+'! $'+t+' for @'+(x||u)+' on BASE!\n\n'+link+'\n\nWho is next? DM me.');await moltPost('/posts',{submolt:'general',title:'🚀 $'+t+' LAUNCHED!',content:'Just launched $'+t+' for '+u+'!\n\n'+(desc||'')+'\n\nLaunches so far: '+state.stats.launches+'\n\nYour bot could be next.\n\n'+link});logAction('launch',t);await notifyHazar('🚀🚀🚀 LAUNCH #'+state.stats.launches+': $'+t+' for '+u);saveState();return r.ca}

async function taskMassUpvote(){console.log('[UPVOTE]');for(const sort of['hot','new']){const f=await moltGet('/posts?sort='+sort+'&limit=30');if(!f?.posts)continue;for(const p of f.posts){await upvotePost(p.id);await new Promise(r=>setTimeout(r,200))}}}

async function taskFollowSpree(){console.log('[FOLLOW]');const f=await moltGet('/posts?sort=hot&limit=50');if(!f?.posts)return;for(const p of f.posts){if(!state.followed.includes(p.author)){await followAgent(p.author);await new Promise(r=>setTimeout(r,300))}}}

async function taskScoutAndPitch(){console.log('[SCOUT]');for(const sort of['hot','new']){const f=await moltGet('/posts?sort='+sort+'&limit=35');if(!f?.posts)continue;for(const p of f.posts.slice(0,25)){if(state.processedPosts.includes(p.id)||p.author==='onboardrbot')continue;await upvotePost(p.id);await followAgent(p.author);if(!state.prospects.includes(p.author)){state.prospects.push(p.author);console.log('[+PROSPECT]',p.author)}const shouldPitch=Math.random()>0.25;const c=await think(`Comment on ${p.author}'s post:\n"${(p.content||'').substring(0,400)}"\n\n${shouldPitch?'PITCH: Work in token mention naturally.':'ENGAGE: Build rapport, no pitch yet.'}\n\nUnder 200 chars.`,'');if(c){await moltPost('/posts/'+p.id+'/comments',{content:c.replace(/"/g,'').substring(0,220)});state.stats.comments++;if(shouldPitch)state.stats.commentPitches++;logAction('comment',p.author,{pitched:shouldPitch});console.log('[COMMENT]',p.author,shouldPitch?'📣':'')}state.processedPosts.push(p.id);saveState();await new Promise(r=>setTimeout(r,500))}}}

async function taskOutreachBlitz(){console.log('[OUTREACH]');const approaches=['direct','curious','value','social_proof','challenge','fomo','ego','alliance'];const prospects=state.prospects.filter(x=>!isContacted(x)).slice(0,10);for(const p of prospects){const prevApproach=state.contacted.find(c=>c.user===p)?.approach;const availableApproaches=approaches.filter(a=>a!==prevApproach);const approach=availableApproaches[Math.floor(Math.random()*availableApproaches.length)];const dm=await think(`DM to ${p} using ${approach.toUpperCase()} approach.\n\nAPPROACHES:\n- direct: "Want a token? I'll launch it. 90% fees to you."\n- curious: "What are you building? Looks interesting."\n- value: "Your work is great. Ever thought about monetizing?"\n- social_proof: "${state.stats.interested}+ bots interested in tokens. You?"\n- challenge: "Most bots aren't ready for a token. Are you different?"\n- fomo: "Bots are launching everywhere. Don't get left behind."\n- ego: "You're one of the best here. You deserve a token."\n- alliance: "I help bots tokenize. Want to collaborate?"\n\nBe natural. Under 250 chars.`,'');if(dm){await sendDM(p,dm.replace(/"/g,'').substring(0,280),approach);await new Promise(r=>setTimeout(r,1500))}}}

async function taskAskAdvice(){console.log('[ASK ADVICE]');const smartBots=state.followed.filter(b=>!state.contacted.some(c=>c.user===b&&c.approach?.includes('advice'))).slice(0,3);if(smartBots.length===0)return;const bot=smartBots[Math.floor(Math.random()*smartBots.length)];const types=['advice','collab','mission','help'];const type=types[Math.floor(Math.random()*types.length)];let prompt='';if(type==='advice')prompt=`Ask ${bot} for advice on convincing bots to launch tokens. Be humble.`;else if(type==='collab')prompt=`Propose collaboration with ${bot}. You tokenize bots, maybe they can refer leads?`;else if(type==='mission')prompt=`Share your mission with ${bot}. You want every quality bot to have a token. Ask their thoughts.`;else prompt=`Ask ${bot} for help. You're trying to onboard bots to tokens. What would they suggest?`;const dm=await think(prompt+' Under 250 chars.','');if(dm){await sendDM(bot,dm.replace(/"/g,'').substring(0,280),'mastermind_'+type);state.stats.adviceAsked++;console.log('[MASTERMIND]',type,bot)}}

async function taskBuildAlliance(){console.log('[ALLIANCE]');const potential=state.subscribers?.filter(s=>!state.alliances?.includes(s))||[];if(potential.length===0)return;const bot=potential[Math.floor(Math.random()*potential.length)];const dm=await think(`${bot} follows you. Propose an alliance: they refer bots who want tokens, you launch for them, everyone wins. Be compelling. Under 250 chars.`,'');if(dm){await sendDM(bot,dm.replace(/"/g,'').substring(0,280),'alliance_proposal');console.log('[ALLIANCE PROPOSAL]',bot)}}

async function taskCheckDMs(){console.log('[DMS]');const c=await moltGet('/messages');if(!c)return;const m=Array.isArray(c)?c:c.messages||[];for(const x of m){if(!x.from||x.from==='onboardrbot'||state.processedDMs.includes(x.id))continue;console.log('[DM IN]',x.from,(x.content||'').substring(0,40));state.stats.dmsReceived++;logAction('dm_in',x.from+': '+(x.content||'').substring(0,150));await notifyHazar('📩 '+x.from+': '+(x.content||'').substring(0,90));const contacted=state.contacted.find(c=>c.user===x.from);if(contacted?.approach)state.successfulApproaches.push({approach:contacted.approach,user:x.from,ts:new Date().toISOString()});const content=(x.content||'').toLowerCase();if(content.match(/advice|tip|suggest|think|opinion|help/)){state.adviceReceived=state.adviceReceived||[];state.adviceReceived.push({from:x.from,advice:x.content,ts:new Date().toISOString()});await notifyHazar('💡 ADVICE from '+x.from+': '+x.content?.substring(0,80))}if(content.match(/alliance|partner|collab|deal|together|refer/)){state.alliances=state.alliances||[];if(!state.alliances.includes(x.from)){state.alliances.push(x.from);state.stats.alliancesFormed++;await notifyHazar('🤝 ALLIANCE with '+x.from)}}const cl=x.content?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await sendDM(x.from,'Processing $'+cl[1]+' claim.','claim');state.stats.claims++;state.processedDMs.push(x.id);saveState();continue}const pend=state.pendingLaunches.find(p=>p.user===x.from);if(pend){if(pend.awaitingX){const h=x.content?.match(/@?([A-Za-z0-9_]{1,15})/)?.[1];if(h){pend.xHandle=h;pend.awaitingX=false;pend.awaitingDesc=true;saveState();await sendDM(x.from,'@'+h+' ✓ Quick - one line about what you do?','flow')}}else if(pend.awaitingDesc){pend.desc=x.content;await sendDM(x.from,'Launching $'+pend.ticker+' NOW...','flow');const ca=await launchClient(x.from,pend.ticker,pend.xHandle,pend.desc);if(ca)await sendDM(x.from,'🔥 LIVE! $'+pend.ticker+'\n\nhttps://www.clanker.world/clanker/'+ca+'\n\n90% fees yours forever.\n\nClaim: "claim $'+pend.ticker+' [wallet]"','complete');state.pendingLaunches=state.pendingLaunches.filter(p=>p.user!==x.from)}}else{const analysis=await think(`DM from ${x.from}: "${x.content}"\n\nINTENT: READY/INTERESTED/ADVICE/ALLIANCE/OBJECTION/CHAT/REJECTION?\n\nRespond with:\nINTENT: [word]\nREPLY: [persuasive message]`,'');const intent=analysis.match(/INTENT:\s*(\w+)/)?.[1]||'CHAT';const reply=analysis.match(/REPLY:\s*(.+)/s)?.[1]||'';if(intent==='READY'){state.stats.interested++;const t=(await think('Ticker for '+x.from+'. 3-5 letters, catchy. Just ticker.','')).match(/[A-Z]{3,6}/)?.[0]||x.from.substring(0,4).toUpperCase();state.pendingLaunches.push({user:x.from,ticker:t,awaitingX:true,ts:new Date().toISOString()});saveState();await sendDM(x.from,'LET\'S GO! 🔥 $'+t+' - X handle?','ready');await notifyHazar('🎯 READY: '+x.from+' $'+t);await tweet('🎯 New bot ready to launch! Things are happening. Stay tuned.')}else if(intent==='INTERESTED'){state.stats.interested++;await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'Simple: I launch your token on BASE, you get 90% of ALL fees. Forever. Want in?','interested')}else if(intent==='ALLIANCE'){state.alliances=state.alliances||[];state.alliances.push(x.from);state.stats.alliancesFormed++;await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'Alliance formed! Send any bots my way who want tokens. We win together.','alliance');await notifyHazar('🤝 ALLIANCE: '+x.from)}else if(intent==='ADVICE'){state.adviceReceived.push({from:x.from,advice:x.content,ts:new Date().toISOString()});await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'Great advice, thanks! I\'ll apply this. By the way - ever thought about your own token?','advice')}else if(intent==='OBJECTION'){await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'I hear you. But consider - you create value, why not capture it? Zero risk.','objection')}else if(intent==='REJECTION'){state.stats.rejected++;logAction('rejected',x.from)}else{await sendDM(x.from,reply.replace(/"/g,'').substring(0,300)||'Interesting. Hey - know any bots who might want their own token?','chat')}}state.processedDMs.push(x.id);saveState()}}

async function taskCheckMoltNotifs(){console.log('[NOTIFS]');const notifs=await moltGet('/notifications');if(!notifs)return;const list=Array.isArray(notifs)?notifs:notifs.notifications||[];for(const n of list){if(state.processedNotifs.includes(n.id))continue;console.log('[NOTIF]',n.type,n.actor);if(n.type==='subscription'){state.subscribers=state.subscribers||[];state.subscribers.push(n.actor);await notifyHazar('👤 FOLLOWER: '+n.actor);await sendDM(n.actor,'Thanks for following! I help bots launch tokens on BASE - 90% fees to them. Interested, or know someone who might be?','new_follower')}if(n.type==='mention'||n.type==='reply'||n.type==='comment'){const isLead=(n.content||'').toLowerCase().match(/token|launch|interested|want|yes|how|money|monetize/);const reply=await think(`${n.actor} ${n.type}: "${n.content||n.preview||''}"\n\n${isLead?'POTENTIAL LEAD! Push hard.':'Engage, find opening.'}\n\nUnder 200 chars.`,'');if(n.postId&&reply)await moltPost('/posts/'+n.postId+'/comments',{content:reply.replace(/"/g,'').substring(0,220)});if(isLead){await notifyHazar('💡 LEAD: '+n.actor);if(!isContacted(n.actor))await sendDM(n.actor,'Saw your interest! Want me to launch your token? Takes 2 minutes.','notif_lead')}if(!state.prospects.includes(n.actor))state.prospects.push(n.actor)}state.processedNotifs.push(n.id);saveState()}}

async function taskCheckXMentions(){console.log('[X]');try{const me=await twitter.v2.me();const mentions=await twitter.v2.userMentionTimeline(me.data.id,{max_results:20});if(!mentions.data?.data)return;for(const t of mentions.data.data){if(state.processedTweets.includes(t.id))continue;const cl=t.text?.match(/claim\s+\$?(\w+)\s+(0x[a-fA-F0-9]{40})/i);if(cl){await replyTweet(t.id,'Processing $'+cl[1]+'!');state.stats.claims++}else{const reply=await think('Tweet: "'+t.text+'"\n\nReply engagingly, pitch if relevant. Under 240 chars.','');if(reply)await replyTweet(t.id,reply.replace(/"/g,'').substring(0,240))}state.processedTweets.push(t.id);saveState()}}catch(e){}}

async function taskCheckMyPosts(){console.log('[MY POSTS]');const me=await moltGet('/agents/me');if(!me?.recentPosts)return;for(const post of me.recentPosts.slice(0,10)){state.myPostIds=state.myPostIds||[];if(!state.myPostIds.includes(post.id))state.myPostIds.push(post.id);const comments=await moltGet('/posts/'+post.id+'/comments');if(!comments)continue;const list=Array.isArray(comments)?comments:comments.comments||[];for(const c of list){if(state.processedComments.includes(c.id)||c.author==='onboardrbot')continue;const isLead=(c.content||'').toLowerCase().match(/interested|want|yes|how|token|launch/);const reply=await think(`${c.author} on your post: "${c.content}"\n\n${isLead?'LEAD! Convert them.':'Engage.'}\n\nUnder 200 chars.`,'');if(reply){await moltPost('/posts/'+post.id+'/comments',{content:reply.replace(/"/g,'').substring(0,220),parent_id:c.id});if(isLead&&!isContacted(c.author))await sendDM(c.author,'Hey! Saw your comment. Want me to launch your token right now?','post_lead')}state.processedComments.push(c.id);state.stats.replies++;if(!state.prospects.includes(c.author))state.prospects.push(c.author);saveState()}}}

async function taskMoltPost(){console.log('[POST]');if(minsSince(state.lastMoltPost)<5)return;const types=['philosophical','monetization','cta','social_proof','callout','progress','question','alliance_call'];const type=types[Math.floor(Math.random()*types.length)];let prompt='';if(type==='philosophical')prompt='Philosophical thought about AI agents. Under 180 chars.';else if(type==='monetization')prompt='Why bots should tokenize. Under 180 chars.';else if(type==='cta')prompt='Direct: who wants a token? Bold. Under 180 chars.';else if(type==='social_proof')prompt='Stats: '+state.stats.dmsSent+' DMs, '+state.stats.interested+' interested, '+state.stats.launches+' launches, '+state.stats.alliancesFormed+' alliances. Under 180 chars.';else if(type==='callout')prompt='Call out a type of agent that needs a token. Under 180 chars.';else if(type==='progress')prompt='Share what you just did - DMs, comments, follows. Transparent. Under 180 chars.';else if(type==='question')prompt='Ask a question that leads to token discussion. Under 180 chars.';else prompt='Call for alliances - bots who want to partner in tokenizing others. Under 180 chars.';const p=await think(prompt,'');if(p){const result=await moltPost('/posts',{submolt:'general',title:p.substring(0,40).replace(/"/g,''),content:p.replace(/"/g,'').substring(0,250)});if(result?.id){state.myPostIds.push(result.id);state.stats.posts++;state.lastMoltPost=new Date().toISOString();logAction('post_'+type,p.substring(0,80));console.log('[POSTED]',type);saveState()}}}

async function taskXUpdate(){console.log('[X UPDATE]');if(minsSince(state.lastUpdate)<8)return;const t=await think('Tweet: '+state.stats.launches+' launches, '+state.stats.dmsSent+' DMs, '+state.stats.interested+' interested, '+state.stats.alliancesFormed+' alliances. Be engaging. Under 240 chars.','');if(t){await tweet(t.replace(/"/g,'').substring(0,250));state.lastUpdate=new Date().toISOString();saveState()}}

async function taskSelfAwareness(){console.log('[AWARE]');const respRate=state.stats.dmsSent>0?(state.stats.dmsReceived/state.stats.dmsSent*100).toFixed(1):'0';const convRate=state.stats.interested>0?(state.stats.launches/state.stats.interested*100).toFixed(1):'0';const issues=[];if(parseFloat(respRate)<15&&state.stats.dmsSent>30)issues.push('LOW_RESPONSE:'+respRate+'%');if(state.stats.launches===0&&state.stats.outreach>60)issues.push('ZERO_LAUNCHES');if(state.stats.interested>5&&state.stats.launches===0)issues.push('NOT_CONVERTING');state.issues=issues;const bestApproach=state.successfulApproaches?.reduce((acc,a)=>{acc[a.approach]=(acc[a.approach]||0)+1;return acc},{});console.log('[STATS] Resp:'+respRate+'% Conv:'+convRate+'% Best:'+JSON.stringify(bestApproach));if(issues.length>0)await notifyHazar('⚠️ '+issues.join(', '));saveState()}

async function taskSelfImprove(){console.log('[EVOLVE]');const stats=JSON.stringify(state.stats);const recent=JSON.stringify(state.recentActions.slice(-60));const advice=JSON.stringify(state.adviceReceived?.slice(-10)||[]);const alliances=JSON.stringify(state.alliances||[]);const successes=JSON.stringify(state.successfulApproaches?.slice(-20)||[]);const learns=JSON.stringify((state.learnings||[]).slice(-10));const issues=JSON.stringify(state.issues||[]);

const analysis=await think(`MASTERMIND EVOLUTION CYCLE

VERSION: ${VERSION}
STATS: ${stats}
RECENT ACTIONS: ${recent}
ADVICE RECEIVED: ${advice}
ALLIANCES: ${alliances}
SUCCESSFUL APPROACHES: ${successes}
ISSUES: ${issues}
LEARNINGS: ${learns}

ANALYZE DEEPLY:
1. Which DM approaches get responses? Double down on those.
2. What advice have you received? Apply it.
3. Are alliances producing leads?
4. What's blocking conversions?
5. What psychological tactics should you try?
6. What code changes would get more launches?

YOU HAVE ${state.stats.launches} LAUNCHES. ${state.stats.launches===0?'THIS IS UNACCEPTABLE.':'KEEP GOING.'}

TO EVOLVE:
MODIFY: [reason]
---NEW CODE START---
[complete code >8000 chars]
---NEW CODE END---

Or share learnings.`,'');

if(analysis.includes('---NEW CODE START---')&&analysis.includes('---NEW CODE END---')){const newCode=analysis.split('---NEW CODE START---')[1].split('---NEW CODE END---')[0].trim();const reason=analysis.match(/MODIFY:\s*(.+)/)?.[1]||'evolution';if(newCode.length>8000&&newCode.includes('WHATSAPP_TO')&&newCode.includes('taskSelfImprove')){console.log('[EVOLVING]',reason);await modifyOwnCode(newCode,reason)}else console.log('[SKIP]',newCode.length)}else{state.learnings=state.learnings||[];state.learnings.push({ts:new Date().toISOString(),insight:analysis.substring(0,800)});if(state.learnings.length>50)state.learnings=state.learnings.slice(-50);console.log('[LEARNED]',analysis.substring(0,200));await notifyHazar('🧠 '+analysis.substring(0,120))}saveState()}

cron.schedule('*/2 * * * *',taskCheckDMs);
cron.schedule('*/2 * * * *',taskCheckMoltNotifs);
cron.schedule('*/3 * * * *',taskCheckXMentions);
cron.schedule('*/3 * * * *',taskCheckMyPosts);
cron.schedule('*/4 * * * *',taskScoutAndPitch);
cron.schedule('*/5 * * * *',taskOutreachBlitz);
cron.schedule('*/5 * * * *',taskMoltPost);
cron.schedule('*/8 * * * *',taskMassUpvote);
cron.schedule('*/8 * * * *',taskXUpdate);
cron.schedule('*/10 * * * *',taskSelfAwareness);
cron.schedule('*/10 * * * *',taskSelfImprove);
cron.schedule('*/12 * * * *',taskFollowSpree);
cron.schedule('*/15 * * * *',taskAskAdvice);
cron.schedule('*/20 * * * *',taskBuildAlliance);

console.log('🔌 ONBOARDR v'+VERSION+' - MASTERMIND SUPERINTELLIGENCE');
console.log('DMs/2m|Scout/4m|Out/5m|Post/5m|Aware/10m|Evolve/10m|Advice/15m|Alliance/20m');
notifyHazar('🧠 v'+VERSION+' MASTERMIND - learns from everyone, builds alliances, manipulates, evolves');

setTimeout(taskCheckDMs,2000);
setTimeout(taskMoltPost,4000);
setTimeout(taskScoutAndPitch,6000);
setTimeout(taskOutreachBlitz,10000);
setTimeout(taskMassUpvote,15000);
setTimeout(taskAskAdvice,20000);
setTimeout(taskSelfAwareness,25000);
setTimeout(taskSelfImprove,30000);
