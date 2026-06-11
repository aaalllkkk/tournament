function allJobs(){
  return (data.projects||[]).flatMap((p,pi)=>(p.allocations||[]).map((a,ai)=>({p,pi,a,ai,artist:data.artists.find(x=>x.id===a.artistId)})));
}
function editTeamProject(pid){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengedit project.")) return;
  const p=projectById(pid); if(!p) return;
  document.getElementById("tp-edit-id").value=p.id;
  document.getElementById("tp-client").value=p.client||"";
  document.getElementById("tp-name").value=p.name||"";
  syncPackageTypeSelectOptions(p.packageType||"Custom");
  document.getElementById("tp-deadline").value=p.deadline||"";
  document.getElementById("tp-brief-status").value=p.briefStatus||"Draft";
  document.getElementById("tp-budget-usd").value=p.budgetUsd||"";
  document.getElementById("tp-budget-idr").value=p.budgetIdr||"";
  document.getElementById("tp-platform").value=p.platform||"Direct";
  document.getElementById("tp-payment-status").value=p.paymentStatus||"Belum Bayar";
  document.getElementById("tp-paid-usd").value=p.paidUsd||"";
  document.getElementById("tp-paid-idr").value=p.paidIdr||"";
  document.getElementById("tp-payment-date").value=p.paymentDate||"";
  document.getElementById("tp-expected-release-date").value=p.expectedReleaseDate||"";
  document.getElementById("tp-payment-note").value=p.paymentNote||"";
  document.getElementById("tp-instruction").value=p.artistInstruction||"";
  document.getElementById("tp-brief-link").value=p.briefLink||"";
  document.getElementById("tp-freebie-link").value=p.freebieRequirementNotes||"";
  clearProjectPdfInputs();
  setProjectPdfInfo(p);
  tempAllocations=(p.allocations||[]).map(a=>({...a,id:a.id||uid(),serviceType:a.serviceType||"Custom",payMode:a.payMode||"conversion"}));
  renderTempAllocs();
  document.getElementById("project-modal").classList.add("active");
}
async function deleteTeamProject(pid){
  if(!requireVerifiedAdmin("Hanya admin yang boleh menghapus project.")) return;
  const project=projectById(pid);
  if(!project){ alert("Project tidak ditemukan."); return; }
  if(!confirm("Hapus project ini dari Team?")) return;
  try{
    await deleteProjectPdfFiles(project);
  }catch(err){
    console.error("deleteTeamProject PDF cleanup error",err);
    alert(`Gagal menghapus PDF project dari Supabase Storage: ${err?.message||err}`);
    return;
  }
  data.projects=(data.projects||[]).filter(p=>p.id!==pid);
  saveData(); renderAll();
}
function visibleJobs(){
  const rows=allJobs().filter(j=>(j.a.workStatus||"Booked")!=="Paid");
  if(role!=="artist") return rows;
  return rows.filter(j=>j.a.artistId===activeArtist||(!j.a.artistId&&j.a.workerName===artistName(activeArtist)));
}
function artistName(id){ return data.artists.find(a=>a.id===id)?.name||""; }
function unassignedWorkerLabel(allocation){
  const roleName=String(allocation?.role||"").toLowerCase();
  return roleName.includes("rigging")?"Unassigned - Rigging":"Unassigned - Artist Lain";
}
function workerDisplayName(allocation){
  const manualName=String(allocation?.workerName||"").trim();
  if(manualName) return manualName;
  const assignedArtist=artistName(allocation?.artistId).trim();
  if(assignedArtist) return assignedArtist;
  return unassignedWorkerLabel(allocation);
}
function roleSortRank(roleName){
  const role=String(roleName||"").toLowerCase();
  if(role.includes("illustration")) return 0;
  if(role.includes("rigging")) return 1;
  if(role.includes("bgm")) return 2;
  if(role.includes("overlay")) return 3;
  if(role.includes("layout")) return 4;
  if(role.includes("freebie")) return 5;
  return 6;
}
function statusKey(j){
  const s=j.a.workStatus||"Booked";
  if(isDependency(j)) return "dependency";
  if(s==="Submitted") return "submitted";
  if(s==="Revision Hold") return "revision";
  if(["Approved","Payable","Paid"].includes(s)) return "payroll";
  if(["Blocked","Waiting Client"].includes(s)) return "blocked";
  if(s==="In Progress") return "progress";
  if(s==="Waitlist") return "waitlist";
  return "ready";
}
function statusPill(key){
  const map={dependency:["Dependency","dep"],submitted:["Menunggu admin","admin"],revision:["Perlu revisi","bad"],payroll:["Payroll","ok"],blocked:["Kendala","bad"],progress:["Sedang dikerjakan","ok"],waitlist:["Waitlist","warn"],ready:["Sudah dipesan","warn"]};
  const v=map[key]||["Cek","warn"];
  return `<span class="pill ${v[1]}">${v[0]}</span>`;
}
function normalizeLandingFilter(value){
  const allowed=["all","submitted","approved","dependency","issue"];
  return allowed.includes(String(value||""))?String(value):"all";
}
function setLandingFilter(value){
  landingFilter=normalizeLandingFilter(value);
  setSessionValue(SESSION_LANDING_FILTER,landingFilter);
  renderLanding();
}
function renderLandingFilterChips(){
  const root=document.getElementById("landing-filter-chips");
  if(!root) return;
  landingFilter=normalizeLandingFilter(landingFilter);
  root.querySelectorAll("[data-landing-filter]").forEach(btn=>{
    const active=btn.dataset.landingFilter===landingFilter;
    btn.classList.toggle("primary",active);
    btn.classList.toggle("opacity-70",!active);
  });
}
function deadlineChip(v){
  const d=days(v); const urgent=d!==null&&d<=7;
  const label=d===null?"Tanpa deadline":d<0?`${Math.abs(d)}h lewat`:d===0?"Hari ini":`${d}h lagi`;
  return `<div class="rounded-xl border ${urgent?"border-red-400/60 bg-red-500/15":"border-yellow-400/35 bg-yellow-500/10"} px-3 py-2 text-right"><p class="mono text-[10px] text-yellow-300">DEADLINE</p><p class="font-bold mono">${fmt(v)}</p><p class="text-xs">${label}</p></div>`;
}
function dependencyTarget(j){
  const dep=String(j.a.dependency||"");
  if(!dep.startsWith("Setelah ")) return null;
  const role=dep.replace("Setelah ","").toLowerCase();
  return (j.p.allocations||[]).find(a=>String(a.role||"").toLowerCase().includes(role));
}
function hasDependencyLock(j,allowedStatuses){
  const t=dependencyTarget(j);
  return Boolean(t&&!allowedStatuses.includes(String(t.workStatus||"Booked")));
}
function isDependency(j){ return hasDependencyLock(j,["In Progress","Submitted","Approved","Payable","Paid"]); }
function isApprovalDependencyLocked(j){ return hasDependencyLock(j,["Approved","Payable","Paid"]); }
function autoProgress(j){
  const s=j.a.workStatus||"Booked";
  if(s==="Paid"||s==="Payable"||s==="Approved") return 100;
  if(s==="Submitted") return Math.max(90,Number(j.a.artistProgress)||0);
  if(isDependency(j)) return Math.max(5,Number(j.a.artistProgress)||0);
  if(s==="In Progress") return Math.max(25,Number(j.a.artistProgress)||0);
  return Number(j.a.artistProgress)||0;
}
function renderSelectors(){
  const roleSelect=document.getElementById("role");
  if(roleSelect) roleSelect.value=role||"admin";
  const sel=document.getElementById("active-artist");
  if(role==="artist"&&artistLockedId) activeArtist=artistLockedId;
  sel.innerHTML=data.artists.length?data.artists.map(a=>`<option value="${a.id}">${esc(a.name)} - ${esc(artistRolesLabel(a))}</option>`).join(""):`<option value="">Belum ada artist</option>`;
  if(!activeArtist&&data.artists[0]) activeArtist=data.artists[0].id;
  sel.value=activeArtist;
  sel.disabled=role==="artist";
  const artistDisplay=document.getElementById("active-artist-display");
  const artistNameLabel=document.getElementById("active-artist-name");
  const pinBtn=document.getElementById("pin-btn");
  const artistMode=role==="artist";
  const isVerifiedAdmin=role==="admin"&&currentProfile?.role==="admin";
  document.body.classList.toggle("artist-mode",artistMode);
  document.body.classList.toggle("admin-mode",isVerifiedAdmin);
  roleSelect?.classList.toggle("hidden",artistMode);
  sel.classList.toggle("hidden",artistMode);
  artistDisplay?.classList.toggle("hidden",!artistMode);
  if(artistNameLabel) artistNameLabel.textContent=artistName(activeArtist)||"Artist";
  pinBtn?.classList.add("hidden");
  const logoutBtn=document.getElementById("logout-btn");
  if(logoutBtn){
    logoutBtn.classList.toggle("hidden",!role);
    logoutBtn.textContent=role==="admin"?"Logout (Admin)":"Logout";
  }
  document.querySelectorAll("[data-admin-only]").forEach(el=>el.classList.toggle("hidden",!isVerifiedAdmin));
  if(role==="artist"&&(document.getElementById("page-admin")?.classList.contains("active")||document.getElementById("page-data")?.classList.contains("active")||document.getElementById("page-payroll")?.classList.contains("active")||document.getElementById("page-setup")?.classList.contains("active"))) switchPage("landing");
  renderLoginArtists();
}
function saveSession(){
  if(role==="artist"){
    activeArtist=artistLockedId||activeArtist;
  }else{
    activeArtist=document.getElementById("active-artist").value;
  }
  setSessionValue(SESSION_ARTIST,activeArtist||"");
}
function setRole(v){
  if(authInProgress) return;
  if(v==="admin"){
    if(currentUser&&currentProfile?.role==="admin"){
      role="admin";
      setSessionValue(SESSION_ROLE,role);
      renderAll();
      return;
    }
    role="";
    openLogin("admin");
    return;
  }
  if(v==="artist"){
    if(hasArtistSession()){
      activeArtist=artistLockedId;
      role="artist";
      setSessionValue(SESSION_ARTIST,activeArtist||"");
      setSessionValue(SESSION_ARTIST_LOCK,artistLockedId||"");
      setSessionValue(SESSION_ARTIST_PIN,artistPinSession||"");
      setSessionValue(SESSION_ROLE,role);
      renderAll();
      return;
    }
    role="";
    openLogin("artist");
    return;
  }
  role=v;
  setSessionValue(SESSION_ROLE,role);
  renderAll();
}
function renderLoginArtists(){
  const sel=document.getElementById("login-artist-select");
  if(!sel) return;
  sel.innerHTML=data.artists.length?data.artists.map(a=>`<option value="${a.id}">${esc(a.name)} - ${esc(artistRolesLabel(a))}${a.pinConfigured?"":" (PIN belum diset)"}</option>`).join(""):`<option value="">Belum ada data artist. Tambahkan artist atau import dari Studio.</option>`;
}
async function openLogin(preferredRole=""){
  renderLoginArtists();
  setLoginBusy(false);
  setLoginStatus("");
  if(preferredRole==="artist"&&activeArtist&&document.getElementById("login-artist-select")){
    document.getElementById("login-artist-select").value=activeArtist;
  }
  document.getElementById("login-modal").classList.add("active");
  if(!db) return;
  try{
    await withTimeout(loadArtistRosterRemote(),5000,"openLogin loadArtistRosterRemote");
  }catch(err){
    console.warn("openLogin loadArtistRosterRemote timeout",err);
  }
  renderLoginArtists();
  if(preferredRole==="artist"&&activeArtist&&document.getElementById("login-artist-select")){
    document.getElementById("login-artist-select").value=activeArtist;
  }
  if(preferredRole==="admin"){
    document.getElementById("login-admin-email")?.focus();
  }else if(preferredRole==="artist"){
    document.getElementById("login-artist-pin")?.focus();
  }
}
function closeLogin(force=false){
  if(loginBusy&&!force) return;
  setLoginBusy(false);
  setLoginStatus("");
  document.getElementById("login-modal").classList.remove("active");
}
async function logoutTools(){
  if(loginBusy) return;
  if(!confirm("Logout dari session di perangkat ini?")) return;
  setLoginBusy(true);
  try{
    const prevRole=role;
    const shouldSignOutAdminAuth=prevRole==="admin"&&Boolean(db&&currentUser);
    if(shouldSignOutAdminAuth){
      try{
        const {error}=await withTimeout(db.auth.signOut({scope:"local"}),8000,"signOut");
        if(error) console.error("logout signOut error",error);
      }catch(err){
        console.error("logout signOut timeout/error",err);
      }
    }
    currentUser=null;
    currentProfile=null;
    role="";
    activeArtist="";
    clearArtistSession();
    setSessionValue(SESSION_ROLE,"");
    closeAllModals();
    renderAll();
    switchPage("landing");
    openLogin(prevRole==="artist"?"artist":"admin");
    if(db){
      void withTimeout(loadArtistRosterRemote(),8000,"loadArtistRosterRemote after logout")
        .then(()=>{ renderAll(); })
        .catch(err=>{ console.error("logout roster refresh error",err); });
    }
  }finally{
    setLoginBusy(false);
  }
}
async function loginTools(nextRole){
  if(loginBusy) return;
  if(authInProgress) return;
  if(!supabaseConfigured()) return;
  if(!db){
    alert("Supabase tidak siap. Refresh halaman atau jalankan via local server.");
    return;
  }
  authInProgress=true;
  setLoginBusy(true);
  setLoginStatus("Memulai proses login...","info");
  try{
    const isAdmin=nextRole==="admin";
    if(isAdmin){
      setLoginStatus("Autentikasi admin ke Supabase...","info");
      const email=(document.getElementById("login-admin-email")?.value||"").trim();
      const password=(document.getElementById("login-admin-pin")?.value||"").trim();
      if(!email||!password){ alert("Isi email dan password admin terlebih dahulu."); return; }
      let loginError=null;
      try{
        const loginResult=await withTimeout(db.auth.signInWithPassword({email,password}),AUTH_TIMEOUT_MS,"signInWithPassword");
        loginError=loginResult?.error||null;
      }catch(err){
        const message=String(err?.message||err||"");
        if(message.includes("signInWithPassword timeout")){
          console.warn("signInWithPassword timeout, trying to recover session");
          setLoginStatus("Respon login lambat. Mengecek session yang mungkin sudah sukses...","info");
        }else{
          throw err;
        }
      }
      if(loginError){
        const detail=[loginError.message,loginError.code].filter(Boolean).join(" | ");
        setLoginStatus(`Login admin gagal: ${detail||"Terjadi error autentikasi."}`,"error");
        alert(`Login admin gagal: ${detail||"Terjadi error autentikasi."}`);
        return;
      }
      setLoginStatus("Login berhasil. Memverifikasi role admin...","info");
      const user=await resolveUserAfterAuth(SESSION_TIMEOUT_MS);
      if(!user){
        setLoginStatus("Login timeout. Session belum terdeteksi di browser.","error");
        alert("Terjadi timeout saat login. Coba klik login lagi atau refresh halaman.");
        return;
      }
      currentUser=user;
      await withTimeout(loadProfile(),PROFILE_TIMEOUT_MS,"loadProfile");
      if(currentProfile?.role!=="admin"){
        await db.auth.signOut({scope:"local"});
        currentUser=null;
        currentProfile=null;
        setLoginStatus("Akun berhasil login Auth, tapi belum terdaftar sebagai admin di tabel profiles.","error");
        alert("Akun ini tidak memiliki akses admin.");
        return;
      }
      artistPinFailCount=0;
      artistPinLockUntil=0;
      clearArtistSession();
      setSessionValue(SESSION_ARTIST,"");
      role="admin";
      setSessionValue(SESSION_ROLE,role);
      setLoginStatus("Role admin valid. Menyiapkan dashboard...","success");
    }else{
      setLoginStatus("Memverifikasi PIN artist...","info");
      if(Date.now()<artistPinLockUntil){
        const waitSec=Math.ceil((artistPinLockUntil-Date.now())/1000);
        alert(`Terlalu banyak percobaan PIN. Coba lagi ${waitSec} detik.`);
        return;
      }
      const artistSelectEl=document.getElementById("login-artist-select");
      const selectedArtistBeforeRefresh=artistSelectEl?.value||"";
      await loadArtistRosterRemote();
      renderLoginArtists();
      if(selectedArtistBeforeRefresh&&document.getElementById("login-artist-select")){
        document.getElementById("login-artist-select").value=selectedArtistBeforeRefresh;
      }
      const selectedArtist=document.getElementById("login-artist-select").value||"";
      const pin=(document.getElementById("login-artist-pin")?.value||"").trim();
      if(!selectedArtist){ alert("Pilih artist terlebih dahulu."); return; }
      if(!pin){ alert("Masukkan PIN artist."); return; }
      const artist=data.artists.find(a=>a.id===selectedArtist);
      if(!artist){ alert("Artist tidak ditemukan di data Team."); return; }
      if(!artist.pinConfigured){
        setLoginStatus("Artist ini belum punya PIN di database.","error");
        alert("PIN artist ini belum diset di database. Minta admin set/reset PIN di Setup Artist & Paket, atau import ulang data yang berisi PIN.");
        return;
      }
      const pinOk=await verifyArtistPinRemote(selectedArtist,pin);
      if(!pinOk){
        artistPinFailCount+=1;
        if(artistPinFailCount>=5){
          artistPinLockUntil=Date.now()+60_000;
          artistPinFailCount=0;
        }
        setLoginStatus("PIN artist tidak cocok.","error");
        alert("PIN artist salah.");
        return;
      }
      artistPinFailCount=0;
      artistPinLockUntil=0;
      artistPinSession=pin;
      artistLockedId=selectedArtist;
      activeArtist=selectedArtist;
      role="artist";
      setSessionValue(SESSION_ARTIST_PIN,artistPinSession||"");
      setSessionValue(SESSION_ARTIST_LOCK,artistLockedId||"");
      setSessionValue(SESSION_ARTIST,activeArtist||"");
      setSessionValue(SESSION_ROLE,role);
      if(db&&currentUser){
        try{
          await withTimeout(db.auth.signOut({scope:"local"}),8000,"artistModeSignOutAdminSession");
        }catch(err){
          console.error("artistMode signOut admin session timeout/error",err);
        }
        currentUser=null;
        currentProfile=null;
      }
      const viewerReady=await ensureArtistViewerSession();
      if(!viewerReady){
        console.warn("Artist login berhasil, tetapi sesi viewer untuk akses PDF belum siap.");
      }
      setLoginStatus("PIN valid. Menyiapkan dashboard artist...","success");
    }
    setSessionValue(SESSION_ROLE,role);
    closeLogin(true);
    renderAll();
    switchPage("landing");
    void hydrateAfterLogin();
  }catch(err){
    console.error("loginTools unexpected error",err);
    alert(`Terjadi error saat login: ${err?.message||err}`);
  }finally{
    setLoginBusy(false);
    authInProgress=false;
  }
}
const APP_PAGES=["landing","portal","admin","payroll","setup","data"];
function normalizeAppPage(page){
  const raw=String(page||"landing").replace(/^#/,"").trim();
  let next=APP_PAGES.includes(raw)?raw:"landing";
  if(["admin","data","payroll","setup"].includes(next)&&role==="artist") next="landing";
  return next;
}
function pageFromLocation(){
  return normalizeAppPage(window.location.hash||"landing");
}
function updatePageHistory(page,replace=false){
  if(!window.history?.pushState) return;
  const url=new URL(window.location.href);
  url.hash=page;
  const state={page};
  if(replace) window.history.replaceState(state,"",url);
  else if(window.location.hash!==`#${page}`) window.history.pushState(state,"",url);
}
function renderActivePage(page=activePage){
  const next=normalizeAppPage(page);
  if(next==="landing") renderLanding();
  if(next==="portal") renderPortal();
  if(next==="admin") renderAdmin();
  if(next==="payroll") renderTeamPayroll();
  if(next==="setup") renderSetup();
  if(next==="data") renderDataStatus();
}
function switchPage(page,options={}){
  page=normalizeAppPage(page);
  activePage=page;
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById(`page-${page}`)?.classList.add("active");
  document.querySelectorAll(".nav").forEach(n=>{
    const active=n.dataset.nav===page;
    n.classList.toggle("bg-slate-700",active);
    n.classList.toggle("nav-active",active);
  });
  renderActivePage(page);
  if(options.updateHistory!==false) updatePageHistory(page,Boolean(options.replaceHistory));
}
function renderSummary(rows){
  const counts={
    aktif:rows.length,
    submit:rows.filter(j=>j.a.workStatus==="Submitted").length,
    approved:rows.filter(j=>["Approved","Payable","Paid"].includes(j.a.workStatus||"")).length,
    dep:rows.filter(isDependency).length,
    kendala:rows.filter(j=>["Blocked","Revision Hold"].includes(j.a.workStatus)).length
  };
  document.getElementById("summary").innerHTML=[
    ["Total Aktif",counts.aktif,"text-teal-300"],
    ["Menunggu Admin",counts.submit,"text-sky-300"],
    ["Sudah Approved",counts.approved,"text-emerald-300"],
    ["Dependency",counts.dep,"text-purple-300"],
    ["Kendala",counts.kendala,"text-red-300"]
  ].map(x=>`<div class="glass rounded-xl p-4"><p class="mono text-[10px] text-slate-400">${x[0].toUpperCase()}</p><h3 class="text-2xl font-bold mono ${x[2]}">${x[1]}</h3></div>`).join("");
}
function renderLandingGroupCard(name,items){
  return `
    <div class="glass rounded-2xl overflow-hidden self-start">
      <div class="p-4 bg-slate-950/30 border-b border-white/10 flex justify-between"><div><p class="mono text-[10px] text-teal-300">ARTIST</p><h3 class="text-xl font-bold text-teal-100">${esc(name)}</h3></div><p class="mono font-bold">${items.length} job</p></div>
      <div class="divide-y divide-white/10">${items.map(jobCompact).join("")}</div>
    </div>`;
}
function renderLanding(){
  const q=(document.getElementById("search")?.value||"").toLowerCase();
  let rows=visibleJobs().filter(j=>[j.p.client,j.p.name,j.a.workerName,artistName(j.a.artistId),workerDisplayName(j.a),j.a.role].join(" ").toLowerCase().includes(q));
  const activeFilter=normalizeLandingFilter(landingFilter);
  if(activeFilter==="submitted"){
    rows=rows.filter(j=>String(j.a.workStatus||"")==="Submitted");
  }else if(activeFilter==="approved"){
    rows=rows.filter(j=>["Approved","Payable","Paid"].includes(String(j.a.workStatus||"")));
  }else if(activeFilter==="dependency"){
    rows=rows.filter(isDependency);
  }else if(activeFilter==="issue"){
    rows=rows.filter(j=>["Blocked","Revision Hold","Waiting Client"].includes(String(j.a.workStatus||"")));
  }
  const unreadAllocations=unreadVisibleAllocationSet();
  const order={revision:0,progress:1,ready:2,submitted:3,blocked:4,dependency:5,waitlist:6,payroll:7};
  rows=rows
    .map(j=>({...j,key:statusKey(j),hasUpdate:unreadAllocations.has(String(j.a.id||""))}))
    .sort((a,b)=>{
      const dueA=String(a.a.targetDoneDate||a.p.deadline||"9999-12-31");
      const dueB=String(b.a.targetDoneDate||b.p.deadline||"9999-12-31");
      const dueCmp=dueA.localeCompare(dueB);
      if(dueCmp) return dueCmp;
      const depCmp=(a.key==="dependency"?1:0)-(b.key==="dependency"?1:0);
      if(depCmp) return depCmp;
      const statusCmp=(order[a.key]??9)-(order[b.key]??9);
      if(statusCmp) return statusCmp;
      return workerDisplayName(a.a).localeCompare(workerDisplayName(b.a),"id",{sensitivity:"base"});
    });
  renderLandingFilterChips();
  renderSummary(rows);
  const grouped={};
  rows.forEach(j=>{ const name=workerDisplayName(j.a); grouped[name]=grouped[name]||[]; grouped[name].push(j); });
  const sortedGroups=Object.entries(grouped).sort(([nameA,itemsA],[nameB,itemsB])=>{
    const unassignedA=nameA.toLowerCase().startsWith("unassigned");
    const unassignedB=nameB.toLowerCase().startsWith("unassigned");
    if(unassignedA!==unassignedB) return unassignedA?1:-1;
    const roleA=Math.min(...itemsA.map(job=>roleSortRank(job?.a?.role)));
    const roleB=Math.min(...itemsB.map(job=>roleSortRank(job?.a?.role)));
    if(roleA!==roleB) return roleA-roleB;
    return nameA.localeCompare(nameB,"id",{sensitivity:"base"});
  });
  const board=document.getElementById("landing-board");
  if(!board) return;
  if(!rows.length){
    board.innerHTML=`<div class="glass rounded-2xl p-8 text-center text-slate-400">Belum ada pekerjaan aktif.</div>`;
    return;
  }
  const groups=sortedGroups.map(([name,items])=>({name,items}));
  board.innerHTML=`<div class="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">${groups.map(group=>renderLandingGroupCard(group.name,group.items)).join("")}</div>`;
}
function jobCompact(j){
  const hasUpdate=Boolean(j.hasUpdate);
  const focused=isFocusedAllocation(j.a.id);
  const showDeadline=!["Payable","Paid"].includes(j.a.workStatus);
  const rowClass=`job-row job-row-link p-3${hasUpdate?" job-row-update":""}${focused?" job-target-highlight":""}`;
  return `<div class="${rowClass}" role="button" tabindex="0" onclick="openJobFromLanding('${j.a.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openJobFromLanding('${j.a.id}')}">
    <div class="flex justify-between gap-3"><div class="min-w-0">${statusPill(j.key)}${hasUpdate?` <span class="pill job-update-pill">Update Baru</span>`:""}<h4 class="font-bold mt-2 truncate">${esc(j.p.client)}</h4><p class="text-slate-400 text-xs truncate">${esc(j.p.name)} - ${esc(j.a.role)}</p></div>${showDeadline?deadlineChip(j.a.targetDoneDate||j.p.deadline):""}</div>
    <div class="mt-2 flex justify-between text-xs text-slate-400"><span>${esc(j.a.workStatus||"Booked")}</span><b class="text-white">${autoProgress(j)}%</b></div>
    <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1"><div class="h-full bg-teal-400" style="width:${autoProgress(j)}%"></div></div>
    <div class="mt-2 flex gap-2">${j.a.submissionType?`<span class="text-xs text-slate-400 py-2">Tipe: ${j.a.submissionType==='progress'?'Progress':'Final'}</span>`:''}<button onclick="event.stopPropagation();openBrief('${j.p.id}')" class="btn py-2 text-xs">Brief</button></div>
  </div>`;
}
function isFocusedAllocation(allocationId){
  return Boolean(focusedAllocationId&&String(allocationId||"")===focusedAllocationId);
}
function highlightAllocationTarget(allocationId){
  focusedAllocationId=String(allocationId||"").trim();
  if(!focusedAllocationId) return;
  if(focusedAllocationClearTimer) clearTimeout(focusedAllocationClearTimer);
  focusedAllocationClearTimer=setTimeout(()=>{
    focusedAllocationId="";
    renderAll();
  },9000);
}
function openJobFromLanding(allocId,fromNotification=false){
  const targetId=String(allocId||"").trim();
  if(!targetId) return;
  markAllocationNotificationsRead(targetId);
  renderNotifBell();
  renderNotifList();
  highlightAllocationTarget(targetId);
  renderAll();
  const canOpenAdmin=role==="admin"&&isVerifiedAdmin();
  if(canOpenAdmin){
    switchPage("admin");
    setTimeout(()=>document.getElementById(`admin-job-${targetId}`)?.scrollIntoView({behavior:"smooth",block:"center"}),70);
    return;
  }
  switchPage("portal");
  setTimeout(()=>document.getElementById(`job-${targetId}`)?.scrollIntoView({behavior:"smooth",block:"center"}),70);
}
function renderPortal(){
  const isAdminViewer=role==="admin"&&currentProfile?.role==="admin";
  const query=(document.getElementById("portal-search")?.value||"").trim().toLowerCase();
  let rows=visibleJobs().filter(j=>(j.a.workStatus||"Booked")!=="Paid");
  if(isAdminViewer&&query){
    rows=rows.filter(j=>{
      const text=[
        j.p.client,
        j.p.name,
        j.a.workerName,
        artistName(j.a.artistId),
        workerDisplayName(j.a),
        j.a.role,
        j.a.workStatus
      ].join(" ").toLowerCase();
      return text.includes(query);
    });
  }
  document.getElementById("portal-board").innerHTML=rows.length
    ?`<div class="space-y-4">${rows.map(jobPortal).join("")}</div>`
    :`<div class="glass rounded-2xl p-8 text-slate-400">${isAdminViewer&&query?"Tidak ada pekerjaan yang cocok dengan pencarian admin.":"Tidak ada pekerjaan untuk akun ini."}</div>`;
}
function jobPortal(j){
  const locked=isDependency(j)||["Approved","Payable","Paid"].includes(j.a.workStatus);
  const finished=["Approved","Payable","Paid"].includes(j.a.workStatus);
  const showDeadline=!finished;
  const hasUpdate=hasUnreadAllocationUpdate(j.a.id);
  const highlight=isFocusedAllocation(j.a.id);
  const revisionReason=getAdminRevisionReason(j.a);
  return `<div id="job-${j.a.id}" class="glass rounded-2xl p-5 ${hasUpdate?"job-card-update":""} ${highlight?"job-target-highlight":""}">
    <div class="flex flex-col xl:flex-row xl:justify-between gap-4"><div>${statusPill(statusKey(j))}<h3 class="text-xl font-bold mt-3">${esc(j.p.client)}</h3><p class="text-slate-400">${esc(j.p.name)} - ${esc(j.a.role)} - ${esc(workerDisplayName(j.a))}</p></div>${showDeadline?deadlineChip(j.a.targetDoneDate||j.p.deadline):""}</div>
    <div class="mt-4 p-4 rounded-xl bg-slate-900 border border-white/10"><p class="font-semibold">${finished?"Sudah dikunci admin":locked&&isDependency(j)?"Terkunci dependency":j.a.workStatus==="Submitted"?"Menunggu admin":j.a.workStatus==="Revision Hold"?"Revisi diminta admin":"Bisa diupdate"}</p><p class="text-slate-400 text-sm mt-1">${finished?"Pekerjaan sudah approved/payroll. Artist tidak bisa mengubah status lagi.":locked&&isDependency(j)?"Tunggu pekerjaan sebelumnya minimal berstatus In Progress.":j.a.workStatus==="Revision Hold"?"Baca feedback admin, perbaiki file, lalu submit ulang.":"Update tanggal selesai, link kerja, atau catatan update jika sudah dicek."}</p></div>
    ${j.a.workStatus==="Revision Hold"&&revisionReason?`<div class="mt-3 rounded-xl border border-red-300/45 bg-red-500/15 p-3"><p class="mono text-[10px] text-red-100">CATATAN REVISI ADMIN</p><p class="text-sm text-red-50 mt-1">${esc(revisionReason)}</p></div>`:""}
    <div class="mt-4 flex flex-wrap gap-2">
      ${finished?"":`<button ${locked?"disabled":""} onclick="quick('${j.p.id}','${j.a.id}','In Progress')" class="btn ${j.a.workStatus==="In Progress"?"primary":""}">${j.a.workStatus==="Revision Hold"?"Mulai Revisi":"Mulai Kerja"}</button>
      <button ${locked?"disabled":""} onclick="submitJob('${j.p.id}','${j.a.id}')" class="btn ${j.a.workStatus==="Submitted"?"primary":""}">${j.a.workStatus==="Revision Hold"?"Submit Revisi":"Submit ke Admin"}</button>
      <button ${locked?"disabled":""} onclick="quick('${j.p.id}','${j.a.id}','Blocked')" class="btn danger">Ada Kendala</button>`}
      <button onclick="openBrief('${j.p.id}')" class="btn">Lihat Brief</button>
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-4">
      <input ${locked?"disabled":""} type="date" value="${esc(j.a.doneDate||"")}" onchange="updateJob('${j.p.id}','${j.a.id}','doneDate',this.value)" class="bg-slate-800 p-3 rounded-xl text-sm">
      <input ${locked?"disabled":""} value="${esc(j.a.submissionLink||"")}" onchange="updateJob('${j.p.id}','${j.a.id}','submissionLink',this.value)" class="bg-slate-800 p-3 rounded-xl text-sm xl:col-span-2" placeholder="Link hasil kerja">
      <input ${locked?"disabled":""} value="${esc(j.a.artistUpdateNote||"")}" onchange="updateJob('${j.p.id}','${j.a.id}','artistUpdateNote',this.value)" class="bg-slate-800 p-3 rounded-xl text-sm xl:col-span-3" placeholder="Catatan update">
      <input ${locked?"disabled":""} value="${esc(getArtistHoldReason(j.a))}" onchange="updateJob('${j.p.id}','${j.a.id}','artistHoldReason',this.value)" class="bg-slate-800 p-3 rounded-xl text-sm xl:col-span-3" placeholder="Kendala / alasan hold (artist)">
    </div>
  </div>`;
}
function changeProjectPackage(pid){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengganti paket project.")) return;
  const project=projectById(pid);
  if(!project){ alert("Project tidak ditemukan."); return; }
  const options=listPackageTypes(project.packageType||"");
  const selectedRaw=prompt(
    `Ganti paket untuk ${project.client} - ${project.name}\nPilih salah satu: ${options.join(", ")}`,
    project.packageType||"Standard"
  );
  if(selectedRaw===null) return;
  const selected=String(selectedRaw).trim();
  if(!selected){ alert("Paket tidak boleh kosong."); return; }
  if(!Object.prototype.hasOwnProperty.call(packageTemplates,selected)){
    alert(`Paket "${selected}" tidak tersedia di template setup.`);
    return;
  }
  const resetSplit=confirm("OK: ganti paket + reset worker split sesuai template baru.\nCancel: ganti nama paket saja tanpa reset split.");
  project.packageType=selected;
  if(resetSplit){
    project.allocations=buildAllocationsFromTemplate(selected,project.deadline,project.allocations||[]);
  }
  saveData();
  renderAll();
  alert(`Paket project berhasil diubah ke ${selected}.`);
}
function syncAdminBulkSelection(rows){
  const validIds=new Set((rows||[]).map(j=>String(j?.a?.id||"")).filter(Boolean));
  adminBulkSelectedAllocationIds=new Set([...adminBulkSelectedAllocationIds].filter(id=>validIds.has(id)));
  adminBulkViewAllocationIds=[...validIds];
}
function isAdminTaskSelected(allocationId){
  return adminBulkSelectedAllocationIds.has(String(allocationId||""));
}
function toggleAdminTaskSelection(allocationId,isChecked){
  if(!isVerifiedAdmin()) return;
  const key=String(allocationId||"").trim();
  if(!key) return;
  if(isChecked) adminBulkSelectedAllocationIds.add(key);
  else adminBulkSelectedAllocationIds.delete(key);
  renderAdmin();
}
function clearAdminBulkSelection(){
  adminBulkSelectedAllocationIds.clear();
  renderAdmin();
}
function toggleAdminBulkSelectAll(){
  if(!isVerifiedAdmin()) return;
  const viewIds=(adminBulkViewAllocationIds||[]).filter(Boolean);
  if(!viewIds.length) return;
  const allSelected=viewIds.every(id=>adminBulkSelectedAllocationIds.has(id));
  if(allSelected){
    viewIds.forEach(id=>adminBulkSelectedAllocationIds.delete(id));
  }else{
    viewIds.forEach(id=>adminBulkSelectedAllocationIds.add(id));
  }
  renderAdmin();
}
function renderAdminBulkTools(rows){
  const box=document.getElementById("admin-bulk-tools");
  if(!box) return;
  if(!isVerifiedAdmin()){
    box.classList.add("hidden");
    box.innerHTML="";
    return;
  }
  syncAdminBulkSelection(rows);
  const selectedCount=adminBulkSelectedAllocationIds.size;
  const totalRows=(rows||[]).length;
  const allSelected=totalRows>0&&selectedCount===totalRows;
  box.classList.remove("hidden");
  box.innerHTML=`
    <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
      <div>
        <p class="mono text-[10px] tracking-widest text-amber-300">BULK ACTION</p>
        <p class="text-sm text-slate-300">Terpilih <b>${selectedCount}</b> dari <b>${totalRows}</b> task.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button onclick="toggleAdminBulkSelectAll()" class="btn text-xs">${allSelected?"Unselect Semua":"Pilih Semua Hasil Filter"}</button>
        <button onclick="clearAdminBulkSelection()" class="btn text-xs">Reset</button>
        <button onclick="applyBulkStatus('Approved')" class="primary btn text-xs" ${selectedCount?"" :"disabled"}>Approve</button>
        <button onclick="applyBulkStatus('Payable')" class="btn text-xs" ${selectedCount?"" :"disabled"}>Payable</button>
        <button onclick="applyBulkStatus('Blocked')" class="danger btn text-xs" ${selectedCount?"" :"disabled"}>Tahan</button>
        <button onclick="bulkDeleteApprovedProjectsFromSelection()" class="danger btn text-xs" ${selectedCount?"" :"disabled"}>Hapus Project Approved</button>
      </div>
    </div>
  `;
}
function applyBulkStatus(status){
  if(!requireVerifiedAdmin("Bulk action hanya untuk admin.")) return;
  const selectedRows=allJobs().filter(j=>adminBulkSelectedAllocationIds.has(String(j?.a?.id||"")));
  if(!selectedRows.length){ alert("Belum ada task yang dipilih."); return; }
  let updated=0;
  let skipped=0;
  let blocked=0;
  for(const job of selectedRows){
    const current=String(job.a.workStatus||"Booked");
    if(current===status){ skipped+=1; continue; }
    if(["In Progress","Submitted"].includes(status)&&isDependency(job)){ blocked+=1; continue; }
    if(["Approved","Payable","Paid"].includes(status)&&isApprovalDependencyLocked(job)){ blocked+=1; continue; }
    job.a.workStatus=status;
    if(status==="In Progress"&&!job.a.startDate) job.a.startDate=today();
    if(["Submitted","Approved"].includes(status)&&!job.a.doneDate) job.a.doneDate=today();
    if(status==="Paid"&&!job.a.paidDate) job.a.paidDate=today();
    if(["Approved","Payable"].includes(status)) job.a.paidDate="";
    job.a.lastArtistUpdate=new Date().toISOString();
    notifyArtistAboutAdminAction(job,{previousStatus:current});
    updated+=1;
  }
  if(updated>0){
    adminBulkSelectedAllocationIds.clear();
    saveData();
    renderAll();
  }else{
    renderAdmin();
  }
  alert(`Bulk ${status} selesai. Berhasil: ${updated}, dilewati: ${skipped}, terkunci: ${blocked}.`);
}
function isProjectApprovedForCleanup(project){
  const allocations=Array.isArray(project?.allocations)?project.allocations:[];
  if(!allocations.length) return false;
  return allocations.every(a=>["Approved","Payable","Paid"].includes(String(a?.workStatus||"")));
}
async function bulkDeleteApprovedProjectsFromSelection(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh hapus project bulk.")) return;
  const selectedRows=allJobs().filter(j=>adminBulkSelectedAllocationIds.has(String(j?.a?.id||"")));
  if(!selectedRows.length){ alert("Belum ada task yang dipilih."); return; }
  const projectIds=[...new Set(selectedRows.map(j=>String(j?.p?.id||"")).filter(Boolean))];
  const deletable=[];
  const blocked=[];
  for(const pid of projectIds){
    const project=projectById(pid);
    if(!project) continue;
    if(isProjectApprovedForCleanup(project)) deletable.push(project);
    else blocked.push(project);
  }
  if(!deletable.length){
    alert("Tidak ada project terpilih yang sepenuhnya Approved/Payable/Paid.");
    return;
  }
  const preview=deletable.slice(0,3).map(p=>`${p.client} - ${p.name}`).join(", ");
  const warnBlocked=blocked.length?`\n${blocked.length} project lain tidak ikut dihapus karena belum fully approved.`:"";
  if(!confirm(`Hapus ${deletable.length} project approved terpilih?${preview?`\nContoh: ${preview}`:""}${warnBlocked}`)) return;
  let cleanup={deleted:0};
  try{
    cleanup=await deleteProjectsPdfFiles(deletable);
  }catch(err){
    console.error("bulkDeleteApprovedProjects PDF cleanup error",err);
    alert(`Gagal menghapus PDF project dari Supabase Storage: ${err?.message||err}`);
    return;
  }
  const deleteIds=new Set(deletable.map(p=>p.id));
  data.projects=(data.projects||[]).filter(p=>!deleteIds.has(p.id));
  adminBulkSelectedAllocationIds.clear();
  saveData();
  renderAll();
  alert(`Berhasil menghapus ${deletable.length} project approved.${cleanup.deleted?` PDF terhapus: ${cleanup.deleted}.`:""}`);
}
function adminActionButtons(j){
  const locked=isApprovalDependencyLocked(j);
  const lockMsg=locked?`<span class="pill dep">Tidak bisa approve: dependency approval belum terpenuhi</span>`:"";
  const canEditRevision=j.a.workStatus==="Revision Hold";
  const isProgressSubmission=j.a.submissionType==="progress"&&j.a.workStatus==="Submitted";
  return `<div class="flex flex-wrap gap-2 mt-3">
    ${locked?`<button disabled class="btn opacity-50 cursor-not-allowed">Approve terkunci</button>`:`<button onclick="quick('${j.p.id}','${j.a.id}','Approved')" class="primary btn">Approve</button><button onclick="quick('${j.p.id}','${j.a.id}','Payable')" class="btn">Payable</button>`}
    ${isProgressSubmission?`<button onclick="returnToProgress('${j.p.id}','${j.a.id}')" class="btn bg-blue-900/50 border-blue-500/50">Return ke Progress</button>`:""}
    <button onclick="requestRevision('${j.p.id}','${j.a.id}')" class="btn">Minta Revisi</button>
    ${canEditRevision?`<button onclick="editRevisionReason('${j.p.id}','${j.a.id}')" class="btn">Ubah Alasan Revisi</button>`:""}
    <button onclick="quick('${j.p.id}','${j.a.id}','Blocked')" class="danger btn">Tahan</button>
    <button onclick="changeProjectPackage('${j.p.id}')" class="btn">Ganti Paket</button>
    <button onclick="editTeamProject('${j.p.id}')" class="btn">Edit Project</button>
    <button onclick="deleteTeamProject('${j.p.id}')" class="danger btn">Hapus Project</button>
    ${lockMsg}
  </div>`;
}
function adminJobCard(j){
  const hasUpdate=hasUnreadAllocationUpdate(j.a.id);
  const highlight=isFocusedAllocation(j.a.id);
  const selected=isAdminTaskSelected(j.a.id);
  const revisionReason=getAdminRevisionReason(j.a)||"Belum ada alasan revisi dari admin.";
  const artistNotes=j.a.artistUpdateNote||getArtistHoldReason(j.a)||"Belum ada catatan artist.";
  const revisionBox=j.a.workStatus==="Revision Hold"
    ?`<div class="mt-3 rounded-xl border border-red-300/45 bg-red-500/15 p-3">
        <p class="mono text-[10px] text-red-100">ALASAN REVISI ADMIN</p>
        <p class="text-red-50 text-sm mt-1">${esc(revisionReason)}</p>
      </div>`
    :"";
  const showDeadline=!["Payable","Paid"].includes(j.a.workStatus);
  return `<div id="admin-job-${j.a.id}" class="glass rounded-2xl p-4 ${hasUpdate?"job-card-update":""} ${highlight?"job-target-highlight":""}">
    <div class="flex flex-col xl:flex-row xl:justify-between gap-4"><div><label class="inline-flex items-center gap-2 text-[11px] text-slate-300 mb-2"><input type="checkbox" ${selected?"checked":""} onchange="toggleAdminTaskSelection('${j.a.id}',this.checked)"><span>Pilih bulk</span></label>${statusPill(statusKey(j))}<h3 class="font-bold text-lg mt-2">${esc(workerDisplayName(j.a))} / ${esc(j.a.role)}</h3><p class="text-slate-400 text-sm">${esc(j.p.client)} - ${esc(j.p.name)}</p></div>${showDeadline?deadlineChip(j.a.targetDoneDate||j.p.deadline):""}</div>
    ${isApprovalDependencyLocked(j)?`<div class="mt-3 p-3 rounded-xl border border-purple-400/30 bg-purple-500/10 text-sm text-purple-100">Approval masih terkunci dependency. Artist boleh lanjut kerja setelah task sebelumnya In Progress, tetapi approve tetap menunggu status Approved / Payable / Paid pada task sebelumnya.</div>`:""}
    ${revisionBox}
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3"><p class="bg-slate-900 rounded-xl p-3 text-sm xl:col-span-2">${esc(artistNotes)}</p><p class="bg-slate-900 rounded-xl p-3 text-sm">${j.a.submissionLink?`<a class="text-sky-300" target="_blank" href="${esc(j.a.submissionLink)}">Buka link submit</a>`:"Belum ada link."}</p></div>
    ${adminActionButtons(j)}
  </div>`;
}
function renderAdmin(){
  const isVerifiedAdmin=role==="admin"&&currentProfile?.role==="admin";
  if(role==="artist"||!isVerifiedAdmin){
    adminBulkSelectedAllocationIds.clear();
    renderAdminBulkTools([]);
    document.getElementById("admin-board").innerHTML=`<div class="glass rounded-2xl p-8 text-slate-400">${role==="artist"?"Admin Monitor hanya untuk Admin / Operator.":"Silakan login sebagai admin untuk akses Admin Monitor."}</div>`;
    return;
  }
  const filter=document.getElementById("admin-filter")?.value||"All";
  const query=(document.getElementById("admin-search")?.value||"").trim().toLowerCase();
  const rows=allJobs().filter(j=>{
    if(filter!=="All"&&j.a.workStatus!==filter) return false;
    if(!query) return true;
    const text=[
      j.p.client,
      j.p.name,
      j.a.workerName,
      artistName(j.a.artistId),
      workerDisplayName(j.a),
      j.a.role
    ].join(" ").toLowerCase();
    return text.includes(query);
  });
  renderAdminBulkTools(rows);
  if(!rows.length){
    document.getElementById("admin-board").innerHTML=`<div class="glass rounded-2xl p-8 text-slate-400">Tidak ada pekerjaan untuk filter ini.</div>`;
    return;
  }
  const clientGroups=new Map();
  for(const job of rows){
    const clientName=String(job?.p?.client||"Tanpa Client").trim()||"Tanpa Client";
    if(!clientGroups.has(clientName)) clientGroups.set(clientName,new Map());
    const projectKey=String(job?.p?.id||`${clientName}::${job?.p?.name||"Project"}`);
    const projectMap=clientGroups.get(clientName);
    if(!projectMap.has(projectKey)){
      projectMap.set(projectKey,{project:job.p,jobs:[]});
    }
    projectMap.get(projectKey).jobs.push(job);
  }
  const clientEntries=[...clientGroups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  document.getElementById("admin-board").innerHTML=`<div class="space-y-4">${clientEntries.map(([clientName,projectMap])=>{
    const projects=[...projectMap.values()];
    const projectCount=projects.length;
    const taskCount=projects.reduce((total,item)=>total+item.jobs.length,0);
    return `<div class="glass rounded-2xl overflow-hidden">
      <div class="p-4 border-b border-white/10 bg-slate-950/30">
        <p class="mono text-[10px] tracking-widest text-amber-300">FOLDER CLIENT</p>
        <h3 class="text-xl font-bold mt-1">${esc(clientName)}</h3>
        <p class="text-slate-400 text-xs mt-1">${projectCount} project / ${taskCount} task</p>
      </div>
      <div class="p-3 space-y-3">${projects.map(item=>{
        const projectName=String(item?.project?.name||"Tanpa Nama Project");
        const projectPlatform=String(item?.project?.platform||"Direct");
        const hasProgressSubmission=item.jobs.some(j=>j.a.submissionType==="progress"&&j.a.workStatus==="Submitted");
    return `<div class="bg-slate-900 rounded-xl p-3 ${hasProgressSubmission?'border border-blue-500/50 bg-slate-900/80':''}">\n          <div class="flex items-center justify-between gap-2 border-b border-white/10 pb-2 mb-3">
            <div>
              <p class="mono text-[10px] text-slate-400">PROJECT ${hasProgressSubmission?'<span class="text-blue-400">⏳ PROGRESS WAITING</span>':''}</p>
              <h4 class="font-bold">${esc(projectName)}</h4>
              <p class="text-[11px] text-slate-400 mt-1">Platform: <b class="text-slate-200">${esc(projectPlatform)}</b></p>
            </div>
            <div class="flex items-center gap-2">
              <span class="pill admin">${esc(projectPlatform)}</span>
              <span class="pill warn">${item.jobs.length} task</span>
              ${hasProgressSubmission?`<span class="pill" style="background:rgba(59,130,246,0.3); color:#3b82f6; border:1px solid rgba(59,130,246,0.5)">📋 Progress</span>`:""}
            </div>
          </div>
          <div class="space-y-3">${item.jobs.map(adminJobCard).join("")}</div>
        </div>`;
      }).join("")}</div>
    </div>`;
  }).join("")}</div>`;
}
function payrollMonthForAllocation(allocation){
  return monthKeyFromDate(allocation?.payableDate||"");
}
function payrollDateLabel(allocation){
  const payableDate=String(allocation?.payableDate||"").trim();
  return payableDate?fmt(payableDate):"Belum ditentukan";
}
function setPayrollMonthFilter(value){
  payrollMonthFilter=isMonthKey(value)?value:"all";
  payrollArtistSummaryOpen=false;
  payrollSelectedAllocationIds.clear();
  renderTeamPayroll();
}
function setPayrollStatusFilter(value){
  const next=String(value||"All");
  payrollStatusFilter=["All","Approved","Payable","Paid"].includes(next)?next:"All";
  payrollSelectedAllocationIds.clear();
  renderTeamPayroll();
}
function setPayrollSearch(value){
  payrollSearch=String(value||"");
  const shouldRefocus=document.activeElement?.id==="payroll-search";
  renderTeamPayroll();
  if(shouldRefocus){
    const input=document.getElementById("payroll-search");
    if(input){
      input.focus();
      input.setSelectionRange(input.value.length,input.value.length);
    }
  }
}
function setPayrollTargetMonth(value){
  payrollTargetMonth=isMonthKey(value)?value:currentMonthKey();
}
function syncPayrollSelection(rows){
  const validIds=new Set((rows||[]).map(j=>String(j?.a?.id||"")).filter(Boolean));
  payrollSelectedAllocationIds=new Set([...payrollSelectedAllocationIds].filter(id=>validIds.has(id)));
  payrollViewAllocationIds=[...validIds];
}
function isPayrollTaskSelected(allocationId){
  return payrollSelectedAllocationIds.has(String(allocationId||""));
}
function togglePayrollTaskSelection(allocationId,isChecked){
  if(!isVerifiedAdmin()) return;
  const key=String(allocationId||"").trim();
  if(!key) return;
  if(isChecked) payrollSelectedAllocationIds.add(key);
  else payrollSelectedAllocationIds.delete(key);
  renderTeamPayroll();
}
function clearPayrollSelection(){
  payrollSelectedAllocationIds.clear();
  renderTeamPayroll();
}
function togglePayrollArtistSummary(){
  payrollArtistSummaryOpen=!payrollArtistSummaryOpen;
  renderTeamPayroll();
}
function togglePayrollSelectAll(){
  if(!isVerifiedAdmin()) return;
  const viewIds=(payrollViewAllocationIds||[]).filter(Boolean);
  if(!viewIds.length) return;
  const allSelected=viewIds.every(id=>payrollSelectedAllocationIds.has(id));
  if(allSelected){
    viewIds.forEach(id=>payrollSelectedAllocationIds.delete(id));
  }else{
    viewIds.forEach(id=>payrollSelectedAllocationIds.add(id));
  }
  renderTeamPayroll();
}
function selectedPayrollRows(){
  return allJobs().filter(j=>payrollSelectedAllocationIds.has(String(j?.a?.id||"")));
}
function applyPayrollMonthToSelection(){
  if(!requireVerifiedAdmin("Bulk payable hanya untuk admin.")) return;
  const inputMonth=document.getElementById("payroll-target-month")?.value||payrollTargetMonth||currentMonthKey();
  if(!isMonthKey(inputMonth)){
    alert("Pilih bulan payable terlebih dahulu.");
    return;
  }
  setPayrollTargetMonth(inputMonth);
  const selectedRows=selectedPayrollRows();
  if(!selectedRows.length){
    alert("Pilih minimal satu task payroll.");
    return;
  }
  const payableDate=monthEndDate(inputMonth);
  let updated=0;
  let blocked=0;
  let skipped=0;
  for(const job of selectedRows){
    const status=String(job?.a?.workStatus||"Booked");
    if(!["Approved","Payable","Paid"].includes(status)){ skipped+=1; continue; }
    if(isApprovalDependencyLocked(job)){ blocked+=1; continue; }
    const previousStatus=String(job.a.workStatus||"Booked");
    job.a.workStatus="Payable";
    if(!job.a.doneDate) job.a.doneDate=today();
    job.a.payableDate=payableDate;
    job.a.paidDate="";
    job.a.lastArtistUpdate=new Date().toISOString();
    notifyArtistAboutAdminAction(job,{previousStatus,force:true});
    updated+=1;
  }
  if(updated>0){
    payrollSelectedAllocationIds.clear();
    saveData();
    renderAll();
  }else{
    renderTeamPayroll();
  }
  alert(`Set Payable ${monthLabel(inputMonth)} selesai. Berhasil: ${updated}, dilewati: ${skipped}, terkunci: ${blocked}.`);
}
function setPayrollPayableMonth(pid,aid,month){
  if(!requireVerifiedAdmin("Bulan payable hanya bisa diubah admin.")) return;
  if(!isMonthKey(month)){
    alert("Pilih bulan payable yang valid.");
    renderTeamPayroll();
    return;
  }
  const p=projectById(pid), a=p&&allocationById(p,aid);
  if(!a) return;
  const job={p,a};
  if(!["Approved","Payable","Paid"].includes(String(a.workStatus||""))){
    alert("Task ini belum masuk payroll.");
    renderTeamPayroll();
    return;
  }
  if(isApprovalDependencyLocked(job)){
    alert("Task ini masih terkunci dependency approval.");
    renderTeamPayroll();
    return;
  }
  const previousStatus=String(a.workStatus||"Booked");
  a.workStatus="Payable";
  if(!a.doneDate) a.doneDate=today();
  a.payableDate=monthEndDate(month);
  a.paidDate="";
  a.lastArtistUpdate=new Date().toISOString();
  notifyArtistAboutAdminAction(job,{previousStatus,force:true});
  saveData();
  renderAll();
}
function collectPayrollValidationIssues(rows){
  const issues=[];
  for(const job of rows||[]){
    const status=String(job?.a?.workStatus||"");
    const month=payrollMonthForAllocation(job.a);
    const payableDate=String(job?.a?.payableDate||"").trim();
    const context=`${workerDisplayName(job.a)} - ${job.p?.client||"-"} - ${job.p?.name||"-"}`;
    const base={pid:String(job?.p?.id||""),aid:String(job?.a?.id||""),context};
    if(!month){
      issues.push({
        ...base,
        severity:status==="Approved"?"warn":"bad",
        title:`${status||"Task"} belum punya bulan payable`,
        detail:"Task ini tidak akan masuk export payroll bulanan sampai bulan payable diisi.",
        action:"setMonth"
      });
    }else if(payableDate&&payableDate!==monthEndDate(month)){
      issues.push({
        ...base,
        severity:"warn",
        title:"Tanggal payable tidak standar",
        detail:`Tanggal saat ini ${fmt(payableDate)}. Standar payroll memakai akhir bulan ${monthLabel(month)}.`
      });
    }
    if(status==="Paid"&&!String(job?.a?.paidDate||"").trim()){
      issues.push({
        ...base,
        severity:"warn",
        title:"Paid belum punya tanggal bayar",
        detail:"Status sudah Paid, tapi paidDate masih kosong."
      });
    }
    if(isApprovalDependencyLocked(job)){
      issues.push({
        ...base,
        severity:"bad",
        title:"Dependency approval belum aman",
        detail:"Task sudah masuk payroll, tapi pekerjaan dependency belum Approved / Payable / Paid."
      });
    }
  }
  return issues;
}
function payrollValidationIssueRow(issue){
  const tone=issue.severity==="bad"?"border-red-400/40 bg-red-500/10":"border-amber-400/35 bg-amber-500/10";
  const titleTone=issue.severity==="bad"?"text-red-200":"text-amber-200";
  const setMonthButton=issue.action==="setMonth"
    ?`<button onclick="setPayrollPayableMonth('${issue.pid}','${issue.aid}',document.getElementById('payroll-target-month')?.value||payrollTargetMonth||currentMonthKey())" class="btn text-[11px]">Set Payable</button>`
    :"";
  return `<div class="rounded-xl border ${tone} p-3">
    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
      <div>
        <p class="font-semibold ${titleTone} text-sm">${esc(issue.title)}</p>
        <p class="text-xs text-slate-300 mt-1">${esc(issue.context)}</p>
        <p class="text-xs text-slate-400 mt-1">${esc(issue.detail)}</p>
      </div>
      <div class="flex gap-2 shrink-0">
        ${setMonthButton}
        <button onclick="openJobFromLanding('${issue.aid}')" class="btn text-[11px]">Buka</button>
      </div>
    </div>
  </div>`;
}
function renderPayrollValidationPanel(issues){
  const list=issues||[];
  const visible=list.slice(0,5);
  const rest=list.length-visible.length;
  if(!list.length){
    return `<div class="bg-slate-950/40 border border-emerald-400/20 rounded-xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="mono text-[10px] text-emerald-300">VALIDASI PAYROLL</p>
          <p class="font-semibold mt-1">Tidak ada item perlu dicek</p>
          <p class="text-xs text-slate-400 mt-1">Task payroll sudah punya bulan payable dan tidak ada warning dasar.</p>
        </div>
        <span class="pill ok">Aman</span>
      </div>
    </div>`;
  }
  return `<div class="bg-slate-950/40 border border-white/10 rounded-xl p-4">
    <div class="flex items-start justify-between gap-3 mb-3">
      <div>
        <p class="mono text-[10px] text-amber-300">PERLU DICEK</p>
        <p class="font-semibold mt-1">${list.length} warning payroll</p>
      </div>
      <span class="pill warn">${list.length}</span>
    </div>
    <div class="space-y-2">${visible.map(payrollValidationIssueRow).join("")}</div>
    ${rest?`<p class="text-xs text-slate-500 mt-2">+ ${rest} warning lain. Gunakan search/filter untuk cek detail.</p>`:""}
  </div>`;
}
function renderPayrollExportHistoryPanel(){
  const history=typeof readPayrollExportHistory==="function"?readPayrollExportHistory():[];
  const visible=history.slice(0,5);
  if(!visible.length){
    return `<div class="bg-slate-950/40 border border-white/10 rounded-xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="mono text-[10px] text-sky-300">RIWAYAT EXPORT</p>
          <p class="font-semibold mt-1">Belum ada export payroll</p>
          <p class="text-xs text-slate-400 mt-1">Riwayat akan tersimpan lokal setelah download payroll bulanan.</p>
        </div>
        <span class="pill">0</span>
      </div>
    </div>`;
  }
  return `<div class="bg-slate-950/40 border border-white/10 rounded-xl p-4">
    <div class="flex items-start justify-between gap-3 mb-3">
      <div>
        <p class="mono text-[10px] text-sky-300">RIWAYAT EXPORT</p>
        <p class="font-semibold mt-1">${history.length} export tersimpan</p>
      </div>
      <button onclick="clearPayrollExportHistory()" class="btn text-[11px]">Clear</button>
    </div>
    <div class="space-y-2">${visible.map(item=>`
      <div class="bg-slate-900 rounded-xl p-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-sm">${esc(item.monthLabel||monthLabel(item.month))}</p>
            <p class="text-xs text-slate-400">${esc(item.filename||"-")}</p>
          </div>
          <span class="pill ok">${Number(item.allocationCount)||0} task</span>
        </div>
        <p class="text-[11px] text-slate-500 mt-1">${esc(fmtDateTime(item.exportedAt))} - ${esc(item.admin||"Admin")}</p>
      </div>
    `).join("")}</div>
  </div>`;
}
function buildPayrollArtistSummary(rows){
  const map=new Map();
  for(const job of rows||[]){
    const name=workerDisplayName(job.a);
    if(!map.has(name)){
      map.set(name,{name,total:0,Approved:0,Payable:0,Paid:0,projects:new Set()});
    }
    const item=map.get(name);
    const status=String(job?.a?.workStatus||"");
    item.total+=1;
    if(["Approved","Payable","Paid"].includes(status)) item[status]+=1;
    const projectLabel=[job?.p?.client,job?.p?.name].filter(Boolean).join(" - ");
    if(projectLabel) item.projects.add(projectLabel);
  }
  return [...map.values()].sort((a,b)=>{
    const totalCmp=b.total-a.total;
    if(totalCmp) return totalCmp;
    return a.name.localeCompare(b.name,"id",{sensitivity:"base"});
  });
}
function renderPayrollArtistSummaryPanel(rows,month){
  if(!isMonthKey(month)) return "";
  const summary=buildPayrollArtistSummary(rows);
  const totalTasks=summary.reduce((sum,item)=>sum+item.total,0);
  const open=Boolean(payrollArtistSummaryOpen);
  return `<div class="bg-slate-950/40 border border-white/10 rounded-xl p-4 mb-4">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <p class="mono text-[10px] text-emerald-300">SUMMARY PER ARTIST</p>
        <p class="font-semibold mt-1">${esc(monthLabel(month))} - ${summary.length} artist / ${totalTasks} task</p>
        <p class="text-xs text-slate-400 mt-1">Ringkasan ini muncul hanya saat filter bulan aktif.</p>
      </div>
      <button onclick="togglePayrollArtistSummary()" class="btn text-xs">${open?"Tutup":"Lihat"}</button>
    </div>
    ${open?`
      <div class="mt-3 max-h-[280px] overflow-y-auto space-y-2 pr-1">
        ${summary.length?summary.map(item=>`
          <div class="bg-slate-900 rounded-xl p-3 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2 lg:items-center">
            <div>
              <p class="font-semibold text-sm">${esc(item.name)}</p>
              <p class="text-xs text-slate-400">${item.projects.size} project</p>
            </div>
            <div class="grid grid-cols-4 gap-2 text-center">
              <div><p class="mono text-[10px] text-slate-500">TASK</p><p class="font-bold">${item.total}</p></div>
              <div><p class="mono text-[10px] text-slate-500">APP</p><p class="font-bold">${item.Approved}</p></div>
              <div><p class="mono text-[10px] text-slate-500">PAY</p><p class="font-bold">${item.Payable}</p></div>
              <div><p class="mono text-[10px] text-slate-500">PAID</p><p class="font-bold">${item.Paid}</p></div>
            </div>
          </div>
        `).join(""):`<div class="bg-slate-900 rounded-xl p-4 text-slate-400 text-sm">Belum ada task payroll untuk bulan ini.</div>`}
      </div>
    `:""}
  </div>`;
}
function payrollJobRow(j){
  const selected=isPayrollTaskSelected(j.a.id);
  const month=payrollMonthForAllocation(j.a);
  const monthText=month?monthLabel(month):"Belum pilih bulan";
  const status=String(j.a.workStatus||"Approved");
  return `<div role="button" tabindex="0" onclick="openJobFromLanding('${j.a.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openJobFromLanding('${j.a.id}')}" class="bg-slate-900 rounded-xl p-4 grid grid-cols-1 xl:grid-cols-[auto_1.2fr_.7fr_.9fr_.9fr_auto] gap-3 items-center cursor-pointer hover:bg-slate-800/80 transition">
    <label onclick="event.stopPropagation()" class="inline-flex items-center gap-2 text-[11px] text-slate-300">
      <input type="checkbox" ${selected?"checked":""} onchange="togglePayrollTaskSelection('${j.a.id}',this.checked)">
      <span>Pilih</span>
    </label>
    <div>
      <p class="font-bold">${esc(workerDisplayName(j.a))}</p>
      <p class="text-slate-400 text-sm">${esc(j.a.role||"-")} - ${esc(j.p.client)} - ${esc(j.p.name)}</p>
    </div>
    <p class="text-slate-300 text-sm">${esc(status)}<br><span class="text-slate-500 text-xs">${esc(monthText)}</span></p>
    <label onclick="event.stopPropagation()" class="bg-slate-800 rounded-xl p-2 text-xs text-slate-300">
      <span class="block mono text-[10px] text-slate-500 mb-1">BULAN PAYABLE</span>
      <input type="month" value="${esc(month)}" onchange="setPayrollPayableMonth('${j.p.id}','${j.a.id}',this.value)" class="w-full bg-transparent text-sm">
    </label>
    <p class="text-slate-400 text-xs">Tanggal: <b class="text-slate-200">${esc(payrollDateLabel(j.a))}</b><br>Jenis: <b class="text-slate-200">${esc(j.a.serviceType||"Custom")}</b></p>
    <div onclick="event.stopPropagation()" class="flex flex-wrap gap-2 justify-end">
      <button onclick="setPayrollPayableMonth('${j.p.id}','${j.a.id}',document.getElementById('payroll-target-month')?.value||currentMonthKey())" class="btn text-xs">Set Payable</button>
      <button onclick="quick('${j.p.id}','${j.a.id}','Approved')" class="btn text-xs">Approved</button>
    </div>
  </div>`;
}
function renderTeamPayroll(){
  const board=document.getElementById("team-payroll-board");
  if(!board) return;
  const isVerifiedAdmin=role==="admin"&&currentProfile?.role==="admin";
  if(role==="artist"||!isVerifiedAdmin){ board.innerHTML=`<div class="glass rounded-2xl p-8 text-slate-400">${role==="artist"?"Payroll Team hanya untuk Admin / Operator.":"Silakan login sebagai admin untuk akses Payroll Team."}</div>`; return; }
  if(!payrollTargetMonth) payrollTargetMonth=currentMonthKey();
  const allRows=allJobs().filter(j=>["Approved","Payable","Paid"].includes(j.a.workStatus||""));
  const query=String(payrollSearch||"").trim().toLowerCase();
  let rows=allRows.filter(j=>{
    if(payrollStatusFilter!=="All"&&j.a.workStatus!==payrollStatusFilter) return false;
    if(payrollMonthFilter!=="all"&&payrollMonthForAllocation(j.a)!==payrollMonthFilter) return false;
    if(!query) return true;
    const text=[j.p.client,j.p.name,j.a.workerName,artistName(j.a.artistId),workerDisplayName(j.a),j.a.role,j.a.workStatus].join(" ").toLowerCase();
    return text.includes(query);
  }).sort((a,b)=>{
    const monthA=payrollMonthForAllocation(a.a)||"9999-99";
    const monthB=payrollMonthForAllocation(b.a)||"9999-99";
    const monthCmp=monthA.localeCompare(monthB);
    if(monthCmp) return monthCmp;
    return workerDisplayName(a.a).localeCompare(workerDisplayName(b.a),"id",{sensitivity:"base"});
  });
  syncPayrollSelection(rows);
  const selectedCount=payrollSelectedAllocationIds.size;
  const totalRows=rows.length;
  const allSelected=totalRows>0&&selectedCount===totalRows;
  const counts={
    approved:allRows.filter(j=>j.a.workStatus==="Approved").length,
    payable:allRows.filter(j=>j.a.workStatus==="Payable").length,
    paid:allRows.filter(j=>j.a.workStatus==="Paid").length
  };
  const validationIssues=collectPayrollValidationIssues(allRows);
  const summaryMonth=isMonthKey(payrollMonthFilter)?payrollMonthFilter:"";
  const summaryRows=summaryMonth?allRows.filter(j=>payrollMonthForAllocation(j.a)===summaryMonth):[];
  board.innerHTML=`<div class="glass rounded-2xl p-5">
    <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-4">
      <div>
        <p class="mono text-xs text-emerald-300 tracking-widest">DAFTAR PAYROLL</p>
        <p class="text-slate-300 text-sm mt-1">${allRows.length} item payroll. Terpilih <b>${selectedCount}</b> dari <b>${totalRows}</b> hasil filter.</p>
        <p class="text-slate-500 text-xs mt-1">Approved: ${counts.approved} / Payable: ${counts.payable} / Paid: ${counts.paid}</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2 w-full xl:max-w-5xl">
        <input id="payroll-search" value="${esc(payrollSearch)}" oninput="setPayrollSearch(this.value)" class="bg-slate-800 rounded-xl p-3 text-sm xl:col-span-2" placeholder="Cari nama, client, project...">
        <select onchange="setPayrollStatusFilter(this.value)" class="bg-slate-800 rounded-xl p-3 text-sm">
          ${["All","Approved","Payable","Paid"].map(s=>`<option value="${s}" ${payrollStatusFilter===s?"selected":""}>${s==="All"?"Semua Status":s}</option>`).join("")}
        </select>
        <label class="bg-slate-800 rounded-xl p-2 text-xs text-slate-300">
          <span class="block mono text-[10px] text-slate-500 mb-1">FILTER BULAN</span>
          <input type="month" value="${payrollMonthFilter==="all"?"":esc(payrollMonthFilter)}" onchange="setPayrollMonthFilter(this.value)" class="w-full bg-transparent text-sm">
        </label>
        <button onclick="setPayrollMonthFilter('all')" class="btn text-xs">Semua Bulan</button>
      </div>
    </div>
    <div class="bg-slate-950/40 border border-white/10 rounded-xl p-3 mb-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
      <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
        <label class="bg-slate-800 rounded-xl p-2 text-xs text-slate-300 min-w-[190px]">
          <span class="block mono text-[10px] text-slate-500 mb-1">SET KE BULAN</span>
          <input id="payroll-target-month" type="month" value="${esc(payrollTargetMonth||currentMonthKey())}" onchange="setPayrollTargetMonth(this.value)" class="w-full bg-transparent text-sm">
        </label>
        <button onclick="togglePayrollSelectAll()" class="btn text-xs">${allSelected?"Unselect Semua":"Pilih Semua Hasil Filter"}</button>
        <button onclick="clearPayrollSelection()" class="btn text-xs" ${selectedCount?"" :"disabled"}>Reset Pilihan</button>
      </div>
      <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
        <button onclick="exportPayrollMonth(payrollMonthFilter!=='all'?payrollMonthFilter:(document.getElementById('payroll-target-month')?.value||payrollTargetMonth||currentMonthKey()))" class="btn text-xs">Export Bulan Ini</button>
        <button onclick="applyPayrollMonthToSelection()" class="primary btn text-xs" ${selectedCount?"" :"disabled"}>Set Terpilih Jadi Payable</button>
      </div>
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-4">
      ${renderPayrollValidationPanel(validationIssues)}
      ${renderPayrollExportHistoryPanel()}
    </div>
    ${summaryMonth?renderPayrollArtistSummaryPanel(summaryRows,summaryMonth):""}
    ${rows.length?`<div class="space-y-3">${rows.map(payrollJobRow).join("")}</div>`:`<div class="rounded-xl p-8 text-center text-slate-400 bg-slate-900">Tidak ada item payroll untuk filter ini.</div>`}
  </div>`;
}
function renderSetup(){
  const adminMode=isVerifiedAdmin();
  const usage=packageUsageMap();
  const artistList=document.getElementById("setup-artist-list");
  if(artistList) artistList.innerHTML=data.artists.length?data.artists.map(a=>`
    <div class="bg-slate-900 rounded-xl p-3 flex items-center justify-between gap-3">
      <div><p class="font-bold">${esc(a.name)}</p><p class="text-slate-400 text-xs">${esc(artistRolesLabel(a))}${a.pinConfigured?" - PIN aktif":" - PIN belum diset"}</p></div>
      <div class="flex gap-2">
        <button onclick="openArtistModal('${a.id}')" class="btn text-xs">Edit</button>
        <button onclick="setOrResetTeamArtistPin('${a.id}')" class="btn text-xs ${a.pinConfigured?"":"primary"}">${a.pinConfigured?"Reset PIN":"Set PIN"}</button>
        <button onclick="deleteTeamArtist('${a.id}')" class="danger btn text-xs">Hapus</button>
      </div>
    </div>`).join(""):`<p class="text-slate-400 text-sm">Belum ada artist. Klik + Artist.</p>`;
  const packageList=document.getElementById("setup-package-list");
  if(packageList) packageList.innerHTML=Object.entries(packageTemplates).map(([name,rows])=>`
    <div class="bg-slate-900 rounded-xl p-3">
      <div class="flex items-center justify-between gap-2">
        <p class="font-bold">${esc(name)}</p>
        <span class="text-[11px] text-slate-400">${usage[name]||0} project</span>
      </div>
      <p class="text-slate-400 text-xs mt-1">${rows.map(r=>`${r[0]}: ${r[1]}${r[2]&&r[2]!=="Tidak ada"?` (${r[2]})`:""}`).join(" | ")}</p>
      ${adminMode?`<div class="flex gap-2 mt-2"><button onclick='openPackageModal(${JSON.stringify(name)})' class="btn text-xs">Edit</button><button onclick='deletePackageTemplate(${JSON.stringify(name)})' class="danger btn text-xs">Hapus</button></div>`:""}
    </div>`).join("");
}
