const KEY="kuramash_erp_tools_data";
const SESSION_ROLE="kuramash_tools_role";
const SESSION_ARTIST="kuramash_tools_artist";
const SESSION_ARTIST_PIN="kuramash_tools_artist_pin";
const SESSION_ARTIST_LOCK="kuramash_tools_artist_lock";
const SESSION_LANDING_FILTER="kuramash_tools_landing_filter";
const THEME_KEY="kuramash_tools_theme";
const NOTIF_KEY="kuramash_tools_notifications";
const DESKTOP_NOTIF_KEY="kuramash_tools_desktop_notifications";
const NOTIF_SOUND_KEY="kuramash_tools_notification_sound";
const DEADLINE_REMINDER_STATE_KEY="kuramash_tools_deadline_reminders_v1";
const PAYROLL_EXPORT_HISTORY_KEY="kuramash_tools_payroll_export_history_v1";
const DATA_ROW_ID="kuramash-team-main";
const SUPABASE_URL=window.SUPABASE_URL||"https://carhllfwjwelnqxfnmbj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY=window.SUPABASE_PUBLISHABLE_KEY||"sb_publishable_puuyniyAcFxn4H3ZPcXimg_7YjGUICP";
const SUPABASE_BRIEF_BUCKET=window.SUPABASE_BRIEF_BUCKET||"project-briefs";
const SUPABASE_SIGNED_URL_TTL=60*20;
const SUPABASE_SECURE_PRIVATE_ARTIST_BRIEF_MODE=String(window.SUPABASE_SECURE_PRIVATE_ARTIST_BRIEF_MODE??"true").toLowerCase()!=="false";
const SUPABASE_ARTIST_ID_HEADER=(window.SUPABASE_ARTIST_ID_HEADER||"x-kuramash-artist-id").toLowerCase();
const SUPABASE_ARTIST_PIN_HEADER=(window.SUPABASE_ARTIST_PIN_HEADER||"x-kuramash-artist-pin").toLowerCase();
const IS_FILE_ORIGIN=window.location.protocol==="file:";
const RPC_PUBLIC_ARTISTS="public_get_artist_roster";
const RPC_ADMIN_GET_SNAPSHOT="admin_get_team_snapshot";
const RPC_ADMIN_SAVE_SNAPSHOT="admin_save_team_snapshot";
const RPC_ADMIN_SET_ARTIST_PIN="admin_set_artist_pin";
const RPC_ADMIN_DELETE_ARTIST_PIN="admin_delete_artist_pin";
const RPC_ARTIST_VERIFY_PIN="artist_verify_pin";
const RPC_ARTIST_GET_SNAPSHOT="artist_get_team_snapshot";
const RPC_ARTIST_SAVE_SNAPSHOT="artist_save_team_snapshot";
const RPC_ARTIST_CHANGE_PIN="artist_change_pin";
const SUPABASE_READY=typeof window.supabase!=="undefined"&&/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)&&/^sb_publishable_/i.test(SUPABASE_PUBLISHABLE_KEY);
const authNoopLock=async(_name,_acquireTimeout,fn)=>await fn();
const db=SUPABASE_READY?window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true,
      storageKey:"kuramash_tools_auth_token",
      multiTab:false,
      lock:authNoopLock
    }
  }
):null;
function getSessionValue(key){ return localStorage.getItem(key)||sessionStorage.getItem(key)||""; }
function setSessionValue(key,value){
  if(value===undefined||value===null||value===""){
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key,String(value));
  sessionStorage.setItem(key,String(value));
}
let data={artists:[],projects:[],updatedAt:""};
let role=getSessionValue(SESSION_ROLE);
let activeArtist=getSessionValue(SESSION_ARTIST);
let landingFilter=getSessionValue(SESSION_LANDING_FILTER)||"all";
let themeMode=localStorage.getItem(THEME_KEY)==="light"?"light":"dark";
let currentUser=null;
let currentProfile=null;
let syncTimer=null;
let tempAllocations=[];
let tempPackageRows=[];
let briefObjectUrls=[];
let artistPinSession=getSessionValue(SESSION_ARTIST_PIN);
let artistLockedId=getSessionValue(SESSION_ARTIST_LOCK);
let artistPinFailCount=0;
let artistPinLockUntil=0;
let fileOriginWarned=false;
let loginBusy=false;
let loginBusyWatchdog=null;
let authInProgress=false;
let anonymousViewerUnavailable=false;
let anonymousViewerUnavailableReason="";
let notifications=[];
let deadlineReminderState={};
let liveRefreshTimer=null;
let liveRefreshBusy=false;
let liveRefreshKey="";
let allocationStateCache={};
let focusedAllocationId="";
let focusedAllocationClearTimer=null;
let adminBulkSelectedAllocationIds=new Set();
let adminBulkViewAllocationIds=[];
let payrollSelectedAllocationIds=new Set();
let payrollViewAllocationIds=[];
let payrollMonthFilter="all";
let payrollStatusFilter="All";
let payrollSearch="";
let payrollTargetMonth="";
let payrollExportPreviewMonth="";
let payrollArtistSummaryOpen=false;
let activePage="landing";
let deferredRenderAllOptions=null;
let deferredRenderAllTimer=null;
const AUTH_TIMEOUT_MS=45000;
const SESSION_TIMEOUT_MS=45000;
const PROFILE_TIMEOUT_MS=45000;
const SNAPSHOT_TIMEOUT_MS=30000;
const packageTemplates={
  "Premium":[["Illustration","Premium","Tidak ada"],["Rigging","Premium","Tidak ada"],["Freebie","Freebie","Tidak ada"]],
  "Professional":[["Illustration","Professional","Tidak ada"],["Rigging","Professional","Tidak ada"]],
  "Standard":[["Illustration","Standard","Tidak ada"],["Rigging","Standard","Tidak ada"]],
  "Art Only":[["Illustration","Art Only","Tidak ada"]],
  "Rigging Only":[["Rigging","Rigging Only","Tidak ada"]],
  "BGM / Add-on":[["BGM","BGM","Tidak ada"]],
  "Overlay / Layout":[["Overlay","Overlay","Tidak ada"],["Layout","Layout","Tidak ada"]],
  "Freebie Only":[["Freebie","Freebie","Tidak ada"]],
  "Custom":[["Illustration","Custom","Tidak ada"]]
};
const ARTIST_ROLE_OPTIONS=["Illustration","Rigging","BGM","Overlay","Layout","Freebie"];
const MOBILE_DRAWER_COLLAPSED_KEY="kuramash_tools_mobile_drawer_collapsed";

