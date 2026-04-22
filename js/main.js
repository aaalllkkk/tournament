// File: js/main.js

import { db, auth } from './firebase-config.js';

// 2. Panggil fitur-fitur Firebase yang dibutuhkan
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, updateDoc, deleteDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// --- STATE ---
    let isAdmin = false;
    let teams = [];
    let matches = [];
    let scorers = [];
    let news = [];
    let knockout = { matches: {}, connections: [] };
    let collapsed = JSON.parse(localStorage.getItem("collapsedMW") || "{}");
    let championsCutoff = 4;
    let playoffCutoff = 8;
    let currentLink = null;
    let hofData = []; // Tempat simpan data Hall of Fame
    let hallOfFameData = []; 
    
    // Variabel Global untuk Slideshow
    let slideshowInterval = null;
    let currentSlideIndex = 0;
    let currentBannerData = { img: '' }; // Untuk menyimpan gambar dari Admin

    // --- UTILS ---
    const normalizeKey = (str) => (str || "").toString().trim().toLowerCase();
    const safe = (val, fallback = "") => val ?? fallback;

    const resolveTeam = (name) => {
      const team = teams.find(t => normalizeKey(t.name) === normalizeKey(name));
      return team ? { ...team, disqualified: false } : { name, logo: "https://i.imgur.com/xnTuRnl.png", disqualified: true };
    };
    
    // Function to calculate % based on stars
const calculateWinProbability = (homeStars, awayStars, s1 = 0, s2 = 0) => {
  const hS = parseFloat(homeStars) || 3.0;
  const aS = parseFloat(awayStars) || 3.0;
  
  // 1. Base Probability from Stars
  const baseProb = 50;
  const starDiff = hS - aS;
  let homeWinProb = baseProb + (starDiff * 15) + 5; // +5 Home Advantage

  // 2. Score Bias (Live Update)
  // If s1 or s2 is null (match hasn't started), treat as 0
  const score1 = parseInt(s1) || 0;
  const score2 = parseInt(s2) || 0;
  const goalDiff = score1 - score2;

  // Each goal lead adds 20% probability
  homeWinProb += (goalDiff * 20);

  // 3. Realistic Caps
  // If a team is leading, they shouldn't drop below 10% 
  // unless the star difference is massive.
  homeWinProb = Math.min(Math.max(Math.round(homeWinProb), 5), 95);
  
  return { home: homeWinProb, away: 100 - homeWinProb };
};
    
// Function to show star icons (optional but looks cool)
const getStarIcons = (rating) => {
  const r = parseFloat(rating) || 0;
  const full = Math.floor(r);
  return '★'.repeat(full) + (r % 1 !== 0 ? '½' : '');
};

    const getMW = (m) => {
      let mw = parseInt(m.Matchweek);
      if (!isNaN(mw) && mw > 0) return mw;
      let w = parseInt(m.weekday);
      return (!isNaN(w) && w > 0) ? w : 1;
    };

    // --- AUTH ---
    const login = async () => {
      const email = document.getElementById("email").value;
      const pass = document.getElementById("password").value;
      try {
        await signInWithEmailAndPassword(auth, email, pass);
      } catch (e) {
        alert(e.message);
      }
    };
    const logout = () => signOut(auth);

    onAuthStateChanged(auth, user => {
      isAdmin = !!user;
      const statusEl = document.getElementById("status");
      statusEl.innerText = isAdmin ? "Admin Authenticated" : "Viewer Mode";
      statusEl.className = isAdmin ? "font-headline font-black text-lg text-primary mt-1" : "font-headline font-black text-lg text-white mt-1";
      document.getElementById("adminTools").style.display = isAdmin ? "block" : "none";
      document.body.classList.toggle("admin", isAdmin);

      if (isAdmin) {
        document.getElementById("championsInput").value = championsCutoff;
        document.getElementById("playoffInput").value = playoffCutoff;
      }
      toggleAdminUI();
      renderMatches();
      renderScorers();
      renderNodes();
      renderTeams();
    });

     // --- Generate League ---
    const generateLeague = async () => {
  if (teams.length < 2) return alert("Minimal harus ada 2 tim!");
  
  const isHomeAway = confirm("Gunakan sistem Home & Away? (Setiap tim bertemu 2x)");
  if (!confirm(`Generate jadwal untuk ${teams.length} tim?`)) return;

  try {
    const matchesRef = collection(db, "matches");
    let pool = [];

    // 1. Buat semua kemungkinan pasangan
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;
        if (!isHomeAway && i > j) continue;
        pool.push({ t1: teams[i].name, t2: teams[j].name });
      }
    }

    let currentMW = 1;
    let totalCreated = 0;

    // 2. Bagi ke dalam Matchweek (Satu tim satu kali main per pekan)
    while (pool.length > 0) {
      let usedInWeek = new Set();
      let i = 0;

      while (i < pool.length) {
        const m = pool[i];
        if (!usedInWeek.has(m.t1) && !usedInWeek.has(m.t2)) {
          await addDoc(matchesRef, {
            team1: m.t1,
            team2: m.t2,
            s1: null,
            s2: null,
            date: "TBD",
            live: false,
            type: "league",
            Matchweek: currentMW // Field Matchweek
          });
          
          usedInWeek.add(m.t1);
          usedInWeek.add(m.t2);
          pool.splice(i, 1);
          totalCreated++;
        } else {
          i++;
        }
      }
      currentMW++;
      if(currentMW > 100) break; // Safety break
    }

    alert(`Berhasil! ${totalCreated} pertandingan dibuat dalam ${currentMW - 1} Matchweek.`);
  } catch (e) {
    alert("Error: " + e.message);
  }
};

    const hardReset = async () => {
  if (!confirm("Hapus SEMUA jadwal pertandingan?")) return;
  const code = prompt("Ketik 'RESET' untuk konfirmasi:");
  if (code !== "RESET") return alert("Dibatalkan.");

  try {
    const snap = await getDocs(collection(db, "matches"));
    const batch = snap.docs.map(d => deleteDoc(doc(db, "matches", d.id)));
    await Promise.all(batch);
    alert("Semua pertandingan berhasil dihapus!");
  } catch (e) {
    alert("Gagal reset: " + e.message);
  }
};

    const toggleAdminUI = () => {
      ["adminTeamControls", "matchControls", "scorerControls", "newsControls", "Controls", "liveBannerControls", "hofcontrols"].forEach(id => {
        if (document.getElementById(id)) document.getElementById(id).style.display = isAdmin ? "block" : "none";
      });
    };

    // --- UI TOGGLES ---
    const toggleSidebar = () => {
      document.getElementById('sidebar').classList.toggle('-translate-x-full');
      document.getElementById('sidebarOverlay').classList.toggle('active');
    };

    const openTab = (id, targetEl) => {
      if (window.innerWidth < 1024) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
        document.getElementById('sidebarOverlay').classList.remove('active');
      }

      document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
      
      // RESET SIDEBAR ACTIVE
      document.querySelectorAll(".tab").forEach(tab => {tab.classList.remove("active");});

      // RESET MOBILE ICON
      document.querySelectorAll(".mobile-tab").forEach(t => {
        t.classList.remove("text-[#ffd709]");
      });

      document.getElementById(id).classList.add("active");

      // Handle correct tab highlighting
      if (targetEl && targetEl.classList.contains("tab")) {
        targetEl.classList.add("active");
      } else {
        const matchingTab = Array.from(document.querySelectorAll(".tab")).find(t => t.dataset.tab === id);
        if(matchingTab) matchingTab.classList.add("active");
      }
      
      // SET ACTIVE MOBILE TAB
      if (targetEl && targetEl.classList.contains("mobile-tab")) {
        targetEl.classList.add("text-[#ffd709]");
      }
    };

    const toggleFolder = (mw) => {
      collapsed[mw] = !collapsed[mw];
      localStorage.setItem("collapsedMW", JSON.stringify(collapsed));
      renderMatches();
    };

    // --- DATA LISTENERS ---
    onSnapshot(collection(db, "teams"), snap => {
      teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTeams();
      renderStandings();
      renderDashboardStandings();
    });

    onSnapshot(collection(db, "matches"), snap => {
      matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMatches();
      renderLiveMatches();
      renderStandings();
      renderDashboardStandings();
      renderDashboardHeroContent(); // Hanya update teks, bukan gambar
    });

    onSnapshot(collection(db, "scorers"), snap => {
      scorers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderScorers();
    });
    
    // Listener untuk Hall of Fame
