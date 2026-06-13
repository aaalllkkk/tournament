// File: js/main.js

import { db, auth } from './firebase-config.js';

// 2. Panggil fitur-fitur Firebase yang dibutuhkan
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, updateDoc, deleteDoc, setDoc, getDocs, getDoc, Timestamp, writeBatch, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// --- STATE ---
    let isAdmin = false;
    let teams = [];
    let matches = [];
    let matchEvents = [];
    let liveMatchStates = [];
    let scorers = [];
    let rosterPlayers = [];
    let news = [];
    let knockout = { format: "single", bracketSize: 0, rounds: [] };
    let collapsed = JSON.parse(localStorage.getItem("collapsedMW") || "{}");
    let championsCutoff = 4;
    let playoffCutoff = 6;
    let relegationCutoff = 1;
    let hallOfFameData = []; 
    let hofManagers = [];
    let trophyCabinetSettings = {
      leagueImage: "",
      cupImage: ""
    };
    let matchEventsReady = false;
    const seenMatchEventIds = new Set();
    let matchesSnapshotReady = false;
    const knownLiveByMatchId = new Map();
    const autoNewsInFlight = new Set();
    let knockoutScheduleSyncing = false;
    let knockoutScoreSyncing = false;
    let activeTeamDetailId = "";
    
    // Variabel Global untuk Slideshow
    let slideshowInterval = null;

    // --- UTILS ---
    const applyTheme = (theme) => {
      const mode = theme === "light" ? "light" : "dark";
      document.body.classList.toggle("light-theme", mode === "light");
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.documentElement.classList.toggle("light", mode === "light");
      localStorage.setItem("ligaTheme", mode);

      const icon = document.querySelector("#themeToggle .theme-toggle-icon");
      if (icon) icon.textContent = mode === "light" ? "light_mode" : "dark_mode";
    };

    applyTheme(localStorage.getItem("ligaTheme") || "dark");

    const normalizeKey = (str) => (str || "").toString().trim().toLowerCase();
    const safe = (val, fallback = "") => val ?? fallback;
    const placeholderImage = "https://i.imgur.com/xnTuRnl.png";

    const findManagerPhoto = (managerName, directPhoto = "") => {
      const cleanPhoto = (directPhoto || "").trim();
      if (cleanPhoto) return cleanPhoto;

      const key = normalizeKey(managerName);
      if (!key) return "";

      const manual = hofManagers.find((manager) => (
        normalizeKey(manager.name) === key &&
        (manager.photo || "").trim()
      ));
      if (manual) return manual.photo.trim();

      const fromLeague = hallOfFameData.find((item) => (
        normalizeKey(item.winnerPlayer) === key &&
        (item.winnerPlayerPhoto || "").trim()
      ));
      if (fromLeague) return fromLeague.winnerPlayerPhoto.trim();

      const fromCup = hallOfFameData.find((item) => (
        normalizeKey(item.cupWinnerManager) === key &&
        (item.cupWinnerManagerPhoto || "").trim()
      ));
      if (fromCup) return fromCup.cupWinnerManagerPhoto.trim();

      return "";
    };

    const resolveManagerPhoto = (managerName, directPhoto = "") => {
      return findManagerPhoto(managerName, directPhoto) || placeholderImage;
    };

    const resolveTeam = (name) => {
      const team = teams.find(t => normalizeKey(t.name) === normalizeKey(name));
      return team ? { ...team, disqualified: false } : { name, logo: placeholderImage, disqualified: true };
    };

    const slugKey = (value) => String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const teamKeyFor = (team) => team?.teamKey || slugKey(team?.name);

    const playersForTeam = (team) => {
      const key = teamKeyFor(team);
      const name = normalizeKey(team?.name);
      return rosterPlayers
        .filter((player) => normalizeKey(player.teamKey) === normalizeKey(key) || normalizeKey(player.team) === name)
        .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || (a.rosterSlot ?? 999) - (b.rosterSlot ?? 999) || String(a.player || "").localeCompare(String(b.player || "")));
    };

    const positionGroup = (position = "") => {
      const value = normalizeKey(position);
      if (["gk", "goalkeeper"].some((item) => value.includes(item))) return "GK";
      if (["cb", "lb", "rb", "def", "dmf"].some((item) => value.includes(item))) return "DEF";
      if (["cm", "am", "mf", "mid", "lm", "rm"].some((item) => value.includes(item))) return "MID";
      if (["cf", "ss", "wf", "lw", "rw", "fw", "st"].some((item) => value.includes(item))) return "FWD";
      return "SUB";
    };

    const sameExternalMatch = (a, b) => normalizeKey(a || "") && normalizeKey(a) === normalizeKey(b);

    const getLiveStateForMatch = (match) => liveMatchStates.find((state) => (
      state.id === match.id ||
      state.matchDocId === match.id ||
      sameExternalMatch(state.externalMatchId, match.externalMatchId)
    ));

    const getEventsForMatch = (match) => matchEvents
      .filter((event) => (
        event.matchDocId === match.id ||
        sameExternalMatch(event.externalMatchId, match.externalMatchId)
      ))
      .sort((a, b) => (
        (parseInt(a.minute) || 0) - (parseInt(b.minute) || 0) ||
        (parseInt(a.second) || 0) - (parseInt(b.second) || 0) ||
        (parseInt(a.bridgeImportedAtMs) || 0) - (parseInt(b.bridgeImportedAtMs) || 0)
      ));

    const formatLiveClock = (match) => {
      const state = getLiveStateForMatch(match) || {};
      const minute = state.clockMinute ?? match.liveClockMinute;
      const second = state.clockSecond ?? match.liveClockSecond;
      const period = state.period ?? match.livePeriod;
      if (minute === null || minute === undefined || minute === "") return "";
      const secondText = second === null || second === undefined || second === "" ? "00" : String(second).padStart(2, "0");
      return `${period || "LIVE"} ${minute}:${secondText}`;
    };

    const hasFinalScore = (match) => (
      match &&
      match.s1 !== null &&
      match.s1 !== undefined &&
      match.s1 !== "" &&
      match.s2 !== null &&
      match.s2 !== undefined &&
      match.s2 !== ""
    );

    const hasPenaltyScore = (match) => (
      match &&
      match.p1 !== null &&
      match.p1 !== undefined &&
      match.p1 !== "" &&
      match.p2 !== null &&
      match.p2 !== undefined &&
      match.p2 !== ""
    );

    const formatPenaltyScore = (match) => hasPenaltyScore(match) ? `${match.p1}-${match.p2} pens` : "";

    const getMatchSortValue = (match) => (
      parseInt(match.bridgeImportedAtMs) ||
      parseInt(match.autoNewsGeneratedAt) ||
      parseInt(match.autoNewsRequestedAt) ||
      parseInt(match.Matchweek) ||
      0
    );

    const getTeamForm = (teamName, limit = 5) => matches
      .filter((match) => (
        match.type !== "knockout" &&
        hasFinalScore(match) &&
        (normalizeKey(match.team1) === normalizeKey(teamName) || normalizeKey(match.team2) === normalizeKey(teamName))
      ))
      .sort((a, b) => getMatchSortValue(b) - getMatchSortValue(a))
      .slice(0, limit)
      .map((match) => {
        const isHome = normalizeKey(match.team1) === normalizeKey(teamName);
        const own = parseInt(isHome ? match.s1 : match.s2) || 0;
        const opp = parseInt(isHome ? match.s2 : match.s1) || 0;
        if (own > opp) return "W";
        if (own < opp) return "L";
        return "D";
      });

    const renderFormGuide = (teamName) => {
      const form = getTeamForm(teamName);
      if (!form.length) return "";
      const colorFor = (result) => (
        result === "W" ? "bg-primary/15 text-primary border-primary/20" :
        result === "L" ? "bg-error/15 text-error border-error/20" :
        "bg-secondary/15 text-secondary border-secondary/20"
      );
      return `
        <div class="mt-2 flex items-center gap-1">
          ${form.map((result) => `<span class="flex h-5 w-5 items-center justify-center rounded-md border text-[9px] font-black ${colorFor(result)}">${result}</span>`).join("")}
        </div>
      `;
    };

    const getKnockoutBracketMatch = (matchId) => {
      if (!matchId || !knockout?.rounds?.length) return null;
      for (const round of knockout.rounds) {
        const found = (round.matches || []).find((match) => match.id === matchId);
        if (found) return found;
      }
      return null;
    };

    const renderKnockoutAdminStatus = (match) => {
      if (!isAdmin || match.type !== "knockout") return "";
      const linked = getKnockoutBracketMatch(match.knockoutMatchId);
      const synced = linked && String(linked.s1 ?? "") === String(match.s1 ?? "") && String(linked.s2 ?? "") === String(match.s2 ?? "") && hasFinalScore(match);
      const items = [];

      if (match.live) {
        items.push({ label: "Live from PES", cls: "bg-error/10 text-error border-error/20" });
      } else if (hasFinalScore(match)) {
        items.push({ label: synced ? "Synced to Bracket" : "Ready to Sync", cls: synced ? "bg-primary/10 text-primary border-primary/20" : "bg-secondary/10 text-secondary border-secondary/20" });
        items.push({ label: "Locked Final", cls: "bg-white/5 text-on-surface-variant border-white/10" });
      } else {
        items.push({ label: "Waiting PES", cls: "bg-secondary/10 text-secondary border-secondary/20" });
      }

      return `
        <div class="mt-4 flex flex-wrap justify-center gap-2">
          ${items.map((item) => `<span class="rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-widest ${item.cls}">${item.label}</span>`).join("")}
        </div>
      `;
    };

    const getUpcomingMatches = () => matches
      .filter((match) => !match.live && !hasFinalScore(match) && match.team1 && match.team2)
      .sort((a, b) => {
        if (a.type === "knockout" && b.type !== "knockout") return -1;
        if (a.type !== "knockout" && b.type === "knockout") return 1;
        return getMW(a) - getMW(b);
      });

    const renderDashboardNextMatch = () => {
      const container = document.getElementById("dashboardNextMatch");
      if (!container) return;
      const match = getUpcomingMatches()[0];
      if (!match) {
        container.innerHTML = "";
        return;
      }

      const t1 = resolveTeam(match.team1);
      const t2 = resolveTeam(match.team2);
      const form1 = renderFormGuide(match.team1);
      const form2 = renderFormGuide(match.team2);
      const label = match.type === "knockout" ? (match.knockoutRoundName || "Knockout") : `Matchday ${getMW(match)}`;

      container.innerHTML = `
        <article class="rounded-[1.6rem] border border-outline-variant/10 bg-surface-container-high p-5 shadow-xl">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <p class="text-[10px] uppercase tracking-[0.22em] text-secondary font-black">Next Match Preview</p>
              <h4 class="mt-1 font-headline text-lg font-black uppercase text-white">${label}</h4>
            </div>
            <button class="hidden md:inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary" data-action="openTab" data-tab="schedule">Schedule</button>
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
            <div class="min-w-0 text-center">
              <img src="${t1.logo}" class="mx-auto h-14 w-14 object-contain">
              <p class="mt-2 truncate font-headline text-sm font-black uppercase text-white">${t1.name}</p>
              <div class="flex justify-center">${form1}</div>
            </div>
            <div class="pt-8 font-headline text-xl font-black italic text-secondary">VS</div>
            <div class="min-w-0 text-center">
              <img src="${t2.logo}" class="mx-auto h-14 w-14 object-contain">
              <p class="mt-2 truncate font-headline text-sm font-black uppercase text-white">${t2.name}</p>
              <div class="flex justify-center">${form2}</div>
            </div>
          </div>
        </article>
      `;
    };

    const renderPesBridgePanel = () => {
      const container = document.getElementById("pesBridgePanel");
      if (!container) return;

      if (!isAdmin) {
        container.innerHTML = `
          <div class="rounded-[2rem] border border-outline-variant/10 bg-surface-container-high p-8 text-center shadow-xl">
            <p class="font-headline text-2xl font-black uppercase text-white">Admin Only</p>
            <p class="mt-2 text-sm text-on-surface-variant">Login sebagai admin untuk melihat status PES Bridge.</p>
          </div>
        `;
        return;
      }

      const knockoutSchedules = matches.filter((match) => match.type === "knockout" && match.knockoutGenerated);
      const liveItems = matches.filter((match) => match.live);
      const lockedItems = knockoutSchedules.filter((match) => hasFinalScore(match) && !match.live);
      const waitingItems = knockoutSchedules.filter((match) => !hasFinalScore(match) && !match.live);
      const lastBridgeItem = matches
        .filter((match) => match.bridgeImportedAtMs)
        .sort((a, b) => (parseInt(b.bridgeImportedAtMs) || 0) - (parseInt(a.bridgeImportedAtMs) || 0))[0];
      const escapeHtml = (value) => String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const teamMapText = teams
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .map((team) => `${team.pesTeamId || team.teamKey || slugKey(team.name)}=${team.name}`)
        .join("\n");

      const statCard = (label, value, tone = "text-primary") => `
        <div class="rounded-[1.4rem] border border-outline-variant/10 bg-surface-container-high p-5 shadow-xl">
          <p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-black">${label}</p>
          <p class="mt-2 font-headline text-4xl font-black ${tone}">${value}</p>
        </div>
      `;

      const row = (match) => {
        const status = match.live ? "Live from PES" : hasFinalScore(match) ? "Locked Final" : "Waiting PES";
        const score = hasFinalScore(match) ? `${match.s1}-${match.s2}${formatPenaltyScore(match) ? ` (${formatPenaltyScore(match)})` : ""}` : "vs";
        return `
          <div class="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center rounded-2xl border border-outline-variant/10 bg-black/20 p-4">
            <div class="min-w-0">
              <p class="truncate font-headline text-sm font-black uppercase text-white">${match.team1} ${score} ${match.team2}</p>
              <p class="mt-1 text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">${match.knockoutRoundName || match.date || "Match"}</p>
            </div>
            <span class="rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-secondary">${status}</span>
            <button class="admin-btn !py-2 !px-3" data-action="openTab" data-tab="schedule">Open</button>
          </div>
        `;
      };

      container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          ${statCard("Live", liveItems.length, "text-error")}
          ${statCard("Waiting PES", waitingItems.length, "text-secondary")}
          ${statCard("Locked Final", lockedItems.length, "text-primary")}
          ${statCard("KO Schedules", knockoutSchedules.length, "text-on-surface")}
        </div>
        <section class="mt-6 rounded-[2rem] border border-outline-variant/10 bg-surface-container-high p-6 shadow-xl">
          <div class="mb-5 flex items-center justify-between gap-3">
            <div>
              <p class="text-[10px] uppercase tracking-[0.22em] text-primary font-black">Bridge Settings</p>
              <h3 class="font-headline text-2xl font-black uppercase text-white">Firestore Sync</h3>
            </div>
            <span class="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary">Schedule First</span>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="rounded-2xl border border-outline-variant/10 bg-black/20 p-4">
              <p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-black">Match Target</p>
              <p class="mt-2 font-headline text-lg font-black text-white">matches</p>
              <p class="mt-1 text-[10px] uppercase tracking-widest text-secondary font-bold">Only empty scores</p>
            </div>
            <div class="rounded-2xl border border-outline-variant/10 bg-black/20 p-4">
              <p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-black">Timeline Target</p>
              <p class="mt-2 font-headline text-lg font-black text-white">matchEvents</p>
              <p class="mt-1 text-[10px] uppercase tracking-widest text-secondary font-bold">Goals, assists, cards, subs</p>
            </div>
            <div class="rounded-2xl border border-outline-variant/10 bg-black/20 p-4">
              <p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-black">Live State</p>
              <p class="mt-2 font-headline text-lg font-black text-white">liveMatchStates</p>
              <p class="mt-1 text-[10px] uppercase tracking-widest text-secondary font-bold">Clock and active match</p>
            </div>
          </div>
          <div class="mt-5">
            <p class="mb-2 text-[10px] uppercase tracking-widest text-on-surface-variant font-black">Team Map Preview</p>
            <textarea readonly class="admin-input h-32 font-mono text-xs">${escapeHtml(teamMapText || "Belum ada team terdaftar.")}</textarea>
          </div>
        </section>
        <section class="mt-6 rounded-[2rem] border border-outline-variant/10 bg-surface-container-high p-6 shadow-xl">
          <div class="mb-4 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <p class="text-[10px] uppercase tracking-[0.22em] text-secondary font-black">Latest Bridge Match</p>
              <h3 class="font-headline text-2xl font-black uppercase text-white">${lastBridgeItem ? `${lastBridgeItem.team1} vs ${lastBridgeItem.team2}` : "No bridge import yet"}</h3>
            </div>
            ${lastBridgeItem ? `<p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">${new Date(parseInt(lastBridgeItem.bridgeImportedAtMs)).toLocaleString()}</p>` : ""}
          </div>
          <div class="space-y-3">
            ${(knockoutSchedules.length ? knockoutSchedules : matches.filter((match) => match.live).slice(0, 5)).slice(0, 8).map(row).join("") || `<p class="text-sm italic text-on-surface-variant">Belum ada schedule knockout/live dari PES.</p>`}
          </div>
        </section>
      `;
    };

    const pickNewsImageForMatch = (match) => {
      const t1 = resolveTeam(match.team1);
      const t2 = resolveTeam(match.team2);
      if ((parseInt(match.s1) || 0) > (parseInt(match.s2) || 0)) return t1.logo;
      if ((parseInt(match.s2) || 0) > (parseInt(match.s1) || 0)) return t2.logo;
      return t1.logo || t2.logo || "https://i.imgur.com/xnTuRnl.png";
    };

    const maybeGenerateNewsAfterMatch = async (match) => {
      if (!isAdmin || !match?.id || !hasFinalScore(match)) return;
      if (match.autoNewsStatus === "generated" || match.autoNewsStatus === "generating") return;
      if (autoNewsInFlight.has(match.id)) return;

      autoNewsInFlight.add(match.id);
      const matchRef = doc(db, "matches", match.id);
      const score = `${match.s1}-${match.s2}`;
      const penaltyScore = formatPenaltyScore(match);
      const stage = match.type === "knockout" ? (match.knockoutRoundName || "Knockout") : "League Match";
      const titlePrefix = match.type === "knockout" ? `${stage}: ` : "";
      const title = `${titlePrefix}${match.team1} ${score}${penaltyScore ? ` (${penaltyScore})` : ""} ${match.team2}`;

      try {
        await updateDoc(matchRef, {
          autoNewsStatus: "generating",
          autoNewsRequestedAt: Date.now(),
          autoNewsError: ""
        });

        const response = await fetch("/api/generate-news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            team1: match.team1,
            team2: match.team2,
            score,
            penaltyScore,
            matchType: match.type || "league",
            stage
          })
        });

        if (!response.ok) {
          throw new Error(`Generate news API failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        const content = (data?.text || "").trim();
        if (!content || content === "No result") {
          throw new Error("Generate news API tidak mengembalikan teks berita.");
        }

        await addDoc(collection(db, "news"), {
          title,
          content,
          image: pickNewsImageForMatch(match),
          time: Date.now(),
          autoGenerated: true,
          autoMatchId: match.id,
          source: "web-generate-news-api",
          team1: match.team1,
          team2: match.team2,
          score,
          penaltyScore,
          matchType: match.type || "league",
          stage
        });

        await updateDoc(matchRef, {
          autoNewsStatus: "generated",
          autoNewsGeneratedAt: Date.now(),
          autoNewsError: ""
        });
      } catch (error) {
        console.error("Auto generate news failed:", error);
        try {
          await updateDoc(matchRef, {
            autoNewsStatus: "failed",
            autoNewsError: error.message || String(error)
          });
        } catch (updateError) {
          console.error("Failed to save auto news error:", updateError);
        }
      } finally {
        autoNewsInFlight.delete(match.id);
      }
    };

    const handleFinishedMatchNewsTriggers = (incomingMatches) => {
      if (!matchesSnapshotReady) {
        incomingMatches.forEach((match) => knownLiveByMatchId.set(match.id, match.live === true));
        matchesSnapshotReady = true;
        return;
      }

      incomingMatches.forEach((match) => {
        const wasLive = knownLiveByMatchId.get(match.id);
        const finishedNow = wasLive === true && match.live === false && hasFinalScore(match);
        knownLiveByMatchId.set(match.id, match.live === true);
        if (finishedNow) {
          maybeGenerateNewsAfterMatch(match);
        }
      });
    };

    const showGoalAnimation = (event) => {
      const match = matches.find((m) => (
        m.id === event.matchDocId ||
        sameExternalMatch(m.externalMatchId, event.externalMatchId)
      ));
      const teamName = event.teamSide === "away" ? (match?.team2 || event.team2) : (match?.team1 || event.team1);
      const scorer = event.scorer || event.player || "";
      const assist = event.assist ? `Assist: ${event.assist}` : "";

      const overlay = document.createElement("div");
      overlay.className = "fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none";
      overlay.innerHTML = `
        <div class="relative overflow-hidden rounded-[2rem] border border-primary/40 bg-[#070e1c]/95 px-10 py-8 text-center shadow-[0_0_80px_rgba(142,255,113,0.35)] animate-[goalPop_2.8s_ease_forwards]">
          <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-secondary to-tertiary"></div>
          <p class="font-headline text-6xl md:text-8xl font-black italic uppercase text-primary text-glow-primary leading-none">GOAL</p>
          <p class="mt-3 font-headline text-xl md:text-3xl font-black uppercase text-white">${teamName || "Liga King"}</p>
          ${scorer ? `<p class="mt-2 text-sm uppercase tracking-widest text-secondary font-bold">${scorer}</p>` : ""}
          ${assist ? `<p class="mt-1 text-[10px] uppercase tracking-widest text-tertiary font-bold">${assist}</p>` : ""}
        </div>
      `;

      if (!document.getElementById("goalPopStyle")) {
        const style = document.createElement("style");
        style.id = "goalPopStyle";
        style.textContent = `
          @keyframes goalPop {
            0% { opacity: 0; transform: scale(0.82) translateY(18px); }
            14% { opacity: 1; transform: scale(1.02) translateY(0); }
            78% { opacity: 1; transform: scale(1) translateY(0); }
            100% { opacity: 0; transform: scale(0.95) translateY(-16px); }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 2900);
    };

    const renderMatchTimeline = (match) => {
      const events = getEventsForMatch(match);
      if (!events.length) {
        return match.bridgeSource || match.externalMatchId
          ? `<div class="mt-5 rounded-2xl border border-tertiary/10 bg-tertiary/5 px-4 py-3 text-[10px] uppercase tracking-widest text-tertiary/70 font-bold">PES integration connected. Waiting for timeline events.</div>`
          : "";
      }

      const iconFor = (kind) => {
        const value = normalizeKey(kind);
        if (value.includes("goal")) return "sports_soccer";
        if (value.includes("yellow") || value.includes("red")) return "style";
        if (value.includes("sub")) return "swap_horiz";
        if (value.includes("assist")) return "handshake";
        return "bolt";
      };

      const colorFor = (kind) => {
        const value = normalizeKey(kind);
        if (value.includes("yellow")) return "text-secondary";
        if (value.includes("red")) return "text-error";
        if (value.includes("goal")) return "text-primary";
        return "text-tertiary";
      };

      return `
        <div class="mt-5 rounded-2xl border border-white/5 bg-black/20 p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <p class="text-[10px] uppercase tracking-widest text-white/45 font-black">PES Timeline</p>
            <span class="text-[10px] uppercase tracking-widest text-tertiary font-bold">${events.length} Event</span>
          </div>
          <div class="space-y-2 max-h-36 overflow-y-auto custom-scroll-thin">
            ${events.slice(-6).map((event) => {
              const kind = event.eventType || "event";
              const minute = event.minute !== null && event.minute !== undefined ? `${event.minute}'` : "--";
              const player = event.scorer || event.player || event.card || event.note || kind;
              const assist = event.assist ? ` / AST ${event.assist}` : "";
              const teamLabel = event.teamSide ? event.teamSide.toUpperCase() : "";
              return `
                <div class="grid grid-cols-[42px_24px_1fr] items-center gap-3 text-xs">
                  <span class="font-headline font-black text-white/50">${minute}</span>
                  <span class="material-symbols-outlined text-[18px] ${colorFor(kind)}">${iconFor(kind)}</span>
                  <div class="min-w-0">
                    <p class="truncate font-bold text-white uppercase">${player}${assist}</p>
                    <p class="text-[9px] uppercase tracking-widest text-white/35">${kind}${teamLabel ? ` - ${teamLabel}` : ""}</p>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
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
    
    const koControls = document.getElementById("knockoutControls");
    if (koControls) {
        koControls.style.display = isAdmin ? "block" : "none";
    }

      if (isAdmin) {
        document.getElementById("championsInput").value = championsCutoff;
        document.getElementById("playoffInput").value = playoffCutoff;
        const relegationInput = document.getElementById("relegationInput");
        if (relegationInput) relegationInput.value = relegationCutoff;
        syncKnockoutScoresFromSchedule(matches);
        ensureKnockoutScheduleMatches();
      }
      toggleAdminUI();
      renderMatches();
      renderScorers();
      renderKnockout();
      renderTeams();
      renderDashboardNextMatch();
      renderPesBridgePanel();
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
      ["adminTeamControls", "matchControls", "scorerControls", "newsControls", "knockoutControls", "liveBannerControls", "trophyCabinetControls", "hofcontrols", "hofManagerControls"].forEach(id => {
        if (document.getElementById(id)) document.getElementById(id).style.display = isAdmin ? "block" : "none";
      });
    };

    // --- UI TOGGLES ---
    const toggleSidebar = () => {
      document.getElementById('sidebar').classList.toggle('-translate-x-full');
      document.getElementById('sidebarOverlay').classList.toggle('active');
    };

    const openTab = (id, targetEl) => {
    // 1. Amankan Sidebar (Mobile)
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (window.innerWidth < 1024) {
        if(sidebar) sidebar.classList.add('-translate-x-full');
        if(overlay) overlay.classList.remove('active');
    }

    // 2. Validasi: Cek apakah ID ada di HTML sebelum lanjut
    const targetSection = document.getElementById(id);
    if (!targetSection) {
        console.error(`Gagal membuka tab: Element dengan ID "${id}" tidak ditemukan!`);
        return; // Berhenti di sini agar tidak crash
    }

    // 3. Reset semua section & tab
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".mobile-tab").forEach(t => t.classList.remove("text-[#ffd709]"));

    // 4. Aktifkan Section yang dituju
    targetSection.classList.add("active");

    // 5. Highlight Tab Sidebar
    if (targetEl && targetEl.classList.contains("tab")) {
        targetEl.classList.add("active");
    } else {
        const matchingTab = Array.from(document.querySelectorAll(".tab")).find(t => t.dataset.tab === id);
        if(matchingTab) matchingTab.classList.add("active");
    }
    
    // 6. Highlight Mobile Tab
    if (targetEl && targetEl.classList.contains("mobile-tab")) {
        targetEl.classList.add("text-[#ffd709]");
    }

    // --- 7. Render Knockout saat tab aktif ---
    if (id === 'knockout') {
        setTimeout(() => {
            if (typeof renderKnockout === 'function') renderKnockout();
        }, 100);
    }

    if (id === 'pesbridge') {
        renderPesBridgePanel();
    }
};

    const toggleFolder = (mw) => {
      collapsed[mw] = !collapsed[mw];
      localStorage.setItem("collapsedMW", JSON.stringify(collapsed));
      renderMatches();
    };

    const syncScorersFromBridgeEvents = async (events) => {
      if (!isAdmin || !Array.isArray(events) || !events.length) return;
      const totals = new Map();

      const addStat = (playerName, teamName, field, event) => {
        const player = String(playerName || "").trim();
        if (!player) return;
        const team = String(teamName || event.team || event.teamName || "").trim();
        const key = `${slugKey(team || "unknown")}_${slugKey(player)}`;
        const item = totals.get(key) || {
          docId: `auto_${key}`,
          player,
          team,
          goals: 0,
          assists: 0,
          source: "pes-bridge",
          autoFromEvents: true
        };
        item[field] += 1;
        totals.set(key, item);
      };

      events.forEach((event) => {
        const kind = normalizeKey(event.eventType || event.type || "");
        const match = matches.find((item) => item.id === event.matchDocId || sameExternalMatch(item.externalMatchId, event.externalMatchId));
        const teamName = event.teamSide === "away" ? (match?.team2 || event.team2) : (match?.team1 || event.team1);
        if (kind.includes("goal")) {
          addStat(event.scorer || event.player, teamName, "goals", event);
          addStat(event.assist, teamName, "assists", event);
        }
      });

      for (const item of totals.values()) {
        const roster = rosterPlayers.find((player) => (
          normalizeKey(player.player) === normalizeKey(item.player) &&
          (!item.team || normalizeKey(player.team) === normalizeKey(item.team))
        ));
        await setDoc(doc(db, "scorers", item.docId), {
          ...item,
          image: roster?.faceUrl || roster?.image || roster?.facePath || "",
          rosterPlayerId: roster?.id || "",
          updatedAtMs: Date.now()
        }, { merge: true });
      }
    };

    // --- DATA LISTENERS ---
    onSnapshot(collection(db, "teams"), snap => {
      teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTeams();
      renderStandings();
      renderDashboardStandings();
      renderDashboardNextMatch();
    });

    onSnapshot(collection(db, "matches"), snap => {
      const incomingMatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      handleFinishedMatchNewsTriggers(incomingMatches);
      syncKnockoutScoresFromSchedule(incomingMatches);
      matches = incomingMatches;
      renderMatches();
      renderLiveMatches();
      renderStandings();
      renderDashboardStandings();
      renderDashboardHeroContent(); // Hanya update teks, bukan gambar
      renderDashboardNextMatch();
      renderPesBridgePanel();
    });

    onSnapshot(collection(db, "liveMatchStates"), snap => {
      liveMatchStates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMatches();
      renderLiveMatches();
      renderDashboardHeroContent();
      renderPesBridgePanel();
    });

    onSnapshot(collection(db, "matchEvents"), snap => {
      const incomingEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (matchEventsReady) {
        incomingEvents.forEach((event) => {
          if (seenMatchEventIds.has(event.id)) return;
          if (normalizeKey(event.eventType).includes("goal")) {
            showGoalAnimation(event);
          }
        });
      }
      incomingEvents.forEach((event) => seenMatchEventIds.add(event.id));
      matchEventsReady = true;
      matchEvents = incomingEvents;
      syncScorersFromBridgeEvents(incomingEvents);
      renderMatches();
      renderLiveMatches();
      renderPesBridgePanel();
    });

    onSnapshot(collection(db, "scorers"), snap => {
      scorers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderScorers();
    });

    onSnapshot(collection(db, "players"), snap => {
      rosterPlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTeams();
      renderRosterPlayerOptions();
      renderScorers();
      if (activeTeamDetailId) renderTeamDetailModal(activeTeamDetailId);
    });
    
    // Listener untuk Hall of Fame
onSnapshot(query(collection(db, "halloffame"), orderBy("createdAt", "desc")), (snapshot) => {
    hallOfFameData = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    window.hallOfFameData = hallOfFameData;
    renderHof(hallOfFameData);
    renderHofManagers();
    renderAllTimeHofScorers();
});

onSnapshot(collection(db, "hofManagers"), (snapshot) => {
    hofManagers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderHofManagers();
});
    
    onSnapshot(collection(db, "news"), snap => {
      news = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderNews();
    });

    onSnapshot(doc(db, "config", "standings"), snap => {
      if (snap.exists()) {
        championsCutoff = snap.data().championsCutoff || 4;
        playoffCutoff = snap.data().playoffCutoff || 6;
        relegationCutoff = snap.data().relegationCutoff || 1;
        if (isAdmin) {
          document.getElementById("championsInput").value = championsCutoff;
          document.getElementById("playoffInput").value = playoffCutoff;
          const relegationInput = document.getElementById("relegationInput");
          if (relegationInput) relegationInput.value = relegationCutoff;
        }
      }
      renderStandings();
      renderKnockout();
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
      if (!isAdmin) return;
      const team = teams.find((item) => item.id === id);
      const teamName = team?.name || "";
      const teamKey = team?.teamKey || slugKey(teamName);
      if (!confirm(`Delete team${teamName ? ` "${teamName}"` : ""}? Roster dan gambar Supabase team ini juga akan dibersihkan.`)) return;

      try {
        const playerDocs = new Map();
        if (teamName) {
          const byName = await getDocs(query(collection(db, "players"), where("team", "==", teamName)));
          byName.docs.forEach((item) => playerDocs.set(item.id, item));
        }
        if (teamKey) {
          const byKey = await getDocs(query(collection(db, "players"), where("teamKey", "==", teamKey)));
          byKey.docs.forEach((item) => playerDocs.set(item.id, item));
        }

        const storagePaths = [];
        const deleteOps = [];
        playerDocs.forEach((item) => {
          const data = item.data();
          if (data.faceStoragePath) storagePaths.push(data.faceStoragePath);
          deleteOps.push((batch) => batch.delete(item.ref));
        });
        if (storagePaths.length) await deleteSupabaseFaces(storagePaths);
        await commitBatchChunks(deleteOps);
        await deleteDoc(doc(db, "teams", id));
      } catch (error) {
        console.error("Delete team cleanup failed:", error);
        alert("Gagal hapus team lengkap: " + error.message);
      }
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

    const isScoreEmpty = (value) => value === null || value === undefined || value === "";

    const updateScore = async (id, val, side) => {
      if (!isAdmin) return;
      const num = isNaN(parseInt(val)) ? null : parseInt(val);
      const payload = { [side]: num };
      const match = matches.find((item) => item.id === id);
      if (match?.type === "knockout" && isScoreEmpty(num)) {
        payload.live = false;
        payload.bridgeLocked = false;
        payload.externalMatchId = "";
        payload.liveClockMinute = null;
        payload.liveClockSecond = null;
        payload.livePeriod = "";
      }
      await updateDoc(doc(db, "matches", id), payload);
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
      const readZoneNumber = (id, fallback) => {
        const value = parseInt(document.getElementById(id)?.value, 10);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
      };
      if (isAdmin) await setDoc(doc(db, "config", "standings"), {
        championsCutoff: readZoneNumber("championsInput", 4),
        playoffCutoff: readZoneNumber("playoffInput", 6),
        relegationCutoff: readZoneNumber("relegationInput", 1)
      });
    };

    // --- RENDERING VIEWS ---
    const renderRosterPlayerOptions = () => {
      const select = document.getElementById("playerRosterSelect");
      if (!select) return;
      const selectedTeam = document.getElementById("playerTeam")?.value || "";
      const team = teams.find((item) => normalizeKey(item.name) === normalizeKey(selectedTeam));
      const players = team ? playersForTeam(team) : rosterPlayers.slice().sort((a, b) => String(a.player || "").localeCompare(String(b.player || "")));
      select.innerHTML = `<option value="">Pilih pemain roster</option>` + players.map((player) => `
        <option value="${player.id || player.docId}" data-name="${player.player || ""}" data-image="${player.faceUrl || player.image || player.facePath || ""}" data-team="${player.team || selectedTeam}">
          ${player.number ? `${player.number}. ` : ""}${player.player}${player.position ? ` - ${player.position}` : ""}
        </option>
      `).join("");
    };

    const openTeamCreateModal = () => {
      const modal = document.getElementById("teamEditorModal");
      if (!modal) return;
      ["modalTeamId", "modalTeamName", "modalTeamLogo", "modalTeamFormation", "modalTeamManager", "modalTeamManagerPhoto"].forEach((id) => {
        const field = document.getElementById(id);
        if (field) field.value = "";
      });
      document.getElementById("modalTeamStars").value = "3.0";
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    };

    const openTeamEditModal = (teamId) => {
      const team = teams.find((item) => item.id === teamId);
      const modal = document.getElementById("teamEditorModal");
      if (!team || !modal) return;
      document.getElementById("modalTeamId").value = team.id;
      document.getElementById("modalTeamName").value = team.name || "";
      document.getElementById("modalTeamLogo").value = team.logo || "";
      document.getElementById("modalTeamStars").value = team.stars || 3;
      document.getElementById("modalTeamFormation").value = team.formation || "";
      document.getElementById("modalTeamManager").value = team.managerName || "";
      document.getElementById("modalTeamManagerPhoto").value = team.managerPhoto || findManagerPhoto(team.managerName) || "";
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    };

    const closeTeamEditorModal = () => {
      const modal = document.getElementById("teamEditorModal");
      if (!modal) return;
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    };

    const saveTeamFromModal = async () => {
      if (!isAdmin) return;
      const id = document.getElementById("modalTeamId")?.value || "";
      const name = document.getElementById("modalTeamName")?.value.trim();
      const logo = document.getElementById("modalTeamLogo")?.value.trim();
      const stars = parseFloat(document.getElementById("modalTeamStars")?.value) || 3;
      const formation = document.getElementById("modalTeamFormation")?.value.trim();
      const managerName = document.getElementById("modalTeamManager")?.value.trim();
      const managerPhoto = document.getElementById("modalTeamManagerPhoto")?.value.trim() || findManagerPhoto(managerName);
      if (!name) return alert("Nama team wajib diisi.");

      const payload = {
        name,
        logo,
        stars,
        formation,
        managerName,
        managerPhoto,
        teamKey: slugKey(name),
        updatedAtMs: Date.now()
      };
      if (id) {
        await updateDoc(doc(db, "teams", id), payload);
      } else {
        await addDoc(collection(db, "teams"), {
          ...payload,
          p: 0,
          w: 0,
          d: 0,
          l: 0,
          gf: 0,
          ga: 0,
          pts: 0,
          y: 0,
          createdAtMs: Date.now()
        });
      }
      closeTeamEditorModal();
    };

    const renderTeamDetailModal = (teamId) => {
      const team = teams.find((item) => item.id === teamId);
      const modal = document.getElementById("teamDetailModal");
      const body = document.getElementById("teamDetailBody");
      if (!team || !modal || !body) return;
      activeTeamDetailId = teamId;
      const players = playersForTeam(team);
      const managerPhoto = team.managerPhoto || findManagerPhoto(team.managerName) || placeholderImage;
      const grouped = players.reduce((acc, player) => {
        const group = player.isSubstitute ? "SUB" : positionGroup(player.position);
        (acc[group] ||= []).push(player);
        return acc;
      }, {});
      const renderGroup = (label) => `
        <div class="rounded-2xl border border-outline-variant/10 bg-black/20 p-4">
          <p class="mb-3 text-[10px] uppercase tracking-widest text-primary font-black">${label}</p>
          <div class="space-y-2">
            ${(grouped[label] || []).map((player) => `
              <div class="grid grid-cols-[38px_1fr_auto] items-center gap-3 rounded-xl bg-surface-container/70 p-2">
                <img src="${player.faceUrl || player.image || player.facePath || placeholderImage}" class="h-9 w-9 rounded-lg object-cover">
                <div class="min-w-0">
                  <p class="truncate text-sm font-bold text-white">${player.number ? `${player.number}. ` : ""}${player.player}</p>
                  <p class="text-[9px] uppercase tracking-widest text-on-surface-variant">${player.position || "POS"} ${player.isSubstitute ? "- SUB" : ""}</p>
                </div>
                ${isAdmin ? `<button class="admin-btn !py-1 !px-2 text-[10px]" data-action="editRosterPlayer" data-id="${player.id}">Edit</button>` : ""}
              </div>
            `).join("") || `<p class="text-xs italic text-on-surface-variant">Kosong</p>`}
          </div>
        </div>
      `;

      body.innerHTML = `
        <div class="flex flex-col md:flex-row md:items-center gap-5">
          <img src="${team.logo || placeholderImage}" class="h-20 w-20 rounded-2xl bg-surface-container-highest p-3 object-contain">
          <div class="flex-1">
            <p class="text-[10px] uppercase tracking-widest text-primary font-black">${team.pesTeamId ? `PES ID ${team.pesTeamId}` : team.teamKey || slugKey(team.name)}</p>
            <h2 class="font-headline text-4xl font-black uppercase text-white">${team.name}</h2>
            <p class="text-sm text-on-surface-variant">${players.length} pemain roster${team.formation ? ` - ${team.formation}` : ""}</p>
          </div>
          <div class="rounded-2xl border border-secondary/20 bg-secondary/10 p-3 flex items-center gap-3 min-w-[220px]">
            <img src="${managerPhoto}" class="h-12 w-12 rounded-xl object-cover">
            <div>
              <p class="text-[9px] uppercase tracking-widest text-secondary font-black">Manager</p>
              <p class="font-bold text-white">${team.managerName || "Belum diisi"}</p>
            </div>
          </div>
        </div>
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-4">
          ${["GK", "DEF", "MID", "FWD", "SUB"].map(renderGroup).join("")}
        </div>
      `;
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    };

    const closeTeamDetailModal = () => {
      activeTeamDetailId = "";
      const modal = document.getElementById("teamDetailModal");
      if (!modal) return;
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    };

    const editRosterPlayer = async (playerId) => {
      if (!isAdmin) return;
      const player = rosterPlayers.find((item) => item.id === playerId);
      if (!player) return;
      const position = prompt("Posisi pemain:", player.position || "");
      if (position === null) return;
      const numberText = prompt("Nomor punggung:", player.number ?? "");
      if (numberText === null) return;
      const isSubstitute = confirm("Jadikan substitute? OK = substitute, Cancel = starter.");
      await updateDoc(doc(db, "players", player.id), {
        position: position.trim(),
        number: parseInt(numberText, 10) || null,
        isSubstitute,
        updatedAtMs: Date.now()
      });
    };

    const renderTeams = () => {
      let html = "",
        opts = "",
        filterOpts = '<option value="">All Teams</option>';

      teams.forEach(t => {
        const rosterCount = playersForTeam(t).length;
        const managerPhoto = t.managerPhoto || findManagerPhoto(t.managerName) || placeholderImage;
        html += `
                <li class="bg-surface-container-high rounded-[2rem] p-6 border border-outline-variant/10 shadow-lg group hover:-translate-y-1 transition-transform cursor-pointer" data-action="openTeamDetail" data-id="${t.id}">
                    <div class="flex items-center justify-between gap-4">
                      <div class="flex items-center gap-4 min-w-0">
                          <img src="${t.logo || placeholderImage}" class="w-14 h-14 object-contain bg-surface-container-highest p-2 rounded-[1rem] group-hover:scale-110 transition-transform">
                          <div class="min-w-0">
                            <span class="block truncate font-headline font-bold text-xl">${t.name}</span>
                            <span class="text-[10px] uppercase tracking-widest text-on-surface-variant">${rosterCount} roster</span>
                          </div>
                      </div>
                      <img src="${managerPhoto}" class="h-10 w-10 rounded-xl object-cover border border-secondary/30" title="${t.managerName || "Manager"}">
                    </div>
                    ${isAdmin ? `<div class="mt-4 flex gap-2">
                      <button class="admin-btn !py-2 flex-1" data-action="editTeam" data-id="${t.id}">Edit</button>
                      <button class="deleteBtn" data-action="deleteTeam" data-id="${t.id}">Delete</button>
                    </div>` : ""}
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
      renderRosterPlayerOptions();
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
                    <h3 class="font-headline text-2xl font-bold uppercase tracking-widest text-primary italic pointer-events-none">${grouped[mw].every(m => m.type === "knockout") ? "Knockout Schedule" : `Matchday ${mw}`} <span class="text-sm ml-2 group-hover:text-secondary inline-block transition-transform ${collapsed[mw] ? '-rotate-90' : 'rotate-0'}">▼</span></h3>
                    <div class="h-px flex-1 bg-outline-variant/20"></div>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mw-${mw} mw-row" style="${collapsed[mw] ? 'display:none' : ''}">
                    ${grouped[mw].map(m => {
                        const t1 = resolveTeam(m.team1), t2 = resolveTeam(m.team2), isFinished = m.s1 !== null && !m.live;
                        const liveClock = formatLiveClock(m);
                        const penaltyScore = formatPenaltyScore(m);
                        const adminKoStatus = renderKnockoutAdminStatus(m);
                        const badge = m.live ? `<span class="px-3 py-1 bg-error/10 text-error font-bold text-[10px] uppercase tracking-widest rounded-full border border-error/20 flex items-center gap-1 w-max"><span class="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span> LIVE</span>`
                            : isFinished ? `<span class="px-3 py-1 bg-outline-variant/20 text-on-surface-variant font-bold text-[10px] uppercase tracking-widest rounded-full w-max">Full Time</span>`
                            : m.type === "knockout" ? `<span class="px-3 py-1 bg-secondary/10 text-secondary font-bold text-[10px] uppercase tracking-widest rounded-full border border-secondary/20 w-max">${m.knockoutRoundName || "Knockout"}</span>`
                            : `<span class="px-3 py-1 bg-primary/10 text-primary font-bold text-[10px] uppercase tracking-widest rounded-full border border-primary/20 w-max">Upcoming</span>`;

                        return `
                        <div class="group relative bg-surface-container-high rounded-[2rem] p-6 transition-all hover:bg-surface-container-highest ${m.live ? 'ring-1 ring-error/50 shadow-[0_0_20px_rgba(255,115,81,0.1)]' : 'border border-outline-variant/10 shadow-xl'}">
                            <div class="flex justify-between items-start mb-6">
                                ${badge}
                                <div class="text-right">
                                  ${liveClock ? `<span class="block text-error font-headline text-sm font-black italic">${liveClock}</span>` : ""}
                                  <span class="text-on-surface-variant font-label text-xs uppercase">${safe(m.date, 'TBD')}</span>
                                </div>
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
                                        </div>
                                        ${penaltyScore ? `<p class="mt-2 text-[10px] uppercase tracking-widest text-secondary font-black">${penaltyScore}</p>` : ""}` : `
                                        ${(m.live || isFinished) ? `
                                            <div class="flex items-center gap-4 md:gap-6">
                                                <span class="score-font text-4xl md:text-5xl ${m.live ? 'text-error' : m.s1 > m.s2 ? 'text-primary' : 'text-white'}">${m.s1}</span>
                                                <span class="text-on-surface-variant font-headline text-xl opacity-30 italic font-black">-</span>
                                                <span class="score-font text-4xl md:text-5xl ${m.live ? 'text-error' : m.s2 > m.s1 ? 'text-primary' : 'text-white'}">${m.s2}</span>
                                            </div>
                                            ${penaltyScore ? `<p class="mt-2 text-[10px] uppercase tracking-widest text-secondary font-black">${penaltyScore}</p>` : ""}` : `
                                            <div class="glass-card px-4 py-2 rounded-xl border border-outline-variant/20"><span class="font-headline text-2xl font-black italic text-secondary">VS</span></div>`}
                                    `}
                                </div>
                                <div class="flex-1 flex flex-col items-center gap-3">
                                    <div class="w-16 h-16 md:w-20 md:h-20 bg-surface-container rounded-[1.2rem] flex items-center justify-center p-3"><img src="${t2.logo}" class="w-full h-full object-contain ${!m.live && !isFinished ? 'grayscale opacity-50' : ''}"></div>
                                    <span class="font-bold font-headline text-center uppercase tracking-tight text-sm md:text-base">${t2.name}</span>
                                </div>
                            </div>
                            ${adminKoStatus}
                            ${renderMatchTimeline(m)}
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
    const winnerManagerPhoto = resolveManagerPhoto(h.winnerPlayer, h.winnerPlayerPhoto);
    const cupManager = (h.cupWinnerManager || "").trim();
    const cupManagerPhoto = resolveManagerPhoto(cupManager, h.cupWinnerManagerPhoto);

    return `
    <div onclick="showHofDetail('${h.id}')" class="cursor-pointer group bg-[#161f32]/40 rounded-[2.5rem] border border-white/5 overflow-hidden flex flex-col shadow-2xl transition-all hover:border-[#8eff71]/30 hover:scale-[1.02] active:scale-95">
      
      <div class="p-6 pb-0 flex justify-between items-center">
        <span class="text-[10px] font-black text-[#8eff71] tracking-widest uppercase italic font-['Space_Grotesk']">${h.season}</span>
        <div class="flex gap-0.5">${stars}</div>
      </div>

      <div class="p-8 flex flex-col items-center">
        <img src="${h.winnerLogo || placeholderImage}" class="w-20 h-20 object-contain mb-4 drop-shadow-2xl group-hover:rotate-6 transition-transform">
        <h3 class="text-xl font-black text-white uppercase italic text-center leading-none font-['Space_Grotesk']">${h.winnerTeam}</h3>
        <div class="mt-3 flex items-center gap-2">
          <img src="${winnerManagerPhoto}" class="w-8 h-8 rounded-xl object-cover border border-white/10 bg-[#1c263a]">
          <p class="text-[10px] font-bold text-[#a4abbe] uppercase font-['Space_Grotesk']">Manager: <span class="text-white">${h.winnerPlayer || "-"}</span></p>
        </div>
      </div>

      ${h.cupWinner && h.cupWinner !== "N/A" ? `
      <div class="mx-6 p-3 bg-white/5 rounded-2xl mb-4 flex justify-between items-center border border-white/5">
        <div>
          <p class="text-[7px] font-bold text-[#8eff71] uppercase tracking-tighter">Cup Winner</p>
          <p class="text-[10px] font-black text-white uppercase leading-none mt-1">${h.cupWinner}</p>
          ${cupManager ? `
            <div class="mt-2 flex items-center gap-2">
              <img src="${cupManagerPhoto}" class="w-6 h-6 rounded-lg object-cover border border-white/10 bg-[#1c263a]">
              <p class="text-[8px] font-bold text-white/45 uppercase">Manager: ${cupManager}</p>
            </div>
          ` : ""}
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

const renderHofManagers = () => {
  const container = document.getElementById("hofManagerList");
  if (!container) return;

  const normalizedManual = hofManagers.map((m) => ({
    id: m.id,
    name: (m.name || "").trim(),
    photo: (m.photo || "").trim(),
    leagueTitles: parseInt(m.leagueTitles) || 0,
    cupTitles: parseInt(m.cupTitles) || 0
  })).filter((m) => m.name);

  const managerKey = (name) => normalizeKey(name).replace(/\s+/g, "-");
  const historyMap = {};
  const ensureHistoryManager = (name) => {
    const cleanName = (name || "").trim();
    if (!cleanName) return null;
    const key = managerKey(cleanName);
    if (!historyMap[key]) {
      historyMap[key] = {
        id: `auto-${key}`,
        name: cleanName,
        photo: "",
        leagueTitles: 0,
        cupTitles: 0
      };
    }
    return historyMap[key];
  };

  hallOfFameData.forEach((item) => {
    const leagueManager = ensureHistoryManager(item.winnerPlayer);
    if (leagueManager) {
      leagueManager.photo = leagueManager.photo || resolveManagerPhoto(item.winnerPlayer, item.winnerPlayerPhoto);
      leagueManager.leagueTitles += 1;
    }

    const hasCupWinner = item.cupWinner && item.cupWinner !== "N/A";
    const cupManager = hasCupWinner ? ensureHistoryManager(item.cupWinnerManager) : null;
    if (cupManager) {
      cupManager.photo = cupManager.photo || resolveManagerPhoto(item.cupWinnerManager, item.cupWinnerManagerPhoto);
      cupManager.cupTitles += 1;
    }
  });

  const combinedMap = {};
  Object.values(historyMap).forEach((manager) => {
    combinedMap[managerKey(manager.name)] = manager;
  });

  normalizedManual.forEach((manager) => {
    const key = managerKey(manager.name);
    const automatic = combinedMap[key] || {
      id: `auto-${key}`,
      name: manager.name,
      photo: "",
      leagueTitles: 0,
      cupTitles: 0
    };

    combinedMap[key] = {
      id: manager.id,
      name: manager.name,
      photo: manager.photo || automatic.photo,
      leagueTitles: manager.leagueTitles > 0 ? manager.leagueTitles : automatic.leagueTitles,
      cupTitles: manager.cupTitles > 0 ? manager.cupTitles : automatic.cupTitles
    };
  });

  const leaderboard = Object.values(combinedMap).sort((a, b) => {
    const totalA = a.leagueTitles + a.cupTitles;
    const totalB = b.leagueTitles + b.cupTitles;
    if (totalB !== totalA) return totalB - totalA;
    if (b.leagueTitles !== a.leagueTitles) return b.leagueTitles - a.leagueTitles;
    if (b.cupTitles !== a.cupTitles) return b.cupTitles - a.cupTitles;
    return a.name.localeCompare(b.name);
  });

  const renderTrophyImages = (count, image, label, fallbackIcon) => {
    const safeCount = Math.max(parseInt(count) || 0, 0);
    if (safeCount <= 0) return "";
    const items = Array.from({ length: safeCount }, (_, index) => {
      if (image) {
        return `<img src="${image}" alt="${label}" title="${label}" class="w-8 h-8 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]">`;
      }
      return `<span title="${label}" class="material-symbols-outlined text-[28px] ${label === "League Trophy" ? "text-[#8eff71]" : "text-secondary"}">${fallbackIcon}</span>`;
    }).join("");

    return `
      <div class="flex flex-wrap gap-2">${items}</div>
    `;
  };

  if (leaderboard.length === 0) {
    container.innerHTML = `<p class="text-white/25 italic text-sm">Belum ada data manajer.</p>`;
    return;
  }

  container.innerHTML = leaderboard.map((manager, index) => {
    const rank = index + 1;
    const trophyShelf = [
      renderTrophyImages(manager.leagueTitles, trophyCabinetSettings.leagueImage, "League Trophy", "workspace_premium"),
      renderTrophyImages(manager.cupTitles, trophyCabinetSettings.cupImage, "Cup Trophy", "emoji_events")
    ].filter(Boolean).join("");

    return `
      <article class="relative overflow-hidden rounded-[1.4rem] border ${rank === 1 ? "border-[#f6c453]/70 bg-[#171421]" : "border-[#f6c453]/20 bg-[#111827]/80"} p-5 shadow-[0_18px_55px_rgba(0,0,0,0.35)]">
        <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f6c453]/70 to-transparent"></div>
        <div class="flex items-start gap-4">
          <div class="relative">
            <img src="${resolveManagerPhoto(manager.name, manager.photo)}" alt="${manager.name}" class="w-16 h-16 rounded-2xl object-cover border border-[#f6c453]/30 bg-[#161f32]">
            <span class="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-[#f6c453] text-[#221500] text-[10px] font-black flex items-center justify-center shadow-md">${rank}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-white text-lg font-black uppercase tracking-tight truncate">${manager.name}</h3>
                  ${manager.leagueTitles > 0 ? `<span class="rounded-full border border-[#f6c453]/30 bg-[#f6c453]/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-[#f6c453]">${manager.leagueTitles}x league champions</span>` : ""}
                  ${manager.cupTitles > 0 ? `<span class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white/60">${manager.cupTitles}x cup winner</span>` : ""}
                </div>
              </div>
              ${isAdmin && manager.id && !manager.id.startsWith("auto-")
                ? `<button class="deleteBtn !text-[9px] !px-2 !py-1" data-action="deleteHofManager" data-id="${manager.id}">Delete</button>`
                : ""
              }
            </div>

            <div class="mt-4 rounded-2xl bg-black/25 p-3 border border-[#f6c453]/10">
              <div class="space-y-4">
                ${trophyShelf || `<div class="rounded-xl bg-black/20 p-3 border border-white/5 text-white/35 text-[10px] uppercase tracking-widest font-bold">No Trophy</div>`}
              </div>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
};

const renderAllTimeHofScorers = () => {
  const container = document.getElementById("hofAllTimeScorers");
  if (!container) return;

  const leaderboard = hallOfFameData
    .map((item) => ({
      id: item.id,
      player: (item.topScorer || "").trim(),
      goals: parseInt(item.goals) || 0,
      season: item.season || "",
      photo: (item.scorerPhoto || "").trim()
    }))
    .filter((item) => item.player && item.goals > 0)
    .sort((a, b) => {
    if (b.goals !== a.goals) return b.goals - a.goals;
    if ((b.season || "").localeCompare(a.season || "") !== 0) return (b.season || "").localeCompare(a.season || "");
    return a.player.localeCompare(b.player);
  });

  if (!leaderboard.length) {
    container.innerHTML = `<p class="text-white/25 italic text-sm lg:col-span-12">Belum ada data top scorer season.</p>`;
    return;
  }

  const leader = leaderboard[0];
  const rest = leaderboard.slice(1, 9);

  container.innerHTML = `
    <article class="lg:col-span-5 relative min-h-[360px] overflow-hidden rounded-[1.6rem] border border-[#f6c453]/40 bg-[#15131f] shadow-[0_18px_55px_rgba(0,0,0,0.4)]">
      <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f6c453] to-transparent"></div>
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(246,196,83,0.18),transparent_45%)]"></div>
      <div class="relative z-10 flex h-full flex-col justify-end p-6">
        <img src="${leader.photo || placeholderImage}" alt="${leader.player}" class="absolute bottom-0 right-2 h-[92%] max-w-[68%] object-contain object-bottom drop-shadow-[0_20px_45px_rgba(0,0,0,0.65)]">
        <div class="relative max-w-[58%]">
          <span class="inline-flex rounded-full bg-[#f6c453] px-3 py-1 text-[9px] font-black uppercase tracking-widest text-[#221500]">#1 All-Time</span>
          <h3 class="mt-4 text-3xl md:text-4xl font-black uppercase italic leading-none text-white font-['Space_Grotesk']">${leader.player}</h3>
          <p class="mt-3 text-5xl font-black text-[#f6c453] leading-none">${leader.goals}</p>
          <p class="mt-1 text-[10px] uppercase tracking-widest text-white/55 font-bold">Goals In One Season</p>
          <p class="mt-4 text-[10px] uppercase tracking-widest text-white/35 font-bold">${leader.season || "Recorded Season"}</p>
        </div>
      </div>
    </article>

    <div class="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${rest.length ? rest.map((scorer, index) => `
        <article class="flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-black/20 p-3">
          <div class="relative">
            <img src="${scorer.photo || placeholderImage}" alt="${scorer.player}" class="w-14 h-14 rounded-2xl object-cover object-top border border-[#f6c453]/20 bg-[#161f32]">
            <span class="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#f6c453]/90 text-[9px] font-black text-[#221500]">${index + 2}</span>
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="truncate text-sm font-black uppercase text-white">${scorer.player}</h4>
            <p class="mt-1 text-[10px] uppercase tracking-widest text-white/40 font-bold">${scorer.season || "Recorded Season"}</p>
          </div>
          <div class="text-right">
            <p class="text-2xl font-black text-[#f6c453] leading-none">${scorer.goals}</p>
            <p class="text-[8px] uppercase tracking-widest text-white/35 font-bold">Goals</p>
          </div>
        </article>
      `).join("") : `<div class="rounded-[1.2rem] border border-white/10 bg-black/20 p-5 text-white/35 text-xs uppercase tracking-widest font-bold">Belum ada scorer lain.</div>`}
    </div>
  `;
};
    
    const calculateStandings = () => {
      let table = teams.reduce((acc, t) => ({ ...acc, [t.name]: { team: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 } }), {});
      matches.forEach(m => {
        if (m.type === "knockout") return;
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

  const cCut = Math.max(parseInt(championsCutoff) || 4, 0);
  const pCut = Math.max(parseInt(playoffCutoff) || 6, cCut);
  const hCut = Math.max(parseInt(relegationCutoff) || 1, 0);

  standingsTable.innerHTML = data.map((t, i) => {
    const rank = i + 1;
    const textClass = i === 0 ? "text-primary" : i === 1 ? "text-on-surface" : i === 2 ? "text-secondary" : "text-on-surface-variant";
    
    let bgGradient = "";
    let borderClass = "";
    let zoneBadge = "";
    const isChampionsZone = rank <= cCut;
    const isPlayoffZone = rank > cCut && rank <= pCut;
    const isHinaZone = hCut > 0 && rank > data.length - hCut;

    if (isChampionsZone) {
      bgGradient = "bg-gradient-to-r from-primary/10 to-transparent";
      borderClass = "border-l-4 border-primary";
      zoneBadge = `<span class="hidden md:inline-flex rounded-full bg-primary/10 border border-primary/20 px-2 py-1 text-[8px] uppercase tracking-widest text-primary font-black">Champions</span>`;
    } 
    else if (isPlayoffZone) {
      bgGradient = "bg-gradient-to-r from-secondary/10 to-transparent"; 
      borderClass = "border-l-4 border-secondary";
      zoneBadge = `<span class="hidden md:inline-flex rounded-full bg-secondary/10 border border-secondary/20 px-2 py-1 text-[8px] uppercase tracking-widest text-secondary font-black">Play-off</span>`;
    }
    else if (isHinaZone && data.length > hCut) {
      bgGradient = "bg-error/10";
      borderClass = "border-l-4 border-error";
      zoneBadge = `<span class="hidden md:inline-flex rounded-full bg-error/10 border border-error/20 px-2 py-1 text-[8px] uppercase tracking-widest text-error font-black">Zona Hina</span>`;
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
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-headline font-bold text-on-surface whitespace-nowrap">${t.team}</span>
                ${zoneBadge}
              </div>
              ${renderFormGuide(t.team)}
            </div>
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

window.updateTrophyCabinetSettings = async () => {
  const dataToSave = {
    leagueImage: document.getElementById("leagueTrophyImage")?.value.trim() || "",
    cupImage: document.getElementById("cupTrophyImage")?.value.trim() || ""
  };

  try {
    await setDoc(doc(db, "settings", "trophyCabinet"), dataToSave);
    alert("Foto trophy berhasil disimpan!");
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
      const penaltyScore = formatPenaltyScore(m);

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
                    ${penaltyScore ? `<span class="mt-2 text-secondary font-headline text-lg font-black uppercase tracking-widest">${penaltyScore}</span>` : ""}
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

onSnapshot(doc(db, "settings", "trophyCabinet"), (snap) => {
  trophyCabinetSettings = snap.exists()
    ? {
        leagueImage: snap.data().leagueImage || "",
        cupImage: snap.data().cupImage || ""
      }
    : { leagueImage: "", cupImage: "" };

  const leagueInput = document.getElementById("leagueTrophyImage");
  const cupInput = document.getElementById("cupTrophyImage");
  if (leagueInput) leagueInput.value = trophyCabinetSettings.leagueImage;
  if (cupInput) cupInput.value = trophyCabinetSettings.cupImage;

  renderHofManagers();
});

onSnapshot(doc(db, "tournament", "knockout"), (docSnap) => {
    if (docSnap.exists()) {
        knockout = sanitizeKnockout(docSnap.data());
        renderKnockout();
        ensureKnockoutScheduleMatches();
    } else {
        knockout = { format: "single", bracketSize: 0, qualifierZone: "", qualifiedCount: 0, rounds: [] };
        renderKnockout();
    }
});

    const renderLiveMatches = () => {
      const live = matches.filter(m => m.live);
      document.getElementById("liveMatches").innerHTML = live.length ? live.map(m => {
        const liveClock = formatLiveClock(m);
        const eventCount = getEventsForMatch(m).length;
        return `
                <div class="min-w-[300px] surface-container-high p-5 rounded-[2rem] border-l-4 border-error shadow-xl">
                    <div class="flex justify-between text-[10px] font-label text-error font-bold uppercase tracking-widest mb-4">
                        <span>MW ${getMW(m)}</span><span><span class="liveDot mr-1"></span>${liveClock || "LIVE"}</span>
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
                    ${eventCount ? `<div class="mt-4 pt-3 border-t border-white/5 text-[10px] uppercase tracking-widest text-tertiary font-bold">${eventCount} PES timeline events</div>` : ""}
                </div>`;
      }).join("") : "<p class='text-on-surface-variant text-sm font-label py-4 pl-2'>No pitches active at the moment.</p>";
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

    // --- CORE KNOCKOUT FUNCTIONS ---

const sanitizeScore = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const getRoundName = (teamsInRound) => {
  if (teamsInRound <= 2) return "Final";
  if (teamsInRound === 4) return "Semifinal";
  if (teamsInRound === 8) return "Quarterfinal";
  if (teamsInRound === 16) return "Round of 16";
  return `Round of ${teamsInRound}`;
};

const nextPowerOfTwo = (num) => {
  if (num <= 2) return 2;
  return Math.pow(2, Math.ceil(Math.log2(num)));
};

const createSeedOrder = (size) => {
  let order = [1, 2];
  while (order.length < size) {
    const pivot = (order.length * 2) + 1;
    order = order.flatMap((seed) => [seed, pivot - seed]);
  }
  return order;
};

const sanitizeKnockout = (raw) => {
  if (!raw || !Array.isArray(raw.rounds)) {
    return { format: "single", bracketSize: 0, qualifierZone: "", qualifiedCount: 0, rounds: [] };
  }

  const rounds = raw.rounds.map((round, roundIndex) => ({
    id: round.id || `r${roundIndex + 1}`,
    name: round.name || `Round ${roundIndex + 1}`,
    matches: Array.isArray(round.matches) ? round.matches.map((match, matchIndex) => ({
      id: match.id || `${round.id || `r${roundIndex + 1}`}m${matchIndex + 1}`,
      seed1: match.source1 ? (match.seed1 || "") : (match.seed1 ?? match.team1 ?? ""),
      seed2: match.source2 ? (match.seed2 || "") : (match.seed2 ?? match.team2 ?? ""),
      source1: match.source1 || null,
      source2: match.source2 || null,
      s1: sanitizeScore(match.s1),
      s2: sanitizeScore(match.s2),
      isReset: !!match.isReset,
      visible: match.visible !== false
    })) : []
  }));

  return {
    format: raw.format === "double" ? "double" : "single",
    bracketSize: parseInt(raw.bracketSize) || 0,
    qualifierZone: raw.qualifierZone || "",
    qualifiedCount: parseInt(raw.qualifiedCount) || parseInt(raw.bracketSize) || 0,
    rounds
  };
};

const buildSingleEliminationRounds = (rankedTeams, bracketSize) => {
  const seedingPattern = createSeedOrder(bracketSize);
  const seededSlots = seedingPattern.map((seedNo) => rankedTeams[seedNo - 1] || "");
  const totalRounds = Math.log2(bracketSize);
  const rounds = [];
  let previousMatchIds = [];

  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
    const matchCount = bracketSize / Math.pow(2, roundIndex + 1);
    const teamsInRound = matchCount * 2;
    const round = {
      id: `r${roundIndex + 1}`,
      name: getRoundName(teamsInRound),
      matches: []
    };

    for (let matchIndex = 0; matchIndex < matchCount; matchIndex++) {
      const id = `r${roundIndex + 1}m${matchIndex + 1}`;
      if (roundIndex === 0) {
        round.matches.push({
          id,
          seed1: seededSlots[matchIndex * 2] || "",
          seed2: seededSlots[(matchIndex * 2) + 1] || "",
          source1: null,
          source2: null,
          s1: null,
          s2: null
        });
      } else {
        round.matches.push({
          id,
          seed1: "",
          seed2: "",
          source1: { matchId: previousMatchIds[matchIndex * 2], outcome: "winner" },
          source2: { matchId: previousMatchIds[(matchIndex * 2) + 1], outcome: "winner" },
          s1: null,
          s2: null
        });
      }
    }

    previousMatchIds = round.matches.map((match) => match.id);
    rounds.push(round);
  }

  return rounds;
};

const buildDoubleEliminationTop4 = (rankedTeams) => {
  const seeds = rankedTeams.slice(0, 4);
  return [
    {
      id: "d1",
      name: "Upper Bracket - Semifinal",
      matches: [
        { id: "wb1", seed1: seeds[0] || "", seed2: seeds[3] || "", source1: null, source2: null, s1: null, s2: null },
        { id: "wb2", seed1: seeds[1] || "", seed2: seeds[2] || "", source1: null, source2: null, s1: null, s2: null }
      ]
    },
    {
      id: "d2",
      name: "Lower Bracket - Elimination",
      matches: [
        { id: "lb1", seed1: "", seed2: "", source1: { matchId: "wb1", outcome: "loser" }, source2: { matchId: "wb2", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d3",
      name: "Upper Bracket - Final",
      matches: [
        { id: "wb3", seed1: "", seed2: "", source1: { matchId: "wb1", outcome: "winner" }, source2: { matchId: "wb2", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d4",
      name: "Lower Bracket - Final",
      matches: [
        { id: "lb2", seed1: "", seed2: "", source1: { matchId: "lb1", outcome: "winner" }, source2: { matchId: "wb3", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d5",
      name: "Grand Final",
      matches: [
        { id: "gf1", seed1: "", seed2: "", source1: { matchId: "wb3", outcome: "winner" }, source2: { matchId: "lb2", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d6",
      name: "Grand Final Reset",
      matches: [
        { id: "gf2", seed1: "", seed2: "", source1: { matchId: "gf1", outcome: "winnerSeed1" }, source2: { matchId: "gf1", outcome: "winnerSeed2" }, s1: null, s2: null, isReset: true, visible: false }
      ]
    }
  ];
};

const buildDoubleEliminationTop6 = (rankedTeams) => {
  const seeds = rankedTeams.slice(0, 6);
  return [
    {
      id: "d1",
      name: "Upper Bracket - Play-in",
      matches: [
        { id: "wb1", seed1: seeds[2] || "", seed2: seeds[5] || "", source1: null, source2: null, s1: null, s2: null },
        { id: "wb2", seed1: seeds[3] || "", seed2: seeds[4] || "", source1: null, source2: null, s1: null, s2: null }
      ]
    },
    {
      id: "d2",
      name: "Upper Bracket - Semifinal",
      matches: [
        { id: "wb3", seed1: seeds[0] || "", seed2: "", source1: null, source2: { matchId: "wb2", outcome: "winner" }, s1: null, s2: null },
        { id: "wb4", seed1: seeds[1] || "", seed2: "", source1: null, source2: { matchId: "wb1", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d3",
      name: "Lower Bracket - Round 1",
      matches: [
        { id: "lb1", seed1: "", seed2: "", source1: { matchId: "wb1", outcome: "loser" }, source2: { matchId: "wb2", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d4",
      name: "Lower Bracket - Round 2",
      matches: [
        { id: "lb2", seed1: "", seed2: "", source1: { matchId: "wb3", outcome: "loser" }, source2: { matchId: "lb1", outcome: "winner" }, s1: null, s2: null },
        { id: "lb3", seed1: "", seed2: "", source1: { matchId: "wb4", outcome: "loser" }, source2: null, s1: null, s2: null }
      ]
    },
    {
      id: "d5",
      name: "Upper Bracket - Final",
      matches: [
        { id: "wb5", seed1: "", seed2: "", source1: { matchId: "wb3", outcome: "winner" }, source2: { matchId: "wb4", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d6",
      name: "Lower Bracket - Semifinal",
      matches: [
        { id: "lb4", seed1: "", seed2: "", source1: { matchId: "lb2", outcome: "winner" }, source2: { matchId: "lb3", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d7",
      name: "Lower Bracket - Final",
      matches: [
        { id: "lb5", seed1: "", seed2: "", source1: { matchId: "lb4", outcome: "winner" }, source2: { matchId: "wb5", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d8",
      name: "Grand Final",
      matches: [
        { id: "gf1", seed1: "", seed2: "", source1: { matchId: "wb5", outcome: "winner" }, source2: { matchId: "lb5", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d9",
      name: "Grand Final Reset",
      matches: [
        { id: "gf2", seed1: "", seed2: "", source1: { matchId: "gf1", outcome: "winnerSeed1" }, source2: { matchId: "gf1", outcome: "winnerSeed2" }, s1: null, s2: null, isReset: true, visible: false }
      ]
    }
  ];
};

const buildDoubleEliminationTop8 = (rankedTeams) => {
  const seeds = rankedTeams.slice(0, 8);
  return [
    {
      id: "d1",
      name: "Upper Bracket - Quarterfinal",
      matches: [
        { id: "wb1", seed1: seeds[0] || "", seed2: seeds[7] || "", source1: null, source2: null, s1: null, s2: null },
        { id: "wb2", seed1: seeds[3] || "", seed2: seeds[4] || "", source1: null, source2: null, s1: null, s2: null },
        { id: "wb3", seed1: seeds[1] || "", seed2: seeds[6] || "", source1: null, source2: null, s1: null, s2: null },
        { id: "wb4", seed1: seeds[2] || "", seed2: seeds[5] || "", source1: null, source2: null, s1: null, s2: null }
      ]
    },
    {
      id: "d2",
      name: "Lower Bracket - Round 1",
      matches: [
        { id: "lb1", seed1: "", seed2: "", source1: { matchId: "wb1", outcome: "loser" }, source2: { matchId: "wb2", outcome: "loser" }, s1: null, s2: null },
        { id: "lb2", seed1: "", seed2: "", source1: { matchId: "wb3", outcome: "loser" }, source2: { matchId: "wb4", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d3",
      name: "Upper Bracket - Semifinal",
      matches: [
        { id: "wb5", seed1: "", seed2: "", source1: { matchId: "wb1", outcome: "winner" }, source2: { matchId: "wb2", outcome: "winner" }, s1: null, s2: null },
        { id: "wb6", seed1: "", seed2: "", source1: { matchId: "wb3", outcome: "winner" }, source2: { matchId: "wb4", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d4",
      name: "Lower Bracket - Round 2",
      matches: [
        { id: "lb3", seed1: "", seed2: "", source1: { matchId: "lb1", outcome: "winner" }, source2: { matchId: "wb6", outcome: "loser" }, s1: null, s2: null },
        { id: "lb4", seed1: "", seed2: "", source1: { matchId: "lb2", outcome: "winner" }, source2: { matchId: "wb5", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d5",
      name: "Upper Bracket - Final",
      matches: [
        { id: "wb7", seed1: "", seed2: "", source1: { matchId: "wb5", outcome: "winner" }, source2: { matchId: "wb6", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d6",
      name: "Lower Bracket - Semifinal",
      matches: [
        { id: "lb5", seed1: "", seed2: "", source1: { matchId: "lb3", outcome: "winner" }, source2: { matchId: "lb4", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d7",
      name: "Lower Bracket - Final",
      matches: [
        { id: "lb6", seed1: "", seed2: "", source1: { matchId: "lb5", outcome: "winner" }, source2: { matchId: "wb7", outcome: "loser" }, s1: null, s2: null }
      ]
    },
    {
      id: "d8",
      name: "Grand Final",
      matches: [
        { id: "gf1", seed1: "", seed2: "", source1: { matchId: "wb7", outcome: "winner" }, source2: { matchId: "lb6", outcome: "winner" }, s1: null, s2: null }
      ]
    },
    {
      id: "d9",
      name: "Grand Final Reset",
      matches: [
        { id: "gf2", seed1: "", seed2: "", source1: { matchId: "gf1", outcome: "winnerSeed1" }, source2: { matchId: "gf1", outcome: "winnerSeed2" }, s1: null, s2: null, isReset: true, visible: false }
      ]
    }
  ];
};

const buildDoubleEliminationRounds = (rankedTeams, teamCount) => {
  if (teamCount <= 4) return buildDoubleEliminationTop4(rankedTeams);
  if (teamCount <= 6) return buildDoubleEliminationTop6(rankedTeams);
  return buildDoubleEliminationTop8(rankedTeams);
};

const resolveKnockout = (state) => {
  const safe = sanitizeKnockout(state);
  const rounds = safe.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => ({ ...match }))
  }));
  const matchMap = {};

  rounds.forEach((round) => {
    round.matches.forEach((match) => {
      matchMap[match.id] = match;
    });
  });

  const teamFromOutcome = (source) => {
    if (!source || !source.matchId) return "";
    const sourceMatch = matchMap[source.matchId];
    if (!sourceMatch) return "";

    if (source.outcome === "winner") return sourceMatch.winner || "";
    if (source.outcome === "loser") return sourceMatch.loser || "";

    // Khusus grand final reset: ambil slot peserta dari grand final.
    if (source.outcome === "winnerSeed1") return sourceMatch.team1 || "";
    if (source.outcome === "winnerSeed2") return sourceMatch.team2 || "";
    return "";
  };

  rounds.forEach((round) => {
    round.matches.forEach((match) => {
      match.team1 = match.source1 ? teamFromOutcome(match.source1) : (match.seed1 || "");
      match.team2 = match.source2 ? teamFromOutcome(match.source2) : (match.seed2 || "");
      match.s1 = sanitizeScore(match.s1);
      match.s2 = sanitizeScore(match.s2);

      const hasTeams = !!match.team1 && !!match.team2;
      const hasScore = match.s1 !== null && match.s2 !== null;

      match.winner = "";
      match.loser = "";
      if (hasTeams && hasScore && match.s1 !== match.s2) {
        match.winner = match.s1 > match.s2 ? match.team1 : match.team2;
        match.loser = match.s1 > match.s2 ? match.team2 : match.team1;
      } else if (match.team1 && !match.team2) {
        match.winner = match.team1;
      } else if (!match.team1 && match.team2) {
        match.winner = match.team2;
      }
    });
  });

  if (safe.format === "double") {
    const gf1 = matchMap.gf1;
    const gf2 = matchMap.gf2;
    const lowerFinal = gf1?.source2?.matchId ? matchMap[gf1.source2.matchId] : null;

    if (gf1 && gf2 && lowerFinal) {
      const needReset = !!gf1.winner && gf1.winner === lowerFinal.winner;
      gf2.visible = needReset;
      if (!needReset) {
        gf2.s1 = null;
        gf2.s2 = null;
        gf2.winner = "";
        gf2.loser = "";
      } else {
        gf2.team1 = gf1.team1 || "";
        gf2.team2 = gf1.team2 || "";
      }
    }
  }

  return { ...safe, rounds };
};

const getKnockoutChampion = (resolved) => {
  if (!resolved.rounds.length) return "";
  if (resolved.format === "double") {
    const allMatches = resolved.rounds.flatMap((round) => round.matches);
    const reset = allMatches.find((match) => match.id === "gf2");
    const grand = allMatches.find((match) => match.id === "gf1");
    if (reset && reset.visible && reset.winner) return reset.winner;
    return grand?.winner || "";
  }

  const finalRound = resolved.rounds[resolved.rounds.length - 1];
  const finalMatch = finalRound?.matches?.[0];
  return finalMatch?.winner || "";
};

const renderKnockoutPath = (resolved, champion) => {
  if (!champion) return "";
  const pathMatches = resolved.rounds
    .flatMap((round) => round.matches.map((match) => ({ ...match, roundName: round.name })))
    .filter((match) => match.winner === champion)
    .filter((match) => match.team1 && match.team2 && hasFinalScore(match));

  if (!pathMatches.length) return "";

  return `
    <div class="mb-6 rounded-2xl border border-secondary/20 bg-secondary/5 p-5">
      <p class="text-[10px] uppercase tracking-[0.24em] font-black text-secondary mb-3">Path To Glory</p>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        ${pathMatches.map((match) => {
          const opponent = match.team1 === champion ? match.team2 : match.team1;
          const score = `${match.s1}-${match.s2}${formatPenaltyScore(match) ? ` (${formatPenaltyScore(match)})` : ""}`;
          return `
            <div class="rounded-xl border border-white/10 bg-black/20 p-3">
              <p class="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">${match.roundName}</p>
              <p class="mt-1 font-headline text-sm font-black uppercase text-white">vs ${opponent}</p>
              <p class="mt-2 text-secondary font-black">${score}</p>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
};

const renderKnockout = () => {
  const container = document.getElementById("knockoutBracket");
  if (!container) return;

  const resolved = resolveKnockout(knockout);
  knockout = resolved;
  const visibleRounds = resolved.rounds.filter((round) => round.matches.some((match) => match.visible !== false));

  if (visibleRounds.length === 0) {
    container.innerHTML = `<p class="text-white/30 text-sm italic">Belum ada bracket. Generate dari panel admin.</p>`;
    return;
  }

  const roundsHtml = visibleRounds.map((round, roundIndex) => {
    const baseGap = resolved.format === "single" ? Math.max(14, 14 * Math.pow(2, roundIndex)) : 14;

    const matchesHtml = round.matches
      .filter((match) => match.visible !== false)
      .map((match) => {
        const locked = !match.team1 || !match.team2;
        const team1Class = match.winner && match.winner === match.team1 ? "win" : "";
        const team2Class = match.winner && match.winner === match.team2 ? "win" : "";
        const status = match.winner
          ? `<span class="text-primary">${match.winner}</span>`
          : (locked ? `<span class="text-white/40">Waiting Teams</span>` : `<span class="text-secondary">Waiting Result</span>`);

        return `
          <article class="ko-match-card ${locked ? "ko-locked" : ""}">
            <div class="ko-match-head">
              <span>${match.id.toUpperCase()}</span>
              <span>${status}</span>
            </div>
            <div class="space-y-2">
              <div class="ko-team-row ${team1Class}">
                <p class="ko-team-name">${match.team1 || "BYE"}</p>
                ${isAdmin
                  ? `<input type="number" class="ko-score" value="${match.s1 ?? ""}" data-action="updateScoreKO" data-id="${match.id}" data-side="1" ${locked ? "disabled" : ""}>`
                  : `<span class="ko-score text-center ${locked ? "opacity-50" : ""}">${match.s1 ?? "-"}</span>`
                }
              </div>
              <div class="ko-team-row ${team2Class}">
                <p class="ko-team-name">${match.team2 || "BYE"}</p>
                ${isAdmin
                  ? `<input type="number" class="ko-score" value="${match.s2 ?? ""}" data-action="updateScoreKO" data-id="${match.id}" data-side="2" ${locked ? "disabled" : ""}>`
                  : `<span class="ko-score text-center ${locked ? "opacity-50" : ""}">${match.s2 ?? "-"}</span>`
                }
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <section class="ko-round">
        <h3 class="ko-round-title">${round.name}</h3>
        <div class="ko-stack" style="gap: ${baseGap}px;">
          ${matchesHtml}
        </div>
      </section>
    `;
  }).join("");

  const champion = getKnockoutChampion(resolved);
  const pathPanel = renderKnockoutPath(resolved, champion);
  const championPanel = champion
    ? `
      <div class="mb-6 bg-[#11192a] border border-primary/20 rounded-2xl p-5 shadow-xl">
        <p class="text-[10px] uppercase tracking-[0.24em] font-bold text-white/50 mb-2">Pemenang Partai Final</p>
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-2xl md:text-3xl font-black italic uppercase text-primary leading-none">${champion}</p>
            <p class="text-xs uppercase tracking-widest text-white/45 mt-2">Official Knockout Champion</p>
          </div>
          <span class="material-symbols-outlined text-secondary text-[64px] leading-none drop-shadow-[0_0_16px_rgba(255,215,9,0.35)]">workspace_premium</span>
        </div>
      </div>
    `
    : "";

  container.innerHTML = `
    <div class="mb-5 flex flex-wrap items-center gap-3 text-xs uppercase tracking-widest font-bold">
      <span class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">Format: ${resolved.format === "double" ? "Double Elimination" : "Single Elimination"}</span>
      <span class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">Qualified: ${resolved.qualifierZone || `Top ${resolved.bracketSize || "-"}`}</span>
      <span class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">Teams: ${resolved.qualifiedCount || resolved.bracketSize || "-"}</span>
      ${champion ? `<span class="px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary">Champion: ${champion}</span>` : ""}
    </div>
    ${championPanel}
    ${pathPanel}
    <div class="ko-grid">
      ${roundsHtml}
    </div>
  `;
};

const knockoutScheduleDocId = (matchId) => `knockout-${normalizeKey(matchId).replace(/[^a-z0-9_-]+/g, "-")}`;

async function cleanupGeneratedKnockoutSchedules(activeIds) {
  const snap = await getDocs(collection(db, "matches"));
  const deletions = snap.docs
    .filter((item) => {
      const data = item.data() || {};
      return data.type === "knockout" && data.knockoutGenerated === true && !activeIds.has(item.id);
    })
    .map((item) => deleteDoc(item.ref));
  await Promise.all(deletions);
}

async function ensureKnockoutScheduleMatches(options = {}) {
  if (!isAdmin || knockoutScheduleSyncing) return;
  const resetScores = !!options.resetScores;
  const cleanupStale = !!options.cleanupStale;
  const resolved = resolveKnockout(knockout);
  const activeIds = new Set();
  const writes = [];

  resolved.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (match.visible === false) return;
      if (!match.team1 || !match.team2) return;

      const matchDocId = knockoutScheduleDocId(match.id);
      activeIds.add(matchDocId);
      const matchRef = doc(db, "matches", matchDocId);
      const payload = {
        team1: match.team1,
        team2: match.team2,
        type: "knockout",
        knockoutGenerated: true,
        knockoutMatchId: match.id,
        knockoutRoundId: round.id,
        knockoutRoundName: round.name,
        knockoutFormat: resolved.format,
        knockoutQualifierZone: resolved.qualifierZone || "",
        Matchweek: 900,
        date: `Knockout - ${round.name}`,
        live: false
      };

      writes.push((async () => {
        const existing = await getDoc(matchRef);
        if (resetScores || !existing.exists()) {
          await setDoc(matchRef, {
            ...payload,
            s1: null,
            s2: null,
            p1: null,
            p2: null,
            bridgeLocked: false,
            externalMatchId: ""
          }, { merge: false });
        } else {
          await setDoc(matchRef, payload, { merge: true });
        }
      })());
    });
  });

  knockoutScheduleSyncing = true;
  try {
    if (cleanupStale) await cleanupGeneratedKnockoutSchedules(activeIds);
    await Promise.all(writes);
  } catch (error) {
    console.error("Gagal sync schedule knockout:", error);
  } finally {
    knockoutScheduleSyncing = false;
  }
}

async function syncKnockoutScoresFromSchedule(incomingMatches = matches) {
  if (!isAdmin || knockoutScoreSyncing || !knockout?.rounds?.length) return;

  const scheduleItems = incomingMatches.filter((match) => (
    match.type === "knockout" &&
    match.knockoutMatchId &&
    match.knockoutGenerated === true
  ));
  if (!scheduleItems.length) return;

  const resolved = resolveKnockout(knockout);
  let changed = false;

  scheduleItems.forEach((schedule) => {
    resolved.rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (match.id !== schedule.knockoutMatchId) return;
        const nextS1 = isScoreEmpty(schedule.s1) ? null : parseInt(schedule.s1);
        const nextS2 = isScoreEmpty(schedule.s2) ? null : parseInt(schedule.s2);
        if (match.s1 !== nextS1 || match.s2 !== nextS2) {
          match.s1 = Number.isFinite(nextS1) ? nextS1 : null;
          match.s2 = Number.isFinite(nextS2) ? nextS2 : null;
          changed = true;
        }
      });
    });
  });

  if (!changed) return;
  knockoutScoreSyncing = true;
  try {
    knockout = resolved;
    await saveKnockout();
    await ensureKnockoutScheduleMatches();
    renderKnockout();
  } catch (error) {
    console.error("Gagal sync skor knockout dari schedule:", error);
  } finally {
    knockoutScoreSyncing = false;
  }
}

async function saveKnockout() {
  if (!isAdmin) return;
  try {
    await setDoc(doc(db, "tournament", "knockout"), sanitizeKnockout(knockout));
  } catch (error) {
    console.error("Error saving knockout:", error);
    alert("Gagal menyimpan data knockout.");
  }
}

async function updateScoreKO(matchId, side, score) {
  if (!isAdmin) return;
  const resolved = resolveKnockout(knockout);
  let targetMatch = null;

  resolved.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (match.id === matchId) targetMatch = match;
    });
  });

  if (!targetMatch) return;

  const parsed = sanitizeScore(score);
  if (side === 1) targetMatch.s1 = parsed;
  else targetMatch.s2 = parsed;

  knockout = resolved;
  await saveKnockout();
  renderKnockout();
}

async function generateBracket() {
  if (!isAdmin) return;
  if (teams.length < 2) {
    alert("Minimal butuh 2 tim.");
    return;
  }

  const format = document.getElementById("koType")?.value || "single";
  const sizeSelection = document.getElementById("koSize")?.value || "auto";
  const rankedTeams = calculateStandings().map((row) => row.team);
  const championsSize = Math.max(parseInt(championsCutoff) || 4, 2);
  const playoffSize = Math.max(parseInt(playoffCutoff) || 6, championsSize);
  const requestedSize =
    sizeSelection === "auto" ? playoffSize :
    sizeSelection === "champions" ? championsSize :
    (parseInt(sizeSelection) || playoffSize);

  const qualifierLabel =
    sizeSelection === "champions" ? `Zona Champions Top ${championsSize}` :
    sizeSelection === "auto" ? `Zona Play-off Top ${playoffSize}` :
    `Manual Top ${requestedSize}`;

  if (format === "double") {
    const doubleTeamCount = Math.max(4, Math.min(requestedSize, rankedTeams.length, 8));
    const normalizedDoubleTeamCount = doubleTeamCount <= 4 ? 4 : doubleTeamCount <= 6 ? 6 : 8;
    if (rankedTeams.length < normalizedDoubleTeamCount) {
      alert(`Double elimination butuh minimal ${normalizedDoubleTeamCount} tim untuk pilihan ini.`);
      return;
    }
    const doubleLabel =
      sizeSelection === "champions" ? `Zona Champions Top ${normalizedDoubleTeamCount}` :
      sizeSelection === "auto" ? `Zona Play-off Top ${normalizedDoubleTeamCount}` :
      `Manual Top ${normalizedDoubleTeamCount}`;

    if (!confirm(`Generate Double Elimination bracket untuk ${doubleLabel}?`)) return;
    knockout = {
      format: "double",
      bracketSize: normalizedDoubleTeamCount,
      qualifierZone: doubleLabel,
      qualifiedCount: normalizedDoubleTeamCount,
      rounds: buildDoubleEliminationRounds(rankedTeams, normalizedDoubleTeamCount)
    };
    await saveKnockout();
    await ensureKnockoutScheduleMatches({ resetScores: true, cleanupStale: true });
    renderKnockout();
    return;
  }

  const teamCount = Math.max(2, Math.min(requestedSize, rankedTeams.length));
  const seeded = rankedTeams.slice(0, teamCount);
  const bracketSize = nextPowerOfTwo(teamCount);

  if (!confirm(`Generate Single Elimination untuk ${qualifierLabel} (${teamCount} tim, bracket ${bracketSize})?`)) return;

  knockout = {
    format: "single",
    bracketSize: teamCount,
    qualifierZone: qualifierLabel,
    qualifiedCount: teamCount,
    rounds: buildSingleEliminationRounds(seeded, bracketSize)
  };

  await saveKnockout();
  await ensureKnockoutScheduleMatches({ resetScores: true, cleanupStale: true });
  renderKnockout();
}

const clearKnockoutData = async () => {
  if (!isAdmin) return;
  knockout = { format: "single", bracketSize: 0, qualifierZone: "", qualifiedCount: 0, rounds: [] };
  await saveKnockout();
  await cleanupGeneratedKnockoutSchedules(new Set());
  renderKnockout();
};


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
      const selected = document.getElementById("playerRosterSelect");
      const option = selected?.selectedOptions?.[0];
      const rosterId = selected?.value || "";
      const player = option?.dataset.name || option?.textContent?.trim() || "";
      const image = option?.dataset.image || "";
      const poster = document.getElementById("scorerPoster").value.trim();
      const team = option?.dataset.team || document.getElementById("playerTeam").value;
      const goals = parseInt(document.getElementById("playerGoals").value) || 0;
      const assists = parseInt(document.getElementById("playerAssists").value) || 0; // New field

      if (!player || !team) return alert("Fill in player name and team!");

      // Save to Firebase (including assists)
      await addDoc(collection(db, "scorers"), { player, image, poster, team, goals, assists, rosterPlayerId: rosterId });

      // Clear input fields after saving
      ["scorerPoster", "playerGoals", "playerAssists"].forEach(id => document.getElementById(id).value = "");
    };

    const deleteScorer = async (id) => {
      if (isAdmin && confirm("Delete scorer?")) await deleteDoc(doc(db, "scorers", id));
    };

    const addHofManager = async () => {
      if (!isAdmin) return;

      const name = document.getElementById("hofManagerName")?.value.trim();
      const photo = document.getElementById("hofManagerPhoto")?.value.trim();
      const leagueTitles = parseInt(document.getElementById("hofManagerLeagueTitles")?.value) || 0;
      const cupTitles = parseInt(document.getElementById("hofManagerCupTitles")?.value) || 0;

      if (!name) {
        alert("Nama manajer wajib diisi.");
        return;
      }

      const existing = hofManagers.find((m) => normalizeKey(m.name) === normalizeKey(name));
      const payload = {
        name,
        photo,
        leagueTitles,
        cupTitles,
        updatedAt: serverTimestamp()
      };

      if (existing) {
        await updateDoc(doc(db, "hofManagers", existing.id), payload);
        alert("Data manager berhasil di-update.");
      } else {
        await addDoc(collection(db, "hofManagers"), {
          ...payload,
          createdAt: serverTimestamp()
        });
        alert("Manager berhasil ditambahkan.");
      }

      ["hofManagerName", "hofManagerPhoto", "hofManagerLeagueTitles", "hofManagerCupTitles"].forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field) field.value = "";
      });
    };

    const deleteHofManager = async (id) => {
      if (!isAdmin || !id) return;
      if (!confirm("Hapus manager ini dari leaderboard?")) return;
      await deleteDoc(doc(db, "hofManagers", id));
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

    const winnerPlayer = document.getElementById('hofWinnerPlayer').value;
    const cupWinnerManager = document.getElementById('hofCupWinnerManager').value || "";
    const winnerPlayerPhoto = document.getElementById('hofWinnerPlayerPhoto').value || "";
    const cupWinnerManagerPhoto = document.getElementById('hofCupWinnerManagerPhoto').value || "";

    const data = {
      season: season,
      winnerTeam: winnerTeam,
      winnerPlayer,
      winnerPlayerPhoto: findManagerPhoto(winnerPlayer, winnerPlayerPhoto),
      winnerLogo: document.getElementById('hofWinnerLogo').value,
      winnerStars: parseInt(document.getElementById('hofWinnerStars').value) || 1,
      cupWinner: document.getElementById('hofCupWinner').value || "N/A",
      cupWinnerManager,
      cupWinnerManagerPhoto: cupWinnerManager ? findManagerPhoto(cupWinnerManager, cupWinnerManagerPhoto) : "",
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
    const detailWinnerPlayerPhoto = document.getElementById('detailWinnerPlayerPhoto');
    if (detailWinnerPlayerPhoto) {
        detailWinnerPlayerPhoto.src = resolveManagerPhoto(item.winnerPlayer, item.winnerPlayerPhoto);
    }
    const detailCupWinnerManager = document.getElementById('detailCupWinnerManager');
    if (detailCupWinnerManager) {
        detailCupWinnerManager.innerText = item.cupWinnerManager || "-";
    }
    const detailCupWinnerManagerPhoto = document.getElementById('detailCupWinnerManagerPhoto');
    if (detailCupWinnerManagerPhoto) {
        detailCupWinnerManagerPhoto.src = resolveManagerPhoto(item.cupWinnerManager, item.cupWinnerManagerPhoto);
    }
    
    // 3. Isi Deskripsi (Dengan penanganan jika kosong)
    const descEl = document.getElementById('detailDescription');
    if (descEl) {
        descEl.innerText = item.description || "No special story recorded for this legendary season.";
    }

    // 4. Update Logo Tim Juara
    const logoEl = document.getElementById('detailWinnerLogo');
    if (logoEl) {
        logoEl.src = item.winnerLogo || placeholderImage; // Placeholder jika logo kosong
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
            <img src="${item.scorerPhoto || placeholderImage}" 
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

    const BACKUP_COLLECTIONS = ["teams", "matches", "scorers", "players", "news", "halloffame", "hofManagers"];
    const BACKUP_DOCUMENTS = ["config/standings", "settings/liveBanner", "settings/trophyCabinet", "tournament/knockout"];

    const serializeForBackup = (value) => {
      if (value instanceof Timestamp) {
        return {
          __type: "timestamp",
          seconds: value.seconds,
          nanoseconds: value.nanoseconds
        };
      }
      if (Array.isArray(value)) return value.map((item) => serializeForBackup(item));
      if (value && typeof value === "object") {
        const result = {};
        Object.entries(value).forEach(([key, child]) => {
          result[key] = serializeForBackup(child);
        });
        return result;
      }
      return value;
    };

    const deserializeFromBackup = (value) => {
      if (Array.isArray(value)) return value.map((item) => deserializeFromBackup(item));
      if (value && typeof value === "object") {
        if (value.__type === "timestamp" && typeof value.seconds === "number") {
          return new Timestamp(value.seconds, value.nanoseconds || 0);
        }
        const result = {};
        Object.entries(value).forEach(([key, child]) => {
          result[key] = deserializeFromBackup(child);
        });
        return result;
      }
      return value;
    };

    const buildBackupPayload = async () => {
      const collectionPairs = await Promise.all(
        BACKUP_COLLECTIONS.map(async (name) => {
          const snap = await getDocs(collection(db, name));
          const docs = snap.docs.map((item) => ({
            id: item.id,
            data: serializeForBackup(item.data())
          }));
          return [name, docs];
        })
      );

      const documentPairs = await Promise.all(
        BACKUP_DOCUMENTS.map(async (path) => {
          const ref = doc(db, ...path.split("/"));
          const snap = await getDoc(ref);
          return [path, snap.exists() ? serializeForBackup(snap.data()) : null];
        })
      );

      return {
        meta: {
          app: "Liga King",
          version: 3,
          exportedAt: new Date().toISOString()
        },
        collections: Object.fromEntries(collectionPairs),
        documents: Object.fromEntries(documentPairs)
      };
    };

    const exportBackup = async () => {
      if (!isAdmin) {
        alert("Hanya admin yang bisa export backup.");
        return;
      }

      try {
        const payload = await buildBackupPayload();

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        link.href = url;
        link.download = `liga-king-backup-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        alert("Backup berhasil di-export.");
      } catch (error) {
        console.error("Export backup failed:", error);
        alert("Gagal export backup: " + error.message);
      }
    };

    const archiveSeason = async () => {
      if (!isAdmin) {
        alert("Hanya admin yang bisa archive season.");
        return;
      }

      const defaultName = `Season Archive ${new Date().toLocaleDateString()}`;
      const archiveName = prompt("Nama archive season:", defaultName);
      if (!archiveName) return;
      if (!confirm(`Archive "${archiveName}" sekarang?`)) return;
      if (!confirm("Konfirmasi kedua: data akan disimpan ke seasonArchives. Lanjut?")) return;

      try {
        const payload = await buildBackupPayload();
        await addDoc(collection(db, "seasonArchives"), {
          name: archiveName,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          payload
        });
        alert("Season berhasil di-archive.");
      } catch (error) {
        console.error("Archive season failed:", error);
        alert("Gagal archive season: " + error.message);
      }
    };

    const importBackup = async (e) => {
      if (!isAdmin) {
        alert("Hanya admin yang bisa import backup.");
        e.target.value = "";
        return;
      }

      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const incomingCollections = parsed.collections || {};
        const incomingDocuments = parsed.documents || {};

        if (!incomingCollections || typeof incomingCollections !== "object") {
          throw new Error("Format backup tidak valid (collections missing).");
        }

        if (!confirm("Import backup akan menimpa database saat ini. Lanjutkan?")) {
          e.target.value = "";
          return;
        }

        for (const collectionName of BACKUP_COLLECTIONS) {
          if (!Array.isArray(incomingCollections[collectionName])) continue;

          const current = await getDocs(collection(db, collectionName));
          await Promise.all(current.docs.map((item) => deleteDoc(item.ref)));

          const incomingDocs = incomingCollections[collectionName];
          for (const incoming of incomingDocs) {
            const incomingId = incoming?.id;
            const incomingData = deserializeFromBackup(incoming?.data || {});
            if (incomingId) {
              await setDoc(doc(db, collectionName, incomingId), incomingData);
            } else {
              await addDoc(collection(db, collectionName), incomingData);
            }
          }
        }

        for (const documentPath of BACKUP_DOCUMENTS) {
          if (!(documentPath in incomingDocuments)) continue;

          const ref = doc(db, ...documentPath.split("/"));
          const incomingData = incomingDocuments[documentPath];
          if (incomingData === null) {
            await deleteDoc(ref);
          } else {
            await setDoc(ref, deserializeFromBackup(incomingData));
          }
        }

        alert("Import backup selesai. Data sudah diperbarui.");
      } catch (error) {
        console.error("Import backup failed:", error);
        alert("Gagal import backup: " + error.message);
      } finally {
        e.target.value = "";
      }
    };

    const commitBatchChunks = async (operations, chunkSize = 450) => {
      for (let i = 0; i < operations.length; i += chunkSize) {
        const batch = writeBatch(db);
        operations.slice(i, i + chunkSize).forEach((operation) => operation(batch));
        await batch.commit();
      }
    };

    const parseRosterImportPlayers = (parsed) => {
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.players)) return parsed.players;
      if (parsed.players && typeof parsed.players === "object") return Object.values(parsed.players);
      throw new Error("Format roster tidak valid. Pilih firestore-import.json dari PES Roster Importer.");
    };

    const fileToBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error || new Error("Gagal membaca file."));
      reader.readAsDataURL(file);
    });

    const buildFaceFileMap = () => {
      const input = document.getElementById("rosterFaceFiles");
      const files = Array.from(input?.files || []);
      const map = new Map();
      files.forEach((file) => {
        const relative = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
        map.set(relative, file);
      });
      return map;
    };

    const findRosterFaceFile = (player, faceFileMap) => {
      if (!faceFileMap.size || !player.faceFile) return null;
      const candidates = [
        player.facePath,
        `${player.teamKey}/${player.faceFile}`,
        player.faceFile
      ].filter(Boolean).map((value) => String(value).replace(/\\/g, "/"));

      for (const candidate of candidates) {
        if (faceFileMap.has(candidate)) return faceFileMap.get(candidate);
      }

      const suffixes = [
        `/${player.teamKey}/${player.faceFile}`,
        `/${player.faceFile}`
      ];
      for (const [relativePath, file] of faceFileMap.entries()) {
        if (suffixes.some((suffix) => relativePath.endsWith(suffix))) return file;
      }
      return null;
    };

    const uploadRosterFace = async (player, file) => {
      const storagePath = `${player.teamKey}/${player.faceFile}`.replace(/\\/g, "/");
      const base64 = await fileToBase64(file);
      const response = await fetch("/api/supabase-upload-face", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: storagePath,
          contentType: file.type || "image/png",
          base64
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Upload gagal: ${storagePath}`);
      return result;
    };

    const uploadRosterFaces = async (players, faceFileMap) => {
      let uploaded = 0;
      let missing = 0;
      const cache = new Map();
      const enhanced = [];

      for (const player of players) {
        const file = findRosterFaceFile(player, faceFileMap);
        if (!file) {
          if (player.faceFile) missing += 1;
          enhanced.push(player);
          continue;
        }

        const storagePath = `${player.teamKey}/${player.faceFile}`.replace(/\\/g, "/");
        let uploadedFace = cache.get(storagePath);
        if (!uploadedFace) {
          uploadedFace = await uploadRosterFace(player, file);
          cache.set(storagePath, uploadedFace);
          uploaded += 1;
        }

        enhanced.push({
          ...player,
          faceUrl: uploadedFace.publicUrl,
          image: uploadedFace.publicUrl,
          faceStoragePath: uploadedFace.path,
          faceStorageBucket: "player-faces"
        });
      }

      return { players: enhanced, uploaded, missing };
    };

    const deleteSupabaseFaces = async (paths) => {
      const uniquePaths = [...new Set((paths || []).filter(Boolean))];
      if (!uniquePaths.length) return 0;
      const response = await fetch("/api/supabase-delete-faces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: uniquePaths })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Gagal hapus gambar Supabase.");
      return result.deleted || 0;
    };

    const ensureTeamsForRoster = async (players) => {
      const incomingTeams = new Map();
      players.forEach((player) => {
        if (!player.team || !player.teamKey) return;
        if (!incomingTeams.has(player.teamKey)) {
          incomingTeams.set(player.teamKey, {
            name: player.team,
            teamKey: player.teamKey,
            pesTeamId: player.teamId || null
          });
        }
      });

      if (!incomingTeams.size) return { created: 0, updated: 0 };

      const snap = await getDocs(collection(db, "teams"));
      const existing = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      let created = 0;
      let updated = 0;

      for (const incoming of incomingTeams.values()) {
        const found = existing.find((team) => (
          normalizeKey(team.teamKey) === normalizeKey(incoming.teamKey) ||
          normalizeKey(team.name) === normalizeKey(incoming.name)
        ));

        if (found) {
          await updateDoc(doc(db, "teams", found.id), {
            teamKey: incoming.teamKey,
            pesTeamId: incoming.pesTeamId,
            updatedAtMs: Date.now()
          });
          updated += 1;
        } else {
          await addDoc(collection(db, "teams"), {
            name: incoming.name,
            logo: "",
            teamKey: incoming.teamKey,
            pesTeamId: incoming.pesTeamId,
            p: 0,
            w: 0,
            d: 0,
            l: 0,
            gf: 0,
            ga: 0,
            pts: 0,
            y: 0,
            stars: 3,
            source: "pes-roster-importer",
            createdAtMs: Date.now()
          });
          created += 1;
        }
      }

      return { created, updated };
    };

    const importRosterPlayers = async (e) => {
      if (!isAdmin) {
        alert("Hanya admin yang bisa import roster PES.");
        e.target.value = "";
        return;
      }

      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const incomingPlayers = parseRosterImportPlayers(parsed)
          .filter((player) => player && (player.docId || player.playerId) && player.player && player.teamKey);

        if (!incomingPlayers.length) {
          throw new Error("Tidak ada player valid di file import.");
        }

        const faceFileMap = buildFaceFileMap();
        const faceMessage = faceFileMap.size
          ? `\n${faceFileMap.size} file gambar dipilih dan akan diupload ke Supabase.`
          : "\nTidak ada folder faces dipilih; import hanya memakai path/URL yang sudah ada di JSON.";
        const teamKeys = [...new Set(incomingPlayers.map((player) => player.teamKey).filter(Boolean))];
        const teamLabel = teamKeys.length <= 5 ? teamKeys.join(", ") : `${teamKeys.length} teams`;
        if (!confirm(`Import ${incomingPlayers.length} pemain untuk ${teamLabel}? Roster lama untuk team yang sama akan diganti.${faceMessage}`)) {
          e.target.value = "";
          return;
        }

        const deleteOps = [];
        const oldStoragePaths = [];
        for (let i = 0; i < teamKeys.length; i += 10) {
          const chunk = teamKeys.slice(i, i + 10);
          const snap = await getDocs(query(collection(db, "players"), where("teamKey", "in", chunk)));
          snap.docs.forEach((item) => {
            const data = item.data();
            if (data.faceStoragePath) oldStoragePaths.push(data.faceStoragePath);
            deleteOps.push((batch) => batch.delete(item.ref));
          });
        }
        if (oldStoragePaths.length) await deleteSupabaseFaces(oldStoragePaths);

        const uploadResult = faceFileMap.size
          ? await uploadRosterFaces(incomingPlayers, faceFileMap)
          : { players: incomingPlayers, uploaded: 0, missing: 0 };
        const teamImportResult = await ensureTeamsForRoster(uploadResult.players);

        await commitBatchChunks(deleteOps);

        const importedAtMs = Date.now();
        const writeOps = uploadResult.players.map((player) => {
          const docId = String(player.docId || `${player.teamKey}_${player.playerKey || player.playerId}`).trim();
          const payload = {
            ...player,
            docId,
            importedAtMs,
            source: player.source || "pes-roster-importer"
          };
          return (batch) => batch.set(doc(db, "players", docId), payload);
        });
        await commitBatchChunks(writeOps);

        alert(`Roster import selesai. Team dibuat: ${teamImportResult.created}, team update: ${teamImportResult.updated}. ${deleteOps.length} dokumen lama diganti, ${writeOps.length} pemain masuk. Gambar upload: ${uploadResult.uploaded}. Gambar tidak ketemu: ${uploadResult.missing}.`);
      } catch (error) {
        console.error("Import roster failed:", error);
        alert("Gagal import roster: " + error.message);
      } finally {
        e.target.value = "";
      }
    };

    // --- EVENT DELEGATION HUB (MENGGANTIKAN SEMUA ONCLICK/ONCHANGE) ---
   // --- EVENT DELEGATION HUB ---
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const id = btn.dataset.id; // Ambil ID sekaligus

    // 1. Navigasi & UI
    if (action === 'toggleSidebar') toggleSidebar();
    else if (action === 'openTab') openTab(btn.dataset.tab, btn);
    else if (action === 'toggleFolder') toggleFolder(parseInt(btn.dataset.mw));
    else if (action === 'openHofModal') {
        const modal = document.getElementById('hofModal');
        if(modal) modal.classList.remove('hidden');
    }
    
    // 2. Auth
    else if (action === 'login') await login();
    else if (action === 'logout') logout(); 
    else if (action === 'toggleTheme') {
        const nextTheme = document.body.classList.contains("light-theme") ? "dark" : "light";
        applyTheme(nextTheme);
    }
    
    // 3. Teams
    else if (action === 'openTeamCreateModal') openTeamCreateModal();
    else if (action === 'closeTeamEditorModal') closeTeamEditorModal();
    else if (action === 'saveTeamFromModal') await saveTeamFromModal();
    else if (action === 'editTeam') openTeamEditModal(id);
    else if (action === 'openTeamDetail') renderTeamDetailModal(id);
    else if (action === 'closeTeamDetailModal') closeTeamDetailModal();
    else if (action === 'editRosterPlayer') await editRosterPlayer(id);
    else if (action === 'addTeam') openTeamCreateModal();
    else if (action === 'deleteTeam') await deleteTeam(id);
    
    // 4. Matches & League
    else if (action === 'generateLeague') await generateLeague(); 
    else if (action === 'resetMatches') await hardReset();
    else if (action === 'deleteMatch') await deleteMatch(id);
    else if (action === 'addMatch') await addMatch();
    
    // 5. LIVE System
    else if (action === 'toggleLive') {
        const newState = btn.dataset.state === 'true'; 
        await toggleLive(id, newState);
    }
    
    // 6. Scorers & News
    else if (action === 'addNews') await addNews();
    else if (action === 'addScorer') await addScorer();
    else if (action === 'deleteScorer') await deleteScorer(id);
    else if (action === 'addHofManager') await addHofManager();
    else if (action === 'deleteHofManager') await deleteHofManager(id);
      
    // 7. Knockout System (Dibersihkan dari duplikasi)
    else if (action === 'generateBracket') await generateBracket();
    else if (action === 'clearKnockout') {
        if(confirm("Hapus semua data knockout?")) {
            await clearKnockoutData();
        }
    }
    
    // 8. Backup & Settings
    else if (action === 'saveCutoffs') await saveCutoffs();
    else if (action === 'archiveSeason') await archiveSeason();
    else if (action === 'exportBackup') await exportBackup();
});
    
    document.addEventListener('change', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
      
    const action = target.dataset.action;

    if (action === 'filterMatches') renderMatches();
    else if (action === 'updateScore') await updateScore(target.dataset.id, target.value, target.dataset.side);
    else if (action === 'updateScorerGoals') await updateScorerGoals(target.dataset.id, target.value);
    else if (action === 'updateScorerAssists') await updateScorerAssists(target.dataset.id, target.value);
    else if (action === 'updateScoreKO') await updateScoreKO(target.dataset.id, parseInt(target.dataset.side), target.value);
    else if (action === 'importBackup') await importBackup(e);
    else if (action === 'importRosterPlayers') await importRosterPlayers(e);
    else if (action === 'selectScorerTeam') renderRosterPlayerOptions();
});

    document.addEventListener('input', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      if (target.dataset.action === 'searchScorer') renderScorers();
    });