function applyThemeMode(){
  document.body.classList.toggle("theme-light",themeMode==="light");
  const btn=document.getElementById("theme-toggle");
  const label=document.getElementById("theme-toggle-label");
  if(label) label.textContent=themeMode==="light"?"Mode Siang":"Mode Malam";
  if(btn){
    btn.setAttribute("aria-label",themeMode==="light"?"Mode siang aktif, klik untuk mode malam":"Mode malam aktif, klik untuk mode siang");
    btn.setAttribute("aria-pressed",themeMode==="light"?"true":"false");
  }
}
function toggleThemeMode(){
  themeMode=themeMode==="light"?"dark":"light";
  localStorage.setItem(THEME_KEY,themeMode);
  document.body.classList.remove("theme-changing");
  void document.body.offsetWidth;
  document.body.classList.add("theme-changing");
  applyThemeMode();
  setTimeout(()=>document.body.classList.remove("theme-changing"),620);
}

function isMobileDrawerViewport(){
  return window.matchMedia("(max-width:900px)").matches;
}
function applyMobileDrawerState(){
  if(!isMobileDrawerViewport()){
    document.body.classList.remove("mobile-drawer-collapsed");
    return;
  }
  const collapsed=localStorage.getItem(MOBILE_DRAWER_COLLAPSED_KEY)==="1";
  document.body.classList.toggle("mobile-drawer-collapsed",collapsed);
}
function toggleMobileDrawer(forceClose){
  if(!isMobileDrawerViewport()) return;
  const nextCollapsed=typeof forceClose==="boolean"
    ?forceClose
    :!document.body.classList.contains("mobile-drawer-collapsed");
  document.body.classList.toggle("mobile-drawer-collapsed",nextCollapsed);
  localStorage.setItem(MOBILE_DRAWER_COLLAPSED_KEY,nextCollapsed?"1":"0");
}

