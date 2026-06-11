function cleanArtist(item){
  const source=item&&typeof item==="object"?item:{};
  const roles=normalizeArtistRoles(source.roles||source.role);
  return {
    id:String(source.id||uid()),
    name:String(source.name||"Artist"),
    role:roles[0]||"Illustration",
    roles,
    pinConfigured:Boolean(source.pinConfigured||source.pin_configured||source.pin_hash||source.pinHash||source.pin)
  };
}
function sanitizeArtists(list){
  if(!Array.isArray(list)) return [];
  const seen=new Set();
  const out=[];
  for(const item of list){
    const artist=cleanArtist(item);
    if(!artist.id||seen.has(artist.id)) continue;
    seen.add(artist.id);
    out.push(artist);
  }
  return out;
}
function readImportedPin(rawArtist){
  if(!rawArtist||typeof rawArtist!=="object") return "";
  const candidates=[rawArtist.pin,rawArtist.PIN,rawArtist.artistPin,rawArtist.pinArtist,rawArtist.passcode];
  for(const value of candidates){
    if(value===undefined||value===null) continue;
    const pin=String(value).trim();
    if(pin) return pin;
  }
  return "";
}
function toNumberOr(value,fallback=0){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
}
function normalizeWorkStatus(value){
  const raw=String(value||"Booked").trim();
  if(!raw) return "Booked";
  const key=raw.toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  const map={
    booked:"Booked",
    waitlist:"Waitlist",
    "in progress":"In Progress",
    inprogress:"In Progress",
    blocked:"Blocked",
    submitted:"Submitted",
    approved:"Approved",
    payable:"Payable",
    paid:"Paid",
    "revision hold":"Revision Hold",
    revision:"Revision Hold",
    "waiting client":"Waiting Client"
  };
  return map[key]||raw;
}
function normalizePayMode(value){
  const key=String(value||"").trim().toLowerCase();
  if(["fixed","usd","nominal","amount","amountusd","manual"].includes(key)) return "fixed";
  if(["percent","percentage","share","ratio"].includes(key)) return "percent";
  return "conversion";
}
function normalizePaymentStatusValue(value){
  const key=String(value||"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
  if(["lunas","paid","full paid","fully paid","settled"].includes(key)) return "Lunas";
  if(["dp / partial","dp partial","partial","parsial","partially paid"].includes(key)) return "Parsial";
  if(["pending","belum bayar","belum dibayar","unpaid"].includes(key)) return "Pending";
  return "";
}
function payslipStatusFromWorkStatus(value,projectPaymentStatus="",allocationPaymentStatus=""){
  const status=normalizeWorkStatus(value);
  const projectPayStatus=normalizePaymentStatusValue(projectPaymentStatus);
  const allocationPayStatus=normalizePaymentStatusValue(allocationPaymentStatus);
  if(projectPayStatus==="Lunas"||allocationPayStatus==="Lunas") return "Lunas";
  if(["Approved","Payable","Paid"].includes(status)) return "Lunas";
  if(allocationPayStatus) return allocationPayStatus;
  return "Pending";
}
function normalizeAllocation(rawAllocation,projectDeadline="",projectPaymentStatus=""){
  const source=rawAllocation&&typeof rawAllocation==="object"?rawAllocation:{};
  const workStatus=normalizeWorkStatus(source.workStatus??source.status??source.state??"Booked");
  const allocationPaymentStatus=source.payslipPaymentStatus??source.payslipStatus??source.payrollPaymentStatus??source.paymentStatus??"";
  const payslipPaymentStatus=payslipStatusFromWorkStatus(workStatus,projectPaymentStatus,allocationPaymentStatus);
  const role=String(source.role||source.workerRole||source.position||"Illustration").trim()||"Illustration";
  const serviceType=String(source.serviceType||source.service||source.type||"Custom").trim()||"Custom";
  const dependency=String(source.dependency||source.dependsOn||source.dep||"Tidak ada").trim()||"Tidak ada";
  const percentSource=source.percent??source.splitPercent??source.sharePercent??source.feePercent??0;
  const amountSource=source.amountUsd??source.amountUSD??source.amount_usd??source.amount??source.feeUsd??0;
  const rawPayMode=source.payMode??source.paymentMode??source.mode;
  const payMode=rawPayMode!==undefined&&rawPayMode!==null&&String(rawPayMode).trim()!==""
    ?normalizePayMode(rawPayMode)
    :toNumberOr(amountSource,0)>0?"fixed":toNumberOr(percentSource,0)>0?"percent":"conversion";
  const artistHoldReason=String(source.artistHoldReason||"").trim();
  const adminRevisionNote=String(source.adminRevisionNote||"").trim();
  const holdReason=String(source.holdReason||"").trim()||artistHoldReason||(workStatus==="Revision Hold"?adminRevisionNote:"");
  const adminFeedback=String(source.adminFeedback||"").trim()||adminRevisionNote;
  return {
    ...source,
    id:String(source.id||source.allocationId||uid()),
    role,
    serviceType,
    artistId:String(source.artistId||source.artist_id||""),
    workerName:String(source.workerName||source.worker||""),
    workStatus,
    dependency,
    targetDoneDate:String(source.targetDoneDate||source.targetDate||source.deadline||projectDeadline||""),
    artistProgress:Math.max(0,Math.min(100,toNumberOr(source.artistProgress??source.progress??0,0))),
    payMode,
    percent:toNumberOr(percentSource,0),
    amountUsd:toNumberOr(amountSource,0),
    paymentStatus:payslipPaymentStatus,
    payslipPaymentStatus,
    payslipStatus:payslipPaymentStatus,
    payrollPaymentStatus:payslipPaymentStatus,
    holdReason,
    adminFeedback,
    artistHoldReason:artistHoldReason||(workStatus==="Blocked"?holdReason:""),
    adminRevisionNote:adminRevisionNote||(workStatus==="Revision Hold"?(adminFeedback||holdReason):""),
    projectId:String(source.projectId||source.project_id||""),
    startDate:String(source.startDate||source.startedAt||""),
    doneDate:String(source.doneDate||source.submittedAt||source.completedAt||""),
    payableDate:String(source.payableDate||""),
    paidDate:String(source.paidDate||source.paymentDate||""),
    lastArtistUpdate:String(source.lastArtistUpdate||source.updatedAt||"")
  };
}
function normalizeProject(rawProject){
  const source=rawProject&&typeof rawProject==="object"?rawProject:{};
  const deadline=String(source.deadline||source.targetDate||"");
  const projectPaymentStatus=String(source.paymentStatus||source.clientPaymentStatus||source.payment_status||"");
  const rawAllocations=Array.isArray(source.allocations)?source.allocations:Array.isArray(source.workerSplits)?source.workerSplits:Array.isArray(source.workers)?source.workers:[];
  const seenAllocIds=new Set();
  const allocations=rawAllocations.map(item=>{
    const normalized=normalizeAllocation(item,deadline,projectPaymentStatus);
    let nextId=String(normalized.id||uid());
    while(seenAllocIds.has(nextId)) nextId=uid();
    seenAllocIds.add(nextId);
    return {...normalized,id:nextId};
  });
  return {
    ...source,
    id:String(source.id||source.projectId||uid()),
    client:String(source.client||source.clientName||""),
    name:String(source.name||source.projectName||""),
    deadline,
    packageType:String(source.packageType||source.package||source.serviceType||"Custom"),
    budgetUsd:toNumberOr(source.budgetUsd??source.budgetUSD??source.budget_usd,0),
    budgetIdr:toNumberOr(source.budgetIdr??source.budgetIDR??source.budget_idr,0),
    paidUsd:toNumberOr(source.paidUsd??source.paidUSD??source.paid_usd,0),
    paidIdr:toNumberOr(source.paidIdr??source.paidIDR??source.paid_idr,0),
    allocations
  };
}
function sanitizeProjects(list){
  if(!Array.isArray(list)) return [];
  const seenProjectIds=new Set();
  const out=[];
  for(const item of list){
    const project=normalizeProject(item);
    if(!project.id||seenProjectIds.has(project.id)) continue;
    seenProjectIds.add(project.id);
    out.push(project);
  }
  return out;
}
function normalizeSnapshot(raw){
  const source=raw&&typeof raw==="object"?raw:{};
  return {
    artists:sanitizeArtists(source.artists),
    projects:sanitizeProjects(source.projects),
    updatedAt:String(source.updatedAt||source.updated_at||"")
  };
}
function applySnapshot(raw){
  data=normalizeSnapshot(raw);
  localStorage.setItem(KEY,JSON.stringify(data));
}
function extractSnapshot(raw){
  if(Array.isArray(raw)) return extractSnapshot(raw[0]);
  if(raw&&typeof raw==="object"&&raw.payload&&typeof raw.payload==="object"){
    return {...raw.payload,updatedAt:raw.updated_at||raw.payload.updatedAt||""};
  }
  return raw&&typeof raw==="object"?raw:null;
}
function loadData(){
  try{
    const parsed=JSON.parse(localStorage.getItem(KEY)||"{}");
    return normalizeSnapshot(parsed);
  }catch(e){
    return {artists:[],projects:[],updatedAt:""};
  }
}
function getArtistHoldReason(allocation){
  if(!allocation||typeof allocation!=="object") return "";
  const scoped=String(allocation.artistHoldReason||"").trim();
  if(scoped) return scoped;
  const legacy=String(allocation.holdReason||"").trim();
  if((allocation.workStatus||"")==="Blocked") return legacy;
  return "";
}
function getAdminRevisionReason(allocation){
  if(!allocation||typeof allocation!=="object") return "";
  const scoped=String(allocation.adminRevisionNote||"").trim();
  if(scoped) return scoped;
  const legacyAdmin=String(allocation.adminFeedback||"").trim();
  if(legacyAdmin) return legacyAdmin;
  const legacyHold=String(allocation.holdReason||"").trim();
  if((allocation.workStatus||"")==="Revision Hold") return legacyHold;
  return "";
}
function normalizeAllocationNotes(allocation){
  if(!allocation||typeof allocation!=="object") return;
  const artistHold=getArtistHoldReason(allocation);
  const adminRevision=getAdminRevisionReason(allocation);
  if(artistHold&&!String(allocation.artistHoldReason||"").trim()) allocation.artistHoldReason=artistHold;
  if(adminRevision&&!String(allocation.adminRevisionNote||"").trim()) allocation.adminRevisionNote=adminRevision;
}
function normalizeAllAllocationNotes(){
  for(const project of data.projects||[]){
    for(const allocation of project.allocations||[]){
      normalizeAllocationNotes(allocation);
    }
  }
}
function saveData(){
  normalizeAllAllocationNotes();
  data=normalizeSnapshot({...data,updatedAt:new Date().toISOString()});
  localStorage.setItem(KEY,JSON.stringify(data));
  allocationStateCache=captureAllocationState(data);
  renderDataStatus();
  renderNotifBell();
  queueRemoteSave();
}
function supabaseConfigured(){
  if(db) return true;
  alert("Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di file HTML ini.");
  return false;
}
function queueRemoteSave(){
  if(!db) return;
  if(role==="admin"&&(!currentUser||currentProfile?.role!=="admin")) return;
  if(role==="artist"&&(!activeArtist||!artistPinSession)) return;
  if(role!=="admin"&&role!=="artist") return;
  if(syncTimer) clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{ void saveRemoteSnapshot(); },180);
}
async function saveRemoteSnapshot(){
  if(!db) return;
  const payload=normalizeSnapshot({...data,updatedAt:new Date().toISOString()});
  let error=null;
  let ok=true;
  if(role==="admin"){
    const result=await db.rpc(RPC_ADMIN_SAVE_SNAPSHOT,{p_payload:payload});
    error=result.error;
    ok=Boolean(result.data);
  }else if(role==="artist"){
    const result=await db.rpc(RPC_ARTIST_SAVE_SNAPSHOT,{p_artist_id:activeArtist,p_pin:artistPinSession,p_payload:payload});
    error=result.error;
    ok=Boolean(result.data);
  }
  if(error) console.error("saveRemoteSnapshot error",error);
  if(!error&&!ok) console.error("saveRemoteSnapshot rejected by RPC policy");
  return !error&&ok;
}
async function loadArtistRosterRemote(){
  if(!db) return;
  try{
    const {data:rows,error}=await withTimeout(db.rpc(RPC_PUBLIC_ARTISTS),12000,"loadArtistRosterRemote");
    if(error){ console.error("loadArtistRosterRemote error",error); return; }
    if(Array.isArray(rows)){
      data.artists=sanitizeArtists(rows);
      localStorage.setItem(KEY,JSON.stringify(data));
    }
  }catch(err){
    console.error("loadArtistRosterRemote timeout/error",err);
  }
}
async function loadRemoteSnapshot(){
  if(!db) return;
  if(role==="admin"){
    const {data:snapshot,error}=await withTimeout(db.rpc(RPC_ADMIN_GET_SNAPSHOT),SNAPSHOT_TIMEOUT_MS,"RPC_ADMIN_GET_SNAPSHOT");
    if(error){ console.error("loadRemoteSnapshot admin error",error); return; }
    const parsed=extractSnapshot(snapshot);
    if(parsed) applySnapshot(parsed);
    return;
  }
  if(role==="artist"&&activeArtist&&artistPinSession){
    const {data:snapshot,error}=await withTimeout(
      db.rpc(RPC_ARTIST_GET_SNAPSHOT,{p_artist_id:activeArtist,p_pin:artistPinSession}),
      SNAPSHOT_TIMEOUT_MS,
      "RPC_ARTIST_GET_SNAPSHOT"
    );
    if(error){ console.error("loadRemoteSnapshot artist error",error); return; }
    const parsed=extractSnapshot(snapshot);
    if(parsed) applySnapshot(parsed);
    return;
  }
  await loadArtistRosterRemote();
}
async function loadProfile(){
  if(!db||!currentUser){ currentProfile=null; return; }
  try{
    const {data:profile,error}=await withTimeout(
      db.from("profiles").select("id,role,artist_id").eq("id",currentUser.id).maybeSingle(),
      PROFILE_TIMEOUT_MS,
      "loadProfile"
    );
    if(error){ console.error("loadProfile error",error); currentProfile=null; return; }
    currentProfile=profile||null;
  }catch(err){
    console.error("loadProfile timeout/error",err);
    currentProfile=null;
  }
}
function setProjectPdfInfo(p){
  const el=document.getElementById("tp-pdf-info");
  if(!el) return;
  const brief=p?.expressionPdfName?`Brief PDF: ${p.expressionPdfName}`:"Brief PDF: belum ada";
  const freebie=p?.freebieRequirementPdfName?`Freebie PDF: ${p.freebieRequirementPdfName}`:"Freebie PDF: belum ada";
  el.textContent=`${brief} | ${freebie}`;
}
function clearProjectPdfInputs(){
  const briefInput=document.getElementById("tp-brief-pdf");
  const freebieInput=document.getElementById("tp-freebie-pdf");
  if(briefInput) briefInput.value="";
  if(freebieInput) freebieInput.value="";
}
function clearBriefObjectUrls(){
  if(!briefObjectUrls.length) return;
  for(const url of briefObjectUrls){
    try{ URL.revokeObjectURL(url); }catch(_err){}
  }
  briefObjectUrls=[];
}
function stripQueryHash(value){
  return String(value||"").split("#")[0].split("?")[0];
}
function normalizeBriefStoragePathCandidates(path){
  const raw=String(path||"").trim();
  if(!raw) return [];
  const out=[];
  const pushCandidate=(candidate)=>{
    const normalized=stripQueryHash(candidate).trim().replace(/\\/g,"/").replace(/^\/+/,"");
    if(!normalized||out.includes(normalized)) return;
    out.push(normalized);
    if(normalized.startsWith(`${SUPABASE_BRIEF_BUCKET}/`)){
      const withoutBucket=normalized.slice(SUPABASE_BRIEF_BUCKET.length+1);
      if(withoutBucket&&!out.includes(withoutBucket)) out.push(withoutBucket);
    }
    if(normalized.startsWith(`storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/`)){
      const withoutSign=normalized.slice(`storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/`.length);
      if(withoutSign&&!out.includes(withoutSign)) out.push(withoutSign);
    }
    if(normalized.startsWith(`storage/v1/object/public/${SUPABASE_BRIEF_BUCKET}/`)){
      const withoutPublic=normalized.slice(`storage/v1/object/public/${SUPABASE_BRIEF_BUCKET}/`.length);
      if(withoutPublic&&!out.includes(withoutPublic)) out.push(withoutPublic);
    }
    if(normalized.startsWith(`storage/v1/object/${SUPABASE_BRIEF_BUCKET}/`)){
      const withoutObject=normalized.slice(`storage/v1/object/${SUPABASE_BRIEF_BUCKET}/`.length);
      if(withoutObject&&!out.includes(withoutObject)) out.push(withoutObject);
    }
  };
  pushCandidate(raw);
  const rawMarkers=[
    `/storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/`,
    `/storage/v1/object/public/${SUPABASE_BRIEF_BUCKET}/`,
    `/storage/v1/object/${SUPABASE_BRIEF_BUCKET}/`,
    `storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/`,
    `storage/v1/object/public/${SUPABASE_BRIEF_BUCKET}/`,
    `storage/v1/object/${SUPABASE_BRIEF_BUCKET}/`
  ];
  rawMarkers.forEach(marker=>{
    const idx=raw.indexOf(marker);
    if(idx>=0){
      pushCandidate(raw.slice(idx+marker.length));
    }
  });
  try{
    const parsed=new URL(raw);
    const pathname=parsed.pathname||"";
    const markers=[
      `/storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/`,
      `/storage/v1/object/public/${SUPABASE_BRIEF_BUCKET}/`,
      `/storage/v1/object/${SUPABASE_BRIEF_BUCKET}/`
    ];
    markers.forEach(marker=>{
      const idx=pathname.indexOf(marker);
      if(idx>=0){
        const extracted=decodeURIComponent(pathname.slice(idx+marker.length));
        pushCandidate(extracted);
      }
    });
  }catch(_err){}
  return out;
}
function encodeStoragePath(path){
  return stripQueryHash(path)
    .split("/")
    .filter(Boolean)
    .map(part=>encodeURIComponent(part))
    .join("/");
}
function toAbsoluteSupabaseSignedUrl(value){
  const raw=String(value||"").trim();
  if(!raw) return "";
  if(/^https?:\/\//i.test(raw)) return raw;
  if(raw.startsWith("/storage/v1/")) return `${SUPABASE_URL}${raw}`;
  if(raw.startsWith("storage/v1/")) return `${SUPABASE_URL}/${raw}`;
  if(raw.startsWith("/object/")) return `${SUPABASE_URL}/storage/v1${raw}`;
  if(raw.startsWith("object/")) return `${SUPABASE_URL}/storage/v1/${raw}`;
  if(raw.startsWith("/")) return `${SUPABASE_URL}${raw}`;
  return `${SUPABASE_URL}/${raw}`;
}
function normalizeSingleStoragePath(path){
  return stripQueryHash(path).trim().replace(/\\/g,"/").replace(/^\/+/,"");
}
function isRemovableProjectStoragePath(path,projectId=""){
  const normalized=normalizeSingleStoragePath(path);
  if(!normalized||/^https?:\/\//i.test(normalized)) return false;
  const pid=String(projectId||"").trim();
  if(pid&&!normalized.startsWith(`${pid}/`)) return false;
  return normalized.includes("/");
}
function collectProjectPdfStoragePaths(project){
  const p=project&&typeof project==="object"?project:{};
  const projectId=String(p.id||"").trim();
  const sources=[
    p.expressionPdfData,
    p.expressionPdfPath,
    p.briefPdfData,
    p.freebieRequirementPdfData,
    p.freebieRequirementPdfPath,
    p.freebiePdfData
  ];
  const out=[];
  const push=(candidate)=>{
    const normalized=normalizeSingleStoragePath(candidate);
    if(!isRemovableProjectStoragePath(normalized,projectId)||out.includes(normalized)) return;
    out.push(normalized);
  };
  for(const source of sources){
    normalizeBriefStoragePathCandidates(source).forEach(push);
  }
  return out;
}
async function listProjectStorageFolderPaths(projectId){
  const pid=String(projectId||"").trim();
  if(!db||!pid) return [];
  const out=[];
  const pageSize=100;
  let offset=0;
  while(true){
    const {data:items,error}=await db.storage.from(SUPABASE_BRIEF_BUCKET).list(pid,{limit:pageSize,offset,sortBy:{column:"name",order:"asc"}});
    if(error) throw error;
    const page=Array.isArray(items)?items:[];
    page
      .map(item=>String(item?.name||"").trim())
      .filter(Boolean)
      .forEach(name=>out.push(`${pid}/${name}`));
    if(page.length<pageSize) break;
    offset+=pageSize;
  }
  return out;
}
async function deleteProjectPdfFiles(project){
  const p=project&&typeof project==="object"?project:null;
  if(!p||!db) return {deleted:0,paths:[]};
  if(!isVerifiedAdmin()) throw new Error("Session admin tidak ditemukan untuk menghapus PDF project.");
  const paths=new Set(collectProjectPdfStoragePaths(p));
  const folderPaths=await listProjectStorageFolderPaths(p.id);
  folderPaths.forEach(path=>{
    if(isRemovableProjectStoragePath(path,p.id)) paths.add(normalizeSingleStoragePath(path));
  });
  const removable=[...paths];
  if(!removable.length) return {deleted:0,paths:[]};
  const {data:removed,error}=await db.storage.from(SUPABASE_BRIEF_BUCKET).remove(removable);
  if(error) throw error;
  return {deleted:Array.isArray(removed)?removed.length:removable.length,paths:removable};
}
async function deleteProjectsPdfFiles(projects){
  let deleted=0;
  const paths=[];
  for(const project of projects||[]){
    const result=await deleteProjectPdfFiles(project);
    deleted+=result.deleted||0;
    paths.push(...(result.paths||[]));
  }
  return {deleted,paths};
}
function expandStoragePathVariants(path){
  const base=normalizeSingleStoragePath(path);
  if(!base) return [];
  const out=[];
  const push=(value)=>{
    const v=normalizeSingleStoragePath(value);
    if(v&&!out.includes(v)) out.push(v);
  };
  push(base);
  if(base.startsWith(`${SUPABASE_BRIEF_BUCKET}/`)) push(base.slice(SUPABASE_BRIEF_BUCKET.length+1));
  [
    `storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/`,
    `storage/v1/object/public/${SUPABASE_BRIEF_BUCKET}/`,
    `storage/v1/object/${SUPABASE_BRIEF_BUCKET}/`
  ].forEach(prefix=>{
    if(base.startsWith(prefix)) push(base.slice(prefix.length));
  });
  for(const item of [...out]){
    try{
      const decoded=decodeURIComponent(item);
      if(decoded!==item) push(decoded);
    }catch(_err){}
  }
  return out;
}
async function requestArtistScopedSignedUrlByPath(path,headers){
  const encodedPath=encodeStoragePath(path);
  if(!encodedPath) return "";
  const url=`${SUPABASE_URL}/storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}/${encodedPath}`;
  const response=await fetch(url,{
    method:"POST",
    headers,
    body:JSON.stringify({expiresIn:SUPABASE_SIGNED_URL_TTL})
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>`HTTP ${response.status}`);
    console.warn("artist sign by path failed",path,response.status,detail);
    return "";
  }
  const payload=await response.json().catch(()=>null);
  const signedRaw=String(payload?.signedURL||payload?.signedUrl||"").trim();
  if(!signedRaw) return "";
  return toAbsoluteSupabaseSignedUrl(signedRaw);
}
async function requestArtistScopedSignedUrlByBody(path,headers){
  const normalized=normalizeSingleStoragePath(path);
  if(!normalized) return "";
  const url=`${SUPABASE_URL}/storage/v1/object/sign/${SUPABASE_BRIEF_BUCKET}`;
  const response=await fetch(url,{
    method:"POST",
    headers,
    body:JSON.stringify({expiresIn:SUPABASE_SIGNED_URL_TTL,paths:[normalized]})
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>`HTTP ${response.status}`);
    console.warn("artist sign by body failed",path,response.status,detail);
    return "";
  }
  const payload=await response.json().catch(()=>null);
  let signedRaw="";
  if(Array.isArray(payload)&&payload[0]){
    signedRaw=String(payload[0]?.signedURL||payload[0]?.signedUrl||"").trim();
  }else if(Array.isArray(payload?.signedURLs)&&payload.signedURLs[0]){
    signedRaw=String(payload.signedURLs[0]?.signedURL||payload.signedURLs[0]?.signedUrl||"").trim();
  }else if(Array.isArray(payload?.signedUrls)&&payload.signedUrls[0]){
    signedRaw=String(payload.signedUrls[0]?.signedURL||payload.signedUrls[0]?.signedUrl||"").trim();
  }
  if(!signedRaw) return "";
  return toAbsoluteSupabaseSignedUrl(signedRaw);
}
async function requestArtistScopedBlobByPath(path,headers){
  const encodedPath=encodeStoragePath(path);
  if(!encodedPath) return "";
  const endpoints=[
    `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BRIEF_BUCKET}/${encodedPath}`,
    `${SUPABASE_URL}/storage/v1/object/authenticated/${SUPABASE_BRIEF_BUCKET}/${encodedPath}`
  ];
  for(const endpoint of endpoints){
    const response=await fetch(endpoint,{method:"GET",headers});
    if(!response.ok){
      const detail=await response.text().catch(()=>`HTTP ${response.status}`);
      console.warn("artist direct blob failed",path,response.status,detail);
      continue;
    }
    const blob=await response.blob().catch(()=>null);
    if(!blob) continue;
    const blobUrl=URL.createObjectURL(blob);
    briefObjectUrls.push(blobUrl);
    return blobUrl;
  }
  return "";
}
async function createArtistScopedSignedUrl(path){
  if(!SUPABASE_SECURE_PRIVATE_ARTIST_BRIEF_MODE) return "";
  if(role!=="artist"||!activeArtist||!artistPinSession) return "";
  const candidates=expandStoragePathVariants(path);
  if(!candidates.length) return "";
  const headers={
    "Content-Type":"application/json",
    "apikey":SUPABASE_PUBLISHABLE_KEY,
    [SUPABASE_ARTIST_ID_HEADER]:activeArtist,
    [SUPABASE_ARTIST_PIN_HEADER]:artistPinSession
  };
  try{
    for(const candidate of candidates){
      const byPath=await requestArtistScopedSignedUrlByPath(candidate,headers);
      if(byPath) return byPath;
      const byBody=await requestArtistScopedSignedUrlByBody(candidate,headers);
      if(byBody) return byBody;
      const byBlob=await requestArtistScopedBlobByPath(candidate,headers);
      if(byBlob) return byBlob;
    }
  }catch(err){
    console.warn("createArtistScopedSignedUrl exception",path,err);
  }
  console.warn("createArtistScopedSignedUrl exhausted candidates",candidates);
  return "";
}
async function uploadProjectPdf(file,projectId,group){
  if(!file) return null;
  if(!db||!currentUser||currentProfile?.role!=="admin") throw new Error("Session admin tidak ditemukan untuk upload file.");
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
  const path=`${projectId}/${group}-${Date.now()}-${safeName}`;
  const {error:uploadError}=await db.storage.from(SUPABASE_BRIEF_BUCKET).upload(path,file,{upsert:true,contentType:file.type||"application/pdf"});
  if(uploadError) throw uploadError;
  return {name:file.name,path,url:""};
}
async function createSignedBriefUrl(path){
  const rawPath=String(path||"").trim();
  if(!rawPath) return "";
  if(/^https?:\/\//i.test(rawPath)){
    const isSupabaseStorageUrl=/\/storage\/v1\/object\//i.test(rawPath)&&rawPath.includes(SUPABASE_BRIEF_BUCKET);
    if(!isSupabaseStorageUrl) return rawPath;
  }
  if(!db) return "";
  const pathCandidates=normalizeBriefStoragePathCandidates(rawPath);
  if(!pathCandidates.length) return "";
  if(SUPABASE_SECURE_PRIVATE_ARTIST_BRIEF_MODE&&role==="artist"){
    for(const candidate of pathCandidates){
      const artistScopedUrl=await createArtistScopedSignedUrl(candidate);
      if(artistScopedUrl) return artistScopedUrl;
    }
    return "";
  }
  const canUseAnonymousFallback=!(role==="admin"&&currentProfile?.role==="admin");
  let sessionUser=null;
  try{
    const {data:sessionData,error:sessionError}=await db.auth.getSession();
    if(sessionError) console.warn("createSignedBriefUrl getSession warning",sessionError);
    sessionUser=sessionData?.session?.user||null;
  }catch(err){
    console.warn("createSignedBriefUrl getSession error",err);
  }
  if(!sessionUser&&canUseAnonymousFallback&&!anonymousViewerUnavailable){
    const {error:anonError}=await db.auth.signInAnonymously();
    if(anonError){
      if(isAnonymousDisabledError(anonError)){
        markAnonymousViewerUnavailable(anonError);
        console.warn("createSignedBriefUrl skipped anonymous sign-in: disabled by project setting.");
      }else{
        console.error("createSignedBriefUrl anonymous sign-in failed",anonError);
      }
    }else{
    const {data:userData,error:userError}=await db.auth.getUser();
      if(userError||!userData?.user){
        console.error("createSignedBriefUrl anonymous user not found",userError);
      }else{
        sessionUser=userData.user;
      }
    }
  }
  if(sessionUser) currentUser=sessionUser;
  for(const candidate of pathCandidates){
    const {data:signed,error}=await db.storage.from(SUPABASE_BRIEF_BUCKET).createSignedUrl(candidate,SUPABASE_SIGNED_URL_TTL);
    if(!error&&signed?.signedUrl) return signed.signedUrl;
    if(error) console.warn("createSignedBriefUrl signedUrl failed",candidate,error.message||error);
  }
  if(canUseAnonymousFallback&&!anonymousViewerUnavailable){
    try{
      const {error:retryAnonError}=await db.auth.signInAnonymously();
      if(retryAnonError){
        if(isAnonymousDisabledError(retryAnonError)){
          markAnonymousViewerUnavailable(retryAnonError);
          console.warn("createSignedBriefUrl retry skipped: anonymous sign-in disabled.");
        }else{
          console.warn("createSignedBriefUrl retry anonymous sign-in failed",retryAnonError);
        }
      }else{
        for(const candidate of pathCandidates){
          const {data:signed,error}=await db.storage.from(SUPABASE_BRIEF_BUCKET).createSignedUrl(candidate,SUPABASE_SIGNED_URL_TTL);
          if(!error&&signed?.signedUrl) return signed.signedUrl;
          if(error) console.warn("createSignedBriefUrl retry signedUrl failed",candidate,error.message||error);
        }
      }
    }catch(err){
      console.warn("createSignedBriefUrl retry anonymous exception",err);
    }
  }
  for(const candidate of pathCandidates){
    const {data:blob,error}=await db.storage.from(SUPABASE_BRIEF_BUCKET).download(candidate);
    if(!error&&blob){
      const blobUrl=URL.createObjectURL(blob);
      briefObjectUrls.push(blobUrl);
      return blobUrl;
    }
    if(error) console.warn("createSignedBriefUrl download fallback failed",candidate,error.message||error);
  }
  return "";
}
async function verifyArtistPinRemote(artistId,pin){
  if(!db||!artistId||!pin) return false;
  const {data:ok,error}=await db.rpc(RPC_ARTIST_VERIFY_PIN,{p_artist_id:artistId,p_pin:pin});
  if(error){ console.error("verifyArtistPinRemote error",error); return false; }
  return Boolean(ok);
}
async function adminSetArtistPinRemote(artistId,pin){
  if(!db||!artistId||!pin) return false;
  const {data:ok,error}=await db.rpc(RPC_ADMIN_SET_ARTIST_PIN,{p_artist_id:artistId,p_pin:pin});
  if(error){ console.error("adminSetArtistPinRemote error",error); return false; }
  return Boolean(ok);
}
async function adminDeleteArtistPinRemote(artistId){
  if(!db||!artistId) return false;
  const {data:ok,error}=await db.rpc(RPC_ADMIN_DELETE_ARTIST_PIN,{p_artist_id:artistId});
  if(error){ console.error("adminDeleteArtistPinRemote error",error); return false; }
  return Boolean(ok);
}
async function artistChangeOwnPinRemote(artistId,currentPin,newPin){
  if(!db||!artistId||!currentPin||!newPin) return false;
  const {data:ok,error}=await db.rpc(RPC_ARTIST_CHANGE_PIN,{p_artist_id:artistId,p_current_pin:currentPin,p_new_pin:newPin});
  if(error){ console.error("artistChangeOwnPinRemote error",error); return false; }
  return Boolean(ok);
}
