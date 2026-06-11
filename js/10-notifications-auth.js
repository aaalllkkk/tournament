function runDeadlineReminderNotifications(){
  const scope=currentNotifScope();
  const scopeKey=currentReminderScopeKey();
  if(!scope||!scopeKey||scope.targetRole!=="artist") return;
  let changed=false;
  const rows=visibleJobs();
  for(const job of rows){
    const status=String(job?.a?.workStatus||"Booked");
    if(["Approved","Payable","Paid"].includes(status)) continue;
    const dueDate=String(job?.a?.targetDoneDate||job?.p?.deadline||"").trim();
    if(!dueDate) continue;
    const dayOffset=days(dueDate);
    const tag=deadlineReminderTag(dayOffset);
    if(!["h-3","h-1"].includes(tag)) continue;
    const allocationId=String(job?.a?.id||"").trim();
    if(!allocationId) continue;
    const reminderKey=`${scopeKey}|${allocationId}|${dueDate}|${tag}`;
    if(deadlineReminderState?.[reminderKey]) continue;
    const worker=workerDisplayName(job.a);
    let title="Reminder Deadline";
    let message=`Reminder deadline: ${job.p.client} - ${job.p.name} (${worker}) target ${fmt(dueDate)}.`;
    if(tag==="h-3") message=`Reminder H-3: ${job.p.client} - ${job.p.name} (${worker}) deadline ${fmt(dueDate)}.`;
    if(tag==="h-1") message=`Reminder H-1: ${job.p.client} - ${job.p.name} (${worker}) deadline besok (${fmt(dueDate)}).`;
    if(tag==="h-3") title="Deadline H-3";
    if(tag==="h-1") title="Deadline Besok";
    addNotification({
      type:"deadlineReminder",
      title,
      targetRole:"artist",
      artistId:scope.artistId||"",
      projectId:String(job?.p?.id||""),
      allocationId,
      message
    });
    deadlineReminderState[reminderKey]=new Date().toISOString();
    changed=true;
  }
  if(changed||pruneDeadlineReminderState()){
    saveDeadlineReminderState();
  }
}
function currentNotifScope(){
  if(role==="admin"&&isVerifiedAdmin()) return {targetRole:"admin",artistId:""};
  if(role==="artist"&&activeArtist) return {targetRole:"artist",artistId:activeArtist};
  return null;
}
function visibleNotifications(){
  const scope=currentNotifScope();
  if(!scope) return [];
  return (notifications||[])
    .filter(item=>{
      if(item.targetRole!==scope.targetRole) return false;
      if(scope.targetRole==="artist"&&item.artistId!==scope.artistId) return false;
      return true;
    })
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
function inCurrentNotifScope(item){
  const scope=currentNotifScope();
  if(!scope||!item) return false;
  if(item.targetRole!==scope.targetRole) return false;
  if(scope.targetRole==="artist"&&item.artistId!==scope.artistId) return false;
  return true;
}
function unreadVisibleAllocationSet(){
  const set=new Set();
  for(const item of visibleNotifications()){
    if(item.read) continue;
    const aid=String(item.allocationId||"").trim();
    if(aid) set.add(aid);
  }
  return set;
}
function hasUnreadAllocationUpdate(allocationId){
  const aid=String(allocationId||"").trim();
  if(!aid) return false;
  return unreadVisibleAllocationSet().has(aid);
}
function markNotificationReadById(notifId){
  const target=String(notifId||"").trim();
  if(!target) return;
  let changed=false;
  notifications=(notifications||[]).map(item=>{
    if(String(item?.id||"")!==target) return item;
    if(item.read) return item;
    changed=true;
    return {...item,read:true};
  });
  if(changed) saveNotifications();
}
function markAllocationNotificationsRead(allocationId){
  const aid=String(allocationId||"").trim();
  if(!aid) return;
  let changed=false;
  notifications=(notifications||[]).map(item=>{
    if(!inCurrentNotifScope(item)) return item;
    if(String(item.allocationId||"")!==aid) return item;
    if(item.read) return item;
    changed=true;
    return {...item,read:true};
  });
  if(changed) saveNotifications();
}
function deleteNotificationById(notifId){
  const target=String(notifId||"").trim();
  if(!target) return;
  let changed=false;
  notifications=(notifications||[]).filter(item=>{
    const match=String(item?.id||"")===target&&inCurrentNotifScope(item);
    if(match) changed=true;
    return !match;
  });
  if(!changed) return;
  saveNotifications();
  renderNotifBell();
  renderNotifList();
}
function clearVisibleNotificationHistory(){
  const scopedItems=visibleNotifications();
  if(!scopedItems.length){
    alert("Tidak ada history notifikasi untuk akun ini.");
    return;
  }
  if(!confirm(`Hapus semua history notifikasi (${scopedItems.length} item) untuk akun ini?`)) return;
  const deleteIds=new Set(scopedItems.map(item=>String(item.id||"")));
  notifications=(notifications||[]).filter(item=>!deleteIds.has(String(item?.id||"")));
  saveNotifications();
  renderNotifBell();
  renderNotifList();
}
function unreadVisibleNotificationCount(){
  return visibleNotifications().filter(item=>!item.read).length;
}
function renderNotifBell(){
  const dot=document.getElementById("notif-dot");
  if(dot) dot.classList.toggle("hidden",unreadVisibleNotificationCount()===0);
  renderDesktopNotificationToggle();
  renderNotificationSoundToggle();
}
let notificationAudioContext=null;
let notificationSoundUnlocked=false;
function notificationSoundEnabled(){
  return localStorage.getItem(NOTIF_SOUND_KEY)!=="0";
}
function setNotificationSoundEnabled(enabled){
  localStorage.setItem(NOTIF_SOUND_KEY,enabled?"1":"0");
}
function notificationSoundSupported(){
  return typeof window!=="undefined"&&Boolean(window.AudioContext||window.webkitAudioContext);
}
function renderNotificationSoundToggle(){
  const btn=document.getElementById("sound-notif-toggle");
  if(!btn) return;
  if(!notificationSoundSupported()){
    btn.textContent="Sound N/A";
    btn.disabled=true;
    btn.title="Browser ini tidak mendukung Web Audio.";
    return;
  }
  btn.disabled=false;
  const active=notificationSoundEnabled();
  btn.textContent=active?"Sound On":"Sound Off";
  btn.title=active?"Matikan suara notifikasi.":"Aktifkan suara notifikasi.";
}
function ensureNotificationAudioContext(){
  if(!notificationSoundSupported()) return null;
  if(notificationAudioContext) return notificationAudioContext;
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  notificationAudioContext=new AudioCtx();
  return notificationAudioContext;
}
function unlockNotificationSound(){
  if(!notificationSoundSupported()) return;
  try{
    const ctx=ensureNotificationAudioContext();
    if(!ctx) return;
    if(ctx.state==="suspended"){
      ctx.resume().then(()=>{ notificationSoundUnlocked=true; }).catch(()=>{});
      return;
    }
    notificationSoundUnlocked=true;
  }catch(err){
    console.warn("unlockNotificationSound failed",err);
  }
}
function playNotificationTone(ctx,startAt,frequency,duration,peakGain){
  const oscillator=ctx.createOscillator();
  const gain=ctx.createGain();
  oscillator.type="sine";
  oscillator.frequency.setValueAtTime(frequency,startAt);
  gain.gain.setValueAtTime(0.0001,startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain,startAt+0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001,startAt+duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt+duration+0.04);
}
function playNotificationSound(item=null,options={}){
  if(!options.force&&(!notificationSoundEnabled()||!inCurrentNotifScope(item))) return;
  if(!notificationSoundSupported()) return;
  try{
    const ctx=ensureNotificationAudioContext();
    if(!ctx) return;
    const play=()=>{
      const start=ctx.currentTime+0.01;
      playNotificationTone(ctx,start,880,0.13,0.08);
      playNotificationTone(ctx,start+0.15,1174.66,0.16,0.075);
    };
    if(ctx.state==="suspended"){
      ctx.resume()
        .then(()=>{ notificationSoundUnlocked=true; play(); })
        .catch(err=>console.warn("playNotificationSound resume failed",err));
      return;
    }
    notificationSoundUnlocked=true;
    play();
  }catch(err){
    console.warn("playNotificationSound failed",err);
  }
}
function toggleNotificationSound(){
  if(!notificationSoundSupported()){
    alert("Browser ini tidak mendukung suara notifikasi.");
    renderNotificationSoundToggle();
    return;
  }
  const next=!notificationSoundEnabled();
  setNotificationSoundEnabled(next);
  unlockNotificationSound();
  renderNotificationSoundToggle();
  if(next){
    playNotificationSound({targetRole:currentNotifScope()?.targetRole||"",artistId:currentNotifScope()?.artistId||""},{force:true});
  }
}
if(typeof window!=="undefined"&&window.addEventListener){
  window.addEventListener("pointerdown",unlockNotificationSound,{once:true,passive:true});
  window.addEventListener("keydown",unlockNotificationSound,{once:true});
}
function desktopNotificationsSupported(){
  return typeof window!=="undefined"&&"Notification" in window;
}
function desktopNotificationsEnabled(){
  return localStorage.getItem(DESKTOP_NOTIF_KEY)==="1";
}
function setDesktopNotificationsEnabled(enabled){
  localStorage.setItem(DESKTOP_NOTIF_KEY,enabled?"1":"0");
}
function renderDesktopNotificationToggle(){
  const btn=document.getElementById("desktop-notif-toggle");
  if(!btn) return;
  if(!desktopNotificationsSupported()){
    btn.textContent="Desktop N/A";
    btn.disabled=true;
    btn.title="Browser ini tidak mendukung notifikasi desktop.";
    return;
  }
  btn.disabled=false;
  if(Notification.permission==="denied"){
    btn.textContent="Desktop Diblokir";
    btn.title="Izin notifikasi diblokir di browser. Ubah dari site settings browser.";
    return;
  }
  const active=desktopNotificationsEnabled()&&Notification.permission==="granted";
  btn.textContent=active?"Desktop On":"Desktop Off";
  btn.title=active?"Matikan notifikasi desktop.":"Aktifkan notifikasi desktop.";
}
function desktopNotificationTitle(item){
  if(item?.title) return String(item.title);
  if(item?.type==="projectAssigned") return "Project Baru";
  if(item?.targetRole==="admin") return "Update Team";
  if(item?.targetRole==="artist") return "Update Project";
  return "KURAMASH ERP TEAM";
}
function showDesktopNotification(item,options={}){
  if(!desktopNotificationsSupported()) return;
  if(Notification.permission!=="granted") return;
  if(!options.force&&(!desktopNotificationsEnabled()||!inCurrentNotifScope(item))) return;
  if(!options.force&&document.visibilityState==="visible") return;
  try{
    const notif=new Notification(desktopNotificationTitle(item),{
      body:String(item?.message||"Ada update baru."),
      tag:String(item?.id||item?.allocationId||Date.now()),
      renotify:false,
      silent:false
    });
    notif.onclick=()=>{
      window.focus?.();
      notif.close?.();
      if(item?.id&&item?.allocationId) openNotificationProject(item.id);
      else openNotifModal();
    };
  }catch(err){
    console.warn("showDesktopNotification failed",err);
  }
}
async function toggleDesktopNotifications(){
  if(!desktopNotificationsSupported()){
    alert("Browser ini tidak mendukung notifikasi desktop.");
    renderDesktopNotificationToggle();
    return;
  }
  if(desktopNotificationsEnabled()&&Notification.permission==="granted"){
    setDesktopNotificationsEnabled(false);
    renderDesktopNotificationToggle();
    alert("Notifikasi desktop dimatikan.");
    return;
  }
  const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
  if(permission!=="granted"){
    setDesktopNotificationsEnabled(false);
    renderDesktopNotificationToggle();
    alert(permission==="denied"
      ?"Izin notifikasi diblokir di browser. Buka site settings browser untuk mengaktifkan lagi."
      :"Izin notifikasi desktop belum diberikan.");
    return;
  }
  setDesktopNotificationsEnabled(true);
  renderDesktopNotificationToggle();
  showDesktopNotification({
    id:"desktop-notification-ready",
    title:"Notifikasi Desktop Aktif",
    message:"Update project akan muncul sebagai notifikasi desktop selama aplikasi ini terbuka."
  },{force:true});
}
function addNotification(item){
  const notification={
    id:uid(),
    createdAt:new Date().toISOString(),
    read:false,
    ...item
  };
  notifications.unshift(notification);
  saveNotifications();
  renderNotifBell();
  playNotificationSound(notification);
  showDesktopNotification(notification);
}
function allocationNotificationProjectLabel(jobOrState){
  const client=String(jobOrState?.p?.client||jobOrState?.client||"Client").trim()||"Client";
  const projectName=String(jobOrState?.p?.name||jobOrState?.projectName||"Project").trim()||"Project";
  return `${client} - ${projectName}`;
}
function allocationNotificationWorkerLabel(jobOrState){
  if(jobOrState?.a) return workerDisplayName(jobOrState.a)||"Artist";
  return String(jobOrState?.workerName||artistName(jobOrState?.artistId)||"Artist").trim()||"Artist";
}
function statusNotificationLabel(status){
  const map={
    "Booked":"Booked",
    "Waitlist":"Waitlist",
    "In Progress":"In Progress",
    "Submitted":"Menunggu Admin",
    "Approved":"Approved",
    "Payable":"Payable",
    "Paid":"Paid",
    "Blocked":"Tahan / Kendala",
    "Revision Hold":"Revisi",
    "Waiting Client":"Waiting Client"
  };
  return map[String(status||"")]||String(status||"Update");
}
function notifyAdminAboutArtistUpdate(job,options={}){
  if(!job?.a) return;
  const status=String(job.a.workStatus||"Booked");
  if(!["Submitted","Blocked"].includes(status)) return;
  const projectLabel=allocationNotificationProjectLabel(job);
  const worker=allocationNotificationWorkerLabel(job);
  const previousStatus=String(options.previousStatus||"");
  const isResubmit=status==="Submitted"&&previousStatus==="Submitted";
  const action=status==="Submitted"
    ?isResubmit?"mengirim ulang submission":"submit pekerjaan"
    :"mengirim status kendala";
  addNotification({
    type:status==="Submitted"?(isResubmit?"artistResubmitted":"artistSubmitted"):"artistBlocked",
    title:status==="Submitted"?(isResubmit?"Submission Dikirim Ulang":"Submission Baru"):"Kendala Artist",
    targetRole:"admin",
    artistId:"",
    projectId:String(job.p?.id||""),
    allocationId:String(job.a?.id||""),
    message:`${worker} ${action}: ${projectLabel}.`
  });
  if(role==="artist"&&status==="Submitted"){
    const recipientArtist=String(job.a.artistId||activeArtist||"");
    addNotification({
      type:isResubmit?"artistSubmitConfirmationRepeat":"artistSubmitConfirmation",
      title:isResubmit?"Kiriman Dikirim Ulang":"Kiriman Disubmit",
      targetRole:"artist",
      artistId:recipientArtist,
      projectId:String(job.p?.id||""),
      allocationId:String(job.a?.id||""),
      message:`Kiriman Anda untuk ${projectLabel} sudah ${isResubmit?"dikirim ulang":"disubmit"} ke admin.`
    });
  }
}
function notifyArtistAboutAdminAction(job,options={}){
  if(!job?.a) return;
  const artistId=String(job.a.artistId||"").trim();
  if(!artistId) return;
  const status=String(job.a.workStatus||"Booked");
  const previousStatus=String(options.previousStatus||"");
  const note=String(options.note||getAdminRevisionReason(job.a)||"").trim();
  if(!options.force&&previousStatus===status) return;
  const projectLabel=allocationNotificationProjectLabel(job);
  let message=`Admin mengubah status ${projectLabel} menjadi ${statusNotificationLabel(status)}.`;
  let title="Update Admin";
  if(status==="Revision Hold"){
    title=previousStatus==="Revision Hold"?"Catatan Revisi Diubah":"Revisi Diminta";
    message=`Admin meminta revisi untuk ${projectLabel}.${note?` Catatan: ${note}`:""}`;
  }else if(status==="Approved"){
    title="Pekerjaan Approved";
    message=`Admin approve ${projectLabel}.`;
  }else if(status==="Payable"){
    title="Masuk Payable";
    message=`Admin memindahkan ${projectLabel} ke Payable.`;
  }else if(status==="Paid"){
    title="Sudah Dibayar";
    message=`Admin menandai ${projectLabel} sebagai Paid.`;
  }else if(status==="Blocked"){
    title="Task Ditahan";
    message=`Admin menahan ${projectLabel}.${note?` Catatan: ${note}`:""}`;
  }else if(status==="In Progress"){
    title="Dikembalikan ke Progress";
    message=`Admin mengembalikan ${projectLabel} ke In Progress.`;
  }
  addNotification({
    type:"adminStatusUpdate",
    title,
    targetRole:"artist",
    artistId,
    projectId:String(job.p?.id||""),
    allocationId:String(job.a?.id||""),
    message
  });
}
function markVisibleNotificationsRead(){
  const scope=currentNotifScope();
  if(!scope) return;
  let changed=false;
  notifications=(notifications||[]).map(item=>{
    if(item.targetRole!==scope.targetRole) return item;
    if(scope.targetRole==="artist"&&item.artistId!==scope.artistId) return item;
    if(item.read) return item;
    changed=true;
    return {...item,read:true};
  });
  if(changed) saveNotifications();
}
function renderNotifList(){
  const box=document.getElementById("notif-list");
  if(!box) return;
  const items=visibleNotifications();
  box.innerHTML=items.length?items.map(item=>{
    const notifIdRaw=String(item.id||"");
    const notifIdJs=notifIdRaw.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const jumpable=Boolean(item.allocationId);
    return `
    <div class="notif-swipe-wrap" data-notif-id="${esc(notifIdRaw)}">
      <div class="notif-swipe-delete">HAPUS</div>
      <div ${jumpable?`role="button" tabindex="0" onclick="openNotificationProject('${notifIdJs}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openNotificationProject('${notifIdJs}')}"`:""} class="notif-swipe-item bg-slate-900 rounded-xl p-3 border ${item.read?"border-white/5":"border-rose-400/35"} ${jumpable?"cursor-pointer hover:border-white/40 hover:bg-slate-800/80 transition":" "}">
        <p class="text-sm">${esc(item.message||"-")}</p>
        ${jumpable?`<p class="text-[11px] text-sky-300 mt-1">Klik untuk buka project terkait</p>`:""}
        <p class="mono text-[10px] text-slate-500 mt-1">${esc(fmtDateTime(item.createdAt))}</p>
      </div>
    </div>
  `;}).join(""):`<div class="bg-slate-900 rounded-xl p-4 text-slate-400 text-sm">Belum ada notifikasi.</div>`;
  bindNotifSwipeGestures();
}
function bindNotifSwipeGestures(){
  document.querySelectorAll(".notif-swipe-wrap").forEach(wrap=>{
    const item=wrap.querySelector(".notif-swipe-item");
    if(!item) return;
    const notifId=String(wrap.dataset.notifId||"").trim();
    if(!notifId) return;
    let startX=0;
    let deltaX=0;
    let dragging=false;
    let pointerId=null;
    const MAX_SHIFT=104;
    const DELETE_THRESHOLD=-86;
    const applyTransform=(x)=>{ item.style.transform=`translateX(${x}px)`; };
    const resetItem=()=>{
      item.style.transition="transform .18s ease";
      applyTransform(0);
      setTimeout(()=>{ item.style.transition=""; },190);
    };
    item.addEventListener("click",ev=>{
      if(item.dataset.swipeSuppress==="1"){
        ev.preventDefault();
        ev.stopImmediatePropagation();
        item.dataset.swipeSuppress="0";
      }
    },true);
    item.addEventListener("pointerdown",ev=>{
      if(ev.button!==0) return;
      dragging=true;
      pointerId=ev.pointerId;
      startX=ev.clientX;
      deltaX=0;
      item.dataset.swipeSuppress="0";
      item.style.transition="";
      item.setPointerCapture?.(pointerId);
    });
    item.addEventListener("pointermove",ev=>{
      if(!dragging||ev.pointerId!==pointerId) return;
      const raw=ev.clientX-startX;
      deltaX=Math.max(-MAX_SHIFT,Math.min(0,raw));
      if(Math.abs(deltaX)>8) item.dataset.swipeSuppress="1";
      applyTransform(deltaX);
    });
    const finishSwipe=(ev)=>{
      if(!dragging||ev.pointerId!==pointerId) return;
      dragging=false;
      item.releasePointerCapture?.(pointerId);
      pointerId=null;
      if(deltaX<=DELETE_THRESHOLD){
        item.style.transition="transform .14s ease";
        applyTransform(-MAX_SHIFT);
        setTimeout(()=>{ deleteNotificationById(notifId); },130);
      }else{
        resetItem();
      }
    };
    item.addEventListener("pointerup",finishSwipe);
    item.addEventListener("pointercancel",finishSwipe);
  });
}
function openNotificationProject(notifId){
  const target=String(notifId||"").trim();
  if(!target) return;
  const item=(notifications||[]).find(x=>String(x?.id||"")===target);
  if(!item||!inCurrentNotifScope(item)) return;
  const allocId=String(item.allocationId||"").trim();
  markNotificationReadById(target);
  renderNotifBell();
  renderNotifList();
  closeNotifModal();
  if(allocId){
    openJobFromLanding(allocId,true);
  }
}
function openNotifModal(){
  renderNotifBell();
  renderNotifList();
  document.getElementById("notif-modal")?.classList.add("active");
}
function closeNotifModal(){ document.getElementById("notif-modal")?.classList.remove("active"); }
function captureAllocationState(snapshot){
  const source=snapshot&&typeof snapshot==="object"?snapshot:{projects:[]};
  const out={};
  for(const project of source.projects||[]){
    for(const alloc of project.allocations||[]){
      if(!alloc?.id) continue;
      out[String(alloc.id)]={
        status:String(alloc.workStatus||"Booked"),
        projectId:String(project.id||""),
        client:String(project.client||""),
        projectName:String(project.name||""),
        artistId:String(alloc.artistId||""),
        workerName:String(alloc.workerName||""),
        role:String(alloc.role||""),
        submissionType:String(alloc.submissionType||""),
        submissionLink:String(alloc.submissionLink||""),
        artistUpdateNote:String(alloc.artistUpdateNote||""),
        artistHoldReason:String(getArtistHoldReason(alloc)||""),
        adminRevisionNote:String(getAdminRevisionReason(alloc)||""),
        payableDate:String(alloc.payableDate||""),
        paidDate:String(alloc.paidDate||""),
        lastArtistUpdate:String(alloc.lastArtistUpdate||"")
      };
    }
  }
  return out;
}
function artistUpdateSignal(state){
  return [
    state?.status,
    state?.submissionType,
    state?.submissionLink,
    state?.artistUpdateNote,
    state?.artistHoldReason,
    state?.lastArtistUpdate
  ].map(v=>String(v||"")).join("|");
}
function adminUpdateSignal(state){
  return [
    state?.status,
    state?.adminRevisionNote,
    state?.payableDate,
    state?.paidDate
  ].map(v=>String(v||"")).join("|");
}
function pushStatusNotifications(prevState,nextState){
  const prev=prevState&&typeof prevState==="object"?prevState:{};
  const next=nextState&&typeof nextState==="object"?nextState:{};
  if(role==="admin"&&isVerifiedAdmin()){
    for(const [allocId,after] of Object.entries(next)){
      const before=prev[allocId];
      const statusChanged=!before||before.status!==after.status;
      const artistChanged=before&&artistUpdateSignal(before)!==artistUpdateSignal(after);
      if(!["Submitted","Blocked"].includes(after.status)) continue;
      if(!statusChanged&&!artistChanged) continue;
      const worker=after.workerName||artistName(after.artistId)||"Artist";
      const action=after.status==="Submitted"
        ?before?.status==="Submitted"?"mengirim ulang submission":"submit pekerjaan"
        :"mengirim status kendala";
      addNotification({
        type:after.status==="Submitted"&&before?.status==="Submitted"?"artistResubmitted":"artistStatusUpdate",
        title:after.status==="Submitted"&&before?.status==="Submitted"?"Submission Dikirim Ulang":"Update Artist",
        targetRole:"admin",
        artistId:"",
        projectId:after.projectId,
        allocationId:allocId,
        message:`${worker} ${action}: ${after.client} - ${after.projectName}.`
      });
    }
    return;
  }
  if(role==="artist"&&activeArtist){
    for(const [allocId,after] of Object.entries(next)){
      const before=prev[allocId];
      if(after.artistId!==activeArtist) continue;
      if(!before){
        addNotification({
          type:"projectAssigned",
          targetRole:"artist",
          artistId:activeArtist,
          projectId:after.projectId,
          allocationId:allocId,
          title:`Proyek Baru: ${after.projectName}`,
          message:`Admin menambahkan pekerjaan untuk Anda dari klien ${after.client}. Role: ${after.role||"Worker"}`
        });
        continue;
      }
      const statusChanged=before.status!==after.status;
      const adminChanged=adminUpdateSignal(before)!==adminUpdateSignal(after);
      if(!statusChanged&&!adminChanged) continue;
      if(!["Approved","Revision Hold","Blocked","Payable","Paid","In Progress","Waiting Client"].includes(after.status)) continue;
      const label=statusNotificationLabel(after.status);
      let message=`Admin mengubah status ${after.client} - ${after.projectName} menjadi ${label}.`;
      let title="Update Admin";
      if(after.status==="Revision Hold"){
        title=before.status==="Revision Hold"?"Catatan Revisi Diubah":"Revisi Diminta";
        message=`Admin meminta revisi untuk ${after.client} - ${after.projectName}.${after.adminRevisionNote?` Catatan: ${after.adminRevisionNote}`:""}`;
      }else if(after.status==="Approved"){
        title="Pekerjaan Approved";
        message=`Admin approve ${after.client} - ${after.projectName}.`;
      }else if(after.status==="Payable"){
        title="Masuk Payable";
        message=`Admin memindahkan ${after.client} - ${after.projectName} ke Payable.`;
      }else if(after.status==="Paid"){
        title="Sudah Dibayar";
        message=`Admin menandai ${after.client} - ${after.projectName} sebagai Paid.`;
      }else if(after.status==="In Progress"){
        title="Dikembalikan ke Progress";
        message=`Admin mengembalikan ${after.client} - ${after.projectName} ke In Progress.`;
      }
      addNotification({
        title,
        targetRole:"artist",
        artistId:activeArtist,
        projectId:after.projectId,
        allocationId:allocId,
        message
      });
    }
  }
}
function currentLiveRefreshKey(){
  if(!db) return "";
  if(role==="admin"&&currentUser&&currentProfile?.role==="admin") return `admin:${currentUser.id}`;
  if(role==="artist"&&activeArtist&&artistPinSession) return `artist:${activeArtist}`;
  return "";
}
async function pollRemoteChanges(){
  if(liveRefreshBusy||!db) return;
  if(isUserTextEditing()) return;
  const key=currentLiveRefreshKey();
  if(!key) return;
  liveRefreshBusy=true;
  const before=allocationStateCache&&Object.keys(allocationStateCache).length?allocationStateCache:captureAllocationState(data);
  try{
    await loadRemoteSnapshot();
    const after=captureAllocationState(data);
    pushStatusNotifications(before,after);
    allocationStateCache=after;
    renderAll();
  }catch(err){
    console.error("pollRemoteChanges error",err);
  }finally{
    liveRefreshBusy=false;
  }
}
function syncLiveRefreshWatcher(){
  const nextKey=currentLiveRefreshKey();
  if(!nextKey){
    if(liveRefreshTimer){ clearInterval(liveRefreshTimer); liveRefreshTimer=null; }
    liveRefreshKey="";
    return;
  }
  if(liveRefreshTimer&&liveRefreshKey===nextKey) return;
  if(liveRefreshTimer) clearInterval(liveRefreshTimer);
  liveRefreshKey=nextKey;
  allocationStateCache=captureAllocationState(data);
  liveRefreshTimer=setInterval(()=>{ void pollRemoteChanges(); },7000);
}
function hasArtistSession(){ return Boolean(artistPinSession&&artistLockedId); }
function isVerifiedAdmin(){ return role==="admin"&&currentProfile?.role==="admin"; }
function requireVerifiedAdmin(message="Fitur ini hanya untuk admin yang sudah login."){
  if(isVerifiedAdmin()) return true;
  alert(message);
  openLogin("admin");
  return false;
}
function isAnonymousDisabledError(err){
  const msg=String(err?.message||err||"").toLowerCase();
  const code=String(err?.code||"").toLowerCase();
  return msg.includes("anonymous sign-ins are disabled")
    || msg.includes("anonymous signups are disabled")
    || code.includes("anonymous_provider_disabled");
}
function markAnonymousViewerUnavailable(err){
  anonymousViewerUnavailable=true;
  anonymousViewerUnavailableReason=String(err?.message||err||"Anonymous sign-ins are disabled");
}
function clearArtistSession(){
  artistPinSession="";
  artistLockedId="";
  if(role==="artist") activeArtist="";
  setSessionValue(SESSION_ARTIST_PIN,"");
  setSessionValue(SESSION_ARTIST_LOCK,"");
  setSessionValue(SESSION_ARTIST,"");
}
function normalizeArtistRoles(value){
  const raw=Array.isArray(value)?value:String(value||"").split(/[|,]/g);
  const cleaned=raw.map(v=>String(v||"").trim()).filter(Boolean);
  if(cleaned.length===0) return ["Illustration"];
  const unique=[];
  for(const roleItem of cleaned){
    if(!unique.includes(roleItem)) unique.push(roleItem);
  }
  return unique;
}
function artistRolesLabel(artist){
  return normalizeArtistRoles(artist?.roles||artist?.role).join(", ");
}
function collectArtistRolesFromModal(){
  const selected=[...document.querySelectorAll(".ta-role-option:checked")].map(el=>String(el.value||"").trim()).filter(Boolean);
  return normalizeArtistRoles(selected);
}
function renderArtistRolePicker(selectedRoles){
  const container=document.getElementById("ta-role-list");
  if(!container) return;
  const selected=new Set(normalizeArtistRoles(selectedRoles));
  container.innerHTML=ARTIST_ROLE_OPTIONS.map(roleName=>`
    <label class="bg-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 flex items-center gap-2">
      <input type="checkbox" class="ta-role-option" value="${esc(roleName)}" ${selected.has(roleName)?"checked":""}>
      <span>${esc(roleName)}</span>
    </label>
  `).join("");
}
async function ensureArtistViewerSession(){
  if(!db) return false;
  if(role!=="artist") return Boolean(currentUser);
  if(currentUser) return true;
  if(SUPABASE_SECURE_PRIVATE_ARTIST_BRIEF_MODE) return true;
  if(anonymousViewerUnavailable) return false;
  try{
    const {data:sessionData,error:sessionError}=await db.auth.getSession();
    if(!sessionError&&sessionData?.session?.user){
      currentUser=sessionData.session.user;
      return true;
    }
  }catch(err){
    console.warn("ensureArtistViewerSession getSession error",err);
  }
  const {error:anonError}=await db.auth.signInAnonymously();
  if(anonError){
    if(isAnonymousDisabledError(anonError)){
      markAnonymousViewerUnavailable(anonError);
      console.warn("ensureArtistViewerSession skipped: anonymous sign-in is disabled in Supabase Auth settings.");
      return false;
    }
    console.error("ensureArtistViewerSession anonymous sign-in failed",anonError);
    return false;
  }
  const {data:userData,error:userError}=await db.auth.getUser();
  if(userError||!userData?.user){
    console.error("ensureArtistViewerSession anonymous user not found",userError);
    return false;
  }
  currentUser=userData.user;
  return true;
}
function setLoginBusy(isBusy){
  if(loginBusyWatchdog){
    clearTimeout(loginBusyWatchdog);
    loginBusyWatchdog=null;
  }
  loginBusy=Boolean(isBusy);
  document.querySelectorAll("[data-login-role]").forEach(btn=>{
    btn.disabled=loginBusy;
    btn.classList.toggle("opacity-50",loginBusy);
    btn.classList.toggle("cursor-not-allowed",loginBusy);
  });
  const adminBtn=document.getElementById("login-admin-btn");
  const artistBtn=document.getElementById("login-artist-btn");
  if(adminBtn) adminBtn.textContent=loginBusy?"Memproses...":"Masuk Admin";
  if(artistBtn) artistBtn.textContent=loginBusy?"Memproses...":"Masuk Artist";
  if(loginBusy){
    loginBusyWatchdog=setTimeout(()=>{
      loginBusy=false;
      document.querySelectorAll("[data-login-role]").forEach(btn=>{
        btn.disabled=false;
        btn.classList.remove("opacity-50","cursor-not-allowed");
      });
      if(adminBtn) adminBtn.textContent="Masuk Admin";
      if(artistBtn) artistBtn.textContent="Masuk Artist";
      console.warn("loginBusy watchdog release after timeout");
    },70000);
  }
}
function setLoginStatus(message="",kind="info"){
  const el=document.getElementById("login-status");
  if(!el) return;
  if(!message){
    el.classList.add("hidden");
    el.textContent="";
    el.classList.remove("border-red-400/40","bg-red-500/10","text-red-200","border-emerald-400/40","bg-emerald-500/10","text-emerald-200","border-slate-500/40","bg-slate-500/10","text-slate-200");
    return;
  }
  el.classList.remove("hidden");
  el.classList.remove("border-red-400/40","bg-red-500/10","text-red-200","border-emerald-400/40","bg-emerald-500/10","text-emerald-200","border-slate-500/40","bg-slate-500/10","text-slate-200");
  if(kind==="error"){
    el.classList.add("border-red-400/40","bg-red-500/10","text-red-200");
  }else if(kind==="success"){
    el.classList.add("border-emerald-400/40","bg-emerald-500/10","text-emerald-200");
  }else{
    el.classList.add("border-slate-500/40","bg-slate-500/10","text-slate-200");
  }
  el.textContent=message;
}
async function withTimeout(promise,ms,label){
  let timer=null;
  try{
    return await Promise.race([
      promise,
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(`${label} timeout (${ms}ms)`)),ms);
      })
    ]);
  }finally{
    if(timer) clearTimeout(timer);
  }
}
async function resolveUserAfterAuth(timeoutMs=SESSION_TIMEOUT_MS){
  if(!db) return null;
  try{
    const {data:userData,error:userError}=await withTimeout(db.auth.getUser(),timeoutMs,"getUser");
    if(!userError&&userData?.user) return userData.user;
  }catch(err){
    console.warn("resolveUserAfterAuth getUser error",err);
  }
  try{
    const {data:sessionData,error:sessionError}=await withTimeout(db.auth.getSession(),timeoutMs,"getSession");
    if(!sessionError&&sessionData?.session?.user) return sessionData.session.user;
  }catch(err){
    console.warn("resolveUserAfterAuth getSession error",err);
  }
  return null;
}
async function hydrateAfterLogin(){
  try{
    await withTimeout(loadRemoteSnapshot(),SNAPSHOT_TIMEOUT_MS,"loadRemoteSnapshot");
  }catch(err){
    console.error("hydrateAfterLogin error",err);
    alert("Login berhasil, tetapi sinkronisasi data ke Supabase lambat/gagal. Coba refresh halaman.");
  }
  renderAll();
}
function closeAllModals(){
  ["login-modal","pin-modal","submit-type-modal","export-modal","payroll-export-preview-modal","revision-modal","brief-modal","artist-modal","project-modal","package-modal","notif-modal"].forEach(id=>{
    document.getElementById(id)?.classList.remove("active");
  });
  clearBriefObjectUrls();
}