const TEXT_EDIT_INPUT_TYPES=new Set(["","text","search","url","tel","email","password","number"]);
function isTextEditingElement(el){
  if(!el||el.disabled||el.readOnly) return false;
  const tag=String(el.tagName||"").toLowerCase();
  if(tag==="textarea") return true;
  if(tag==="input") return TEXT_EDIT_INPUT_TYPES.has(String(el.type||"text").toLowerCase());
  return Boolean(el.isContentEditable);
}
function isUserTextEditing(){
  return document.hasFocus()&&isTextEditingElement(document.activeElement);
}
function scheduleDeferredRenderAll(options={}){
  deferredRenderAllOptions={...(deferredRenderAllOptions||{}),...(options||{})};
  if(deferredRenderAllTimer) clearTimeout(deferredRenderAllTimer);
  deferredRenderAllTimer=setTimeout(flushDeferredRenderAllIfIdle,500);
}
function flushDeferredRenderAllIfIdle(){
  if(!deferredRenderAllOptions) return;
  if(isUserTextEditing()){
    if(deferredRenderAllTimer) clearTimeout(deferredRenderAllTimer);
    deferredRenderAllTimer=setTimeout(flushDeferredRenderAllIfIdle,500);
    return;
  }
  const options=deferredRenderAllOptions;
  deferredRenderAllOptions=null;
  if(deferredRenderAllTimer){
    clearTimeout(deferredRenderAllTimer);
    deferredRenderAllTimer=null;
  }
  if(typeof renderAll==="function") renderAll({...options,deferWhileEditing:false});
}
document.addEventListener("focusout",()=>setTimeout(flushDeferredRenderAllIfIdle,0),true);

function uid(){ return (crypto.randomUUID?crypto.randomUUID():"id-"+Date.now()+"-"+Math.random().toString(16).slice(2)); }
function esc(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function today(){ return new Date().toISOString().slice(0,10); }
function fmt(v){ if(!v) return "-"; const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m?`${m[3]}/${m[2]}/${m[1]}`:v; }
function currentMonthKey(){ return today().slice(0,7); }
function isMonthKey(value){ return /^\d{4}-\d{2}$/.test(String(value||"")); }
function monthEndDate(month){
  const key=String(month||"");
  if(!isMonthKey(key)) return today();
  const [year,monthIndex]=key.split("-").map(Number);
  const end=new Date(year,monthIndex,0);
  return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")}`;
}
function monthLabel(month){
  const key=String(month||"");
  if(!isMonthKey(key)) return "Belum ditentukan";
  const date=new Date(`${key}-01T00:00:00`);
  if(Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("id-ID",{month:"long",year:"numeric"});
}
function monthKeyFromDate(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})/);
  return match?`${match[1]}-${match[2]}`:"";
}
function days(v){ if(!v) return null; const a=new Date(`${v}T00:00:00`); const b=new Date(`${today()}T00:00:00`); return Math.ceil((a-b)/86400000); }
function resolveAllocationTargetDate(allocation,previousDeadline,nextDeadline){
  const currentTarget=String(allocation?.targetDoneDate||"").trim();
  const prev=String(previousDeadline||"").trim();
  const next=String(nextDeadline||"").trim();
  if(!currentTarget) return next;
  if(prev&&currentTarget===prev) return next;
  return currentTarget;
}
function resolveAllocationPayableDate(allocation,previousRelease,nextRelease){
  const currentPayable=String(allocation?.payableDate||"").trim();
  const prev=String(previousRelease||"").trim();
  const next=String(nextRelease||"").trim();
  if(!currentPayable) return next;
  if(prev&&currentPayable===prev) return next;
  return currentPayable;
}
function fmtDateTime(v){
  if(!v) return "-";
  const d=new Date(v);
  if(Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("id-ID");
}
function loadNotifications(){
  try{
    const parsed=JSON.parse(localStorage.getItem(NOTIF_KEY)||"[]");
    if(!Array.isArray(parsed)) return [];
    return parsed.filter(item=>item&&typeof item==="object");
  }catch(_err){
    return [];
  }
}
function saveNotifications(){
  const trimmed=(notifications||[]).slice(0,250);
  notifications=trimmed;
  localStorage.setItem(NOTIF_KEY,JSON.stringify(trimmed));
}
function loadDeadlineReminderState(){
  try{
    const parsed=JSON.parse(localStorage.getItem(DEADLINE_REMINDER_STATE_KEY)||"{}");
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) return {};
    return parsed;
  }catch(_err){
    return {};
  }
}
function saveDeadlineReminderState(){
  localStorage.setItem(DEADLINE_REMINDER_STATE_KEY,JSON.stringify(deadlineReminderState||{}));
}
function pruneDeadlineReminderState(){
  const entries=Object.entries(deadlineReminderState||{});
  if(entries.length<=1200) return false;
  entries.sort((a,b)=>String(a[1]||"").localeCompare(String(b[1]||"")));
  const keep=entries.slice(-800);
  deadlineReminderState=Object.fromEntries(keep);
  return true;
}
function currentReminderScopeKey(){
  const scope=currentNotifScope();
  if(!scope) return "";
  if(scope.targetRole==="admin") return "admin:*";
  return `artist:${scope.artistId||""}`;
}
function deadlineReminderTag(daysToDeadline){
  if(daysToDeadline===3) return "h-3";
  if(daysToDeadline===1) return "h-1";
  return "";
}
