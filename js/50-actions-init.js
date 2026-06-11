async function setOrResetTeamArtistPin(id){
  const artist=data.artists.find(a=>a.id===id);
  if(!artist){ alert("Artist tidak ditemukan."); return; }
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengubah PIN artist.")) return;
  const actionLabel=artist.pinConfigured?"reset":"set";
  const rawPin=prompt(`Masukkan PIN baru untuk ${artist.name} (minimal 4 karakter). Tekan Cancel untuk batal ${actionLabel}.`);
  if(rawPin===null) return;
  const nextPin=String(rawPin).trim();
  if(nextPin.length<4){ alert("PIN artist minimal 4 karakter."); return; }
  const ok=await adminSetArtistPinRemote(id,nextPin);
  if(!ok){
    alert("Gagal menyimpan PIN artist ke Supabase.");
    return;
  }
  data.artists=data.artists.map(a=>a.id===id?{...a,pinConfigured:true}:a);
  saveData();
  renderAll();
  alert(`PIN untuk ${artist.name} berhasil diperbarui.`);
}
async function deleteTeamArtist(id){
  if(!requireVerifiedAdmin("Hanya admin yang boleh hapus artist.")) return;
  const used=allJobs().some(j=>j.a.artistId===id);
  if(used){ alert("Artist ini masih dipakai di pekerjaan. Ganti PIC dulu sebelum hapus."); return; }
  if(!confirm("Hapus artist ini dari Team?")) return;
  if(db){
    const ok=await adminDeleteArtistPinRemote(id);
    if(!ok){
      alert("Gagal menghapus kredensial PIN artist di Supabase.");
      return;
    }
  }
  data.artists=data.artists.filter(a=>a.id!==id);
  if(activeArtist===id) activeArtist="";
  saveData(); renderAll();
}
function projectById(id){ return data.projects.find(p=>p.id===id); }
function allocationById(p,id){ return (p.allocations||[]).find(a=>a.id===id); }
function updateJob(pid,aid,field,value){
  if(["adminFeedback","adminRevisionNote"].includes(field)&&!requireVerifiedAdmin("Feedback admin hanya bisa diisi oleh admin.")) return;
  const p=projectById(pid), a=p&&allocationById(p,aid); if(!a) return;
  a[field]=field==="artistProgress"?Math.max(0,Math.min(100,Number(value)||0)):value;
  a.lastArtistUpdate=new Date().toISOString();
  saveData(); renderAll();
}
function quick(pid,aid,status){
  const adminOnlyStatuses=["Approved","Payable","Paid"];
  if(adminOnlyStatuses.includes(status)&&!requireVerifiedAdmin(`Status ${status} hanya bisa diubah oleh admin.`)) return;
  const p=projectById(pid), a=p&&allocationById(p,aid); if(!a) return;
  const job={p,a};
  const previousStatus=String(a.workStatus||"Booked");
  if(isDependency(job)&&["In Progress","Submitted"].includes(status)){
    const dep=dependencyTarget(job);
    alert(`Tidak bisa mengubah ke ${status}. Dependency masih aktif. Tunggu ${dep?.role||"pekerjaan sebelumnya"} minimal berstatus In Progress terlebih dahulu.`);
    renderAll();
    return;
  }
  if(isApprovalDependencyLocked(job)&&["Approved","Payable","Paid"].includes(status)){
    const dep=dependencyTarget(job);
    alert(`Tidak bisa mengubah ke ${status}. Untuk approve/payroll, tunggu ${dep?.role||"pekerjaan sebelumnya"} berstatus Approved / Payable / Paid terlebih dahulu.`);
    renderAll();
    return;
  }
  if(["Approved","Payable","Paid"].includes(a.workStatus)&&!["Revision Hold","Blocked","Payable","Paid"].includes(status)){
    if(!isVerifiedAdmin()){
      alert("Pekerjaan sudah dikunci admin. Ubah dari Admin Monitor jika memang perlu koreksi.");
      return;
    }
  }
  a.workStatus=status;
  if(status==="In Progress"&&!a.startDate) a.startDate=today();
  if(["Submitted","Approved"].includes(status)&&!a.doneDate) a.doneDate=today();
  if(status==="Paid"&&!a.paidDate) a.paidDate=today();
  if(["Approved","Payable"].includes(status)) a.paidDate="";
  a.lastArtistUpdate=new Date().toISOString();
  if(role==="artist"){
    notifyAdminAboutArtistUpdate(job,{previousStatus});
  }else if(isVerifiedAdmin()){
    notifyArtistAboutAdminAction(job,{previousStatus});
  }
  saveData(); renderAll();
}
function applyRevisionReason(allocation,note){
  const message=String(note||"").trim()||"Perlu revisi dari admin.";
  allocation.workStatus="Revision Hold";
  allocation.adminRevisionNote=message;
  allocation.adminFeedback=message;
  allocation.lastArtistUpdate=new Date().toISOString();
}
function openRevisionModal(pid,aid){
  if(!requireVerifiedAdmin("Aksi minta revisi hanya untuk admin.")) return;
  const p=projectById(pid), a=p&&allocationById(p,aid); if(!a) return;
  const currentReason=getAdminRevisionReason(a);
  window.revisionModal_pid=pid;
  window.revisionModal_aid=aid;
  const title=document.getElementById("revision-title");
  const context=document.getElementById("revision-context");
  const note=document.getElementById("revision-note");
  if(title) title.textContent=a.workStatus==="Revision Hold"?"Ubah Alasan Revisi":"Minta Revisi";
  if(context) context.textContent=`${workerDisplayName(a)} - ${p.client} - ${p.name}`;
  if(note) note.value=currentReason||"";
  document.getElementById("revision-modal")?.classList.add("active");
  setTimeout(()=>note?.focus(),0);
}
function requestRevision(pid,aid){ openRevisionModal(pid,aid); }
function editRevisionReason(pid,aid){
  if(!requireVerifiedAdmin("Aksi ini hanya untuk admin.")) return;
  openRevisionModal(pid,aid);
}
function closeRevisionModal(){
  document.getElementById("revision-modal")?.classList.remove("active");
  window.revisionModal_pid="";
  window.revisionModal_aid="";
}
function saveRevisionModal(){
  if(!requireVerifiedAdmin("Aksi minta revisi hanya untuk admin.")) return;
  const pid=window.revisionModal_pid, aid=window.revisionModal_aid;
  const p=projectById(pid), a=p&&allocationById(p,aid); if(!a) return;
  const previousStatus=String(a.workStatus||"Booked");
  const note=document.getElementById("revision-note")?.value||"";
  applyRevisionReason(a,note);
  notifyArtistAboutAdminAction({p,a},{previousStatus,note,force:true});
  closeRevisionModal();
  saveData(); renderAll();
}
function openSubmitTypeModal(pid,aid){
  window.submitModal_pid=pid;
  window.submitModal_aid=aid;
  document.getElementById("submit-type-modal").classList.add("active");
}
function closeSubmitTypeModal(){
  document.getElementById("submit-type-modal").classList.remove("active");
}
function submitJobWithType(type){
  const pid=window.submitModal_pid, aid=window.submitModal_aid;
  if(!pid||!aid) return;
  closeSubmitTypeModal();
  const p=projectById(pid), a=p&&allocationById(p,aid);
  if(!a) return;
  a.submissionType=type;
  quick(pid,aid,"Submitted");
}
function submitJob(pid,aid){ openSubmitTypeModal(pid,aid); }
async function openBrief(pid){
  clearBriefObjectUrls();
  const p=projectById(pid); if(!p) return;
  const briefPdfSource=p.expressionPdfData||p.expressionPdfPath||p.briefPdfData||"";
  const freebiePdfSource=p.freebieRequirementPdfData||p.freebieRequirementPdfPath||p.freebiePdfData||"";
  const briefPdfUrl=await createSignedBriefUrl(briefPdfSource);
  const freebiePdfUrl=await createSignedBriefUrl(freebiePdfSource);
  document.getElementById("brief-title").textContent=`${p.client} - ${p.name}`;
  const driveLink=(label,url)=>url?`<a class="inline-flex btn text-xs mr-2 mt-2" target="_blank" href="${esc(url)}">${esc(label)}</a>`:`<span class="text-slate-500 text-xs mr-2">Belum ada ${esc(label)}.</span>`;
  const pdfLink=(label,url,source)=>{
    if(url) return `<a class="inline-flex btn text-xs mr-2 mt-2" target="_blank" href="${esc(url)}">${esc(label)}</a>`;
    if(!source) return `<span class="text-slate-500 text-xs mr-2">Belum ada ${esc(label)}.</span>`;
    if(role==="artist"&&SUPABASE_SECURE_PRIVATE_ARTIST_BRIEF_MODE){
      return `<span class="text-amber-300 text-xs mr-2">PDF ada, tapi akses private gagal. Cek SQL policy storage artist scoped + pastikan PIN artist valid.</span>`;
    }
    if(role==="artist"&&anonymousViewerUnavailable){
      return `<span class="text-amber-300 text-xs mr-2">PDF ada, tapi akses artist butuh Anonymous Auth ON.</span>`;
    }
    return `<span class="text-amber-300 text-xs mr-2">File ${esc(label)} ada, tapi link akses gagal dibuat.</span>`;
  };
  const formatText=(txt)=>esc(txt).replace(/\n/g,"<br>").replace(/  /g,"&nbsp;&nbsp;");
  document.getElementById("brief-body").innerHTML=[
    ["Status Requirement",p.briefStatus],["Instruksi Artist",p.artistInstruction||"Belum ada instruksi."],
  ].map(x=>`<div class="bg-slate-900 rounded-xl p-4"><p class="mono text-[10px] text-slate-500">${x[0].toUpperCase()}</p><p class="mt-1 whitespace-pre-wrap leading-relaxed">${formatText(x[1])}</p></div>`).join("")+
  `<div class="bg-slate-900 rounded-xl p-4"><p class="mono text-[10px] text-slate-500">LINK DRIVE REQUIREMENT</p>${driveLink("Brief / Requirement",p.briefLink)}${driveLink("Requirement Freebie",p.freebieRequirementNotes)}</div>`+
  `<div class="bg-slate-900 rounded-xl p-4"><p class="mono text-[10px] text-slate-500">PDF REQUIREMENT</p>${pdfLink("PDF Brief",briefPdfUrl,briefPdfSource)}${pdfLink("PDF Freebie",freebiePdfUrl,freebiePdfSource)}</div>`+
  (p.briefLink?`<a class="text-sky-300 text-sm" target="_blank" href="${esc(p.briefLink)}">Buka brief/reference</a>`:"");
  document.getElementById("brief-modal").classList.add("active");
}
function closeBrief(){
  clearBriefObjectUrls();
  document.getElementById("brief-modal").classList.remove("active");
}
function triggerImportSeed(){
  if(!requireVerifiedAdmin("Import dari Studio hanya untuk admin yang sudah login.")) return;
  document.getElementById("seed-file").click();
}
function importSeedFile(input){
  if(!isVerifiedAdmin()){
    alert("Import dari Studio hanya untuk admin yang sudah login.");
    if(input) input.value="";
    openLogin("admin");
    return;
  }
  const file=input.files?.[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const payload=JSON.parse(String(reader.result||"{}"));
      if(!["KURAMASH_ERP_TOOLS","KURAMASH_ERP_TEAM"].includes(payload.app)) throw new Error("bad");
      const rawArtists=Array.isArray(payload.artists)?payload.artists:[];
      const pinCandidates=rawArtists
        .map(raw=>({id:String(raw?.id||""),name:String(raw?.name||"Artist"),pin:readImportedPin(raw)}))
        .filter(x=>x.id&&x.pin);
      const candidateIds=new Set(pinCandidates.map(x=>x.id));
      const syncedPinIds=new Set();
      const failedPinNames=[];
      let pinSynced=0;
      if(db&&role==="admin"&&currentProfile?.role==="admin"){
        for(const item of pinCandidates){
          const ok=await adminSetArtistPinRemote(item.id,item.pin);
          if(ok){
            pinSynced+=1;
            syncedPinIds.add(item.id);
          }else{
            failedPinNames.push(item.name);
          }
        }
      }
      data={
        artists:sanitizeArtists(rawArtists),
        projects:sanitizeProjects(payload.projects),
        updatedAt:new Date().toISOString()
      };
      data.artists=data.artists.map(artist=>{
        if(!candidateIds.has(artist.id)) return {...artist,pinConfigured:Boolean(artist.pinConfigured)};
        return {...artist,pinConfigured:syncedPinIds.has(artist.id)};
      });
      saveData();
      const snapshotSaved=await saveRemoteSnapshot();
      if(!snapshotSaved){
        alert("Import lokal berhasil, tapi sinkron snapshot ke Supabase gagal. Pastikan login admin valid dan koneksi tidak diblokir.");
      }
      if(pinCandidates.length===0){
        alert("Data Team berhasil dimasukkan. Tidak ada field PIN di file import, jadi artist belum bisa login PIN sampai PIN diset oleh admin.");
        renderAll();
        return;
      }
      if(pinSynced===pinCandidates.length){
        alert(`Data Team berhasil dimasukkan. ${pinSynced} PIN artist berhasil diamankan ke Supabase.`);
        renderAll();
        return;
      }
      const failCount=pinCandidates.length-pinSynced;
      const previewFailed=failedPinNames.slice(0,3).join(", ");
      alert(`Data Team masuk, tapi ${failCount}/${pinCandidates.length} PIN artist gagal tersimpan ke database.${previewFailed?` Contoh: ${previewFailed}`:""} Re-import lagi setelah pastikan login admin dan SQL hardening sudah terpasang penuh.`);
      renderAll();
    }catch(e){
      alert("File tidak cocok. Gunakan file Team dari Studio atau export Team sebelumnya.");
    }
  };
  reader.readAsText(file);
}
function exportToolsUpdate(){
  if(!requireVerifiedAdmin("Export update team hanya untuk admin.")) return;
  const payload={app:"KURAMASH_ERP_TEAM",type:"update",version:"1.0",exportedAt:new Date().toISOString(),artists:sanitizeArtists(data.artists),projects:sanitizeProjects(data.projects)};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`kuramash-team-data-${today()}.json`; a.click(); URL.revokeObjectURL(url);
}
function payrollExportDefaultMonth(){
  if(isMonthKey(payrollMonthFilter)&&payrollMonthFilter!=="all") return payrollMonthFilter;
  if(isMonthKey(payrollTargetMonth)) return payrollTargetMonth;
  return currentMonthKey();
}
function payrollExportStatuses(){
  return new Set(["Approved","Payable","Paid"]);
}
function payrollRowsForMonth(month){
  const allowedStatuses=payrollExportStatuses();
  return allJobs().filter(job=>{
    const status=String(job?.a?.workStatus||"");
    return allowedStatuses.has(status)&&payrollMonthForAllocation(job.a)===month;
  }).sort((a,b)=>{
    const workerCmp=workerDisplayName(a.a).localeCompare(workerDisplayName(b.a),"id",{sensitivity:"base"});
    if(workerCmp) return workerCmp;
    const clientCmp=String(a.p?.client||"").localeCompare(String(b.p?.client||""),"id",{sensitivity:"base"});
    if(clientCmp) return clientCmp;
    return String(a.p?.name||"").localeCompare(String(b.p?.name||""),"id",{sensitivity:"base"});
  });
}
function collectPayrollMonthExportProjects(month){
  const allowedStatuses=payrollExportStatuses();
  return (data.projects||[]).map(project=>{
    const allocations=(project.allocations||[]).filter(allocation=>{
      const status=String(allocation?.workStatus||"");
      return allowedStatuses.has(status)&&payrollMonthForAllocation(allocation)===month;
    });
    return allocations.length?{...project,allocations}:null;
  }).filter(Boolean);
}
function buildPayrollMonthSummary(projects){
  const statusCounts={Approved:0,Payable:0,Paid:0};
  const artistCounts={};
  let allocationCount=0;
  for(const project of projects||[]){
    for(const allocation of project.allocations||[]){
      allocationCount+=1;
      const status=String(allocation?.workStatus||"");
      if(Object.prototype.hasOwnProperty.call(statusCounts,status)) statusCounts[status]+=1;
      const artist=workerDisplayName(allocation);
      artistCounts[artist]=(artistCounts[artist]||0)+1;
    }
  }
  return {projectCount:(projects||[]).length,allocationCount,statusCounts,artistCounts};
}
function buildPayrollMonthPayload(month){
  const payrollProjects=collectPayrollMonthExportProjects(month);
  return {
    app:"KURAMASH_ERP_TEAM",
    type:"update",
    exportMode:"payroll_month",
    version:"1.0",
    exportedAt:new Date().toISOString(),
    payrollMonth:month,
    payrollMonthLabel:monthLabel(month),
    artists:sanitizeArtists(data.artists),
    projects:sanitizeProjects(payrollProjects),
    payrollSummary:buildPayrollMonthSummary(payrollProjects)
  };
}
function payrollExportPreviewRow(job){
  const status=String(job?.a?.workStatus||"-");
  const month=payrollMonthForAllocation(job.a);
  return `<div class="bg-slate-900 rounded-xl p-3 grid grid-cols-1 md:grid-cols-[1fr_.8fr_.7fr] gap-2">
    <div>
      <p class="font-semibold">${esc(workerDisplayName(job.a))}</p>
      <p class="text-xs text-slate-400">${esc(job.a?.role||"-")} - ${esc(job.a?.serviceType||"Custom")}</p>
    </div>
    <div>
      <p class="text-sm">${esc(job.p?.client||"-")}</p>
      <p class="text-xs text-slate-400">${esc(job.p?.name||"-")}</p>
    </div>
    <div class="md:text-right">
      <p class="text-sm">${esc(status)}</p>
      <p class="text-xs text-slate-400">${esc(month?monthLabel(month):"Tanpa bulan")} / ${esc(payrollDateLabel(job.a))}</p>
    </div>
  </div>`;
}
function renderPayrollExportPreview(month){
  const payload=buildPayrollMonthPayload(month);
  const rows=payrollRowsForMonth(month);
  const summary=payload.payrollSummary;
  const title=document.getElementById("payroll-export-preview-title");
  const meta=document.getElementById("payroll-export-preview-meta");
  const body=document.getElementById("payroll-export-preview-body");
  const button=document.getElementById("payroll-export-confirm-btn");
  if(title) title.textContent=`Preview Payroll ${monthLabel(month)}`;
  if(meta){
    meta.innerHTML=`${summary.allocationCount} task dari ${summary.projectCount} project. Approved: ${summary.statusCounts.Approved} / Payable: ${summary.statusCounts.Payable} / Paid: ${summary.statusCounts.Paid}`;
  }
  if(body){
    const artistSummary=Object.entries(summary.artistCounts||{}).sort((a,b)=>a[0].localeCompare(b[0],"id",{sensitivity:"base"}));
    body.innerHTML=`
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div class="bg-slate-900 rounded-xl p-3"><p class="mono text-[10px] text-slate-500">TASK</p><p class="font-bold text-lg">${summary.allocationCount}</p></div>
        <div class="bg-slate-900 rounded-xl p-3"><p class="mono text-[10px] text-slate-500">PROJECT</p><p class="font-bold text-lg">${summary.projectCount}</p></div>
        <div class="bg-slate-900 rounded-xl p-3"><p class="mono text-[10px] text-slate-500">PAYABLE</p><p class="font-bold text-lg">${summary.statusCounts.Payable}</p></div>
        <div class="bg-slate-900 rounded-xl p-3"><p class="mono text-[10px] text-slate-500">PAID</p><p class="font-bold text-lg">${summary.statusCounts.Paid}</p></div>
      </div>
      <div class="bg-slate-950/40 border border-white/10 rounded-xl p-3">
        <p class="mono text-[10px] text-slate-500 mb-2">RINGKASAN ARTIST</p>
        <div class="flex flex-wrap gap-2">${artistSummary.map(([name,count])=>`<span class="pill ok">${esc(name)}: ${count}</span>`).join("")||`<span class="text-slate-400 text-sm">Belum ada artist.</span>`}</div>
      </div>
      <div class="space-y-2">${rows.map(payrollExportPreviewRow).join("")}</div>
    `;
  }
  if(button) button.textContent=`Download ${summary.allocationCount} Task`;
}
function exportPayrollMonth(monthValue){
  if(!requireVerifiedAdmin("Export payroll bulanan hanya untuk admin.")) return;
  const rawMonth=monthValue||prompt("Export payroll untuk bulan apa? (format YYYY-MM)",payrollExportDefaultMonth());
  if(rawMonth===null) return;
  const month=String(rawMonth||"").trim();
  if(!isMonthKey(month)){
    alert("Bulan tidak valid. Gunakan format YYYY-MM.");
    return;
  }
  const payrollProjects=collectPayrollMonthExportProjects(month);
  if(!payrollProjects.length){
    alert(`Belum ada payroll Approved / Payable / Paid untuk ${monthLabel(month)}.`);
    return;
  }
  payrollExportPreviewMonth=month;
  renderPayrollExportPreview(month);
  document.getElementById("payroll-export-preview-modal")?.classList.add("active");
}
function closePayrollExportPreview(){
  document.getElementById("payroll-export-preview-modal")?.classList.remove("active");
}
function readPayrollExportHistory(){
  try{
    const parsed=JSON.parse(localStorage.getItem(PAYROLL_EXPORT_HISTORY_KEY)||"[]");
    return Array.isArray(parsed)?parsed:[];
  }catch(e){
    return [];
  }
}
function savePayrollExportHistory(history){
  localStorage.setItem(PAYROLL_EXPORT_HISTORY_KEY,JSON.stringify((history||[]).slice(0,30)));
}
function recordPayrollExportHistory(payload,filename){
  const summary=payload?.payrollSummary||{};
  const entry={
    id:uid(),
    exportedAt:payload.exportedAt||new Date().toISOString(),
    month:payload.payrollMonth||"",
    monthLabel:payload.payrollMonthLabel||monthLabel(payload.payrollMonth||""),
    filename,
    projectCount:Number(summary.projectCount)||0,
    allocationCount:Number(summary.allocationCount)||0,
    statusCounts:summary.statusCounts||{},
    admin:currentUser?.email||currentUser?.id||"Admin"
  };
  savePayrollExportHistory([entry,...readPayrollExportHistory()]);
}
function confirmPayrollMonthExport(){
  if(!requireVerifiedAdmin("Export payroll bulanan hanya untuk admin.")) return;
  const month=String(payrollExportPreviewMonth||"").trim();
  if(!isMonthKey(month)){
    alert("Bulan preview export tidak valid. Buka ulang export payroll.");
    return;
  }
  const payload=buildPayrollMonthPayload(month);
  if(!payload.payrollSummary.allocationCount){
    alert(`Belum ada payroll Approved / Payable / Paid untuk ${monthLabel(month)}.`);
    closePayrollExportPreview();
    return;
  }
  const filename=`kuramash-payroll-${month}.json`;
  downloadJsonFile(payload,filename);
  recordPayrollExportHistory(payload,filename);
  closePayrollExportPreview();
  renderTeamPayroll();
  alert(`Export payroll ${monthLabel(month)} selesai. ${payload.payrollSummary.allocationCount} task dari ${payload.payrollSummary.projectCount} project masuk file.`);
}
function clearPayrollExportHistory(){
  if(!requireVerifiedAdmin("Riwayat export payroll hanya untuk admin.")) return;
  if(!confirm("Hapus riwayat export payroll lokal di browser ini?")) return;
  localStorage.removeItem(PAYROLL_EXPORT_HISTORY_KEY);
  renderTeamPayroll();
}
function openExportModal(){
  if(!requireVerifiedAdmin("Export data hanya untuk admin.")) return;
  document.getElementById("export-modal")?.classList.add("active");
}
function closeExportModal(){
  document.getElementById("export-modal")?.classList.remove("active");
}
function exportOnlyFromModal(){
  closeExportModal();
  exportToolsUpdate();
}
function exportPayrollMonthFromModal(){
  closeExportModal();
  exportPayrollMonth();
}
function exportAndClearFromModal(){
  closeExportModal();
  void exportAndClearApprovedProjects();
}
function collectCleanupEligibleProjects(){
  return (data.projects||[]).filter(project=>isProjectApprovedForCleanup(project));
}
async function exportAndClearApprovedProjects(){
  if(!requireVerifiedAdmin("Aksi export + hapus hanya untuk admin.")) return;
  const candidates=collectCleanupEligibleProjects();
  const carryOverCount=(data.projects||[]).length-candidates.length;
  if(!candidates.length){
    alert("Belum ada project yang semuanya berstatus Approved/Payable/Paid.");
    return;
  }
  const preview=candidates.slice(0,3).map(p=>`${p.client} - ${p.name}`).join(", ");
  if(!confirm(`Export update sekarang lalu hapus ${candidates.length} project approved dari daftar aktif?${preview?`\nContoh: ${preview}`:""}${carryOverCount?`\n${carryOverCount} project belum full approved tetap disimpan untuk bulan depan.`:""}`)) return;
  exportToolsUpdate();
  let cleanup={deleted:0};
  try{
    cleanup=await deleteProjectsPdfFiles(candidates);
  }catch(err){
    console.error("exportAndClearApprovedProjects PDF cleanup error",err);
    alert(`Export sudah dibuat, tapi PDF project gagal dihapus dari Supabase Storage: ${err?.message||err}`);
    return;
  }
  const deleteIds=new Set(candidates.map(p=>p.id));
  data.projects=(data.projects||[]).filter(p=>!deleteIds.has(p.id));
  adminBulkSelectedAllocationIds.clear();
  saveData();
  renderAll();
  alert(`Export selesai. ${candidates.length} project approved sudah dihapus dari list aktif.${cleanup.deleted?` PDF terhapus: ${cleanup.deleted}.`:""}${carryOverCount?` ${carryOverCount} project belum full approved tetap aktif untuk bulan depan.`:""}`);
}
function slugRoleName(value){
  return String(value||"role")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")||"role";
}
function buildLegacySingleRoleArtists(artists){
  const source=sanitizeArtists(artists);
  const out=[];
  for(const artist of source){
    const roles=normalizeArtistRoles(artist.roles||artist.role);
    const fallbackRoles=roles.length?roles:["Illustration"];
    fallbackRoles.forEach((roleName,index)=>{
      const role=String(roleName||"Illustration").trim()||"Illustration";
      const splitId=fallbackRoles.length>1?`${artist.id}__${slugRoleName(role)}_${index+1}`:artist.id;
      out.push({
        id:splitId,
        name:artist.name,
        role,
        pin:String(artist?.pin||"")
      });
    });
  }
  return out;
}
function buildLegacyCatalogPayload(includePackage,includeArtist){
  const mode=includePackage&&includeArtist?"all":includeArtist?"artist_only":"package_only";
  return {
    app:"KURAMASH_ERP_CATALOG",
    type:"catalog",
    version:"1.0",
    exportedAt:new Date().toISOString(),
    mode,
    note:"Catalog sync untuk ERP Team. File ini tidak membawa project berjalan.",
    artists:includeArtist?buildLegacySingleRoleArtists(data.artists):[],
    packages:[],
    splitConversions:[],
    packageTemplates:includePackage?packageTemplates:{}
  };
}
function buildPackageTemplateUsage(){
  const usage={};
  for(const project of data.projects||[]){
    const key=String(project?.packageType||"Custom");
    usage[key]=(usage[key]||0)+1;
  }
  return usage;
}
function downloadJsonFile(payload,filename){
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=filename;
  link.click();
  URL.revokeObjectURL(url);
}
function exportPackageTemplates(){
  if(!requireVerifiedAdmin("Export data paket hanya untuk admin.")) return;
  const payload={
    app:"KURAMASH_ERP_TEAM",
    type:"package_templates",
    version:"1.0",
    exportedAt:new Date().toISOString(),
    templates:packageTemplates,
    usageByProject:buildPackageTemplateUsage()
  };
  downloadJsonFile(payload,`kuramash-package-templates-${today()}.json`);
}
function exportSetupData(){
  if(!requireVerifiedAdmin("Export data setup hanya untuk admin.")) return;
  const optionRaw=prompt(
    "Pilih jenis export setup:\n1 = Paket saja\n2 = Artist saja\n3 = Paket + Artist",
    "3"
  );
  if(optionRaw===null) return;
  const option=String(optionRaw).trim();
  const includePackage=option==="1"||option==="3";
  const includeArtist=option==="2"||option==="3";
  if(!includePackage&&!includeArtist){
    alert("Pilihan tidak dikenali. Gunakan 1, 2, atau 3.");
    return;
  }
  let compatibilitySplit=false;
  if(includeArtist){
    compatibilitySplit=confirm(
      "Aktifkan mode kompatibilitas website lama?\nOK = artist multi-role dipecah jadi beberapa artist single-role.\nCancel = tetap format multi-role normal."
    );
  }
  const payload=compatibilitySplit
    ?buildLegacyCatalogPayload(includePackage,includeArtist)
    :{
      app:"KURAMASH_ERP_TEAM",
      type:"setup_data",
      version:"1.0",
      exportedAt:new Date().toISOString()
    };
  if(!compatibilitySplit){
    if(includePackage){
      payload.templates=packageTemplates;
      payload.usageByProject=buildPackageTemplateUsage();
    }
    if(includeArtist){
      payload.artists=sanitizeArtists(data.artists);
      payload.artistFormat="multi_role";
    }
  }
  let filename=`kuramash-setup-data-${today()}.json`;
  if(includePackage&&!includeArtist) filename=`kuramash-setup-package-${today()}.json`;
  if(includeArtist&&!includePackage) filename=`kuramash-setup-artist-${today()}.json`;
  if(includeArtist&&compatibilitySplit){
    filename=includePackage&&includeArtist
      ?`kuramash-team-catalog-paket-artist-${today()}.json`
      :filename.replace(".json","-legacy.json");
  }
  downloadJsonFile(payload,filename);
  alert(`Export selesai: ${includePackage&&includeArtist?"paket + artist":includePackage?"paket":"artist"}${includeArtist&&compatibilitySplit?" (legacy split role aktif)":""}.`);
}
function renderDataStatus(){
  const el=document.getElementById("data-status"); if(!el) return;
  el.innerHTML=`Artist: <b>${data.artists.length}</b><br>Project: <b>${data.projects.length}</b><br>Worker task: <b>${allJobs().length}</b><br>Update terakhir: <b>${data.updatedAt?new Date(data.updatedAt).toLocaleString("id-ID"):"Belum ada"}</b>`;
}
function openPinModal(){
  if(role!=="artist"){ alert("PIN pribadi hanya untuk artist."); return; }
  if(!artistLockedId){ alert("Session artist belum valid. Login artist dulu."); openLogin("artist"); return; }
  document.getElementById("new-pin").value="";
  document.getElementById("pin-modal").classList.add("active");
}
function closePinModal(){ document.getElementById("pin-modal").classList.remove("active"); }
function returnToProgress(pid,aid){
  if(!requireVerifiedAdmin("Hanya admin yang bisa return ke progress.")) return;
  const p=projectById(pid), a=p&&allocationById(p,aid);
  if(!a) return;
  if(a.submissionType!=="progress"){
    alert("Hanya progress submissions yang bisa di-return tanpa revisi.");
    return;
  }
  if(!confirm("Return allocation ini ke In Progress? (Tanpa mark sebagai revisi)")) return;
  const previousStatus=String(a.workStatus||"Booked");
  a.workStatus="In Progress";
  a.lastArtistUpdate=new Date().toISOString();
  notifyArtistAboutAdminAction({p,a},{previousStatus});
  saveData(); renderAll();
}
async function saveOwnPin(){
  const nextPin=document.getElementById("new-pin").value.trim();
  if(nextPin.length<4){ alert("PIN baru minimal 4 karakter."); return; }
  if(!artistLockedId||!artistPinSession){ alert("Session artist tidak valid. Login ulang dulu."); return; }
  const artist=data.artists.find(a=>a.id===artistLockedId);
  if(!artist){ alert("Artist aktif tidak ditemukan."); return; }
  const ok=await artistChangeOwnPinRemote(artistLockedId,artistPinSession,nextPin);
  if(!ok){ alert("Gagal mengubah PIN di Supabase."); return; }
  artist.pinConfigured=true;
  artistPinSession=nextPin;
  activeArtist=artistLockedId;
  setSessionValue(SESSION_ARTIST_PIN,artistPinSession||"");
  setSessionValue(SESSION_ARTIST_LOCK,artistLockedId||"");
  setSessionValue(SESSION_ARTIST,activeArtist||"");
  localStorage.setItem(KEY,JSON.stringify(data));
  renderAll();
  closePinModal();
  alert("PIN artist berhasil diperbarui.");
}
function renderAll(options={}){
  if(options.deferWhileEditing!==false&&isUserTextEditing()){
    scheduleDeferredRenderAll(options);
    return;
  }
  applyThemeMode();
  activePage=normalizeAppPage(options.page||activePage||pageFromLocation());
  renderSelectors();
  renderActivePage(activePage);
  runDeadlineReminderNotifications();
  renderNotifBell();
  applyMobileDrawerState();
  syncLiveRefreshWatcher();
}
async function initApp(){
  authInProgress=true;
  try{
    if(IS_FILE_ORIGIN&&!fileOriginWarned){
      fileOriginWarned=true;
      alert("File dibuka via file://. Untuk sync Supabase stabil, jalankan lewat server lokal (http://127.0.0.1:5500 atau http://localhost:5500).");
    }
    const initialPage=pageFromLocation();
    renderAll({page:initialPage});
    switchPage(initialPage,{replaceHistory:true});
    if(!db){
      if(!role) openLogin("admin");
      return;
    }
    const {data:sessionData,error:sessionError}=await db.auth.getSession();
    if(sessionError) console.error("init getSession error",sessionError);
    currentUser=sessionData?.session?.user||null;
    if(currentUser) await loadProfile();
    const hasAdminSession=Boolean(currentUser&&currentProfile?.role==="admin");
    const hasArtistStored=hasArtistSession();
    if(hasAdminSession){
      role="admin";
      clearArtistSession();
      activeArtist="";
      setSessionValue(SESSION_ROLE,role);
      setSessionValue(SESSION_ARTIST,"");
      await loadRemoteSnapshot();
    }else if(role==="artist"&&hasArtistStored){
      activeArtist=artistLockedId;
      setSessionValue(SESSION_ROLE,role);
      setSessionValue(SESSION_ARTIST,activeArtist||"");
      await loadRemoteSnapshot();
      await ensureArtistViewerSession();
    }else if(!role&&hasArtistStored){
      role="artist";
      activeArtist=artistLockedId;
      setSessionValue(SESSION_ROLE,role);
      setSessionValue(SESSION_ARTIST,activeArtist||"");
      await loadRemoteSnapshot();
      await ensureArtistViewerSession();
    }else{
      role="";
      activeArtist="";
      setSessionValue(SESSION_ROLE,"");
      setSessionValue(SESSION_ARTIST,"");
      await loadArtistRosterRemote();
    }
    const postAuthPage=pageFromLocation();
    renderAll({page:postAuthPage});
    switchPage(postAuthPage,{replaceHistory:true});
    if(role) closeLogin(true);
    if(!role) openLogin("admin");
  }finally{
    authInProgress=false;
  }
}
if(db){
  db.auth.onAuthStateChange(async(event,session)=>{
    if(authInProgress) return;
    authInProgress=true;
    try{
      if(event==="SIGNED_OUT"){
        currentProfile=null;
        currentUser=null;
        if(role==="admin"){
          role="";
          activeArtist="";
          clearArtistSession();
          setSessionValue(SESSION_ROLE,"");
          setSessionValue(SESSION_ARTIST,"");
          renderAll();
          openLogin("admin");
        }
        return;
      }
      const newUser=session?.user||null;
      if(newUser&&newUser.id===currentUser?.id) return;
      currentUser=newUser;
      if(currentUser){
        await loadProfile();
        const isAdmin=currentProfile?.role==="admin";
        const hasArtistLock=Boolean(artistLockedId&&artistPinSession);
        if(isAdmin&&!hasArtistLock){
          role="admin";
          clearArtistSession();
          activeArtist="";
          setSessionValue(SESSION_ROLE,"admin");
          setSessionValue(SESSION_ARTIST,"");
          await loadRemoteSnapshot();
          renderAll();
          closeLogin(true);
        }else if(!isAdmin&&role==="admin"&&!hasArtistLock){
          role="";
          activeArtist="";
          setSessionValue(SESSION_ROLE,"");
          setSessionValue(SESSION_ARTIST,"");
          renderAll();
          openLogin("admin");
        }
      }
    }finally{
      authInProgress=false;
    }
  });
}
function restorePageFromHistory(){
  switchPage(pageFromLocation(),{updateHistory:false});
}
window.addEventListener("popstate",restorePageFromHistory);
window.addEventListener("hashchange",restorePageFromHistory);
window.addEventListener("resize",applyMobileDrawerState,{passive:true});
window.addEventListener("orientationchange",applyMobileDrawerState,{passive:true});
// Initialize data from storage after all modules are loaded
data=loadData();
notifications=loadNotifications();
deadlineReminderState=loadDeadlineReminderState();
void initApp();