onSnapshot(query(collection(db, "halloffame"), orderBy("createdAt", "desc")), (snapshot) => {
    // Simpan ke window agar bisa diakses oleh fungsi detail
    window.hallOfFameData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Panggil fungsi render yang sudah kita buat
    renderHof(window.hallOfFameData);
});
    
    onSnapshot(collection(db, "news"), snap => {
      news = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderNews();
    });

    onSnapshot(doc(db, "tournament", "knockout"), (doc) => {
    if (doc.exists()) {
        knockout = doc.data();
        renderNodes(); // Ini sekarang akan bekerja karena fungsi di atas sudah terdaftar
    }
});

    onSnapshot(doc(db, "config", "standings"), snap => {
      if (snap.exists()) {
        championsCutoff = snap.data().championsCutoff || 4;
        playoffCutoff = snap.data().playoffCutoff || 8;
        if (isAdmin) {
          document.getElementById("championsInput").value = championsCutoff;
          document.getElementById("playoffInput").value = playoffCutoff;
        }
      }
      renderStandings();
    });
 
    onSnapshot(doc(db, "config", "knockout"), snap => {
      if (snap.exists()) {
        knockout = snap.data();
        renderNodes();
      }
    });


    // --- ACTIONS ---
    const addTeam = async () => {
      const name = document.getElementById("teamName").value.trim();
      const logo = document.getElementById("teamLogo").value.trim();
      const stars = parseFloat(document.getElementById('teamStars').value) || 3.0;
      
      if (!name || !isAdmin) return;
      await addDoc(collection(db, "teams"), { name, logo, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, y: 0, stars: stars });
      document.getElementById("teamName").value = "";
      document.getElementById("teamLogo").value = "";
    };

    const deleteTeam = async (id) => {
      if (isAdmin && confirm("Delete team?")) await deleteDoc(doc(db, "teams", id));
    };

    const addMatch = async () => {
      if (!isAdmin) return;
      const team1 = document.getElementById("team1").value;
      const team2 = document.getElementById("team2").value;
      const Matchweek = parseInt(document.getElementById("matchMatchweek").value);
      const date = document.getElementById("date").value;
      if (team1 === team2) return alert("Same teams!");
      await addDoc(collection(db, "matches"), { team1, team2, Matchweek, date, s1: null, s2: null, y1: 0, y2: 0, live: false });
    };

    const updateScore = async (id, val, side) => {
      if (!isAdmin) return;
      const num = isNaN(parseInt(val)) ? null : parseInt(val);
      await updateDoc(doc(db, "matches", id), { [side]: num });
    };

    const toggleLive = async (id, newState) => {
    const matchRef = doc(db, "matches", id);
    const updateData = { live: newState };

    // Jika newState adalah true (Go Live), kita set tanggalnya otomatis
    if (newState === true) {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = months[now.getMonth()];
        const year = now.getFullYear();
        
        // Format: "07 Apr 2024"
        updateData.date = `${day} ${month} ${year}`;
    }

    try {
        await updateDoc(matchRef, updateData);
    } catch (e) {
        console.error("Error updating live status:", e);
    }
};
    
    const deleteMatch = async (id) => {
      if (isAdmin && confirm("Delete?")) await deleteDoc(doc(db, "matches", id));
    };

    const addNews = async () => {
      const title = document.getElementById("newsTitle").value;
      const content = document.getElementById("newsContent").value;
      const image = document.getElementById("newsImage").value;
      if (!isAdmin || !title) return;
      await addDoc(collection(db, "news"), { title, content, image, time: Date.now() });
      document.getElementById("newsTitle").value = "";
      document.getElementById("newsContent").value = "";
      document.getElementById("newsImage").value = "";
    };

    const saveCutoffs = async () => {
      if (isAdmin) await setDoc(doc(db, "config", "standings"), {
        championsCutoff: parseInt(document.getElementById("championsInput").value),
        playoffCutoff: parseInt(document.getElementById("playoffInput").value)
      });
    };

    // --- RENDERING VIEWS ---
    const renderTeams = () => {
      let html = "",
        opts = "",
        filterOpts = '<option value="">All Teams</option>';

      teams.forEach(t => {
        html += `
                <li class="bg-surface-container-high rounded-[2rem] p-6 flex items-center justify-between border border-outline-variant/10 shadow-lg group hover:-translate-y-1 transition-transform">
                    <div class="flex items-center gap-4">
                        <img src="${t.logo}" class="w-14 h-14 object-contain bg-surface-container-highest p-2 rounded-[1rem] group-hover:scale-110 transition-transform">
                        <span class="font-headline font-bold text-xl">${t.name}</span>
                    </div>
                    ${isAdmin ? `<button class="deleteBtn" data-action="deleteTeam" data-id="${t.id}">Delete</button>` : ""}
                </li>`;
        opts += `<option value="${t.name}">${t.name}</option>`;
        filterOpts += `<option value="${t.name.toLowerCase()}">${t.name}</option>`;
      });

      document.getElementById("teamList").innerHTML = html;
      document.getElementById("team1").innerHTML = opts;
      document.getElementById("team2").innerHTML = opts;
      document.getElementById("playerTeam").innerHTML = opts;
      document.getElementById("filterTeam1").innerHTML = filterOpts;
      document.getElementById("filterTeam2").innerHTML = '<option value="">Vs Team</option>' + filterOpts.substring(34);
    };

    const renderMatches = () => {
      const container = document.getElementById("matchContainer");
      if (!container) return;

      const f1 = document.getElementById("filterTeam1").value.toLowerCase();
      const f2 = document.getElementById("filterTeam2").value.toLowerCase();

      const filtered = matches.filter(m => {
        const t1 = (m.team1 || "").toLowerCase(),
          t2 = (m.team2 || "").toLowerCase();
        if (!f1 && !f2) return true;
        if (f1 && !f2) return t1 === f1 || t2 === f1;
        return (t1 === f1 && t2 === f2) || (t1 === f2 && t2 === f1);
      }).sort((a, b) => (b.live - a.live) || getMW(a) - getMW(b));

      const grouped = filtered.reduce((acc, m) => {
        const mw = getMW(m);
        acc[mw] = acc[mw] || [];
        acc[mw].push(m);
        return acc;
      }, {});

      container.innerHTML = Object.keys(grouped).sort((a, b) => a - b).map(mw => `
                <div class="flex items-center gap-4 mb-6 mt-12 cursor-pointer group" data-action="toggleFolder" data-mw="${mw}">
                    <div class="h-px flex-1 bg-outline-variant/20"></div>
                    <h3 class="font-headline text-2xl font-bold uppercase tracking-widest text-primary italic pointer-events-none">Matchday ${mw} <span class="text-sm ml-2 group-hover:text-secondary inline-block transition-transform ${collapsed[mw] ? '-rotate-90' : 'rotate-0'}">▼</span></h3>
                    <div class="h-px flex-1 bg-outline-variant/20"></div>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mw-${mw} mw-row" style="${collapsed[mw] ? 'display:none' : ''}">
                    ${grouped[mw].map(m => {
                        const t1 = resolveTeam(m.team1), t2 = resolveTeam(m.team2), isFinished = m.s1 !== null && !m.live;
                        const badge = m.live ? `<span class="px-3 py-1 bg-error/10 text-error font-bold text-[10px] uppercase tracking-widest rounded-full border border-error/20 flex items-center gap-1 w-max"><span class="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span> LIVE</span>`
                            : isFinished ? `<span class="px-3 py-1 bg-outline-variant/20 text-on-surface-variant font-bold text-[10px] uppercase tracking-widest rounded-full w-max">Full Time</span>`
                            : `<span class="px-3 py-1 bg-primary/10 text-primary font-bold text-[10px] uppercase tracking-widest rounded-full border border-primary/20 w-max">Upcoming</span>`;

                        return `
                        <div class="group relative bg-surface-container-high rounded-[2rem] p-6 transition-all hover:bg-surface-container-highest ${m.live ? 'ring-1 ring-error/50 shadow-[0_0_20px_rgba(255,115,81,0.1)]' : 'border border-outline-variant/10 shadow-xl'}">
                            <div class="flex justify-between items-start mb-6">
                                ${badge}
                                <span class="text-on-surface-variant font-label text-xs uppercase">${safe(m.date, 'TBD')}</span>
                            </div>
                            <div class="flex items-center justify-between gap-2 md:gap-4">
                                <div class="flex-1 flex flex-col items-center gap-3">
                                    <div class="w-16 h-16 md:w-20 md:h-20 bg-surface-container rounded-[1.2rem] flex items-center justify-center p-3"><img src="${t1.logo}" class="w-full h-full object-contain ${!m.live && !isFinished ? 'grayscale opacity-50' : ''}"></div>
                                    <span class="font-bold font-headline text-center uppercase tracking-tight text-sm md:text-base">${t1.name}</span>
                                </div>
                                <div class="flex flex-col items-center px-2">
                                    ${isAdmin ? `
                                        <div class="flex items-center gap-2 bg-[#070e1c] p-2 rounded-xl border border-outline-variant/20">
                                            <input type="number" class="w-12 bg-transparent text-center text-xl font-headline font-black text-white p-0 border-none focus:ring-0" value="${m.s1 ?? ""}" data-action="updateScore" data-side="s1" data-id="${m.id}">
                                            <span class="text-on-surface-variant font-black">-</span>
                                            <input type="number" class="w-12 bg-transparent text-center text-xl font-headline font-black text-white p-0 border-none focus:ring-0" value="${m.s2 ?? ""}" data-action="updateScore" data-side="s2" data-id="${m.id}">
                                        </div>` : `
                                        ${(m.live || isFinished) ? `
                                            <div class="flex items-center gap-4 md:gap-6">
                                                <span class="score-font text-4xl md:text-5xl ${m.live ? 'text-error' : m.s1 > m.s2 ? 'text-primary' : 'text-white'}">${m.s1}</span>
                                                <span class="text-on-surface-variant font-headline text-xl opacity-30 italic font-black">-</span>
                                                <span class="score-font text-4xl md:text-5xl ${m.live ? 'text-error' : m.s2 > m.s1 ? 'text-primary' : 'text-white'}">${m.s2}</span>
                                            </div>` : `
                                            <div class="glass-card px-4 py-2 rounded-xl border border-outline-variant/20"><span class="font-headline text-2xl font-black italic text-secondary">VS</span></div>`}
                                    `}
                                </div>
                                <div class="flex-1 flex flex-col items-center gap-3">
                                    <div class="w-16 h-16 md:w-20 md:h-20 bg-surface-container rounded-[1.2rem] flex items-center justify-center p-3"><img src="${t2.logo}" class="w-full h-full object-contain ${!m.live && !isFinished ? 'grayscale opacity-50' : ''}"></div>
                                    <span class="font-bold font-headline text-center uppercase tracking-tight text-sm md:text-base">${t2.name}</span>
                                </div>
                            </div>
                            ${isAdmin ? `
                                <div class="mt-6 pt-4 border-t border-outline-variant/10 flex justify-between gap-2">
                                    <button class="admin-btn flex-1 !py-2 ${m.live ? '!bg-error !text-white' : ''}" data-action="toggleLive" data-id="${m.id}" data-state="${!m.live}">${m.live ? 'Stop Live' : 'Go Live'}</button>
                                    <button class="deleteBtn" data-action="deleteMatch" data-id="${m.id}">Del</button>
                                </div>` : ''}
                        </div>`;
                    }).join("")}
                </div>`).join("");
    };

    const renderHof = (data) => {
  const container = document.getElementById('hofGrid');
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-20 text-white/30 italic font-['Space_Grotesk']">Belum ada data sejarah.</div>`;
    return;
  }

  container.innerHTML = data.map(h => {
    let stars = "";
    for(let i=0; i < (parseInt(h.winnerStars) || 1); i++) {
      stars += `<span class="material-symbols-outlined text-[14px] text-yellow-400">star</span>`;
    }

    return `
    <div onclick="showHofDetail('${h.id}')" class="cursor-pointer group bg-[#161f32]/40 rounded-[2.5rem] border border-white/5 overflow-hidden flex flex-col shadow-2xl transition-all hover:border-[#8eff71]/30 hover:scale-[1.02] active:scale-95">
      
      <div class="p-6 pb-0 flex justify-between items-center">
        <span class="text-[10px] font-black text-[#8eff71] tracking-widest uppercase italic font-['Space_Grotesk']">${h.season}</span>
        <div class="flex gap-0.5">${stars}</div>
      </div>

      <div class="p-8 flex flex-col items-center">
        <img src="${h.winnerLogo || 'https://i.imgur.com/xnTuRnl.png'}" class="w-20 h-20 object-contain mb-4 drop-shadow-2xl group-hover:rotate-6 transition-transform">
        <h3 class="text-xl font-black text-white uppercase italic text-center leading-none font-['Space_Grotesk']">${h.winnerTeam}</h3>
        <p class="text-[10px] font-bold text-[#a4abbe] uppercase mt-2 font-['Space_Grotesk']">Manager: <span class="text-white">${h.winnerPlayer}</span></p>
      </div>

      ${h.cupWinner && h.cupWinner !== "N/A" ? `
      <div class="mx-6 p-3 bg-white/5 rounded-2xl mb-4 flex justify-between items-center border border-white/5">
        <div>
          <p class="text-[7px] font-bold text-[#8eff71] uppercase tracking-tighter">Cup Winner</p>
          <p class="text-[10px] font-black text-white uppercase leading-none mt-1">${h.cupWinner}</p>
        </div>
        <span class="material-symbols-outlined text-[#8eff71] text-lg opacity-40">workspace_premium</span>
      </div>` : ''}

      <div class="mt-auto bg-black/40 p-6 border-t border-white/5 flex justify-between items-center backdrop-blur-md">
        <div>
          <p class="text-[8px] font-bold text-[#a4abbe] uppercase tracking-widest font-['Space_Grotesk']">Golden Boot</p>
          <p class="text-sm font-black text-white uppercase italic font-['Space_Grotesk'] leading-none mt-1">${h.topScorer}</p>
        </div>
        <div class="text-right">
          <p class="text-2xl font-black text-[#8eff71] leading-none font-['Space_Grotesk']">${h.goals}</p>
          <p class="text-[8px] font-bold opacity-40 uppercase">Goals</p>
        </div>
      </div>
    </div>`;
  }).join("");
};
    
    const calculateStandings = () => {
      let table = teams.reduce((acc, t) => ({ ...acc, [t.name]: { team: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 } }), {});
      matches.forEach(m => {
        if (!m.team1 || !m.team2 || m.s1 === null || m.s2 === null) return;
        const h = table[m.team1],
          a = table[m.team2];
        if (!h || !a) return;
        h.p++;
        a.p++;
        h.gf += m.s1;
        h.ga += m.s2;
        a.gf += m.s2;
        a.ga += m.s1;
        if (m.s1 > m.s2) {
          h.w++;
          a.l++;
          h.pts += 3;
        } else if (m.s1 < m.s2) {
          a.w++;
          h.l++;
          a.pts += 3;
        } else {
          h.d++;
          a.d++;
          h.pts += 1;
          a.pts += 1;
        }
      });
      return Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    };

    const isTeamLive = (teamName) => matches.some(m => m.live && (m.team1 === teamName || m.team2 === teamName));

    const renderStandings = () => {
  const data = calculateStandings();
  const standingsTable = document.getElementById("standingsTable");
  if (!standingsTable) return;

  // Pastikan nilai cutoff adalah angka, jika tidak ada default ke 0
  const cCut = parseInt(championsCutoff) || 0;
  const pCut = parseInt(playoffCutoff) || 0;

  standingsTable.innerHTML = data.map((t, i) => {
    const rank = i + 1;
    const textClass = i === 0 ? "text-primary" : i === 1 ? "text-on-surface" : i === 2 ? "text-secondary" : "text-on-surface-variant";
    
    let bgGradient = "";
    let borderClass = "";

    // 1. ZONA CHAMPIONS (Biru)
    if (i < cCut) {
      bgGradient = "bg-gradient-to-r from-primary/5 to-transparent" ; // Menggunakan warna standar agar pasti muncul
      borderClass = "border-l-4 border-green-500";
    } 
    // 2. ZONA PLAYOFF (Kuning/Oranye)
    // Logika: Jika peringkat lebih besar dari Champions tapi masih di bawah atau sama dengan Playoff
    else if (i < pCut) {
      bgGradient = "bg-gradient-to-r from-error/5 to-transparent"; 
      borderClass = "border-l-4 border-red-500";
    }
    // 3. ZONA BAHAYA (Merah) - Otomatis 3 terbawah
    else if (i >= data.length - 1 && data.length > 3) {
      bgGradient = "bg-red-500/5";
      borderClass = "border-l-4 border-red-500/30";
    }

    return `
      <tr class="group hover:bg-surface-container-highest transition-colors ${bgGradient} ${borderClass}">
        <td class="py-5 px-6 font-headline font-black text-lg ${textClass}">${rank.toString().padStart(2, '0')}</td>
        <td class="py-5 px-6">
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-[0.8rem] bg-surface-container-highest flex items-center justify-center p-1 border border-outline-variant/10 relative">
              ${isTeamLive(t.team) ? `<div class="absolute -top-1 -right-1"><span class="liveDot"></span></div>` : ""}
              <img src="${resolveTeam(t.team).logo}" class="w-full h-full object-contain">
            </div>
            <span class="font-headline font-bold text-on-surface whitespace-nowrap">${t.team}</span>
          </div>
        </td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.p}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.w}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.d}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.l}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.gf}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.ga}</td>
        <td class="py-5 px-4 text-center font-bold ${t.gf-t.ga > 0 ? 'text-primary' : t.gf-t.ga < 0 ? 'text-error' : 'text-on-surface-variant'}">${t.gf-t.ga > 0 ? '+'+(t.gf-t.ga) : t.gf-t.ga}</td>
        <td class="py-5 px-6 text-center font-black text-xl ${textClass}">${t.pts}</td>
      </tr>`;
  }).join("");
};
  

    const renderDashboardStandings = () => {
      document.getElementById("dashboardStandings").innerHTML = calculateStandings().slice(0, 5).map((t, i) => {
        const badgeClass = i === 0 ? 'bg-primary/20 text-primary' : i === 1 ? 'bg-tertiary/20 text-tertiary' : i === 2 ? 'bg-white/10 text-white' : i === 3 ? 'bg-error/20 text-error' : 'bg-secondary/20 text-secondary';
        return `
                <div class="grid grid-cols-12 items-center px-4 py-3 hover:bg-surface-container-highest transition-colors rounded-xl">
                    <span class="col-span-2 font-headline font-bold ${i===0 ? 'text-secondary':''}">${(i+1).toString().padStart(2, '0')}</span>
                    <div class="col-span-8 flex items-center gap-3">
                        <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] ${badgeClass} overflow-hidden">
                            <img src="${resolveTeam(t.team).logo}" class="w-full h-full object-cover p-1">
                        </div>
                        <span class="font-body text-sm font-semibold truncate">${t.team}</span>
                    </div>
                    <span class="col-span-2 text-right font-headline font-bold ${i===0 ? 'text-secondary':''}">${t.pts}</span>
                </div>`;
      }).join("");
    };
    
    // --- ACTIONS UNTUK ADMIN BANNER ---
   window.updateLiveBanner = async () => {
  const dataToSave = {};
  // Loop untuk mengambil nilai dari 8 input secara otomatis
  for (let i = 1; i <= 8; i++) {
    const val = document.getElementById(`liveImg${i}`).value.trim();
    dataToSave[`img${i}`] = val;
  }
  
  try {
    await setDoc(doc(db, "settings", "liveBanner"), dataToSave);
    alert("8 Gambar berhasil disimpan!");
  } catch (e) { 
    alert("Gagal: " + e.message); 
  }
};
    
    // --- LOGIKA SLIDESHOW FADE (JASCRIPT) ---
    
   // --- SLIDESHOW LOGIC ---
