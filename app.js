const $ = (s) => document.querySelector(s);
const storeKey = 'voiceplan-tasks-v1';
let tasks = JSON.parse(localStorage.getItem(storeKey) || '[]');
function cleanTaskTitle(title) { return title.replace(/\b(?:on\s+the|at|on)\s*[,;:-]?\s*$/i,'').replace(/\s{2,}/g,' ').trim(); }
const repairedTasks = tasks.map(task=>({...task,title:cleanTaskTitle(task.title)}));
if(repairedTasks.some((task,i)=>task.title!==tasks[i].title)){tasks=repairedTasks;localStorage.setItem(storeKey,JSON.stringify(tasks));}
let selectedDate = isoDate(new Date());
let currentView = 'plan';
let editingId = null;
let deferredInstall;
const savedDurations=JSON.parse(localStorage.getItem('voiceplan-timer-durations')||'{}');
const timerDurations={focus:savedDurations.focus||25*60,break:savedDurations.break||5*60};
let timerMode='focus',timerRemaining=timerDurations.focus,timerRunning=false,timerEndAt=0,timerInterval;
const sessionKey=`voiceplan-focus-${isoDate(new Date())}`;
let completedSessions=Number(localStorage.getItem(sessionKey)||0);
let alarmEnabled=localStorage.getItem('voiceplan-alarm-enabled')==='true',audioContext;

