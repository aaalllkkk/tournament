function openArtistModal(artistId=""){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengelola artist.")) return;
  const editArtist=artistId?data.artists.find(a=>a.id===artistId):null;
  document.getElementById("ta-edit-id").value=editArtist?.id||"";
  document.getElementById("artist-modal-title").textContent=editArtist?"Edit Artist":"Tambah Artist";
  document.getElementById("ta-save-btn").textContent=editArtist?"Simpan Perubahan":"Simpan";
  document.getElementById("ta-name").value=editArtist?.name||"";
  document.getElementById("ta-pin").value="";
  renderArtistRolePicker(editArtist?.roles||editArtist?.role||["Illustration"]);
  document.getElementById("artist-modal").classList.add("active");
}
function closeArtistModal(){ document.getElementById("artist-modal").classList.remove("active"); }
async function saveTeamArtist(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengelola artist.")) return;
  const editId=document.getElementById("ta-edit-id").value.trim();
  const name=document.getElementById("ta-name").value.trim();
  let pin=document.getElementById("ta-pin").value.trim();
  // Ensure PIN only contains digits
  if(pin&&!/^\d+$/.test(pin)){ alert("PIN hanya boleh berisi angka."); return; }
  const roles=collectArtistRolesFromModal();
  if(!name){ alert("Isi nama artist."); return; }
  if(editId){
    const index=data.artists.findIndex(a=>a.id===editId);
    if(index<0){ alert("Artist tidak ditemukan."); return; }
    if(pin&&pin.length<4){ alert("PIN artist minimal 4 karakter."); return; }
    if(pin){
      const pinSaved=await adminSetArtistPinRemote(editId,pin);
      if(!pinSaved){
        alert("Gagal menyimpan PIN artist ke Supabase.");
        return;
      }
    }
    data.artists[index]={
      ...data.artists[index],
      name,
      role:roles[0]||"Illustration",
      roles,
      pinConfigured:pin?true:Boolean(data.artists[index].pinConfigured)
    };
    saveData();
    closeArtistModal();
    renderAll();
    return;
  }
  if(pin.length<4){ alert("PIN artist minimal 4 karakter."); return; }
  const artist={id:uid(),name,role:roles[0]||"Illustration",roles,pinConfigured:true};
  data.artists.push(artist);
  const pinSaved=await adminSetArtistPinRemote(artist.id,pin);
  if(!pinSaved){
    data.artists=data.artists.filter(a=>a.id!==artist.id);
    alert("Gagal menyimpan PIN artist ke Supabase. Artist tidak jadi ditambahkan.");
    renderAll();
    return;
  }
  saveData(); closeArtistModal(); renderAll();
}
function templateAllocation(role,serviceType,dependency){
  return {id:uid(),role,serviceType,artistId:"",workerName:"",workStatus:"Booked",dependency,targetDoneDate:"",artistProgress:0,payMode:"conversion",percent:0,amountUsd:0};
}
function listPackageTypes(extraValue=""){
  const options=Object.keys(packageTemplates);
  const extra=String(extraValue||"").trim();
  if(extra&&!options.includes(extra)) options.push(extra);
  if(!options.length) options.push("Custom");
  return options;
}
function packageUsageMap(){
  const usage={};
  for(const project of data.projects||[]){
    const key=String(project?.packageType||"Custom");
    usage[key]=(usage[key]||0)+1;
  }
  return usage;
}
function normalizePackageRow(row){
  if(Array.isArray(row)){
    return [
      String(row[0]||"Illustration").trim()||"Illustration",
      String(row[1]||"Custom").trim()||"Custom",
      String(row[2]||"Tidak ada").trim()||"Tidak ada"
    ];
  }
  const source=row&&typeof row==="object"?row:{};
  return [
    String(source.role||source.workerRole||"Illustration").trim()||"Illustration",
    String(source.serviceType||source.service||source.type||"Custom").trim()||"Custom",
    String(source.dependency||source.dependsOn||"Tidak ada").trim()||"Tidak ada"
  ];
}
function clonePackageRows(rows){
  if(!Array.isArray(rows)) return [];
  return rows.map(normalizePackageRow).filter(row=>row[0]&&row[1]);
}
function applyTemplateMap(nextMap,replaceAll=false){
  const incoming=nextMap&&typeof nextMap==="object"?nextMap:{};
  const normalized={};
  for(const [rawName,rawRows] of Object.entries(incoming)){
    const name=String(rawName||"").trim();
    if(!name) continue;
    const rows=clonePackageRows(rawRows);
    if(!rows.length) continue;
    normalized[name]=rows;
  }
  if(!Object.keys(normalized).length) return false;
  if(replaceAll){
    Object.keys(packageTemplates).forEach(key=>{ delete packageTemplates[key]; });
  }
  for(const [name,rows] of Object.entries(normalized)){
    packageTemplates[name]=rows;
  }
  if(!Array.isArray(packageTemplates.Custom)||!packageTemplates.Custom.length){
    packageTemplates.Custom=[["Illustration","Custom","Tidak ada"]];
  }
  if(replaceAll){
    const valid=new Set(Object.keys(packageTemplates));
    data.projects=(data.projects||[]).map(project=>{
      const pkg=String(project?.packageType||"");
      if(pkg&&valid.has(pkg)) return project;
      return {...project,packageType:"Custom"};
    });
  }
  return true;
}
function extractTemplateMap(payload){
  const source=payload&&typeof payload==="object"?payload:null;
  if(!source) return null;
  const candidates=[
    source.type==="package_templates"?source.templates:null,
    source.templates,
    source.packageTemplates,
    source.packages
  ];
  for(const item of candidates){
    if(item&&typeof item==="object"&&!Array.isArray(item)) return item;
  }
  const values=Object.values(source);
  if(values.length&&values.every(v=>Array.isArray(v))) return source;
  return null;
}
function openPackageModal(packageName=""){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur paket.")) return;
  const name=String(packageName||"").trim();
  const exists=Boolean(name&&packageTemplates[name]);
  document.getElementById("pk-edit-name-old").value=exists?name:"";
  document.getElementById("pk-name").value=exists?name:"";
  document.getElementById("package-modal-title").textContent=exists?"Edit Paket":"Tambah Paket";
  tempPackageRows=exists?clonePackageRows(packageTemplates[name]):[["Illustration","Custom","Tidak ada"]];
  renderPackageRowsEditor();
  document.getElementById("package-modal").classList.add("active");
}
function closePackageModal(){ document.getElementById("package-modal").classList.remove("active"); }
function addTempPackageRow(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur paket.")) return;
  tempPackageRows.push(["Illustration","Custom","Tidak ada"]);
  renderPackageRowsEditor();
}
function removeTempPackageRow(index){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur paket.")) return;
  tempPackageRows.splice(index,1);
  if(!tempPackageRows.length) tempPackageRows.push(["Illustration","Custom","Tidak ada"]);
  renderPackageRowsEditor();
}
function updateTempPackageRow(index,field,value){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur paket.")) return;
  const current=normalizePackageRow(tempPackageRows[index]||[]);
  if(field==="role") current[0]=String(value||"").trim()||"Illustration";
  if(field==="serviceType") current[1]=String(value||"").trim()||"Custom";
  if(field==="dependency") current[2]=String(value||"").trim()||"Tidak ada";
  tempPackageRows[index]=current;
}
function renderPackageRowsEditor(){
  const root=document.getElementById("package-rows");
  if(!root) return;
  const serviceOptions=[...new Set([...listPackageTypes(),"Art Only","Rigging Only","BGM","Overlay","Layout","Freebie","Custom"])];
  root.innerHTML=tempPackageRows.map((rawRow,index)=>{
    const row=normalizePackageRow(rawRow);
    const dependencyOptions=["Tidak ada","Setelah Illustration","Setelah Rigging"];
    if(row[2]&&!dependencyOptions.includes(row[2])) dependencyOptions.push(row[2]);
    return `
    <div class="grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_auto] gap-2 bg-slate-900 rounded-xl p-3">
      <input value="${esc(row[0])}" onchange="updateTempPackageRow(${index},'role',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm" placeholder="Role worker">
      <select onchange="updateTempPackageRow(${index},'serviceType',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm">${serviceOptions.map(opt=>`<option ${row[1]===opt?"selected":""}>${esc(opt)}</option>`).join("")}</select>
      <select onchange="updateTempPackageRow(${index},'dependency',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm">${dependencyOptions.map(opt=>`<option ${row[2]===opt?"selected":""}>${esc(opt)}</option>`).join("")}</select>
      <button onclick="removeTempPackageRow(${index})" class="danger btn">Del</button>
    </div>`;
  }).join("");
}
function savePackageTemplate(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur paket.")) return;
  const oldName=String(document.getElementById("pk-edit-name-old").value||"").trim();
  const nextName=String(document.getElementById("pk-name").value||"").trim();
  if(!nextName){ alert("Nama paket wajib diisi."); return; }
  const rows=clonePackageRows(tempPackageRows);
  if(!rows.length){ alert("Isi minimal 1 baris worker split."); return; }
  if(oldName&&oldName!==nextName&&packageTemplates[nextName]){
    alert(`Nama paket ${nextName} sudah ada.`);
    return;
  }
  if(oldName&&oldName!==nextName){
    let changedProjects=0;
    data.projects=(data.projects||[]).map(project=>{
      if(project.packageType!==oldName) return project;
      changedProjects+=1;
      return {...project,packageType:nextName};
    });
    if(changedProjects){
      alert(`${changedProjects} project otomatis dipindahkan ke paket ${nextName}.`);
    }
    delete packageTemplates[oldName];
  }
  packageTemplates[nextName]=rows;
  saveData();
  closePackageModal();
  renderAll();
}
function deletePackageTemplate(name){
  if(!requireVerifiedAdmin("Hanya admin yang boleh menghapus paket.")) return;
  const key=String(name||"").trim();
  if(!key||!packageTemplates[key]) return;
  const total=Object.keys(packageTemplates).length;
  if(total<=1){ alert("Minimal harus ada 1 paket."); return; }
  const usage=packageUsageMap()[key]||0;
  const fallback=listPackageTypes().find(item=>item!==key)||"Custom";
  if(!confirm(`Hapus paket ${key}?${usage?` ${usage} project akan dipindah ke ${fallback}.`:""}`)) return;
  delete packageTemplates[key];
  if(usage){
    data.projects=(data.projects||[]).map(project=>project.packageType===key?{...project,packageType:fallback}:project);
  }
  saveData();
  renderAll();
}
function triggerImportPackageTemplates(){
  if(!requireVerifiedAdmin("Import data paket hanya untuk admin.")) return;
  document.getElementById("package-import-file").click();
}
function importPackageTemplatesFile(input){
  if(!isVerifiedAdmin()){
    alert("Import data paket hanya untuk admin yang sudah login.");
    if(input) input.value="";
    openLogin("admin");
    return;
  }
  const file=input?.files?.[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const payload=JSON.parse(String(reader.result||"{}"));
      const extracted=extractTemplateMap(payload);
      if(!extracted) throw new Error("format");
      const replaceAll=confirm("OK = ganti semua template paket lama.\nCancel = merge ke template paket yang ada.");
      const ok=applyTemplateMap(extracted,replaceAll);
      if(!ok) throw new Error("empty");
      saveData();
      renderAll();
      alert("Import paket berhasil.");
    }catch(_err){
      alert("File paket tidak cocok. Gunakan file export paket yang valid.");
    }finally{
      if(input) input.value="";
    }
  };
  reader.readAsText(file);
}
function triggerImportArtistCatalog(){
  if(!requireVerifiedAdmin("Import artist catalog hanya untuk admin.")) return;
  document.getElementById("artist-catalog-file").click();
}
async function importArtistCatalogFile(input){
  if(!isVerifiedAdmin()){
    alert("Import artist catalog hanya untuk admin yang sudah login.");
    if(input) input.value="";
    openLogin("admin");
    return;
  }
  const file=input?.files?.[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const payload=JSON.parse(String(reader.result||"{}"));
      const allowedApps=["KURAMASH_ERP_CATALOG","KURAMASH_ERP_TEAM","KURAMASH_ERP_TOOLS"];
      if(!allowedApps.includes(String(payload?.app||""))){
        throw new Error("app");
      }
      const rawArtists=Array.isArray(payload?.artists)?payload.artists:[];
      const importedArtists=sanitizeArtists(rawArtists);
      if(!importedArtists.length){
        alert("File tidak berisi data artist.");
        return;
      }
      const merged=[...data.artists];
      let added=0;
      let updated=0;
      for(const artist of importedArtists){
        const index=merged.findIndex(item=>item.id===artist.id);
        const nextRoles=normalizeArtistRoles(artist.roles||artist.role);
        if(index>=0){
          const prev=merged[index];
          merged[index]={
            ...prev,
            name:artist.name||prev.name,
            role:nextRoles[0]||prev.role||"Illustration",
            roles:nextRoles,
            pinConfigured:Boolean(prev.pinConfigured||artist.pinConfigured)
          };
          updated+=1;
        }else{
          merged.push({
            ...artist,
            role:nextRoles[0]||"Illustration",
            roles:nextRoles,
            pinConfigured:Boolean(artist.pinConfigured)
          });
          added+=1;
        }
      }

      let pinAttempt=0;
      let pinSynced=0;
      const failedPinNames=[];
      if(db&&isVerifiedAdmin()){
        for(const raw of rawArtists){
          const artistId=String(raw?.id||"").trim();
          const nextPin=readImportedPin(raw);
          if(!artistId||nextPin.length<4) continue;
          pinAttempt+=1;
          const ok=await adminSetArtistPinRemote(artistId,nextPin);
          if(ok){
            pinSynced+=1;
          }else{
            failedPinNames.push(String(raw?.name||artistId));
          }
        }
      }

      data.artists=merged.map(artist=>{
        const source=rawArtists.find(raw=>String(raw?.id||"")===artist.id);
        if(!source) return artist;
        const importedPin=readImportedPin(source);
        return {...artist,pinConfigured:Boolean(artist.pinConfigured||importedPin.length>=4)};
      });
      saveData();
      const snapshotSaved=await saveRemoteSnapshot();
      if(!snapshotSaved){
        alert("Import artist lokal berhasil, tapi sinkron snapshot ke Supabase gagal.");
      }
      if(pinAttempt===0){
        alert(`Import artist selesai. Tambah baru: ${added}, update: ${updated}. Tidak ada PIN valid (>=4) di file.`);
        renderAll();
        return;
      }
      if(pinSynced===pinAttempt){
        alert(`Import artist selesai. Tambah baru: ${added}, update: ${updated}. PIN tersinkron: ${pinSynced}/${pinAttempt}.`);
        renderAll();
        return;
      }
      const failedPreview=failedPinNames.slice(0,3).join(", ");
      alert(`Import artist selesai. Tambah baru: ${added}, update: ${updated}. PIN gagal sinkron ${pinAttempt-pinSynced}/${pinAttempt}.${failedPreview?` Contoh: ${failedPreview}`:""}`);
      renderAll();
    }catch(_err){
      alert("File artist catalog tidak cocok.");
    }finally{
      if(input) input.value="";
    }
  };
  reader.readAsText(file);
}
function syncPackageTypeSelectOptions(selectedValue=""){
  const select=document.getElementById("tp-package-type");
  if(!select) return;
  const requested=String(selectedValue||select.value||"Standard").trim();
  const options=listPackageTypes(requested);
  select.innerHTML=options.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join("");
  if(options.includes(requested)){
    select.value=requested;
  }else if(options.includes("Standard")){
    select.value="Standard";
  }else{
    select.value=options[0]||"";
  }
}
function buildAllocationsFromTemplate(packageType,deadline,currentAllocations=[]){
  const rows=packageTemplates[packageType]||packageTemplates.Custom||[];
  const pool=Array.isArray(currentAllocations)?[...currentAllocations]:[];
  return rows.map(([roleName,serviceType,dependency])=>{
    const roleKey=String(roleName||"").toLowerCase();
    const matchIndex=pool.findIndex(item=>String(item?.role||"").toLowerCase()===roleKey);
    const existing=matchIndex>=0?pool.splice(matchIndex,1)[0]:null;
    const base=templateAllocation(roleName,serviceType,dependency);
    if(!existing) return {...base,targetDoneDate:deadline||""};
    return {
      ...base,
      ...existing,
      id:existing.id||uid(),
      role:roleName,
      serviceType,
      dependency,
      targetDoneDate:existing.targetDoneDate||deadline||""
    };
  });
}
function applyPackageTemplate(type){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur template paket.")) return;
  const deadline=document.getElementById("tp-deadline")?.value||"";
  tempAllocations=buildAllocationsFromTemplate(type,deadline,[]);
  renderTempAllocs();
}
function openProjectModal(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh membuat project team.")) return;
  document.getElementById("tp-edit-id").value="";
  ["tp-client","tp-name","tp-deadline","tp-budget-usd","tp-budget-idr","tp-paid-usd","tp-paid-idr","tp-payment-date","tp-expected-release-date","tp-payment-note","tp-brief-link","tp-freebie-link","tp-instruction"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
  clearProjectPdfInputs();
  setProjectPdfInfo(null);
  syncPackageTypeSelectOptions("Standard");
  document.getElementById("tp-brief-status").value="Draft";
  document.getElementById("tp-payment-status").value="Belum Bayar";
  document.getElementById("tp-platform").value="Direct";
  applyPackageTemplate("Standard");
  document.getElementById("project-modal").classList.add("active");
}
function closeProjectModal(){ document.getElementById("project-modal").classList.remove("active"); }
function addTempAlloc(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur worker split.")) return;
  tempAllocations.push(templateAllocation("Illustration","Custom","Tidak ada"));
  renderTempAllocs();
}
function removeTempAlloc(index){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur worker split.")) return;
  tempAllocations.splice(index,1);
  renderTempAllocs();
}
function updateTempAlloc(index,field,value){
  if(!requireVerifiedAdmin("Hanya admin yang boleh mengatur worker split.")) return;
  tempAllocations[index][field]=value;
  if(field==="artistId"){
    const a=data.artists.find(x=>x.id===value);
    tempAllocations[index].workerName=a?a.name:"";
  }
  if(field==="role"){
    if(value==="Illustration"&&!tempAllocations[index].serviceType) tempAllocations[index].serviceType="Art Only";
    if(value==="Rigging") tempAllocations[index].serviceType="Rigging Only";
    if(["BGM","Overlay","Layout","Freebie"].includes(value)) tempAllocations[index].serviceType=value==="Freebie"?"Freebie":value;
  }
  renderTempAllocs();
}
function renderTempAllocs(){
  const roleOptions=["Illustration","Rigging","BGM","Overlay","Layout","Freebie","Other"];
  const statusOptions=["Booked","Waitlist","In Progress","Blocked","Waiting Client","Revision Hold","Submitted","Approved","Payable"];
  const serviceOptions=[...new Set([...listPackageTypes(),"Art Only","Rigging Only","BGM","Overlay","Layout","Freebie","Custom"])];
  const artistOptions=`<option value="">Manual / Belum assign</option>`+data.artists.map(a=>`<option value="${a.id}">${esc(a.name)} (${esc(artistRolesLabel(a))})</option>`).join("");
  document.getElementById("temp-allocs").innerHTML=tempAllocations.map((a,i)=>`
    <div class="grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 bg-slate-900 rounded-xl p-3">
      <select onchange="updateTempAlloc(${i},'role',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm">${roleOptions.map(r=>`<option ${a.role===r?"selected":""}>${r}</option>`).join("")}</select>
      <select onchange="updateTempAlloc(${i},'artistId',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm">${artistOptions.replace(`value="${a.artistId}"`,`value="${a.artistId}" selected`)}</select>
      <input value="${esc(a.workerName)}" onchange="updateTempAlloc(${i},'workerName',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm" placeholder="Nama worker manual">
      <select onchange="updateTempAlloc(${i},'workStatus',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm">${statusOptions.map(s=>`<option ${a.workStatus===s?"selected":""}>${s}</option>`).join("")}</select>
      <button onclick="removeTempAlloc(${i})" class="danger btn">Del</button>
      <label class="bg-slate-800 rounded-xl p-3 text-sm text-slate-300 xl:col-span-2">
        <span class="block mono text-[10px] text-slate-400 mb-1">JENIS PEKERJAAN / KONVERSI PAKET</span>
        <select onchange="updateTempAlloc(${i},'serviceType',this.value)" class="w-full bg-transparent text-sm">${serviceOptions.map(s=>`<option ${a.serviceType===s?"selected":""}>${s}</option>`).join("")}</select>
      </label>
      <select onchange="updateTempAlloc(${i},'dependency',this.value)" class="bg-slate-800 rounded-xl p-3 text-sm xl:col-span-2"><option>Tidak ada</option><option ${a.dependency==="Setelah Illustration"?"selected":""}>Setelah Illustration</option><option ${a.dependency==="Setelah Rigging"?"selected":""}>Setelah Rigging</option></select>
      <label class="bg-slate-800 rounded-xl p-3 text-sm text-slate-300">
        <span class="block mono text-[10px] text-slate-400 mb-1">TARGET SELESAI WORKER</span>
        <input type="date" value="${esc(a.targetDoneDate||"")}" onchange="updateTempAlloc(${i},'targetDoneDate',this.value)" class="w-full bg-transparent text-sm">
      </label>
    </div>`).join("");
}
async function saveTeamProject(){
  if(!requireVerifiedAdmin("Hanya admin yang boleh menyimpan project team.")) return;
  const client=document.getElementById("tp-client").value.trim();
  const name=document.getElementById("tp-name").value.trim();
  if(!client||!name){ alert("Isi nama klien dan project."); return; }
  const editId=document.getElementById("tp-edit-id").value;
  const existing=editId?projectById(editId):null;
  const previousDeadline=existing?.deadline||"";
  const previousRelease=existing?.expectedReleaseDate||"";
  const deadline=document.getElementById("tp-deadline").value;
  const expectedReleaseDate=document.getElementById("tp-expected-release-date").value;
  const briefLink=document.getElementById("tp-brief-link").value.trim();
  const freebieLink=document.getElementById("tp-freebie-link").value.trim();
  const project={
    ...(existing||{}),
    id:existing?.id||uid(),client,name,deadline,status:existing?.status||"Planning",productionStage:existing?.productionStage||"Brief",
    packageType:document.getElementById("tp-package-type").value,
    briefStatus:document.getElementById("tp-brief-status").value,
    clientBrief:"",
    briefLink,
    artistInstruction:document.getElementById("tp-instruction").value.trim(),
    budgetUsd:Number(document.getElementById("tp-budget-usd").value)||0,
    budgetIdr:Number(document.getElementById("tp-budget-idr").value)||0,
    platform:document.getElementById("tp-platform").value,
    platformFeeRate:0,
    taxRate:0,
    paymentStatus:document.getElementById("tp-payment-status").value,
    paidUsd:Number(document.getElementById("tp-paid-usd").value)||0,
    paidIdr:Number(document.getElementById("tp-paid-idr").value)||0,
    paymentDate:document.getElementById("tp-payment-date").value,
    expectedReleaseDate,
    paymentNote:document.getElementById("tp-payment-note").value.trim(),
    platformHold:document.getElementById("tp-payment-status").value==="Tertahan Platform",
    expressionStatus:briefLink?"Ekspresi / Requirement Tautan Siap":"Belum Dicek",
    expressionNotes:"",
    expressionPdfName:existing?.expressionPdfName||"",
    expressionPdfData:existing?.expressionPdfData||"",
    freebieRequirementStatus:freebieLink?"Requirement Freebie Diterima":"Belum Dicek",
    freebieRequirementNotes:freebieLink,
    freebieRequirementPdfName:existing?.freebieRequirementPdfName||"",
    freebieRequirementPdfData:existing?.freebieRequirementPdfData||"",
    allocations:tempAllocations.map(a=>({...a,projectId:"",targetDoneDate:resolveAllocationTargetDate(a,previousDeadline,deadline),payableDate:resolveAllocationPayableDate(a,previousRelease,expectedReleaseDate),lastArtistUpdate:a.lastArtistUpdate||""}))
  };
  const briefPdfFile=document.getElementById("tp-brief-pdf")?.files?.[0]||null;
  const freebiePdfFile=document.getElementById("tp-freebie-pdf")?.files?.[0]||null;
  try{
    if(briefPdfFile){
      const uploaded=await uploadProjectPdf(briefPdfFile,project.id,"brief");
      if(uploaded){ project.expressionPdfName=uploaded.name; project.expressionPdfData=uploaded.url||uploaded.path; }
    }
    if(freebiePdfFile){
      const uploaded=await uploadProjectPdf(freebiePdfFile,project.id,"freebie");
      if(uploaded){ project.freebieRequirementPdfName=uploaded.name; project.freebieRequirementPdfData=uploaded.url||uploaded.path; }
    }
  }catch(err){
    alert(`Upload PDF gagal: ${err?.message||err}`);
    return;
  }
  if(existing) data.projects[data.projects.findIndex(p=>p.id===existing.id)]=project;
  else data.projects.push(project);
  
  // Kirim notifikasi ke semua artist dalam project ini (hanya untuk project baru)
  if(!existing){
    const allocations=project.allocations||[];
    allocations.forEach(alloc=>{
      if(alloc.artistId){
        const artist=data.artists.find(a=>a.id===alloc.artistId);
        if(artist){
          addNotification({
            type:"projectAssigned",
            targetRole:"artist",
            artistId:alloc.artistId,
            title:`Proyek Baru: ${project.name}`,
            message:`Admin menambahkan pekerjaan untuk Anda dari klien ${project.client}. Role: ${alloc.role}`,
            projectId:project.id,
            allocationId:alloc.id
          });
        }
      }
    });
  }
  
  saveData(); closeProjectModal(); renderAll();
}