const initSlideshow = (urls) => {
  const bg = document.getElementById("headlineBackground");
  if (!bg) return;
  if (slideshowInterval) clearInterval(slideshowInterval);

  // Jika kosong, gunakan gambar placeholder
  const imagesToUse = urls.length > 0 ? urls : ["https://via.placeholder.com/1920x1080"];

  bg.innerHTML = imagesToUse.map((src, i) => `
    <img src="${src}" class="headline-image ${i === 0 ? 'active' : ''}">
  `).join("");

  const imgEls = bg.querySelectorAll("img");
  if (imgEls.length < 2) return;

  let current = 0;
  slideshowInterval = setInterval(() => {
    imgEls[current].classList.remove("active");
    current = (current + 1) % imgEls.length;
    imgEls[current].classList.add("active");
  }, 7000); // Ganti gambar setiap 7 detik
};
    
    // Fungsi terpisah untuk mengupdate konten teks (Timi, Skor)
    const renderDashboardHeroContent = () => {
      const contentContainer = document.getElementById("headlineContent");
      if (!contentContainer) return;
      
      // Cari match live atau yang akan datang
      const m = matches.find(m => m.live) || matches.filter(m => m.s1 === null).sort((a, b) => getMW(a) - getMW(b))[0];

      if (!m) {
        contentContainer.innerHTML = `
          <div class="relative z-10 flex items-center justify-center h-full w-full pt-10">
            <h2 class="font-headline text-4xl font-bold p-8 text-white uppercase tracking-widest text-glow-primary">Welcome to Liga King</h2>
          </div>`;
        return;
      }

      const t1 = resolveTeam(m.team1);
      const t2 = resolveTeam(m.team2);

      // Calculate the real probability
      const prob = calculateWinProbability(t1.stars, t2.stars, m.s1, m.s2);

      contentContainer.innerHTML = `
        <div class="flex-1 w-full pt-20">
            <div class="flex items-center gap-3 mb-4">
                ${m.live ? `<span class="px-3 py-1 bg-error rounded-full text-xs font-bold flex items-center gap-1 text-white animate-pulse">● LIVE</span>` : `<span class="px-3 py-1 bg-primary text-[#064200] rounded-full text-xs font-bold">UPCOMING</span>`}
                <span class="text-secondary font-bold font-label tracking-widest text-sm uppercase italic">Matchday ${getMW(m)} • Elite Arena Stadium</span>
            </div>
            <div class="flex items-center gap-8 md:gap-16">
                <div class="text-center flex-1">
                    <img src="${t1.logo}" class="w-20 h-20 md:w-32 md:h-32 object-contain mb-4 filter drop-shadow-2xl mx-auto">
                    <h2 class="font-headline text-2xl md:text-4xl font-bold text-white tracking-tight">${t1.name}</h2>
                </div>
                <div class="flex flex-col items-center">
                    ${m.live || (m.s1!==null) ? `<span class="font-headline text-5xl md:text-8xl font-black text-error italic score-font">${m.s1} - ${m.s2}</span>` 
                    : `<span class="font-headline text-3xl md:text-5xl font-black text-on-surface-variant opacity-50 italicVS">VS</span>`}
                    <span class="font-label text-on-surface-variant font-bold mt-2 uppercase text-xs">${safe(m.date, '90\' MINUTES')}</span>
                </div>
                <div class="text-center flex-1">
                    <img src="${t2.logo}" class="w-20 h-20 md:w-32 md:h-32 object-contain mb-4 filter drop-shadow-2xl mx-auto">
                    <h2 class="font-headline text-2xl md:text-4xl font-bold text-white tracking-tight">${t2.name}</h2>
                </div>
            </div>
        </div>
        <div class="glass-card p-6 rounded-[2rem] w-80 hidden lg:block border border-white/10">
    <h4 class="text-secondary text-[10px] font-bold uppercase mb-4 tracking-widest italic">Match Insights</h4>
    <div class="space-y-4 text-[10px] font-bold">
      <div class="flex justify-between">
        <span>WIN PROBABILITY</span>
        <span class="text-primary">${prob.home}% - ${prob.away}%</span>
      </div>
      <div class="h-1.5 bg-white/10 rounded-full flex overflow-hidden">
        <div class="bg-primary transition-all duration-1000" style="width: ${prob.home}%"></div>
        <div class="bg-error transition-all duration-1000" style="width: ${prob.away}%"></div>
      </div>
      <div class="flex justify-between text-[8px] opacity-40 uppercase">
        <span>${t1.name} (${getStarIcons(t1.stars)})</span>
        <span>(${getStarIcons(t2.stars)}) ${t2.name}</span>
      </div>
    </div>
  </div>`;
    };
    
    // --- DATA LISTENERS ---
    onSnapshot(doc(db, "settings", "liveBanner"), (snap) => {
  if (snap.exists()) {
    const data = snap.data();
    const urls = [];
    
    for (let i = 1; i <= 8; i++) {
      const url = data[`img${i}`];
      if (url && url !== "") {
        urls.push(url);
        // Isi otomatis kolom input di admin jika element-nya ada
        const inputEl = document.getElementById(`liveImg${i}`);
        if (inputEl) inputEl.value = url;
      }
    }
    
    initSlideshow(urls);
  }
});

    onSnapshot(collection(db, "teams"), snap => {
      teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStandings();
    });

    onSnapshot(collection(db, "matches"), snap => {
      matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMatches();
    });

    const renderLiveMatches = () => {
      const live = matches.filter(m => m.live);
      document.getElementById("liveMatches").innerHTML = live.length ? live.map(m => `
                <div class="min-w-[300px] surface-container-high p-5 rounded-[2rem] border-l-4 border-error shadow-xl">
                    <div class="flex justify-between text-[10px] font-label text-error font-bold uppercase tracking-widest mb-4">
                        <span>MW ${getMW(m)}</span><span><span class="liveDot mr-1"></span>LIVE</span>
                    </div>
                    <div class="space-y-3">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-3"><img src="${resolveTeam(m.team1).logo}" class="w-8 h-8 rounded-lg object-contain bg-surface-container-highest p-1"><span class="font-bold text-sm truncate w-32">${m.team1}</span></div>
                            <span class="font-headline font-black text-xl text-error">${m.s1}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-3"><img src="${resolveTeam(m.team2).logo}" class="w-8 h-8 rounded-lg object-contain bg-surface-container-highest p-1"><span class="font-bold text-sm truncate w-32">${m.team2}</span></div>
                            <span class="font-headline font-black text-xl text-error">${m.s2}</span>
                        </div>
                    </div>
                </div>`).join("") : "<p class='text-on-surface-variant text-sm font-label py-4 pl-2'>No pitches active at the moment.</p>";
    };

    const renderNews = () => {
    const newsList = document.getElementById("newsList");
    if (!newsList) return;

    // Ambil 3 berita terbaru
    const displayNews = news.sort((a, b) => b.time - a.time).slice(0, 3);

    newsList.innerHTML = displayNews.map((n, i) => {
        const isLarge = i === 0;
        
        if (isLarge) {
            // Desain Kartu Utama (Besar)
            return `
                <div class="news-card md:col-span-2 relative h-[350px] rounded-[2.5rem] overflow-hidden group cursor-pointer border border-white/5 shadow-2xl" data-index="${i}">
                    ${n.image ? `<img src="${n.image}" class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110">` : `<div class="absolute inset-0 bg-slate-800"></div>`}
                    
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
                    
                    <div class="absolute bottom-0 p-8 w-full transform transition-transform duration-500">
                        <span class="px-4 py-1.5 bg-primary text-[#064200] text-[10px] font-black rounded-full mb-4 inline-block tracking-[0.2em] uppercase shadow-lg shadow-primary/20">Headline News</span>
                        <h2 class="font-headline text-3xl md:text-4xl font-black leading-none text-white italic uppercase tracking-tighter group-hover:text-primary transition-colors duration-300">
                            ${n.title}
                        </h2>
                        <p class="text-white/70 text-sm mt-3 font-medium line-clamp-2 max-w-xl">
                            ${n.content}
                        </p>
                    </div>
                </div>`;
        } else {
            // Desain Kartu Kecil (Samping)
            return `
                <div class="news-card bg-[#161f32]/60 backdrop-blur-md rounded-[2.2rem] overflow-hidden hover:bg-[#1c263a] transition-all duration-500 group border border-white/5 shadow-xl cursor-pointer" data-index="${i}">
                    <div class="h-44 relative overflow-hidden">
                        ${n.image ? `<img src="${n.image}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110">` : `<div class="w-full h-full bg-slate-800"></div>`}
                        <div class="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors"></div>
                    </div>
                    <div class="p-6">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
                            <span class="text-tertiary text-[10px] font-black uppercase tracking-widest">${new Date(n.time).toLocaleDateString()}</span>
                        </div>
                        <h4 class="font-headline font-bold text-xl text-white group-hover:text-tertiary transition-colors duration-300 leading-[1.1] line-clamp-2 italic uppercase">
                            ${n.title}
                        </h4>
                    </div>
                </div>`;
        }
    }).join("");

    // Pasang ulang Event Listener
    document.querySelectorAll('.news-card').forEach(card => {
        card.onclick = () => {
            const index = card.getAttribute('data-index');
            showModal(displayNews[index]);
        };
    });
};

// 3. Fungsi untuk memunculkan modal
const showModal = (data) => {
    const modal = document.getElementById("newsModal");
    const container = document.getElementById("modalDetailContent");

    container.innerHTML = `
        <div class="relative group">
            ${data.image ? `<img src="${data.image}" class="w-full h-80 object-cover rounded-[2rem] mb-8 shadow-2xl border border-white/10">` : ''}
            <div class="absolute top-4 left-4">
                 <span class="px-3 py-1 bg-black/50 backdrop-blur-md text-primary text-[10px] font-bold rounded-full border border-primary/30 uppercase tracking-widest">Article Detail</span>
            </div>
        </div>
        
        <h2 class="font-headline text-4xl font-black uppercase italic tracking-tighter text-white mb-6 leading-[0.9]">
            <span class="text-primary">/</span> ${data.title}
        </h2>
        
        <div class="prose prose-invert max-w-none text-gray-300 font-medium leading-relaxed text-lg whitespace-pre-line border-l-2 border-primary/20 pl-6 py-2">
            ${data.content}
        </div>
        
        <div class="mt-10 pt-6 border-t border-white/5 flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase tracking-[0.3em]">
            <span>Elite League Management</span>
            <span>${new Date(data.time).toLocaleDateString()}</span>
        </div>
    `;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    document.body.style.overflow = "hidden";
};

// 4. Fungsi Tutup Modal
const closeModal = () => {
    const modal = document.getElementById("newsModal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.style.overflow = "auto";
};

// Pasang event listener untuk tombol tutup
document.getElementById("closeModalBtn").onclick = closeModal;
document.getElementById("closeBackdrop").onclick = closeModal;

    
    const renderScorers = () => {
      const keyword = (document.getElementById("searchScorer")?.value || "").toLowerCase();
      const sorted = [...scorers].filter(s => s.player.toLowerCase().includes(keyword) || s.team.toLowerCase().includes(keyword)).sort((a, b) => b.goals - a.goals);

      document.getElementById("scorerTable").innerHTML = sorted.map((s, i) => `
                <div class="bg-surface-container-highest p-5 rounded-[2rem] flex items-center justify-between group hover:scale-[1.01] transition-transform border border-outline-variant/5 shadow-md">
                    <div class="flex items-center gap-6 flex-1">
                        <span class="font-headline font-black text-2xl ${i===0?'text-secondary': i===1?'text-on-surface':'text-on-surface-variant'} w-8 italic text-center">${(i+1).toString().padStart(2,'0')}</span>
                        <div class="relative">
                            <img src="${s.image || 'https://i.imgur.com/xnTuRnl.png'}" class="w-14 h-14 rounded-full object-cover border-2 ${i===0?'border-secondary':'border-transparent'}">
                            ${i===0 ? `<div class="absolute -bottom-1 -right-1 bg-secondary w-5 h-5 rounded-full flex items-center justify-center"><span class="material-symbols-outlined text-[12px] text-on-secondary" style="font-variation-settings: 'FILL' 1;">workspace_premium</span></div>` : ''}
                        </div>
                        <div>
                            <p class="text-lg font-bold font-body group-hover:text-primary transition-colors">${s.player}</p>
                            <p class="text-xs text-on-surface-variant font-label uppercase font-semibold">${s.team}</p>
                        </div>
                    </div>
                    <div class="text-right w-24">
                        ${isAdmin ? `<input type="number" value="${s.goals}" class="admin-input mb-0 w-16 text-center text-xl font-black font-headline text-primary p-1" data-action="updateScorerGoals" data-id="${s.id}">` : `<p class="text-3xl font-black font-headline ${i===0?'text-primary':'text-on-surface'}">${s.goals}</p>`}
                        <p class="text-[10px] text-on-surface-variant font-label uppercase tracking-widest mt-1">Goals</p>
                    </div>
                    <div class="w-10 text-right">${isAdmin ? `<button class="deleteBtn" data-action="deleteScorer" data-id="${s.id}">X</button>` : ""}</div>
                </div>`).join("");

      if (document.getElementById("dashboardScorers")) {
        document.getElementById("dashboardScorers").innerHTML = sorted.slice(0, 3).map((s, i) => `
                <div class="flex items-center gap-4 group cursor-pointer bg-surface-container p-3 rounded-[1.5rem] hover:bg-surface-container-highest transition-colors">
                    <div class="relative">
                        <img src="${s.image || 'https://i.imgur.com/xnTuRnl.png'}" class="w-12 h-12 rounded-full object-cover border-2 ${i===0?'border-secondary':'border-transparent'}">
                        ${i===0 ? `<div class="absolute -bottom-1 -right-1 bg-secondary text-on-secondary text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center">1</div>` : ''}
                    </div>
                    <div class="flex-1">
                        <p class="text-[10px] text-on-surface-variant font-bold font-label uppercase">${s.team}</p>
                        <p class="font-headline font-bold text-lg group-hover:text-primary transition-colors">${s.player}</p>
                    </div>
                    <div class="text-right">
                        <p class="font-headline font-black text-2xl ${i===0?'text-secondary':''}">${s.goals}</p>
                        <p class="text-[10px] text-on-surface-variant font-label uppercase">GOALS</p>
                    </div>
                </div>`).join("");
      }

    if (document.getElementById("topScorerHero") && sorted.length > 0) {
    const leader = sorted[0];
    const heroImage = leader.poster || leader.image || 'https://i.imgur.com/xnTuRnl.png';

    document.getElementById("topScorerHero").innerHTML = `
        <div class="relative w-full h-full flex flex-col items-center justify-end overflow-hidden group">
            
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-primary/20 blur-[120px] rounded-full z-0"></div>

            <div class="absolute inset-0 flex items-end justify-center z-10 pointer-events-none">
                <img src="${heroImage}" 
                     class="h-[115%] w-auto object-contain transition-all duration-700 group-hover:scale-110 drop-shadow-[0_20px_50px_rgba(0,0,0,0.7)]" 
                     style="max-width: 90%;">
            </div>

            <div class="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent z-20"></div>

            <div class="relative z-30 w-full p-8 text-center flex flex-col items-center">
                <div class="flex items-center gap-3 mb-3">
                    <div class="h-[1px] w-8 bg-primary/50"></div>
                    <span class="text-primary text-[10px] font-black uppercase tracking-[0.3em] font-headline italic">Golden Boot Leader</span>
                    <div class="h-[1px] w-8 bg-primary/50"></div>
                </div>
                
                <h2 class="text-6xl md:text-8xl font-black font-headline tracking-tighter text-white uppercase leading-none drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] italic">
                    ${leader.player}
                </h2>
                
                <div class="flex gap-8 mt-6 bg-surface-container-highest/60 p-5 rounded-3xl backdrop-blur-xl border border-white/10 shadow-2xl items-center">
                    <div class="text-right">
                        <p class="text-on-surface-variant text-[8px] uppercase tracking-widest opacity-60 font-bold">Team</p>
                        <p class="text-sm font-black text-white uppercase tracking-tight">${leader.team}</p>
                    </div>
                    <div class="w-px h-8 bg-white/20"></div>
                    <div class="text-left">
                        <p class="text-on-surface-variant text-[8px] uppercase tracking-widest opacity-60 font-bold">Goals</p>
                        <p class="text-4xl font-black text-primary leading-none tabular-nums">${leader.goals}</p>
                    </div>
                </div>
            </div>
        </div>`;
}
      
      // Special section to display the Assist Leaderboard
      const sortedAssists = [...sorted].sort((a, b) => (b.assists || 0) - (a.assists || 0));
      const assistTable = document.getElementById("assistTable");
      if (assistTable) {
        assistTable.innerHTML = sortedAssists.map((s, i) => `
        <div class="bg-surface-container-high p-5 rounded-[2rem] flex items-center justify-between group">
            <div class="flex items-center gap-6">
                <span class="font-headline font-black text-2xl text-on-surface-variant w-8 italic text-center">${i+1}</span>
                <img src="${s.image || 'https://i.imgur.com/xnTuRnl.png'}" class="w-14 h-14 rounded-full object-cover bg-surface-container">
                <div>
                    <p class="text-lg font-bold">${s.player}</p>
                    <p class="text-xs text-on-surface-variant uppercase font-semibold">${s.team}</p>
                </div>
            </div>
            <div class="text-right">
                ${isAdmin 
                ? `<input 
                      type="number" 
                      value="${s.assists || 0}" 
                      class="admin-input w-16 text-center text-xl font-black font-headline p-1"
                      data-action="updateScorerAssists" data-id="${s.id}"
                   >`
                : `<p class="text-3xl font-black font-headline text-tertiary">${s.assists || 0}</p>`
              }
                <p class="text-[10px] text-on-surface-variant font-label uppercase tracking-widest">Assists</p>
            </div>
        </div>
    `).join("");
      }
    };

  // --- SISTEM KNOCKOUT (TARUH DI SINI) ---

// Menggunakan deklarasi 'function' agar bisa diakses dari mana saja (Hoisting)
function drawLines() {
    const svg = document.getElementById("connections");
    if (!svg) return;
    svg.innerHTML = "";
    
    const container = document.getElementById("nodes-container");
    if (container) {
        // Sesuaikan ukuran SVG dengan isi container agar garis tidak terpotong
        svg.setAttribute("width", container.scrollWidth);
        svg.setAttribute("height", container.scrollHeight);
    }

    if (!knockout.connections) return;

    knockout.connections.forEach(conn => {
        const fromEl = document.querySelector(`[data-id="${conn.from}"]`);
        const toEl = document.querySelector(`[data-id="${conn.to}"]`);

        if (fromEl && toEl) {
            const containerRect = svg.getBoundingClientRect();
            const rect1 = fromEl.getBoundingClientRect();
            const rect2 = toEl.getBoundingClientRect();

            // Titik awal (tengah kanan kotak asal)
            const x1 = rect1.right - containerRect.left;
            const y1 = rect1.top + (rect1.height / 2) - containerRect.top;

            // Titik akhir (tengah kiri kotak tujuan)
            const x2 = rect2.left - containerRect.left;
            const y2 = rect2.top + (rect2.height / 2) - containerRect.top;

            // Membuat garis siku-siku yang rapi
            const midX = x1 + (x2 - x1) / 2;
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            
            // Logika garis: Jalan ke kanan -> belok vertikal -> jalan ke kanan lagi
            path.setAttribute("d", `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
            path.setAttribute("stroke", "#3b82f6"); 
            path.setAttribute("stroke-width", "2");
            path.setAttribute("fill", "none");
            path.style.opacity = "0.4";
            svg.appendChild(path);
        }
    });
}