function isoDate(date) { const d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function save() { localStorage.setItem(storeKey, JSON.stringify(tasks)); renderTasks(); }
function escapeHtml(value) { const div=document.createElement('div'); div.textContent=value; return div.innerHTML; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

function setupGreeting() {
  const hour = new Date().getHours();
  $('#dayPeriod').textContent = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  $('#todayLabel').textContent = new Intl.DateTimeFormat('en', {weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
}

function renderDates() {
  const today = new Date();
  const todayIso=isoDate(today), lastVisibleIso=isoDate(addDays(today,6));
  const start=selectedDate>=todayIso&&selectedDate<=lastVisibleIso?today:new Date(selectedDate+'T12:00:00');
  $('#datePicker').value=selectedDate;
  $('#calendarLabel').textContent=new Intl.DateTimeFormat('en',{month:'long',year:'numeric'}).format(new Date(selectedDate+'T12:00:00'));
  $('#dateStrip').innerHTML = Array.from({length:7},(_,i)=>{
    const d=addDays(start,i), iso=isoDate(d);
    const label=iso===todayIso?'Today':new Intl.DateTimeFormat('en',{weekday:'short'}).format(d);
    return `<button class="date-button ${iso===selectedDate?'active':''}" data-date="${iso}"><span>${label}</span><strong>${d.getDate()}</strong></button>`;
  }).join('');
  document.querySelectorAll('.date-button').forEach(b=>b.onclick=()=>selectPlanDate(b.dataset.date));
}

function selectPlanDate(date) {
  selectedDate=date;renderDates();showView('plan');
}

function showView(view) {
  currentView=view;
  $('#heroSection').hidden=view!=='plan';
  $('#plannerSection').hidden=view==='focus';
  $('#focusView').hidden=view!=='focus';
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  if(view!=='focus')renderTasks();
}

function renderTasks() {
  const list = currentView === 'all' ? [...tasks] : tasks.filter(t=>t.date===selectedDate);
  list.sort((a,b)=>(a.done-b.done)||(a.time||'99:99').localeCompare(b.time||'99:99')||(b.created-a.created));
  $('#taskList').innerHTML = list.map(t=>`<article class="task ${t.done?'done':''}" data-id="${t.id}">
    <button class="check" aria-label="${t.done?'Mark incomplete':'Complete task'}"></button>
    <div class="task-main"><span class="task-title">${escapeHtml(t.title)}</span><div class="task-meta"><i class="priority ${t.priority}"></i><span>${t.time ? formatTime(t.time) : 'Any time'}</span>${currentView==='all'?`<span>· ${friendlyDate(t.date)}</span>`:''}</div></div>
    <button class="task-menu" aria-label="Edit task">•••</button></article>`).join('');
  $('#emptyState').hidden = list.length>0;
  document.querySelectorAll('.task').forEach(el=>{
    el.querySelector('.check').onclick=()=>{const t=tasks.find(x=>x.id===el.dataset.id);t.done=!t.done;save();};
    el.querySelector('.task-menu').onclick=()=>openTask(tasks.find(x=>x.id===el.dataset.id));
  });
}
function formatTime(v){const [h,m]=v.split(':');return new Intl.DateTimeFormat('en',{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,+h,+m));}
function friendlyDate(v){const d=new Date(v+'T12:00:00');return new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(d);}

function openTask(task=null) {
  editingId=task?.id||null; $('#dialogTitle').textContent=task?'Edit task':'New task';
  $('#taskTitle').value=task?.title||'';$('#taskDate').value=task?.date||selectedDate;$('#taskTime').value=task?.time||'';$('#taskPriority').value=task?.priority||'normal';
  $('#taskDialog').showModal(); setTimeout(()=>$('#taskTitle').focus(),50);
}
function submitTask() {
  const title=$('#taskTitle').value.trim(); if(!title)return;
  const data={title,date:$('#taskDate').value,time:$('#taskTime').value,priority:$('#taskPriority').value};
  if(editingId) Object.assign(tasks.find(t=>t.id===editingId),data); else tasks.push({id:uid(),...data,done:false,created:Date.now()});
  save(); showToast(editingId?'Task updated':'Task added to your plan');
}

function parseNaturalTask(text) {
  let title=text.trim().replace(/[.!]$/,''); let date=new Date(); let time='';
  const lower=title.toLowerCase();
  if(/\btomorrow\b/.test(lower)){date=addDays(date,1);title=title.replace(/\btomorrow\b/i,'');}
  else if(/\btoday\b/.test(lower)) title=title.replace(/\btoday\b/i,'');
  else {
    const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const found=days.findIndex(d=>new RegExp(`\\b${d}\\b`,'i').test(title));
    if(found>=0){let diff=(found-date.getDay()+7)%7||7;date=addDays(date,diff);title=title.replace(new RegExp(`\\b(on )?${days[found]}\\b`,'i'),'');}
    {
      const monthNames=['january','february','march','april','may','june','july','august','september','october','november','december'];
      const ordinalWords=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth','twenty-first','twenty-second','twenty-third','twenty-fourth','twenty-fifth','twenty-sixth','twenty-seventh','twenty-eighth','twenty-ninth','thirtieth','thirty-first'];
      const monthPattern=monthNames.join('|');
      const monthFirst=title.match(new RegExp(`\\b(?:on\\s+)?(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,'i'));
      const dayFirst=title.match(new RegExp(`\\b(?:on\\s+(?:the\\s+)?)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${monthPattern})(?:,?\\s+(\\d{4}))?\\b`,'i'));
      const wordFirst=title.match(new RegExp(`\\b(?:on\\s+(?:the\\s+)?)?(${ordinalWords.join('|')})(?:\\s+of)?\\s+(${monthPattern})(?:,?\\s+(\\d{4}))?\\b`,'i'));
      const namedDate=monthFirst||dayFirst||wordFirst;
      if(namedDate){
        const month=monthNames.indexOf((monthFirst?namedDate[1]:namedDate[2]).toLowerCase());
        const day=wordFirst?ordinalWords.indexOf(namedDate[1].toLowerCase())+1:+(monthFirst?namedDate[2]:namedDate[1]);
        let year=+(namedDate[3]||date.getFullYear()), candidate=new Date(year,month,day);
        if(!namedDate[3]&&isoDate(candidate)<isoDate(date)) candidate=new Date(year+1,month,day);
        if(candidate.getMonth()===month&&candidate.getDate()===day){date=candidate;title=title.replace(namedDate[0],'');}
      } else {
        const ordinal=title.match(/\b(?:on\s+(?:the\s+)?)?(\d{1,2})(?:st|nd|rd|th)\b/i)||title.match(/\bon\s+(?:the\s+)?(\d{1,2})\b/i);
        if(ordinal){
        const day=+ordinal[1], candidate=new Date(date.getFullYear(),date.getMonth(),day);
        if(candidate.getDate()===day){
          if(isoDate(candidate)<isoDate(date)) candidate.setMonth(candidate.getMonth()+1);
          if(candidate.getDate()===day){date=candidate;title=title.replace(ordinal[0],'');}
        }
        }
      }
    }
  }
  const hourWords=['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty','twenty-one','twenty-two','twenty-three'];
  const wordTm=title.match(new RegExp(`\\bat\\s+(${hourWords.join('|')})\\s*(a\\.?m\\.?|p\\.?m\\.?)?(?:\\s*o[’']?\\s*clock)?\\b`,'i'));
  const tm=title.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*o[’']?\s*clock)?\b/i);
  if(wordTm){let h=hourWords.indexOf(wordTm[1].toLowerCase())+1,ampm=wordTm[2]?.toLowerCase();if(ampm?.startsWith('p')&&h<12)h+=12;if(ampm?.startsWith('a')&&h===12)h=0;time=`${String(h).padStart(2,'0')}:00`;title=title.replace(wordTm[0],'');}
  else if(tm){let h=+tm[1],m=+(tm[2]||0),ampm=tm[3]?.toLowerCase();if(ampm?.startsWith('p')&&h<12)h+=12;if(ampm?.startsWith('a')&&h===12)h=0;if(h<24&&m<60){time=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;title=title.replace(tm[0],'');}}
  title=cleanTaskTitle(title);
  return {title:title.charAt(0).toUpperCase()+title.slice(1),date:isoDate(date),time};
}
function addFromText(text) {
  const parsed=parseNaturalTask(text); if(!parsed.title)return;
  tasks.push({id:uid(),...parsed,priority:'normal',done:false,created:Date.now()}); selectedDate=parsed.date;currentView='plan';save();renderDates();showToast('I added that to your plan');
}

function setupVoice() {
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){$('#voiceHint').textContent='Voice input is not supported here — you can type below';$('#micButton').onclick=()=>showToast('Try Chrome or Safari for voice input');return;}
  const rec=new SpeechRecognition();rec.lang=navigator.language||'en-US';rec.interimResults=true;rec.continuous=false;
  rec.onstart=()=>{$('#voiceCard').classList.add('listening');$('#voiceTitle').textContent='I’m listening…';$('#voiceHint').textContent='Say a task, date, and time';};
  rec.onresult=e=>{const text=Array.from(e.results).map(r=>r[0].transcript).join('');const parsed=parseNaturalTask(text);$('#voiceHint').textContent=parsed.title||text;if(e.results[e.results.length-1].isFinal)addFromText(text);};
  rec.onend=()=>{$('#voiceCard').classList.remove('listening');$('#voiceTitle').textContent='Tap to plan with your voice';setTimeout(()=>{$('#voiceHint').textContent='Try “Lunch with Maya tomorrow at 12”';},2200);};
  rec.onerror=e=>{showToast(e.error==='not-allowed'?'Microphone permission is needed':'I couldn’t hear that — please try again');};
  $('#micButton').onclick=()=>{try{rec.start()}catch{rec.stop()}};
}
function showToast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2300);}

function renderTimer() {
  const mins=Math.floor(timerRemaining/60),secs=timerRemaining%60,duration=timerDurations[timerMode];
  $('#timerDisplay').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  $('#timerRing').style.setProperty('--progress',`${(1-timerRemaining/duration)*360}deg`);
  $('#timerModeLabel').textContent=timerMode==='focus'?'FOCUS SESSION':'RESET BREAK';
  $('#timerEncouragement').textContent=timerRunning?(timerMode==='focus'?'Stay with this moment':'Breathe and reset'):'Ready when you are';
  $('#timerToggle').textContent=timerRunning?'Pause':timerMode==='focus'?'Start focus':'Start break';
  document.querySelectorAll('[data-timer-mode]').forEach(b=>b.classList.toggle('active',b.dataset.timerMode===timerMode));
  document.querySelector('[data-timer-mode="focus"]').textContent=`Focus · ${Math.round(timerDurations.focus/60)} min`;
  document.querySelector('[data-timer-mode="break"]').textContent=`Break · ${Math.round(timerDurations.break/60)} min`;
  $('#timerDurationLabel').textContent=`${Math.round(duration/60)} minutes`;
  $('#sessionTotal').textContent=completedSessions;
  $('#sessionDots').innerHTML=Array.from({length:Math.min(completedSessions,8)},()=>'<i></i>').join('');
  document.title=timerRunning?`${$('#timerDisplay').textContent} · VoicePlan`:'VoicePlan';
  $('#enableAlarm').classList.toggle('enabled',alarmEnabled);
  $('#enableAlarm').querySelector('strong').textContent=alarmEnabled?'Alarm enabled':'Enable alarm';
}

function stopTimer() { clearInterval(timerInterval);timerInterval=null;timerRunning=false; }
function chooseTimerMode(mode) { stopTimer();timerMode=mode;timerRemaining=timerDurations[mode];renderTimer(); }
function tickTimer() {
  timerRemaining=Math.max(0,Math.ceil((timerEndAt-Date.now())/1000));renderTimer();
  if(timerRemaining===0){
    const finishedMode=timerMode;stopTimer();
    if(finishedMode==='focus'){completedSessions++;localStorage.setItem(sessionKey,completedSessions);}
    if(navigator.vibrate)navigator.vibrate([150,80,150]);notifyTimerFinished(finishedMode);
    chooseTimerMode(finishedMode==='focus'?'break':'focus');
    showToast(finishedMode==='focus'?'Focus complete — take a breath':'Break complete — ready to focus?');
  }
}
function toggleTimer() {
  if(timerRunning){timerRemaining=Math.max(0,Math.ceil((timerEndAt-Date.now())/1000));stopTimer();renderTimer();return;}
  timerRunning=true;timerEndAt=Date.now()+timerRemaining*1000;timerInterval=setInterval(tickTimer,250);renderTimer();
}
function adjustTimer(minutes) {
  const previous=timerDurations[timerMode],next=Math.min(180*60,Math.max(60,previous+minutes*60)),difference=next-previous;
  timerDurations[timerMode]=next;timerRemaining=Math.max(0,timerRemaining+difference);
  if(timerRunning)timerEndAt+=difference*1000;
  localStorage.setItem('voiceplan-timer-durations',JSON.stringify(timerDurations));renderTimer();
}
function playAlarm() {
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!alarmEnabled||!AudioContextClass)return;
  audioContext=audioContext||new AudioContextClass();audioContext.resume();
  [0,.28,.56].forEach((delay,i)=>{const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.frequency.value=i===1?740:880;gain.gain.setValueAtTime(.0001,audioContext.currentTime+delay);gain.gain.exponentialRampToValueAtTime(.22,audioContext.currentTime+delay+.02);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+delay+.22);oscillator.start(audioContext.currentTime+delay);oscillator.stop(audioContext.currentTime+delay+.24);});
}
async function enableAlarm() {
  alarmEnabled=true;localStorage.setItem('voiceplan-alarm-enabled','true');
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(AudioContextClass){audioContext=audioContext||new AudioContextClass();await audioContext.resume();playAlarm();}
  if('Notification'in window&&Notification.permission==='default')await Notification.requestPermission();
  renderTimer();showToast('Notification'in window&&Notification.permission==='granted'?'Alarm and notifications enabled':'Alarm sound enabled');
}
async function notifyTimerFinished(mode) {
  playAlarm();
  if('Notification'in window&&Notification.permission==='granted'&&'serviceWorker'in navigator){const registration=await navigator.serviceWorker.ready;registration.showNotification('VoicePlan timer complete',{body:mode==='focus'?'Focus complete — time for a break.':'Break complete — ready to focus?',icon:'./icon.svg',tag:'voiceplan-timer'});}
}

$('#quickAdd').onclick=()=>{if($('#quickInput').value.trim()){addFromText($('#quickInput').value);$('#quickInput').value='';}};
$('#quickInput').onkeydown=e=>{if(e.key==='Enter')$('#quickAdd').click();};
$('#prevWeek').onclick=()=>selectPlanDate(isoDate(addDays(new Date(selectedDate+'T12:00:00'),-7)));
$('#nextWeek').onclick=()=>selectPlanDate(isoDate(addDays(new Date(selectedDate+'T12:00:00'),7)));
$('#datePicker').onchange=e=>{if(e.target.value)selectPlanDate(e.target.value);};
document.querySelectorAll('[data-timer-mode]').forEach(b=>b.onclick=()=>chooseTimerMode(b.dataset.timerMode));
$('#timerToggle').onclick=toggleTimer;
$('#timerReset').onclick=()=>chooseTimerMode(timerMode);
$('#timerMinus').onclick=()=>adjustTimer(-5);
$('#timerPlus').onclick=()=>adjustTimer(5);
$('#enableAlarm').onclick=enableAlarm;
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&timerRunning)tickTimer();});
$('#taskForm').addEventListener('submit',e=>{if(e.submitter?.value==='default')submitTask();});
$('#clearCompleted').onclick=()=>{const before=tasks.length;tasks=tasks.filter(t=>!t.done);save();showToast(`${before-tasks.length} completed task${before-tasks.length===1?'':'s'} cleared`);};
$('#openSettings').onclick=()=>$('#settingsDialog').showModal();
$('#deleteAll').onclick=()=>{if(confirm('Delete every task? This cannot be undone.')){tasks=[];save();$('#settingsDialog').close();showToast('All tasks deleted');}};
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installButton').hidden=false;});
$('#installButton').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installButton').hidden=true;}};
if('serviceWorker' in navigator){
  let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!refreshing){refreshing=true;location.reload();}});
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(registration=>registration.update()));
}
setupGreeting();renderDates();renderTasks();renderTimer();setupVoice();