function renderNodes() {
    const container = document.getElementById("nodes-container");
    if (!container) return;
    container.innerHTML = "";

    if (!knockout.matches) return;

    Object.entries(knockout.matches).forEach(([id, node]) => {
        const div = document.createElement("div");
        div.className = "absolute z-10 group";
        div.style.left = node.x + "px";
        div.style.top = node.y + "px";
        div.dataset.id = id;

        div.innerHTML = `
            <div class="bg-[#1a243a] border border-white/10 rounded-xl shadow-xl w-[200px] overflow-hidden group hover:border-primary/50 transition-all">
                <div class="p-2 space-y-1">
                    <div class="flex items-center justify-between">
                        <input type="text" value="${node.team1 || ''}" data-action="updateTeamKO" data-id="${id}" data-side="1" 
                            class="bg-transparent border-none p-0 text-[11px] font-bold text-white w-24 focus:ring-0" placeholder="TEAM 1" ${!isAdmin ? 'readonly' : ''}>
                        <input type="number" value="${node.s1 ?? ''}" data-action="updateScoreKO" data-id="${id}" data-side="1"
                            class="bg-black/40 border-none rounded w-8 text-center text-xs font-black text-primary focus:ring-0" ${!isAdmin ? 'readonly' : ''}>
                    </div>
                    <div class="flex items-center justify-between">
                        <input type="text" value="${node.team2 || ''}" data-action="updateTeamKO" data-id="${id}" data-side="2"
                            class="bg-transparent border-none p-0 text-[11px] font-bold text-white w-24 focus:ring-0" placeholder="TEAM 2" ${!isAdmin ? 'readonly' : ''}>
                        <input type="number" value="${node.s2 ?? ''}" data-action="updateScoreKO" data-id="${id}" data-side="2"
                            class="bg-black/40 border-none rounded w-8 text-center text-xs font-black text-primary focus:ring-0" ${!isAdmin ? 'readonly' : ''}>
                    </div>
                </div>
                ${isAdmin ? `
                <div class="flex border-t border-white/5 opacity-0 group-hover:opacity-100 transition-all bg-black/20">
                    <button class="flex-1 p-1 hover:bg-primary/20 text-[9px] font-bold text-primary" data-action="linkNode" data-id="${id}">LINK</button>
                    <button class="flex-1 p-1 hover:bg-error/20 text-[9px] font-bold text-error" data-action="deleteNode" data-id="${id}">DEL</button>
                    <div class="drag-handle flex-none p-1 cursor-move"><span class="material-symbols-outlined text-xs text-white/30">drag_pan</span></div>
                </div>` : ''}
            </div>
        `;

        if (isAdmin) setupDragging(div, node);
        container.appendChild(div);
    });

    drawLines();
}

// Tambahkan fungsi pembantu dragging ini di bawahnya
function setupDragging(div, node) {
    const handle = div.querySelector('.drag-handle');
    if (!handle) return;

    handle.onmousedown = (e) => {
        let isDragging = true;
        const startX = e.clientX - node.x;
        const startY = e.clientY - node.y;

        document.onmousemove = (ev) => {
            if (!isDragging) return;
            node.x = ev.clientX - startX;
            node.y = ev.clientY - startY;
            div.style.left = node.x + "px";
            div.style.top = node.y + "px";
            drawLines();
        };

        document.onmouseup = async () => {
            isDragging = false;
            document.onmousemove = null;
            await saveKnockout();
        };
    };
}

    // --- INIT & SCORERS LOGIC ---
    (function populateMatchweek() {
      const s = document.getElementById("matchMatchweek");
      if (s) s.innerHTML = Array.from({ length: 22 }, (_, i) => `<option value="${i+1}">Matchweek ${i+1}</option>`).join('');
    })();

    const updateScorerGoals = async (id, val) => {
      if (isAdmin) await updateDoc(doc(db, "scorers", id), { goals: isNaN(parseInt(val)) ? 0 : parseInt(val) });
    };
    
    const updateScorerAssists = async (id, value) => {
      if (isAdmin) {
        await updateDoc(doc(db, "scorers", id), { assists: isNaN(parseInt(value)) ? 0 : parseInt(value) });
      }
    };

    const addScorer = async () => {
      if (!isAdmin) return;
      const player = document.getElementById("playerName").value.trim();
      const image = document.getElementById("playerImage").value.trim();
      const poster = document.getElementById("scorerPoster").value.trim();
      const team = document.getElementById("playerTeam").value;
      const goals = parseInt(document.getElementById("playerGoals").value) || 0;
      const assists = parseInt(document.getElementById("playerAssists").value) || 0; // New field

      if (!player || !team) return alert("Fill in player name and team!");

      // Save to Firebase (including assists)
      await addDoc(collection(db, "scorers"), { player, image, poster, team, goals, assists });

      // Clear input fields after saving
      ["playerName", "playerImage", "scorerPoster", "playerGoals", "playerAssists"].forEach(id => document.getElementById(id).value = "");
    };

    const deleteScorer = async (id) => {
      if (isAdmin && confirm("Delete scorer?")) await deleteDoc(doc(db, "scorers", id));
    };

    // Fungsi untuk menyimpan data HOF dari Modal
// Gunakan window agar bisa diakses dari HTML jika perlu
// 1. Update Simpan (Tambahkan Deskripsi & Foto Scorer)
window.saveHofEntry = async () => {
  try {
    // Ambil semua nilai dari input
    const season = document.getElementById('hofSeason').value;
    const winnerTeam = document.getElementById('hofWinnerTeam').value;
    
    if (!season || !winnerTeam) {
        alert("Season dan Nama Tim Juara wajib diisi!");
        return;
    }

    const data = {
      season: season,
      winnerTeam: winnerTeam,
      winnerPlayer: document.getElementById('hofWinnerPlayer').value,
      winnerLogo: document.getElementById('hofWinnerLogo').value,
      winnerStars: parseInt(document.getElementById('hofWinnerStars').value) || 1,
      cupWinner: document.getElementById('hofCupWinner').value || "N/A",
      topScorer: document.getElementById('hofTopScorer').value,
      goals: parseInt(document.getElementById('hofGoals').value) || 0,
      scorerPhoto: document.getElementById('hofScorerPhoto').value || "", // Pastikan ID ini ada di HTML
      description: document.getElementById('hofDescription').value || "", // Pastikan ID ini ada di HTML
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, "halloffame"), data);
    
    // Tutup Modal & Reset Form
    document.getElementById('hofModal').classList.add('hidden');
    // Reset semua input (opsional tapi disarankan)
    document.querySelectorAll('#hofModal input, #hofModal textarea').forEach(input => input.value = "");
    
    alert("History Season Berhasil Disimpan!");
  } catch (error) {
    console.error("Error saving history:", error);
    alert("Gagal menyimpan data: " + error.message);
  }
};
    // --- UPDATE LOGIC TAMPILAN DETAIL
window.showHofDetail = (id) => {
    // 1. Ambil data dari variabel global (hallOfFameData)
    const item = window.hallOfFameData ? window.hallOfFameData.find(h => h.id === id) : null;
    
    if (!item) {
        console.error("Data season tidak ditemukan untuk ID:", id);
        return;
    }

    // 2. Isi Data Utama (Teks)
    document.getElementById('detailSeasonName').innerText = item.season;
    document.getElementById('detailWinnerTeam').innerText = item.winnerTeam;
    document.getElementById('detailWinnerPlayer').innerText = item.winnerPlayer; // NAMA MANAGER
    document.getElementById('detailTopScorer').innerText = item.topScorer;
    document.getElementById('detailGoals').innerText = `${item.goals} GOALS SCORED`;
    document.getElementById('detailCupWinner').innerText = item.cupWinner && item.cupWinner !== "N/A" ? item.cupWinner : "No Cup Held";
    
    // 3. Isi Deskripsi (Dengan penanganan jika kosong)
    const descEl = document.getElementById('detailDescription');
    if (descEl) {
        descEl.innerText = item.description || "No special story recorded for this legendary season.";
    }

    // 4. Update Logo Tim Juara
    const logoEl = document.getElementById('detailWinnerLogo');
    if (logoEl) {
        logoEl.src = item.winnerLogo || 'https://i.imgur.com/xnTuRnl.png'; // Placeholder jika logo kosong
    }

    // 5. Render Bintang Juara (Baru)
    const starsContainer = document.getElementById('detailWinnerStars');
    if (starsContainer) {
        let starsHtml = "";
        for(let i=0; i < (parseInt(item.winnerStars) || 1); i++) {
            starsHtml += `<span class="material-symbols-outlined text-[16px]">star</span>`;
        }
        starsContainer.innerHTML = starsHtml;
    }

    // 6. UPDATE FOTO TOP SCORER (FIT & GLOW - JAWABAN NO 1)
    const photoContainer = document.getElementById('scorerPhotoContainer');
    if (photoContainer) {
        // Kita menggunakan object-contain agar foto selalu fit di area,
        // dan menambahkan drop-shadow neon hijau agar menyala.
        photoContainer.innerHTML = `
            <img src="${item.scorerPhoto || 'https://i.imgur.com/xnTuRnl.png'}" 
                 class="max-h-full max-w-full object-contain relative z-10 drop-shadow-[0_0_40px_rgba(142,255,113,0.5)] transition-all duration-500 group-hover:scale-105"
                 alt="Top Scorer ${item.topScorer}">
        `;
    }

    // 7. Tampilkan Modal dengan Animasi Fade In
    const modal = document.getElementById('hofDetailModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        // Trigger animasi opacity (butuh delay sedikit agar CSS transisi berjalan)
        setTimeout(() => {
            modal.classList.add('opacity-100');
        }, 10);
    }
};

    const exportBackup = () => alert("Backup logic to be implemented.");
    const importBackup = (e) => alert("Import logic to be implemented.");

    // --- EVENT DELEGATION HUB (MENGGANTIKAN SEMUA ONCLICK/ONCHANGE) ---
    document.addEventListener('click', async (e) => {
    // Kita gunakan satu variabel saja, yaitu 'btn'
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;

    // Navigasi & UI
    if (action === 'toggleSidebar') toggleSidebar();
    else if (action === 'openTab') openTab(btn.dataset.tab, btn);
    else if (action === 'toggleFolder') toggleFolder(parseInt(btn.dataset.mw));
    
    // Auth
    else if (action === 'login') await login();
    else if (action === 'logout') logout(); 
    
    // Teams
    else if (action === 'addTeam') await addTeam();
    else if (action === 'deleteTeam') await deleteTeam(btn.dataset.id);
    
    // Matches & League
    else if (action === 'generateLeague') await generateLeague(); 
    else if (action === 'resetMatches') await hardReset();
    else if (action === 'deleteMatch') await deleteMatch(btn.dataset.id);
    else if (action === 'addMatch') await addMatch();
    
    // LIVE System (Otomatis Tanggal)
    else if (action === 'toggleLive') {
        const id = btn.dataset.id;
        const newState = btn.dataset.state === 'true'; 
        await toggleLive(id, newState);
    }
    
    // Scorers & News
    else if (action === 'addNews') await addNews();
    else if (action === 'addScorer') await addScorer();
    else if (action === 'deleteScorer') await deleteScorer(btn.dataset.id);
      
    // Tambahkan baris ini di antara else if lainnya
    if (action === 'openHofModal') {
    const modal = document.getElementById('hofModal');
    if(modal) modal.classList.remove('hidden');
}
    
    // Knockout & Others
    else if (action === 'createNode') await createNode();
    else if (action === 'generateBracket') await generateBracket();
    else if (action === 'clearKnockout') {
    if(confirm("Hapus semua data knockout?")) {
        knockout = { matches: {}, connections: [] };
        await saveKnockout();
    }
}
    else if (action === 'deleteNode') await deleteNode(btn.dataset.id);
    else if (action === 'saveCutoffs') await saveCutoffs();
    else if (action === 'exportBackup') exportBackup();
        
});
    

    document.addEventListener('change', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
      
    const action = target.dataset.action;

    if (action === 'filterMatches') renderMatches();
    else if (action === 'updateScore') await updateScore(target.dataset.id, target.value, target.dataset.side);
    else if (action === 'updateScorerGoals') await updateScorerGoals(target.dataset.id, target.value);
    else if (action === 'updateScorerAssists') await updateScorerAssists(target.dataset.id, target.value);
    else if (action === 'updateTeamKO') updateTeamKO(target.dataset.id, parseInt(target.dataset.side), target.value);
    else if (action === 'updateScoreKO') updateScoreKO(target.dataset.id, parseInt(target.dataset.side), target.value);
    else if (action === 'importBackup') importBackup(e);
});

    document.addEventListener('input', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      if (target.dataset.action === 'searchScorer') renderScorers();
    });

document.addEventListener('DOMContentLoaded', () => {
    const connEl = document.getElementById("connections");
    if (connEl) {
        connEl.addEventListener('click', () => {
            if (isAdmin && knockout.connections.length > 0) {
                if (confirm("Hapus garis terakhir?")) {
                    knockout.connections.pop();
                    saveKnockout();
                }
            }
        });
    }
});
