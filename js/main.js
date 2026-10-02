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
    let playerMatchStats = [];
    let news = [];
    let knockout = { format: "single", tieFormat: "single", byeFill: "1", mirrorTeam: false, bracketSize: 0, rounds: [] };
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
    let activeDraggedRosterPlayerId = "";
    let activeTacticDropTargetId = "";
    let competitionConfig = { mode: "league", groupFormat: "normal-single", numGroups: 2, advancePerGroup: 2, cupDirect: "1", bestPos: 3, bestPosCount: 0, mirrorTeam: false, updatedAtMs: 0 };
    
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

    const teamRecordForName = (name) => teams.find((team) => normalizeKey(team.name) === normalizeKey(name)) || resolveTeam(name);

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
        .sort((a, b) => (a.rosterSlot ?? 999) - (b.rosterSlot ?? 999) || (a.number ?? 999) - (b.number ?? 999) || String(a.player || "").localeCompare(String(b.player || "")));
    };

    const positionGroup = (position = "") => {
      const value = normalizeKey(position);
      if (["gk", "goalkeeper"].some((item) => value.includes(item))) return "GK";
      if (["cb", "lb", "rb", "def"].some((item) => value.includes(item))) return "DEF";
      if (["dmf", "cmf", "amf", "lmf", "rmf", "dm", "cm", "am", "mf", "mid", "lm", "rm"].some((item) => value.includes(item))) return "MID";
      if (["cf", "ss", "lwf", "rwf", "wf", "lw", "rw", "fw", "st"].some((item) => value.includes(item))) return "FWD";
      return "SUB";
    };

    const positionCode = (position = "") => String(position || "").trim().toUpperCase();

    const playerRating = (player) => {
      const value = player?.rating ?? player?.overall ?? player?.ovr ?? player?.overallRating;
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : 0;
    };

    const latestPerformanceForPlayer = (player) => {
      const playerId = player?.playerId === undefined || player?.playerId === null ? "" : String(player.playerId);
      const playerKey = normalizeKey(player?.playerKey || slugKey(player?.player));
      const teamKey = normalizeKey(player?.teamKey || slugKey(player?.team));
      return playerMatchStats
        .filter((item) => {
          const idMatches = playerId && String(item.playerId || "") === playerId;
          const keyMatches = playerKey && normalizeKey(item.playerKey || slugKey(item.playerName)) === playerKey;
          const teamMatches = !teamKey || normalizeKey(item.teamKey || slugKey(item.teamName)) === teamKey;
          return teamMatches && (idMatches || keyMatches);
        })
        .sort((a, b) => (b.bridgeImportedAtMs || 0) - (a.bridgeImportedAtMs || 0))[0] || null;
    };

    const playerMatchPerformance = (player) => player?.lastMatchPerformance || latestPerformanceForPlayer(player) || null;

    const playerMatchRating = (player) => {
      const perf = playerMatchPerformance(player);
      const value = player?.lastMatchRating ?? perf?.rating;
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : 0;
    };

    const formatMatchRating = (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) return "";
      return Number.isInteger(number) ? String(number) : number.toFixed(1);
    };

    const playerPerformanceSummary = (player) => {
      const perf = playerMatchPerformance(player);
      if (!perf) return "";
      const parts = [];
      const rating = playerMatchRating(player);
      if (rating) parts.push(`MR ${formatMatchRating(rating)}`);
      if (Number(perf.goals) > 0) parts.push(`G${perf.goals}`);
      if (Number(perf.assists) > 0) parts.push(`A${perf.assists}`);
      return parts.join(" ");
    };

    const sortByRoster = (items) => items.slice().sort((a, b) => (
      (a.rosterSlot ?? 999) - (b.rosterSlot ?? 999) ||
      (a.number ?? 999) - (b.number ?? 999) ||
      String(a.player || "").localeCompare(String(b.player || ""))
    ));

    const parseFormationLines = (formation = "") => {
      const parts = String(formation || "").match(/\d+/g)?.map(Number).filter((item) => item > 0) || [];
      const total = parts.reduce((sum, item) => sum + item, 0);
      return total === 10 ? parts : [4, 3, 3];
    };

    const xSlots = (count) => {
      if (count <= 1) return [50];
      const presets = {
        2: [42, 58],
        3: [32, 50, 68],
        4: [24, 42, 58, 76],
        5: [18, 34, 50, 66, 82]
      };
      if (presets[count]) return presets[count];
      const gap = 68 / Math.max(1, count - 1);
      return Array.from({ length: count }, (_, index) => 16 + gap * index);
    };

    const ySlots = (lineCount) => {
      if (lineCount === 4) return [76, 60, 42, 24];
      if (lineCount === 2) return [68, 32];
      return [74, 52, 28];
    };

    const codeMatchesTarget = (code, target) => {
      if (!target) return true;
      if (target === "WF") return ["LWF", "RWF", "LW", "RW"].some((item) => code.includes(item));
      return code.includes(target);
    };

    const playerPickScore = (player, target = "") => {
      const code = positionCode(player.position);
      const number = Number(player.number) || 99;
      let score = 0;
      if (target && codeMatchesTarget(code, target)) score -= 1000;
      if (player.positionSource === "player-map") score -= 80;
      if (player.positionSource === "player-database") score -= 70;
      if (player.positionSource === "squad-order-heuristic") score -= 40;
      score -= playerRating(player) * 3;
      if (target === "GK" && number === 1) score -= 200;
      if (target === "LB" && code.includes("L")) score -= 30;
      if (target === "RB" && code.includes("R")) score -= 30;
      if (target === "LWF" && (code.includes("LWF") || code === "LW")) score -= 30;
      if (target === "RWF" && (code.includes("RWF") || code === "RW")) score -= 30;
      return score + (player.rosterSlot ?? 999) + number / 100;
    };

    const choosePlayersByTargets = (pool, targets, selectedIds) => {
      const chosen = [];
      const localSelected = new Set(selectedIds);
      const orderedPool = pool.slice().sort((a, b) => (
        (a.rosterSlot ?? 999) - (b.rosterSlot ?? 999) ||
        (a.number ?? 999) - (b.number ?? 999)
      ));

      for (const target of targets) {
        const candidates = orderedPool
          .filter((player) => !localSelected.has(player.id))
          .sort((a, b) => playerPickScore(a, target) - playerPickScore(b, target));
        const exact = candidates.find((player) => codeMatchesTarget(positionCode(player.position), target));
        const picked = exact || candidates[0];
        if (!picked) continue;
        chosen.push(picked);
        localSelected.add(picked.id);
      }

      return chosen;
    };

    const lineRoleFor = (lines, index) => {
      if (index === 0) return "DEF";
      if (index === lines.length - 1) return "FWD";
      if (lines.length === 4 && index === 2) return "AM";
      return "MID";
    };

    const targetsForLine = (role, count) => {
      if (role === "DEF") {
        if (count === 5) return ["LB", "CB", "CB", "CB", "RB"];
        if (count === 3) return ["CB", "CB", "CB"];
        return ["LB", "CB", "CB", "RB"].slice(0, count);
      }
      if (role === "MID") {
        if (count === 2) return ["DMF", "CMF"];
        if (count === 4) return ["LMF", "DMF", "CMF", "RMF"];
        return ["DMF", "CMF", "AMF"].slice(0, count);
      }
      if (role === "AM") return ["LWF", "AMF", "RWF"].slice(0, count);
      if (count === 3) return ["LWF", "CF", "RWF"];
      if (count === 2) return ["CF", "CF"];
      return Array.from({ length: count }, () => "CF");
    };

    const poolForLineRole = (role, preferredRoster, fallbackRoster) => {
      const source = [...preferredRoster, ...fallbackRoster];
      if (role === "DEF") return source.filter((player) => positionGroup(player.position) === "DEF");
      if (role === "MID") return source.filter((player) => positionGroup(player.position) === "MID");
      if (role === "AM") return source.filter((player) => {
        const code = positionCode(player.position);
        return ["AMF", "LWF", "RWF", "SS", "LMF", "RMF"].some((item) => code.includes(item));
      });
      return source.filter((player) => positionGroup(player.position) === "FWD");
    };

    const orderLinePlayers = (group, players) => {
      const laneScore = (player) => {
        const code = positionCode(player.position);
        if (group === "DEF") {
          if (code.includes("LB")) return 10;
          if (code.includes("RB")) return 90;
          if (code.includes("CB")) return 50;
          return 55;
        }
        if (group === "MID") {
          if (code.includes("LMF") || code === "LM") return 15;
          if (code.includes("RMF") || code === "RM") return 85;
          if (code.includes("DMF")) return 42;
          if (code.includes("AMF")) return 58;
          return 50;
        }
        if (group === "AM") {
          if (code.includes("LWF") || code === "LW" || code.includes("LMF")) return 15;
          if (code.includes("RWF") || code === "RW" || code.includes("RMF")) return 85;
          if (code.includes("AMF") || code.includes("SS")) return 50;
          return 55;
        }
        if (code.includes("LWF") || code === "LW") return 15;
        if (code.includes("RWF") || code === "RW") return 85;
        if (code.includes("SS")) return 45;
        if (code.includes("CF") || code.includes("ST")) return 50;
        return 55;
      };
      return players.slice().sort((a, b) => (
        laneScore(a) - laneScore(b) ||
        (a.rosterSlot ?? 999) - (b.rosterSlot ?? 999) ||
        (a.number ?? 999) - (b.number ?? 999)
      ));
    };

    const autoLineupForFormation = (team, players) => {
      const byRoster = players.slice().sort((a, b) => (a.rosterSlot ?? 999) - (b.rosterSlot ?? 999) || (a.number ?? 999) - (b.number ?? 999));
      const preferredRoster = byRoster.filter((player) => player.isSubstitute !== true);
      const fallbackRoster = byRoster.filter((player) => player.isSubstitute === true);
      const lines = parseFormationLines(team.formation);
      const selectedIds = new Set();
      const lineup = [];
      const manualPinned = preferredRoster.filter((player) => (
        player.isSubstitute !== true &&
        Number.isFinite(parseFloat(player.tacticX)) &&
        Number.isFinite(parseFloat(player.tacticY))
      ));

      const gks = byRoster.filter((player) => positionGroup(player.position) === "GK");
      const keeperPool = gks
        .filter((player) => player.isSubstitute !== true)
        .sort((a, b) => playerPickScore(a, "GK") - playerPickScore(b, "GK"));
      const keeper = keeperPool[0] || gks.sort((a, b) => playerPickScore(a, "GK") - playerPickScore(b, "GK"))[0] || byRoster[0];
      if (keeper) {
        lineup.push(keeper);
        selectedIds.add(keeper.id);
      }

      manualPinned.forEach((player) => {
        if (!selectedIds.has(player.id) && lineup.length < 11) {
          lineup.push(player);
          selectedIds.add(player.id);
        }
      });

      const linePlayers = [];
      lines.forEach((count, index) => {
        const group = lineRoleFor(lines, index);
        const manualInGroup = manualPinned.filter((player) => (
          group === "AM"
            ? ["AMF", "LWF", "RWF", "SS", "LMF", "RMF"].some((item) => positionCode(player.position).includes(item))
            : positionGroup(player.position) === group
        )).length;
        const targetCount = Math.max(0, count - manualInGroup);
        const lineSelectedIds = new Set(selectedIds);
        const targets = targetsForLine(group, targetCount);
        let picked = choosePlayersByTargets(poolForLineRole(group, preferredRoster, []), targets, lineSelectedIds);
        picked.forEach((player) => lineSelectedIds.add(player.id));

        if (picked.length < targetCount) {
          const more = choosePlayersByTargets(poolForLineRole(group, [], fallbackRoster), targets.slice(picked.length), lineSelectedIds);
          picked = [...picked, ...more];
          more.forEach((player) => lineSelectedIds.add(player.id));
        }

        if (picked.length < targetCount) {
          const leftovers = [...preferredRoster, ...fallbackRoster].filter((player) => positionGroup(player.position) !== "GK");
          picked = [...picked, ...choosePlayersByTargets(leftovers, Array.from({ length: targetCount - picked.length }, () => ""), lineSelectedIds)];
        }

        picked = orderLinePlayers(group, picked);
        picked.forEach((player) => selectedIds.add(player.id));
        linePlayers.push(picked);
        lineup.push(...picked);
      });

      return { lineup: lineup.slice(0, 11), linePlayers, keeper, manualPinned };
    };

    const autoTacticLayout = (team, players) => {
      const { linePlayers, keeper, manualPinned } = autoLineupForFormation(team, players);
      const lines = parseFormationLines(team.formation);
      const ys = ySlots(lines.length);
      const layout = new Map();

      if (keeper) layout.set(keeper.id, { x: 50, y: 92 });
      for (const player of manualPinned || []) {
        layout.set(player.id, {
          x: parseFloat(player.tacticX),
          y: parseFloat(player.tacticY)
        });
      }

      lines.forEach((count, lineIndex) => {
        const xs = xSlots(count);
        for (let i = 0; i < (linePlayers[lineIndex] || []).length; i += 1) {
          const player = linePlayers[lineIndex][i];
          if (player) layout.set(player.id, { x: xs[i], y: ys[lineIndex] || 50 });
        }
      });
      return layout;
    };

    const percentFromBoardEvent = (board, event) => {
      const rect = board.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
      };
    };

    const clearTacticDropHighlight = () => {
      document.querySelectorAll("[data-tactic-player].drop-replace-target").forEach((node) => {
        node.classList.remove("drop-replace-target", "scale-110", "z-40");
        const img = node.querySelector("img");
        if (img) {
          img.classList.remove("border-[#8eff71]", "shadow-[0_0_28px_rgba(142,255,113,0.9)]");
          img.classList.add("border-primary");
          img.style.borderColor = "";
          img.style.boxShadow = "";
        }
      });
      document.querySelectorAll(".tactic-board.drop-active").forEach((node) => {
        node.classList.remove("drop-active", "ring-2", "ring-primary/70");
      });
      activeTacticDropTargetId = "";
    };

    const setTacticDropHighlight = (board, targetNode) => {
      const targetId = targetNode?.dataset?.tacticPlayer || "";
      if (activeTacticDropTargetId === targetId && board.classList.contains("drop-active")) return;
      clearTacticDropHighlight();
      board.classList.add("drop-active", "ring-2", "ring-primary/70");
      if (!targetNode) return;
      activeTacticDropTargetId = targetId;
      targetNode.classList.add("drop-replace-target", "scale-110", "z-40");
      const img = targetNode.querySelector("img");
      if (img) {
        img.classList.remove("border-primary");
        img.classList.add("border-[#8eff71]", "shadow-[0_0_28px_rgba(142,255,113,0.9)]");
        img.style.borderColor = "#8eff71";
        img.style.boxShadow = "0 0 28px rgba(142,255,113,0.9)";
      }
    };

    const getNearestTacticPlayerNode = (board, event, ignoredPlayerId = "") => {
      const point = percentFromBoardEvent(board, event);
      const nodes = Array.from(board.querySelectorAll("[data-tactic-player]"))
        .filter((node) => node.dataset.tacticPlayer !== ignoredPlayerId);
      let best = null;
      for (const node of nodes) {
        const x = parseFloat(node.dataset.x || node.style.left || "");
        const y = parseFloat(node.dataset.y || node.style.top || "");
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const score = ((point.x - x) ** 2) + ((point.y - y) ** 2);
        if (!best || score < best.score) best = { node, score };
      }
      return best?.node || null;
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
      if (minute === null || minute === undefined || minute === "") return "";
      return `${parseInt(minute, 10) || 0}'`;
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

    const shouldShowPenaltyScore = (match) => normalizeKey(match?.type || "league") === "knockout";
    const formatPenaltyScore = (match) => (shouldShowPenaltyScore(match) && hasPenaltyScore(match)) ? `${match.p1}-${match.p2} pens` : "";
    const formatGoalMinute = (event) => {
      const minute = event?.minute;
      if (minute === null || minute === undefined || minute === "") return "Goal";
      const second = event?.second;
      const secondText = second === null || second === undefined || second === "" ? "" : `:${String(second).padStart(2, "0")}`;
      return `${parseInt(minute, 10) || 0}${secondText}'`;
    };

    const getMatchSortValue = (match) => (
      parseInt(match.bridgeImportedAtMs) ||
      parseInt(match.autoNewsGeneratedAt) ||
      parseInt(match.autoNewsRequestedAt) ||
      parseInt(match.Matchweek) ||
      0
    );

    const getTeamForm = (teamName, limit = 5) => matches
      .filter((match) => (
        (match.type || "league") !== "knockout" &&
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
      const total = parseInt(match.knockoutGames) || 1;
      const items = [];

      if (match.live) {
        items.push({ label: "Live from PES", cls: "bg-error/10 text-error border-error/20" });
      } else if (hasFinalScore(match)) {
        if (total > 1) {
          const tieDone = !!(linked && linked.winner);
          items.push({ label: tieDone ? `Tie decided: ${linked.winner}` : `Game done — tie ${match.knockoutGame || 1}/${total}`, cls: tieDone ? "bg-primary/10 text-primary border-primary/20" : "bg-secondary/10 text-secondary border-secondary/20" });
        } else {
          const synced = linked && String(linked.s1 ?? "") === String(match.s1 ?? "") && String(linked.s2 ?? "") === String(match.s2 ?? "") && String(linked.p1 ?? "") === String(match.p1 ?? "") && String(linked.p2 ?? "") === String(match.p2 ?? "");
          items.push({ label: synced ? "Synced to Bracket" : "Ready to Sync", cls: synced ? "bg-primary/10 text-primary border-primary/20" : "bg-secondary/10 text-secondary border-secondary/20" });
          items.push({ label: "Locked Final", cls: "bg-white/5 text-on-surface-variant border-white/10" });
        }
      } else {
        items.push({ label: total > 1 ? `Waiting PES (${match.knockoutGameLabel || `Game ${match.knockoutGame || 1}`})` : "Waiting PES", cls: "bg-secondary/10 text-secondary border-secondary/20" });
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
        const ta = (a.type || "league"), tb = (b.type || "league");
        if (ta === "knockout" && tb !== "knockout") return -1;
        if (ta !== "knockout" && tb === "knockout") return 1;
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
      const renderMiniPitch = (teamName) => {
        const team = teamRecordForName(teamName);
        const players = playersForTeam(team);
        if (!players.length) {
          return `
            <div class="rounded-[1.2rem] border border-outline-variant/10 bg-black/20 p-4 text-center">
              <p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-black">${teamName}</p>
              <p class="mt-3 text-xs italic text-on-surface-variant">Roster belum diimport</p>
            </div>
          `;
        }

        const lineup = autoLineupForFormation(team, players).lineup;
        const layout = autoTacticLayout(team, players);
        const pieces = lineup.map((player) => {
          const point = layout.get(player.id) || { x: 50, y: 50 };
          const rating = playerRating(player);
          const matchRating = playerMatchRating(player);
          return `
            <div class="absolute -translate-x-1/2 -translate-y-1/2 text-center" style="left:${point.x}%; top:${point.y}%;">
              <img src="${player.faceUrl || player.image || player.facePath || placeholderImage}" class="mx-auto h-7 w-7 rounded-full border border-primary object-cover shadow-lg">
              <div class="mt-0.5 max-w-[58px] rounded bg-black/75 px-1.5 py-0.5 text-[7px] font-black leading-tight text-white">
                <span class="text-primary">${player.position || ""}</span>${rating ? ` <span class="text-secondary">${rating}</span>` : ""}
                <br><span class="block truncate">${String(player.player || "").split(" ").slice(-1)[0]}</span>
                ${matchRating ? `<span class="block text-[6px] text-secondary">MR ${formatMatchRating(matchRating)}</span>` : ""}
              </div>
            </div>
          `;
        }).join("");

        return `
          <div class="rounded-[1.2rem] border border-outline-variant/10 bg-black/20 p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="truncate text-[10px] uppercase tracking-widest text-primary font-black">${team.name}</p>
              <span class="rounded-md bg-black/60 px-2 py-1 text-[9px] font-black text-white">${team.formation || "4-3-3"}</span>
            </div>
            <div class="relative h-[250px] overflow-hidden rounded-[1rem] border border-primary/15 bg-surface-container-highest">
              <div class="absolute inset-0 opacity-25" style="background-image:linear-gradient(90deg,rgba(142,255,113,.22) 1px,transparent 1px),linear-gradient(rgba(255,215,9,.16) 1px,transparent 1px);background-size:20% 16.66%;"></div>
              <div class="absolute inset-x-[18%] top-0 h-[16%] border-x border-b border-primary/25"></div>
              <div class="absolute inset-x-[18%] bottom-0 h-[16%] border-x border-t border-primary/25"></div>
              <div class="absolute left-0 right-0 top-1/2 border-t border-secondary/25"></div>
              <div class="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-secondary/25"></div>
              ${pieces}
            </div>
          </div>
        `;
      };
      const predictedLineups = `
        <div class="mt-5 border-t border-outline-variant/10 pt-5">
          <p class="mb-3 text-[10px] uppercase tracking-[0.22em] text-primary font-black">Predicted Starting XI</p>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
            ${renderMiniPitch(match.team1)}
            ${renderMiniPitch(match.team2)}
          </div>
        </div>
      `;

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
          ${predictedLineups}
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
      const goalMinute = formatGoalMinute(event);
      const assist = event.assist ? `Assist: ${event.assist}` : "";

      const overlay = document.createElement("div");
      overlay.className = "fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none";
      overlay.innerHTML = `
        <div class="relative overflow-hidden rounded-[2rem] border border-primary/40 bg-[#070e1c]/95 px-10 py-8 text-center shadow-[0_0_80px_rgba(142,255,113,0.35)] animate-[goalPop_2.8s_ease_forwards]">
          <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-secondary to-tertiary"></div>
          <p class="font-headline text-6xl md:text-8xl font-black italic uppercase text-primary text-glow-primary leading-none">GOAL</p>
          <p class="mt-3 font-headline text-xl md:text-3xl font-black uppercase text-white">${teamName || "Liga King"}</p>
          <p class="mt-2 text-sm uppercase tracking-widest text-secondary font-bold">${scorer || goalMinute}</p>
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
              const isGoal = normalizeKey(kind).includes("goal");
              const player = event.scorer || event.player || event.card || (isGoal ? formatGoalMinute(event) : event.note || kind);
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

     // --- Competition Engine (Liga / Grup fleksibel) ---
    const GROUP_LETTERS = ["A","B","C","D","E","F","G","H"];
    const groupLetter = (index) => GROUP_LETTERS[index] || `G${index + 1}`;

    const readCompetitionUI = () => {
      const mode = document.getElementById("compMode")?.value || competitionConfig.mode || "league";
      const leagueLegs = parseInt(document.getElementById("leagueLegs")?.value) || 1;
      const numGroups = parseInt(document.getElementById("groupCount")?.value) || competitionConfig.numGroups || 2;
      const groupFormat = document.getElementById("groupFormat")?.value || competitionConfig.groupFormat || "normal-single";
      const advancePerGroup = parseInt(document.getElementById("advancePerGroup")?.value) || competitionConfig.advancePerGroup || 2;
      // Migrasi: config lama hanya punya thirdPlaceCount (= Best 3rd).
      const legacyThird = parseInt(competitionConfig.thirdPlaceCount) || 0;
      const bestPosRaw = parseInt(document.getElementById("bestPosRank")?.value ?? competitionConfig.bestPos ?? 3);
      const bestPos = [2, 3, 4, 5].includes(bestPosRaw) ? bestPosRaw : 3;
      const bestPosCountRaw = parseInt(document.getElementById("bestPosCount")?.value ?? competitionConfig.bestPosCount ?? legacyThird);
      const bestPosCount = Math.max(0, Number.isFinite(bestPosCountRaw) ? bestPosCountRaw : 0);
      // Cup langsung per grup: "all" = semua yang lolos langsung Cup (tanpa tier playoff).
      const cupRaw = document.getElementById("cupDirect")?.value ?? competitionConfig.cupDirect ?? "1";
      const clearExisting = document.getElementById("clearExistingMatches")?.checked !== false;
      const mirrorEl = document.getElementById("compMirrorTeam");
      const mirrorTeam = mirrorEl ? mirrorEl.checked === true : competitionConfig.mirrorTeam === true;
      return { mode, leagueLegs: leagueLegs === 2 ? 2 : 1, numGroups, groupFormat, advancePerGroup, bestPos, bestPosCount, cupDirect: ["1", "2", "3", "all"].includes(String(cupRaw)) ? String(cupRaw) : "1", clearExisting, mirrorTeam };
    };

    // Normalisasi: berapa slot per grup yang badge Cup (sisanya yang lolos = Playoff).
    const cupDirectCount = (adv) => {
      const v = String(competitionConfig.cupDirect ?? "1");
      if (v === "all") return Math.max(1, adv);
      const n = parseInt(v);
      return Math.min(Math.max(1, Number.isFinite(n) ? n : 1), Math.max(1, adv));
    };

    // Satu nilai, dua checkbox (panel Competition + panel Bracket) — selalu sinkron via snapshot.
    const readByeFill = () => {
      const ko = document.getElementById("koByeFill");
      if (ko) return ko.checked ? "1" : "0";
      const cp = document.getElementById("compByeFill");
      if (cp) return cp.checked ? "1" : "0";
      return (knockout?.byeFill || "1") !== "0" ? "1" : "0";
    };

    const syncCompetitionUI = () => {
      const ui = readCompetitionUI();
      const groupWrap = document.getElementById("groupOptsWrap");
      const legsWrap = document.getElementById("leagueLegsWrap");
      if (groupWrap) groupWrap.style.display = ui.mode === "group" ? "grid" : "none";
      if (legsWrap) legsWrap.style.display = ui.mode === "group" ? "none" : "block";
      const status = document.getElementById("compStatus");
      if (status) {
        if (ui.mode === "group") {
          const desc = ui.groupFormat === "asean"
            ? "ASEAN Cup: 1x ketemu, home/away diseimbangkan (grup 5 → 2 kandang + 2 tandang)."
            : ui.groupFormat === "normal-double"
              ? "Grup Normal 2x: setiap tim ketemu 2x home & away."
              : "Grup Normal 1x: setiap tim ketemu 1x.";
          const third = ui.bestPosCount > 0 ? ` + Best ${ui.bestPosCount}x peringkat ${ui.bestPos}` : "";
          const cupTxt = ui.cupDirect === "all" ? "Semua lolos langsung Cup" : `Rank 1–${Math.min(parseInt(ui.cupDirect) || 1, ui.advancePerGroup)} Cup langsung`;
          status.textContent = `Mode: Grup (${ui.numGroups} grup, ${desc} Top ${ui.advancePerGroup}/grup${third} lolos ke knockout [${cupTxt}]. Drawing 1 tim per pot per grup.)`;
        } else {
          status.textContent = `Mode: Liga (${ui.leagueLegs}x ketemu). Grup normal = round-robin penuh. ASEAN Cup = 1x ketemu, home/away diseimbangkan.`;
        }
      }
      const badge = document.getElementById("competitionBadge");
      if (badge) {
        const mirrorTxt = competitionConfig.mirrorTeam ? " • Mirror ON" : "";
        const thirdTxt = competitionConfig.mode === "group" && (competitionConfig.bestPosCount || 0) > 0 ? ` • Best ${competitionConfig.bestPosCount}x#${competitionConfig.bestPos || 3}` : "";
        const cupTxt = competitionConfig.mode === "group" ? ` • Cup ${String(competitionConfig.cupDirect ?? "1") === "all" ? "semua" : "top " + cupDirectCount(parseInt(competitionConfig.advancePerGroup) || 2)}` : "";
        badge.textContent = competitionConfig.mode === "group"
          ? `Mode: Grup • ${competitionConfig.numGroups} grup • ${competitionConfig.groupFormat} • Top ${competitionConfig.advancePerGroup}/grup${cupTxt}${thirdTxt}${mirrorTxt}`
          : `Mode: Liga${mirrorTxt}`;
      }
    };

    const potOf = (team) => {
      const p = parseInt(team?.pot);
      return [1, 2, 3, 4, 5].includes(p) ? p : 99;
    };
    const shuffleInPlace = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    // Drawing grup sesuai Pot 1-5 (terbukti rata max-min ≤1 di semua kasus uji):
    // tiap tim masuk ke grup TERKECIL saat itu, prioritas grup yang belum punya tim
    // dari pot yang sama. Menggantikan rotasi-start per pot yang bikin drift
    // (mis. pot 3+3+2 utk 4 grup dulu jadi 1-2-3-2, sekarang 2-2-2-2).
    const splitTeamsIntoGroups = (teamList, numGroups) => {
      const groups = Array.from({ length: numGroups }, () => []);
      [1, 2, 3, 4, 5, 99].forEach((pot) => {
        const pool = shuffleInPlace(teamList.filter((t) => potOf(t) === pot).slice());
        pool.forEach((team) => {
          let bi = 0;
          for (let g = 1; g < numGroups; g++) {
            const aHas = groups[bi].filter((x) => potOf(x) === pot).length;
            const bHas = groups[g].filter((x) => potOf(x) === pot).length;
            if (groups[g].length < groups[bi].length ||
              (groups[g].length === groups[bi].length && bHas < aHas)) bi = g;
          }
          groups[bi].push(team);
        });
      });
      return groups;
    };
    const potDistributionText = (teamList) => {
      const counts = [1, 2, 3, 4, 5].map((p) => `${teamList.filter((t) => potOf(t) === p).length}xP${p}`).join(" + ");
      const unseeded = teamList.filter((t) => potOf(t) === 99).length;
      return unseeded > 0 ? `${counts} + ${unseeded}xNoPot` : counts;
    };

    // Circle method (standar liga dunia, Lucas 1883): n tim genap → n-1 MW,
    // tiap tim main tepat 1x per MW. Ganjil → 1 BYE per MW (tiap tim istirahat 1x).
    // Pasangan TANPA orientasi venue di sini — venue ditentukan optimizer di bawah.
    const circleMethodRoundRobin = (names) => {
      const list = names.slice();
      if (list.length % 2 === 1) list.push("__BYE__");
      const n = list.length;
      const rounds = [];
      const arr = list.slice();
      for (let r = 0; r < n - 1; r++) {
        const pairs = [];
        for (let i = 0; i < n / 2; i++) {
          const h = arr[i];
          const a = arr[n - 1 - i];
          if (h === "__BYE__" || a === "__BYE__") continue;
          pairs.push([h, a]);
        }
        rounds.push(pairs);
        arr.splice(1, 0, arr.pop());
      }
      return rounds;
    };

    // Kualitas venue per literatur (de Werra): break = 2 kandang/tandang beruntun.
    // Minimum teoritis 2n-2 utk 2n tim. Optimizer multi-start hill-climb deterministik
    // (flip 1 fixture + flip 2 fixture se-tim), terverifikasi capai minimum:
    // n=4→2, n=6→4 (tiap tim ≤1 break), n=8→6; ganjil + hardBalance (ASEAN) = selisih
    // H-A tiap tim ≤1 (grup 5 → 2H2A semua + cuma 2 break, optimum timetable ini).
    const hapCost = (names, rounds, hardBalance) => {
      const seq = new Map(names.map((n) => [n, ""]));
      const home = new Map(names.map((n) => [n, 0]));
      rounds.forEach((pairs) => pairs.forEach(([h, a]) => {
        seq.set(h, (seq.get(h) || "") + "H");
        seq.set(a, (seq.get(a) || "") + "A");
        home.set(h, (home.get(h) || 0) + 1);
      }));
      let breaks = 0, imb = 0, viol = 0;
      names.forEach((n) => {
        const s = seq.get(n) || "";
        for (let k = 1; k < s.length; k++) if (s[k] === s[k - 1]) breaks++;
        const played = s.length;
        imb += Math.abs((home.get(n) || 0) - played / 2);
        if (hardBalance && Math.abs((home.get(n) || 0) - played / 2) > 0.5) viol += 100;
      });
      return breaks * 10 + imb + viol;
    };

    const optimizeHomeAway = (names, rounds, hardBalance = false) => {
      const starts = [(r) => r % 2 === 1, (r) => r % 2 === 0, (r, i) => (r + i) % 2 === 1, (r, i) => (r + i) % 2 === 0];
      let best = null, bestCost = Infinity;
      starts.forEach((flipFn) => {
        const work = rounds.map((pairs, r) => pairs.map(([t1, t2], i) => (flipFn(r, i) ? [t2, t1] : [t1, t2])));
        const flat = work.flat();
        const flipAt = (idx) => { const p = flat[idx]; const t = p[0]; p[0] = p[1]; p[1] = t; };
        let cost = hapCost(names, work, hardBalance);
        let improved = true, iter = 0;
        while (improved && iter < 60) {
          improved = false; iter++;
          for (let x = 0; x < flat.length; x++) {
            flipAt(x);
            const sc = hapCost(names, work, hardBalance);
            if (sc < cost) { cost = sc; improved = true; }
            else flipAt(x);
          }
          if (!improved) {
            outer: for (let x = 0; x < flat.length; x++) {
              for (let y = x + 1; y < flat.length; y++) {
                const fx = flat[x], fy = flat[y];
                if (!(fx[0] === fy[0] || fx[0] === fy[1] || fx[1] === fy[0] || fx[1] === fy[1])) continue;
                flipAt(x); flipAt(y);
                const sc = hapCost(names, work, hardBalance);
                if (sc < cost) { cost = sc; improved = true; break outer; }
                flipAt(x); flipAt(y);
              }
            }
          }
        }
        if (cost < bestCost) { bestCost = cost; best = work; }
      });
      return best || rounds;
    };

    // Istirahat adil antar MW (literatur rest-difference): tim yang baru main dijadwalkan
    // belakangan di MW berikut. Greedy deterministik per urutan slot global.
    // Jaminan: tidak ada back-to-back antar MW bila tiap MW ≥3 match
    // (MW isi 2 match mustahil struktural — selalu ada tim nyambung).
    const orderRoundsByRest = (names, rounds, state = null) => {
      const last = (state && state.last) || new Map(names.map((n) => [n, -9999]));
      let slot = (state && state.slot) || 0;
      const out = rounds.map((pairs) => {
        const remaining = pairs.slice();
        const ordered = [];
        while (remaining.length) {
          let bi = 0, bs = -Infinity;
          remaining.forEach(([t1, t2], i) => {
            const s = Math.min(slot - (last.get(t1) ?? -9999), slot - (last.get(t2) ?? -9999));
            if (s > bs) { bs = s; bi = i; }
          });
          const pick = remaining.splice(bi, 1)[0];
          ordered.push(pick);
          last.set(pick[0], slot);
          last.set(pick[1], slot);
          slot++;
        }
        return ordered;
      });
      return { rounds: out, last, slot };
    };

    const buildFixturesFromNames = (names, legs = 1, balanceASEAN = false) => {
      const raw = circleMethodRoundRobin(names);
      const optimized = optimizeHomeAway(names, raw.map((pairs) => pairs.map(([t1, t2]) => [t1, t2])), balanceASEAN);
      let rest = orderRoundsByRest(names, optimized);
      const fixtures = [];
      rest.rounds.forEach((pairs, ri) => {
        pairs.forEach(([t1, t2]) => fixtures.push({ t1, t2, mw: ri + 1, leg: 1 }));
      });
      if (legs === 2) {
        const base = rest.rounds.length;
        // Leg 2: kandang ditukar + rest-ordering LANJUTAN (bukan dari nol) agar jeda antar leg adil
        rest = orderRoundsByRest(names, optimized.map((pairs) => pairs.map(([t1, t2]) => [t2, t1])), rest);
        rest.rounds.forEach((pairs, ri) => {
          pairs.forEach(([t1, t2]) => fixtures.push({ t1, t2, mw: base + ri + 1, leg: 2 }));
        });
      }
      // slot = urutan tampil global (dipakai urutan render agar jeda istirahat kelihatan)
      fixtures.forEach((f, idx) => { f.slot = idx; });
      return fixtures;
    };

    const deleteLeagueGroupMatches = async () => {
      const snap = await getDocs(collection(db, "matches"));
      const ops = [];
      snap.docs.forEach((d) => {
        const t = (d.data()?.type || "league");
        if (t === "league" || t === "group") ops.push((batch) => batch.delete(d.ref));
      });
      await commitBatchChunks(ops);
      return ops.length;
    };

    const saveCompetitionConfig = async (cfg) => {
      competitionConfig = { ...cfg, updatedAtMs: Date.now() };
      await setDoc(doc(db, "config", "competition"), competitionConfig);
      syncCompetitionUI();
    };

    const assignTeamGroups = async (groups) => {
      const ops = [];
      const byName = new Map();
      groups.forEach((list, gi) => list.forEach((t) => byName.set(t.name, groupLetter(gi))));
      teams.forEach((t) => {
        const g = byName.get(t.name) || "";
        if ((t.group || "") !== g) ops.push((batch) => batch.update(doc(db, "teams", t.id), { group: g, updatedAtMs: Date.now() }));
      });
      if (ops.length) await commitBatchChunks(ops);
    };

    const clearTeamGroups = async () => {
      const ops = [];
      teams.forEach((t) => {
        if (t.group) ops.push((batch) => batch.update(doc(db, "teams", t.id), { group: "", updatedAtMs: Date.now() }));
      });
      if (ops.length) await commitBatchChunks(ops);
    };

     // --- Generate League / Group (improved) ---
    const generateLeague = async () => {
      if (teams.length < 2) return alert("Minimal harus ada 2 tim!");
      const ui = readCompetitionUI();

      if (ui.mode === "group") {
        if (ui.numGroups < 2) return alert("Grup minimal 2.");
        if (teams.length < ui.numGroups * 2) return alert(`Butuh minimal ${ui.numGroups * 2} tim untuk ${ui.numGroups} grup (min 2/grup).`);
        if (ui.advancePerGroup < 1) return alert("Lolos per grup minimal 1.");
      }

      const summary = ui.mode === "group"
        ? `Generate GROUP: ${teams.length} tim → ${ui.numGroups} grup (${ui.groupFormat}, top ${ui.advancePerGroup}/grup${ui.bestPosCount > 0 ? ` + best ${ui.bestPosCount}x #${ui.bestPos}` : ""} lolos)?\nPot: ${potDistributionText(teams)}`
        : `Generate LIGA: ${teams.length} tim, ${ui.leagueLegs}x ketemu?`;
      if (!confirm(summary)) return;
      if (ui.clearExisting && !confirm("Hapus jadwal Liga/Grup lama dulu? (Knockout tidak ikut terhapus)")) return;

      try {
        if (ui.clearExisting) await deleteLeagueGroupMatches();
        else {
          const existing = matches.filter((m) => (m.type || "league") === "league" || (m.type || "") === "group");
          if (existing.length && !confirm(`Sudah ada ${existing.length} jadwal liga/grup. Lanjut tambah (risiko duplikat)?`)) return;
        }

        const existingPairKeys = ui.clearExisting ? new Set() : new Set(matches
          .filter((m) => (m.type || "league") !== "knockout")
          .map((m) => `${m.type || "league"}|${m.group || ""}|${[normalizeKey(m.team1), normalizeKey(m.team2)].sort().join(">")}|leg${m.leg || 1}`));

        const payloads = [];
        const seenPairKeys = new Set();
        const pushUnique = (p) => {
          const pairKey = `${p.type}|${p.group || ""}|${[normalizeKey(p.team1), normalizeKey(p.team2)].sort().join(">")}|leg${p.leg || 1}`;
          if (existingPairKeys.has(pairKey) || seenPairKeys.has(pairKey)) return false;
          existingPairKeys.add(pairKey);
          seenPairKeys.add(pairKey);
          payloads.push(p);
          return true;
        };

        let mwCount = 0;
        if (ui.mode === "league") {
          const names = teams.map((t) => t.name);
          const fixtures = buildFixturesFromNames(names, ui.leagueLegs, false);
          mwCount = fixtures.reduce((mx, f) => Math.max(mx, f.mw), 0);
          fixtures.forEach((f) => {
            pushUnique({
              team1: f.t1, team2: f.t2, s1: null, s2: null, p1: null, p2: null,
              date: "TBD", live: false, type: "league", group: "",
              Matchweek: f.mw, leg: f.leg, stage: `League MW ${f.mw}`,
              slot: f.slot,
              mirrorTeam: ui.mirrorTeam, useTeam: ui.mirrorTeam ? f.t1 : "",
              createdAtMs: Date.now()
            });
          });
          await clearTeamGroups();
          await saveCompetitionConfig({ mode: "league", groupFormat: "normal-single", numGroups: 1, advancePerGroup: 0, cupDirect: "1", bestPos: 3, bestPosCount: 0, mirrorTeam: ui.mirrorTeam });
        } else {
          const groups = splitTeamsIntoGroups(teams, ui.numGroups);
          const legs = ui.groupFormat === "normal-double" ? 2 : 1;
          const balance = ui.groupFormat === "asean";
          groups.forEach((list, gi) => {
            const letter = groupLetter(gi);
            const names = list.map((t) => t.name);
            const fixtures = buildFixturesFromNames(names, legs, balance);
            fixtures.forEach((f) => {
              mwCount = Math.max(mwCount, f.mw);
              pushUnique({
                team1: f.t1, team2: f.t2, s1: null, s2: null, p1: null, p2: null,
                date: "TBD", live: false, type: "group", group: letter,
                Matchweek: f.mw, leg: f.leg, stage: `Group ${letter} MW ${f.mw}`,
                slot: f.slot,
                mirrorTeam: ui.mirrorTeam, useTeam: ui.mirrorTeam ? f.t1 : "",
                createdAtMs: Date.now()
              });
            });
          });
          await assignTeamGroups(groups);
          await saveCompetitionConfig({ mode: "group", groupFormat: ui.groupFormat, numGroups: ui.numGroups, advancePerGroup: ui.advancePerGroup, cupDirect: ui.cupDirect, bestPos: ui.bestPos, bestPosCount: ui.bestPosCount, mirrorTeam: ui.mirrorTeam });
        }

        if (!payloads.length) return alert("Tidak ada jadwal baru (semua sudah ada / duplikat dicegah).");
        const ops = payloads.map((p) => (batch) => batch.set(doc(collection(db, "matches")), p));
        await commitBatchChunks(ops);
        alert(`Berhasil! ${payloads.length} pertandingan dibuat (${ui.mode === "group" ? `${ui.numGroups} grup` : "liga"}${mwCount ? `, ${mwCount} matchweek` : ""}).`);
      } catch (e) {
        alert("Error: " + e.message);
      }
    };

    const hardReset = async () => {
  if (!confirm("Hapus SEMUA jadwal pertandingan (liga/grup/knockout) + TOP SCORER?")) return;
  const code = prompt("Ketik 'RESET' untuk konfirmasi:");
  if (code !== "RESET") return alert("Dibatalkan.");

  try {
    const snap = await getDocs(collection(db, "matches"));
    const batch = snap.docs.map(d => deleteDoc(doc(db, "matches", d.id)));
    await Promise.all(batch);
    try {
      const scorersSnap = await getDocs(collection(db, "scorers"));
      await Promise.all(scorersSnap.docs.map(d => deleteDoc(d.ref)));
    } catch (scorerErr) { console.warn("Reset top scorer warning:", scorerErr); }
    try {
      await clearTeamGroups();
      await saveCompetitionConfig({ mode: "league", groupFormat: "normal-single", numGroups: 1, advancePerGroup: 0, cupDirect: "1", bestPos: 3, bestPosCount: 0, mirrorTeam: false });
    } catch (cfgErr) { console.warn("Reset competition config warning:", cfgErr); }
    alert("Reset selesai: jadwal + top scorer dihapus! Mode kembali ke Liga.");
  } catch (e) {
    alert("Gagal reset: " + e.message);
  }
};

    const toggleAdminUI = () => {
      ["adminTeamControls", "matchControls", "scorerControls", "newsControls", "knockoutControls", "liveBannerControls", "trophyCabinetControls", "hofcontrols", "hofManagerControls"].forEach(id => {
        if (document.getElementById(id)) document.getElementById(id).style.display = isAdmin ? "block" : "none";
      });
      syncCompetitionUI();
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
      const key = String(mw);
      collapsed[key] = !collapsed[key];
      localStorage.setItem("collapsedMW", JSON.stringify(collapsed));
      renderMatches();
    };

    // --- Knockout map: drag-pan + zoom ---
    let koZoom = 1;
    let koPanBound = false;
    const applyKoZoom = () => {
      const canvas = document.getElementById("ko-canvas");
      const label = document.getElementById("koZoomLabel");
      const z = Math.min(1.6, Math.max(0.55, koZoom));
      koZoom = z;
      if (canvas) {
        canvas.style.transform = `scale(${z})`;
        canvas.style.transformOrigin = "0 0";
      }
      if (label) label.textContent = `${Math.round(z * 100)}%`;
    };
    const setKoZoom = (next) => { koZoom = next; applyKoZoom(); };
    const initKoPanZoom = () => {
      if (koPanBound) return;
      const vp = document.getElementById("knockout-viewport");
      if (!vp) return;
      koPanBound = true;
      let dragging = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;
      const interactive = (el) => el && el.closest && el.closest("input,select,textarea,button,a,[data-action]");
      vp.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (interactive(e.target)) return;
        dragging = true; moved = false;
        sx = e.clientX; sy = e.clientY; sl = vp.scrollLeft; st = vp.scrollTop;
        vp.classList.add("ko-panning");
      });
      vp.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) { vp.scrollLeft = sl - dx; vp.scrollTop = st - dy; }
      });
      const endPan = () => { dragging = false; vp.classList.remove("ko-panning"); };
      vp.addEventListener("pointerup", endPan);
      vp.addEventListener("pointercancel", endPan);
      vp.addEventListener("pointerleave", endPan);
      vp.addEventListener("click", (e) => {
        if (moved && !interactive(e.target)) { e.preventDefault(); e.stopPropagation(); moved = false; }
      }, true);
      vp.addEventListener("wheel", (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setKoZoom(koZoom + (e.deltaY < 0 ? 0.08 : -0.08));
      }, { passive: false });
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
      renderDashboardNextMatch();
      if (activeTeamDetailId) renderTeamDetailModal(activeTeamDetailId);
    });

    onSnapshot(collection(db, "playerMatchStats"), snap => {
      playerMatchStats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMatches();
      renderLiveMatches();
      renderDashboardNextMatch();
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

    onSnapshot(doc(db, "config", "competition"), (snap) => {
      if (snap.exists()) {
        const d = snap.data() || {};
        competitionConfig = {
          mode: d.mode === "group" ? "group" : "league",
          groupFormat: d.groupFormat || "normal-single",
          numGroups: parseInt(d.numGroups) || 2,
          advancePerGroup: parseInt(d.advancePerGroup) || 2,
          cupDirect: ["1", "2", "3", "all"].includes(String(d.cupDirect ?? "1")) ? String(d.cupDirect ?? "1") : "1",
          bestPos: [2, 3, 4, 5].includes(parseInt(d.bestPos)) ? parseInt(d.bestPos) : 3,
          bestPosCount: Math.max(0, parseInt(d.bestPosCount ?? d.thirdPlaceCount) || 0),
          mirrorTeam: d.mirrorTeam === true,
          updatedAtMs: d.updatedAtMs || 0
        };
        if (isAdmin) {
          const cm = document.getElementById("compMode"); if (cm) cm.value = competitionConfig.mode;
          const gc = document.getElementById("groupCount"); if (gc) gc.value = String(competitionConfig.numGroups);
          const gf = document.getElementById("groupFormat"); if (gf) gf.value = competitionConfig.groupFormat;
          const ap = document.getElementById("advancePerGroup"); if (ap) ap.value = String(competitionConfig.advancePerGroup);
          const cd = document.getElementById("cupDirect"); if (cd) cd.value = competitionConfig.cupDirect || "1";
          const bp = document.getElementById("bestPosRank"); if (bp) bp.value = String(competitionConfig.bestPos || 3);
          const bc = document.getElementById("bestPosCount"); if (bc) bc.value = String(competitionConfig.bestPosCount || 0);
          const mt = document.getElementById("compMirrorTeam"); if (mt) mt.checked = competitionConfig.mirrorTeam === true;
        }
      }
      syncCompetitionUI();
      renderStandings();
      renderMatches();
      renderTeams();
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
      const team1 = document.getElementById("team1")?.value || "";
      const team2 = document.getElementById("team2")?.value || "";
      const Matchweek = parseInt(document.getElementById("matchMatchweek")?.value) || 1;
      const date = document.getElementById("date")?.value || "TBD";
      const type = document.getElementById("matchType")?.value || "league";
      const group = (document.getElementById("matchGroup")?.value || "").toUpperCase();
      const leg = parseInt(document.getElementById("matchLeg")?.value) || 1;
      const mirrorTeam = document.getElementById("matchMirrorTeam")?.checked === true;
      if (!team1 || !team2) return alert("Pilih kedua tim!");
      if (team1 === team2) return alert("Same teams! Tampilan fixture tetap beda tim (mis. MU vs City) — mirror hanya soal tim yang dipakai main.");
      if (type === "group" && !group) return alert("Pilih grup (A/B/C…) untuk match grup!");
      const stage = type === "group" ? `Group ${group} MW ${Matchweek}` : type === "knockout" ? "Knockout" : `League MW ${Matchweek}`;
      const nextSlot = matches.reduce((mx, m) => Math.max(mx, parseInt(m.slot) || 0), 0) + 1;
      await addDoc(collection(db, "matches"), { team1, team2, Matchweek, date, s1: null, s2: null, p1: null, p2: null, y1: 0, y2: 0, live: false, type, group: type === "group" ? group : "", leg, stage, slot: nextSlot, mirrorTeam, useTeam: mirrorTeam ? team1 : "", createdAtMs: Date.now() });
    };

    const isScoreEmpty = (value) => value === null || value === undefined || value === "";

    const updateScore = async (id, val, side) => {
      if (!isAdmin) return;
      const key = String(side || "");
      if (!["s1", "s2", "p1", "p2"].includes(key)) return;
      const num = isScoreEmpty(val) || isNaN(parseInt(val)) ? null : parseInt(val);
      const payload = { [key]: num };
      const match = matches.find((item) => item.id === id);
      if ((match?.type || "") === "knockout" && (key === "s1" || key === "s2") && isScoreEmpty(num)) {
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
      const potEl = document.getElementById("modalTeamPot"); if (potEl) potEl.value = "3";
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
      const potEl = document.getElementById("modalTeamPot"); if (potEl) potEl.value = String(team.pot || "");
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
      const saved = await upsertTeamFromModalForImport();
      if (!saved) return alert("Nama team wajib diisi.");
      closeTeamEditorModal();
    };

    const isTeamEditorOpen = () => {
      const modal = document.getElementById("teamEditorModal");
      return modal && !modal.classList.contains("hidden");
    };

    const readTeamModalPayload = () => {
      const id = document.getElementById("modalTeamId")?.value || "";
      const name = document.getElementById("modalTeamName")?.value.trim();
      if (!name) return null;
      const managerName = document.getElementById("modalTeamManager")?.value.trim();
      const potRaw = parseInt(document.getElementById("modalTeamPot")?.value);
      return {
        id,
        name,
        logo: document.getElementById("modalTeamLogo")?.value.trim() || "",
        stars: parseFloat(document.getElementById("modalTeamStars")?.value) || 3,
        formation: document.getElementById("modalTeamFormation")?.value.trim() || "",
        managerName,
        managerPhoto: document.getElementById("modalTeamManagerPhoto")?.value.trim() || findManagerPhoto(managerName),
        pot: [1, 2, 3, 4, 5].includes(potRaw) ? potRaw : "",
        teamKey: slugKey(name)
      };
    };

    const upsertTeamFromModalForImport = async () => {
      if (!isTeamEditorOpen()) return null;
      const payload = readTeamModalPayload();
      if (!payload) return null;

      const teamPayload = {
        name: payload.name,
        logo: payload.logo,
        stars: payload.stars,
        formation: payload.formation,
        managerName: payload.managerName,
        managerPhoto: payload.managerPhoto,
        pot: payload.pot,
        teamKey: payload.teamKey,
        updatedAtMs: Date.now()
      };

      if (payload.id) {
        await updateDoc(doc(db, "teams", payload.id), teamPayload);
        return payload;
      }

      const created = await addDoc(collection(db, "teams"), {
        ...teamPayload,
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
      document.getElementById("modalTeamId").value = created.id;
      return { ...payload, id: created.id };
    };

    const applyImportTargetTeam = (players, targetTeam) => {
      if (!targetTeam?.name || !targetTeam?.teamKey) return players;
      return players.map((player) => {
        const playerKey = player.playerKey || slugKey(player.player) || String(player.playerId || "");
        return {
          ...player,
          team: targetTeam.name,
          teamKey: targetTeam.teamKey,
          docId: `${targetTeam.teamKey}_${playerKey}`
        };
      });
    };

    const readImportTeamFromJson = (parsed, players) => {
      const first = players[0] || {};
      const name = parsed?.team || first.team || "";
      const teamKey = parsed?.teamKey || first.teamKey || slugKey(name);
      const teamId = parsed?.teamId || first.teamId || null;
      if (!name || !teamKey) return null;
      return {
        name,
        teamKey,
        pesTeamId: teamId,
        teamId
      };
    };

    const findExistingTeamForImport = async (candidate) => {
      if (!candidate) return null;
      const snap = await getDocs(collection(db, "teams"));
      const existing = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      return existing.find((team) => (
        (candidate.pesTeamId && String(team.pesTeamId || "") === String(candidate.pesTeamId)) ||
        normalizeKey(team.teamKey) === normalizeKey(candidate.teamKey) ||
        normalizeKey(team.name) === normalizeKey(candidate.name)
      )) || null;
    };

    const resolveImportTargetTeam = async (parsed, players) => {
      const modalTarget = await upsertTeamFromModalForImport();
      if (modalTarget) return {
        ...modalTarget,
        source: "modal"
      };

      const jsonTarget = readImportTeamFromJson(parsed, players);
      const existing = await findExistingTeamForImport(jsonTarget);
      if (existing) {
        const finalTarget = {
          id: existing.id,
          name: existing.name || jsonTarget.name,
          teamKey: existing.teamKey || jsonTarget.teamKey,
          pesTeamId: existing.pesTeamId || jsonTarget.pesTeamId || null,
          source: "existing-team"
        };
        await updateDoc(doc(db, "teams", existing.id), {
          teamKey: finalTarget.teamKey,
          pesTeamId: finalTarget.pesTeamId,
          updatedAtMs: Date.now()
        });
        return finalTarget;
      }

      return jsonTarget ? {
        ...jsonTarget,
        source: "json"
      } : null;
    };

    const renderTeamDetailModal = (teamId) => {
      const team = teams.find((item) => item.id === teamId);
      const modal = document.getElementById("teamDetailModal");
      const body = document.getElementById("teamDetailBody");
      if (!team || !modal || !body) return;
      activeTeamDetailId = teamId;
      const players = playersForTeam(team);
      const managerPhoto = team.managerPhoto || findManagerPhoto(team.managerName) || placeholderImage;
      const autoLineup = autoLineupForFormation(team, players);
      const tacticLayout = autoTacticLayout(team, players);
      const starters = autoLineup.lineup;
      const tacticPlayer = (player, index) => {
        const auto = tacticLayout.get(player.id) || { x: 50, y: 50 };
        const x = Number.isFinite(parseFloat(player.tacticX)) ? parseFloat(player.tacticX) : auto.x;
        const y = Number.isFinite(parseFloat(player.tacticY)) ? parseFloat(player.tacticY) : auto.y;
        const performance = playerPerformanceSummary(player);
        return `
          <div data-tactic-player="${player.id}" data-x="${x}" data-y="${y}" class="absolute -translate-x-1/2 -translate-y-1/2 text-center group transition-[left,top,transform,filter] duration-200 ease-out will-change-transform ${isAdmin ? "cursor-move" : ""}" style="left:${x}%; top:${y}%;">
            <img src="${player.faceUrl || player.image || player.facePath || placeholderImage}" class="mx-auto h-11 w-11 rounded-full object-cover border-2 border-primary shadow-xl transition-all duration-200">
            <div class="mt-1 rounded-md bg-black/75 px-2 py-1 text-[9px] font-black leading-tight text-white shadow-lg">
              <span class="text-primary">${player.position || positionGroup(player.position)}</span> ${player.number || ""}
              <br><span class="font-bold">${String(player.player || "").split(" ").slice(-1)[0]}</span>
              ${performance ? `<br><span class="text-secondary">${performance}</span>` : ""}
            </div>
          </div>
        `;
      };
      const tacticBoard = `
        <div class="tactic-board relative h-[520px] overflow-hidden rounded-[2rem] border border-primary/20 bg-surface-container-highest shadow-2xl transition-[box-shadow,border-color,transform] duration-200">
          <div class="absolute inset-0 opacity-25" style="background-image:linear-gradient(90deg,rgba(142,255,113,.24) 1px,transparent 1px),linear-gradient(rgba(255,215,9,.18) 1px,transparent 1px);background-size:20% 16.66%;"></div>
          <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(142,255,113,.14),transparent_42%),linear-gradient(135deg,rgba(255,215,9,.08),transparent_55%)]"></div>
          <div class="absolute inset-x-[18%] top-0 h-[16%] border-x-2 border-b-2 border-primary/30"></div>
          <div class="absolute inset-x-[18%] bottom-0 h-[16%] border-x-2 border-t-2 border-primary/30"></div>
          <div class="absolute left-0 right-0 top-1/2 border-t-2 border-secondary/30"></div>
          <div class="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-secondary/30"></div>
          ${starters.map(tacticPlayer).join("")}
          <div class="absolute bottom-3 left-4 rounded-lg bg-black/70 px-3 py-2 font-headline text-xl font-black text-white">${team.formation || "Custom"}</div>
        </div>
      `;
      const playerRow = (player) => {
        const performance = playerPerformanceSummary(player);
        return `
        <div ${isAdmin ? `draggable="true" data-roster-list-player="${player.id}"` : ""} class="grid grid-cols-[38px_1fr_auto] items-center gap-3 rounded-xl bg-surface-container/70 p-2 ${isAdmin ? "cursor-grab" : ""}">
          <img src="${player.faceUrl || player.image || player.facePath || placeholderImage}" class="h-9 w-9 rounded-lg object-cover">
          <div class="min-w-0">
            <p class="truncate text-sm font-bold text-white">${player.number ? `${player.number}. ` : ""}${player.player}</p>
            <p class="text-[9px] uppercase tracking-widest text-on-surface-variant">${player.position || "POS"} ${player.isSubstitute ? "- SUB" : ""}${performance ? ` - ${performance}` : ""}</p>
          </div>
          ${isAdmin ? `<button class="admin-btn !py-1 !px-2 text-[10px]" data-action="editRosterPlayer" data-id="${player.id}">Edit</button>` : ""}
        </div>
      `;
      };
      const renderList = (label, items, kind) => `
        <div data-roster-drop-zone="${kind}" class="rounded-2xl border border-outline-variant/10 bg-black/20 p-4">
          <p class="mb-3 text-[10px] uppercase tracking-widest text-primary font-black">${label}</p>
          <div class="space-y-2 max-h-[360px] overflow-y-auto custom-scroll-thin">
            ${items.map(playerRow).join("") || `<p class="text-xs italic text-on-surface-variant">Kosong</p>`}
          </div>
        </div>
      `;
      const starterIds = new Set(autoLineup.lineup.map((player) => player.id));
      const starterList = sortByRoster(autoLineup.lineup);
      const subList = sortByRoster(players.filter((player) => !starterIds.has(player.id)));

      body.innerHTML = `
        <div class="flex flex-col md:flex-row md:items-center gap-5">
          <img src="${team.logo || placeholderImage}" class="h-20 w-20 rounded-2xl bg-surface-container-highest p-3 object-contain">
          <div class="flex-1">
            <p class="text-[10px] uppercase tracking-widest text-primary font-black">${team.pesTeamId ? `PES ID ${team.pesTeamId}` : team.teamKey || slugKey(team.name)}</p>
            <h2 class="font-headline text-4xl font-black uppercase text-white">${team.name}</h2>
            <p class="text-sm text-on-surface-variant">${players.length} pemain roster${team.formation ? ` - ${team.formation}` : ""}</p>
          </div>
          ${isAdmin ? `<button class="admin-btn" data-action="resetTeamTactic" data-id="${team.id}">Reset Auto</button>` : ""}
          <div class="rounded-2xl border border-secondary/20 bg-secondary/10 p-3 flex items-center gap-3 min-w-[220px]">
            <img src="${managerPhoto}" class="h-12 w-12 rounded-xl object-cover">
            <div>
              <p class="text-[9px] uppercase tracking-widest text-secondary font-black">Manager</p>
              <p class="font-bold text-white">${team.managerName || "Belum diisi"}</p>
            </div>
          </div>
        </div>
        <div class="mt-6 grid grid-cols-1 xl:grid-cols-[0.62fr_1.25fr_0.62fr] gap-6 items-start">
          ${renderList("Starting XI", starterList, "starter")}
          ${tacticBoard}
          ${renderList("Subs", subList, "sub")}
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
      const tacticX = prompt("Grid X 0-100 (kiri ke kanan):", player.tacticX ?? "");
      if (tacticX === null) return;
      const tacticY = prompt("Grid Y 0-100 (atas ke bawah):", player.tacticY ?? "");
      if (tacticY === null) return;
      const isSubstitute = confirm("Jadikan substitute? OK = substitute, Cancel = starter.");
      await updateDoc(doc(db, "players", player.id), {
        position: position.trim(),
        number: parseInt(numberText, 10) || null,
        tacticX: tacticX === "" ? null : Math.max(0, Math.min(100, parseFloat(tacticX) || 0)),
        tacticY: tacticY === "" ? null : Math.max(0, Math.min(100, parseFloat(tacticY) || 0)),
        isSubstitute,
        updatedAtMs: Date.now()
      });
    };

    const resetTeamTactic = async (teamId) => {
      if (!isAdmin) return;
      const team = teams.find((item) => item.id === teamId);
      if (!team) return;
      if (!confirm(`Reset posisi tactic ${team.name} ke otomatis?`)) return;
      const players = playersForTeam(team);
      const ops = players.map((player) => (batch) => batch.update(doc(db, "players", player.id), {
        tacticX: null,
        tacticY: null,
        isSubstitute: false,
        updatedAtMs: Date.now()
      }));
      await commitBatchChunks(ops);
      renderTeamDetailModal(teamId);
    };

    const moveRosterPlayerBetweenLists = async (playerId, targetKind, replacedPlayerId = "", replacementPoint = null) => {
      if (!isAdmin || !playerId || !targetKind) return;
      const now = Date.now();
      const ops = [];
      const replacementX = Number.isFinite(replacementPoint?.x) ? replacementPoint.x : null;
      const replacementY = Number.isFinite(replacementPoint?.y) ? replacementPoint.y : null;

      if (targetKind === "sub") {
        ops.push((batch) => batch.update(doc(db, "players", playerId), {
          isSubstitute: true,
          tacticX: null,
          tacticY: null,
          updatedAtMs: now
        }));
      } else {
        ops.push((batch) => batch.update(doc(db, "players", playerId), {
          isSubstitute: false,
          tacticX: replacementX,
          tacticY: replacementY,
          updatedAtMs: now
        }));

        if (replacedPlayerId && replacedPlayerId !== playerId) {
          ops.push((batch) => batch.update(doc(db, "players", replacedPlayerId), {
            isSubstitute: true,
            tacticX: null,
            tacticY: null,
            updatedAtMs: now
          }));
        }
      }

      await commitBatchChunks(ops);
      if (activeTeamDetailId) renderTeamDetailModal(activeTeamDetailId);
    };

    const renderTeams = () => {
      let html = "",
        opts = "",
        filterOpts = '<option value="">All Teams</option>';

      teams.forEach(t => {
        const rosterCount = playersForTeam(t).length;
        const managerPhoto = t.managerPhoto || findManagerPhoto(t.managerName) || placeholderImage;
        const groupBadge = (t.group || "").toUpperCase() ? `<span class="ml-2 rounded-full bg-tertiary/10 border border-tertiary/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-tertiary">Grp ${String(t.group).toUpperCase()}</span>` : "";
        const potBadge = [1, 2, 3, 4, 5].includes(parseInt(t.pot)) ? `<span class="ml-2 rounded-full bg-secondary/10 border border-secondary/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-secondary">Pot ${t.pot}</span>` : "";
        html += `
                <li class="bg-surface-container-high rounded-[2rem] p-6 border border-outline-variant/10 shadow-lg group hover:-translate-y-1 transition-transform cursor-pointer" data-action="openTeamDetail" data-id="${t.id}">
                    <div class="flex items-center justify-between gap-4">
                      <div class="flex items-center gap-4 min-w-0">
                          <img src="${t.logo || placeholderImage}" class="w-14 h-14 object-contain bg-surface-container-highest p-2 rounded-[1rem] group-hover:scale-110 transition-transform">
                          <div class="min-w-0">
                            <span class="block truncate font-headline font-bold text-xl">${t.name}${groupBadge}${potBadge}</span>
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
        opts += `<option value="${t.name}">${t.name}${t.group ? ` (Grp ${String(t.group).toUpperCase()})` : ""}${t.pot ? ` [P${t.pot}]` : ""}</option>`;
        filterOpts += `<option value="${t.name.toLowerCase()}">${t.name}</option>`;
      });

      document.getElementById("teamList").innerHTML = html;
      document.getElementById("team1").innerHTML = opts;
      document.getElementById("team2").innerHTML = opts;
      document.getElementById("playerTeam").innerHTML = opts;
      const f1El = document.getElementById("filterTeam1");
      const f2El = document.getElementById("filterTeam2");
      if (f1El) f1El.innerHTML = filterOpts;
      if (f2El) f2El.innerHTML = '<option value="">Vs Team</option>' + teams.map((t) => `<option value="${t.name.toLowerCase()}">${t.name}</option>`).join("");
      renderRosterPlayerOptions();
    };

    const renderMatches = () => {
      const container = document.getElementById("matchContainer");
      if (!container) return;

      const f1 = (document.getElementById("filterTeam1")?.value || "").toLowerCase();
      const f2 = (document.getElementById("filterTeam2")?.value || "").toLowerCase();
      const fG = (document.getElementById("filterGroup")?.value || "").toUpperCase();

      const filtered = matches.filter(m => {
        const t1 = (m.team1 || "").toLowerCase(),
          t2 = (m.team2 || "").toLowerCase();
        if (fG && matchGroup(m) !== fG && (m.type || "") === "group") return false;
        if (fG && (m.type || "league") === "league") {
          // Di mode grup, sembunyikan liga murni saat filter grup aktif
          if (hasGroupStage()) return false;
        }
        if (!f1 && !f2) return true;
        if (f1 && !f2) return t1 === f1 || t2 === f1;
        if (!f1 && f2) return t1 === f2 || t2 === f2;
        return (t1 === f1 && t2 === f2) || (t1 === f2 && t2 === f1);
      }).sort((a, b) => (b.live - a.live) || getMW(a) - getMW(b) || ((parseInt(a.slot) || 0) - (parseInt(b.slot) || 0)));

      const grouped = filtered.reduce((acc, m) => {
        const key = `${m.type || "league"}|${matchGroup(m)}|${getMW(m)}`;
        acc[key] = acc[key] || [];
        acc[key].push(m);
        return acc;
      }, {});

      const sortKeys = Object.keys(grouped).sort((a, b) => {
        const [ta, ga, mwa] = a.split("|");
        const [tb, gb, mwb] = b.split("|");
        const order = { knockout: 0, group: 1, league: 2 };
        if ((order[ta] ?? 9) !== (order[tb] ?? 9)) return (order[ta] ?? 9) - (order[tb] ?? 9);
        if (ga !== gb) return ga.localeCompare(gb);
        return parseInt(mwa) - parseInt(mwb);
      });

      container.innerHTML = sortKeys.map(key => {
        const [ktype, kgroup, kmw] = key.split("|");
        const list = grouped[key];
        const title = ktype === "knockout"
          ? (list[0]?.knockoutRoundName || "Knockout Schedule")
          : ktype === "group" ? `Group ${kgroup} • Matchday ${kmw}` : `Matchday ${kmw}`;
        return `
                <div class="flex items-center gap-4 mb-6 mt-12 cursor-pointer group" data-action="toggleFolder" data-mw="${key}">
                    <div class="h-px flex-1 bg-outline-variant/20"></div>
                    <h3 class="font-headline text-2xl font-bold uppercase tracking-widest text-primary italic pointer-events-none">${title} <span class="text-sm ml-2 group-hover:text-secondary inline-block transition-transform ${collapsed[key] ? '-rotate-90' : 'rotate-0'}">▼</span></h3>
                    <div class="h-px flex-1 bg-outline-variant/20"></div>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mw-row" style="${collapsed[key] ? 'display:none' : ''}">
                    ${list.map(m => {
                        const t1 = resolveTeam(m.team1), t2 = resolveTeam(m.team2), isFinished = hasFinalScore(m) && !m.live;
                        const liveClock = formatLiveClock(m);
                        const penaltyScore = formatPenaltyScore(m);
                        const adminKoStatus = renderKnockoutAdminStatus(m);
                        const koGameBadge = (m.type || "") === "knockout" && (m.knockoutGameLabel || m.knockoutGame) ? `<span class="px-2 py-1 bg-secondary/10 text-secondary font-bold text-[10px] uppercase tracking-widest rounded-full border border-secondary/20 w-max">${m.knockoutGameLabel || `Game ${m.knockoutGame}`}${m.knockoutTieFormat && m.knockoutTieFormat !== "single" ? ` • ${m.knockoutTieFormat.toUpperCase()}` : ""}</span>` : "";
                        const mirrorBadge = m.mirrorTeam ? `<span class="px-2 py-1 bg-tertiary/10 text-tertiary font-bold text-[10px] uppercase tracking-widest rounded-full border border-tertiary/20 w-max">Mirror: pakai ${m.useTeam || m.team1}</span>` : "";
                        const groupMeta = (m.type || "") === "group" && matchGroup(m) ? `<span class="px-2 py-1 bg-tertiary/10 text-tertiary font-bold text-[10px] uppercase tracking-widest rounded-full border border-tertiary/20 w-max">Group ${matchGroup(m)}${m.leg === 2 || m.leg === "2" ? " • Leg 2" : ""}</span>` : ((m.leg === 2 || m.leg === "2") && (m.type || "league") === "league" ? `<span class="px-2 py-1 bg-white/5 text-on-surface-variant font-bold text-[10px] uppercase tracking-widest rounded-full border border-white/10 w-max">Leg 2</span>` : "");
                        const badge = m.live ? `<span class="px-3 py-1 bg-error/10 text-error font-bold text-[10px] uppercase tracking-widest rounded-full border border-error/20 flex items-center gap-1 w-max"><span class="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span> LIVE</span>`
                            : isFinished ? `<span class="px-3 py-1 bg-outline-variant/20 text-on-surface-variant font-bold text-[10px] uppercase tracking-widest rounded-full w-max">Full Time</span>`
                            : m.type === "knockout" ? `<span class="px-3 py-1 bg-secondary/10 text-secondary font-bold text-[10px] uppercase tracking-widest rounded-full border border-secondary/20 w-max">${m.knockoutRoundName || "Knockout"}</span>`
                            : `<span class="px-3 py-1 bg-primary/10 text-primary font-bold text-[10px] uppercase tracking-widest rounded-full border border-primary/20 w-max">Upcoming</span>`;

                        return `
                        <div class="group relative bg-surface-container-high rounded-[2rem] p-6 transition-all hover:bg-surface-container-highest ${m.live ? 'ring-1 ring-error/50 shadow-[0_0_20px_rgba(255,115,81,0.1)]' : 'border border-outline-variant/10 shadow-xl'}">
                            <div class="flex justify-between items-start mb-6">
                                <div class="flex flex-wrap gap-2">${badge}${groupMeta}${koGameBadge}${mirrorBadge}</div>
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
                                        ${(m.type || "") === "knockout" ? `
                                        <div class="mt-2 flex items-center justify-center gap-2">
                                            <span class="text-[8px] uppercase tracking-widest text-secondary font-black">Pens</span>
                                            <input type="number" class="w-10 bg-black/40 text-center text-sm font-black text-secondary p-1 rounded-lg border border-secondary/20" value="${m.p1 ?? ""}" data-action="updateScore" data-side="p1" data-id="${m.id}">
                                            <span class="text-secondary font-black">-</span>
                                            <input type="number" class="w-10 bg-black/40 text-center text-sm font-black text-secondary p-1 rounded-lg border border-secondary/20" value="${m.p2 ?? ""}" data-action="updateScore" data-side="p2" data-id="${m.id}">
                                        </div>` : ""}
                                        ${m.mirrorTeam ? `<p class="mt-2 text-[9px] uppercase tracking-widest text-tertiary font-black">Kedua player pakai ${m.useTeam || m.team1}</p>` : ""}
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
                </div>`;
      }).join("");
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
    
    const isLeagueMatch = (match) => (match.type || "league") !== "knockout" && match.team1 && match.team2;
    const isGroupMatch = (match) => (match.type || "") === "group" && match.team1 && match.team2;
    const matchGroup = (match) => (match.group || "").toString().trim().toUpperCase();
    const hasGroupStage = () => matches.some(isGroupMatch) || competitionConfig.mode === "group";

    const hasMatchScore = (match) => (
      match.s1 !== null &&
      match.s1 !== undefined &&
      match.s1 !== "" &&
      match.s2 !== null &&
      match.s2 !== undefined &&
      match.s2 !== "" &&
      Number.isFinite(Number(match.s1)) &&
      Number.isFinite(Number(match.s2))
    );

    const calculateStandings = (groupFilter = "") => {
      let table = teams.reduce((acc, t) => ({ ...acc, [t.name]: { team: t.name, group: t.group || "", p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 } }), {});
      const gf = (groupFilter || "").toString().trim().toUpperCase();
      matches.forEach(m => {
        if (!isLeagueMatch(m) || !hasMatchScore(m)) return;
        // Jika filter grup aktif: hanya hitung match grup tersebut.
        // Match liga (tanpa grup) ikut di semua grup? Tidak — hanya grup yang sama atau liga murni.
        if (gf) {
          if ((m.type || "") === "group" && matchGroup(m) !== gf) return;
          if ((m.type || "league") === "league") return; // liga murni tidak masuk klasemen grup
        } else {
          // Tanpa filter: jika ada fase grup, klasemen keseluruhan = gabungan grup (untuk kompatibilitas lama)
        }
        const h = table[m.team1],
          a = table[m.team2];
        if (!h || !a) return;
        const score1 = Number(m.s1);
        const score2 = Number(m.s2);
        h.p++;
        a.p++;
        h.gf += score1;
        h.ga += score2;
        a.gf += score2;
        a.ga += score1;
        if (score1 > score2) {
          h.w++;
          a.l++;
          h.pts += 3;
        } else if (score1 < score2) {
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
      let rows = Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
      if (gf) {
        const inGroup = new Set(teams.filter((t) => (t.group || "").toUpperCase() === gf).map((t) => t.name));
        // Jika team.group belum terset (data lama), fallback: tim yang pernah main di grup tsb
        if (!inGroup.size) {
          matches.filter((m) => (m.type || "") === "group" && matchGroup(m) === gf).forEach((m) => { inGroup.add(m.team1); inGroup.add(m.team2); });
        }
        if (inGroup.size) rows = rows.filter((r) => inGroup.has(r.team));
      }
      return rows;
    };

    const listGroupLetters = () => {
      const fromMatches = [...new Set(matches.filter(isGroupMatch).map(matchGroup).filter(Boolean))].sort();
      const fromTeams = [...new Set(teams.map((t) => (t.group || "").toUpperCase()).filter(Boolean))].sort();
      const merged = [...new Set([...fromMatches, ...fromTeams])].sort();
      if (merged.length) return merged;
      if (competitionConfig.mode === "group") return Array.from({ length: competitionConfig.numGroups || 2 }, (_, i) => groupLetter(i));
      return [];
    };

    const getQualifiedFromGroups = (advancePerGroup, bestPos = 3, bestPosCount = 0) => {
      const letters = listGroupLetters();
      const qualified = [];
      letters.forEach((letter) => {
        calculateStandings(letter).slice(0, Math.max(1, advancePerGroup)).forEach((row) => qualified.push(row.team));
      });
      const bestRanked = getBestRankedAtPosition(bestPos).slice(0, Math.max(0, bestPosCount)).map((r) => r.team);
      bestRanked.forEach((t) => { if (!qualified.includes(t)) qualified.push(t); });
      return { letters, qualified, bestRanked };
    };

    // Peringkat terbaik lintas grup di posisi berapa pun (2/runner-up, 3, 4, 5) —
    // di-ranking Pts → GD → GF. Dipakai untuk slot knockout/lower bracket.
    const getBestRankedAtPosition = (pos = 3) => {
      const idx = Math.max(1, parseInt(pos) || 3) - 1;
      const letters = listGroupLetters();
      const ranked = [];
      letters.forEach((letter) => {
        const rows = calculateStandings(letter);
        if (rows.length > idx) ranked.push({ ...rows[idx], group: letter });
      });
      return ranked.sort((a, b) => b.pts - a.pts || ((b.gf - b.ga) - (a.gf - a.ga)) || b.gf - a.gf || String(a.team).localeCompare(String(b.team)));
    };

    const getLockedStandingsZones = (data, cCut, pCut, hCut) => {
      const remainingGames = new Map(data.map((row) => [row.team, 0]));
      const leagueMatches = matches.filter(isLeagueMatch);
      leagueMatches
        .filter((match) => !hasMatchScore(match))
        .forEach((match) => {
          remainingGames.set(match.team1, (remainingGames.get(match.team1) || 0) + 1);
          remainingGames.set(match.team2, (remainingGames.get(match.team2) || 0) + 1);
        });

      const maxPoints = new Map(data.map((row) => [
        row.team,
        row.pts + ((remainingGames.get(row.team) || 0) * 3)
      ]));
      const leagueComplete = leagueMatches.length > 0 && leagueMatches.every(hasMatchScore);
      const zones = new Map();
      const teamCount = data.length;
      const safeCupCut = Math.min(Math.max(cCut, 0), teamCount);
      const safePlayoffCut = Math.min(Math.max(pCut, safeCupCut), teamCount);
      const safeHinaCut = Math.min(Math.max(hCut, 0), Math.max(teamCount - 1, 0));

      const lockedInTop = (row, cutoff) => {
        if (cutoff <= 0 || cutoff >= teamCount) return cutoff >= teamCount;
        const outsiderMax = Math.max(...data.slice(cutoff).map((other) => maxPoints.get(other.team) || other.pts));
        return row.pts > outsiderMax;
      };

      const lockedInBottom = (row) => {
        if (safeHinaCut <= 0 || safeHinaCut >= teamCount) return false;
        const lastSafeTeam = data[teamCount - safeHinaCut - 1];
        if (!lastSafeTeam) return false;
        return (maxPoints.get(row.team) || row.pts) < lastSafeTeam.pts;
      };

      const lockedOutOfTop = (row, cutoff) => {
        if (cutoff <= 0) return true;
        if (cutoff >= teamCount) return false;
        const boundaryTeam = data[cutoff - 1];
        if (!boundaryTeam) return false;
        return (maxPoints.get(row.team) || row.pts) < boundaryTeam.pts;
      };

      data.forEach((row, index) => {
        const rank = index + 1;
        if (leagueComplete) {
          if (rank === 1) zones.set(row.team, "champion");
          else if (rank <= safeCupCut) zones.set(row.team, "cup");
          else if (rank <= safePlayoffCut) zones.set(row.team, "playoff");
          else if (rank > teamCount - safeHinaCut) zones.set(row.team, "hina");
        } else if (rank <= safeCupCut && lockedInTop(row, safeCupCut)) {
          zones.set(row.team, "cup");
        } else if (rank > safeCupCut && rank <= safePlayoffCut && lockedInTop(row, safePlayoffCut) && lockedOutOfTop(row, safeCupCut)) {
          zones.set(row.team, "playoff");
        } else if (rank > teamCount - safeHinaCut && lockedInBottom(row)) {
          zones.set(row.team, "hina");
        }
      });

      return zones;
    };

    const isTeamLive = (teamName) => matches.some(m => m.live && (m.team1 === teamName || m.team2 === teamName));

    const renderStandings = () => {
  // Badge kompetisi diurus syncCompetitionUI (sumber tunggal) agar tidak tertimpa.
  const groupWrap = document.getElementById("groupStandingsWrap");
  const leagueWrap = document.getElementById("leagueStandingsWrap");
  const standingsTable = document.getElementById("standingsTable");
  if (!standingsTable) return;

  const rowHtml = (t, i, lockedZones) => {
    const rank = i + 1;
    const textClass = i === 0 ? "text-primary" : i === 1 ? "text-on-surface" : i === 2 ? "text-secondary" : "text-on-surface-variant";
    let bgGradient = "";
    let borderClass = "";
    let zoneBadge = "";
    const zone = lockedZones.get(t.team);
    const trophyUrl = (trophyCabinetSettings.leagueImage || "").trim();
    if (zone === "champion") {
      bgGradient = "bg-gradient-to-r from-[#f6c453]/15 to-transparent";
      borderClass = "border-l-4 border-[#f6c453]";
      zoneBadge = `${trophyUrl ? `<img src="${trophyUrl}" class="hidden md:inline-flex h-7 w-7 object-contain" alt="League Trophy">` : ""}<span class="hidden md:inline-flex rounded-full bg-[#f6c453]/15 border border-[#f6c453]/35 px-2 py-1 text-[8px] uppercase tracking-widest text-[#f6c453] font-black">Champions</span>`;
    } else if (zone === "cup") {
      bgGradient = "bg-gradient-to-r from-primary/10 to-transparent";
      borderClass = "border-l-4 border-primary";
      zoneBadge = `<span class="hidden md:inline-flex rounded-full bg-primary/10 border border-primary/20 px-2 py-1 text-[8px] uppercase tracking-widest text-primary font-black">Cup</span>`;
    } else if (zone === "playoff") {
      bgGradient = "bg-gradient-to-r from-secondary/10 to-transparent";
      borderClass = "border-l-4 border-secondary";
      zoneBadge = `<span class="hidden md:inline-flex rounded-full bg-secondary/10 border border-secondary/20 px-2 py-1 text-[8px] uppercase tracking-widest text-secondary font-black">Play Off</span>`;
    } else if (zone === "hina") {
      bgGradient = "bg-error/10";
      borderClass = "border-l-4 border-error";
      zoneBadge = `<span class="hidden md:inline-flex rounded-full bg-error/10 border border-error/20 px-2 py-1 text-[8px] uppercase tracking-widest text-error font-black">Hina</span>`;
    }
    return `<tr class="group hover:bg-surface-container-highest transition-colors ${bgGradient} ${borderClass}">
        <td class="py-5 px-6 font-headline font-black text-lg ${textClass}">${rank.toString().padStart(2, '0')}</td>
        <td class="py-5 px-6"><div class="flex items-center gap-4"><div class="w-10 h-10 rounded-[0.8rem] bg-surface-container-highest flex items-center justify-center p-1 border border-outline-variant/10 relative">${isTeamLive(t.team) ? `<div class="absolute -top-1 -right-1"><span class="liveDot"></span></div>` : ""}<img src="${resolveTeam(t.team).logo}" class="w-full h-full object-contain"></div><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><span class="font-headline font-bold text-on-surface whitespace-nowrap">${t.team}</span>${zoneBadge}</div>${renderFormGuide(t.team)}</div></div></td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.p}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.w}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.d}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.l}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.gf}</td>
        <td class="py-5 px-4 text-center text-on-surface-variant font-medium">${t.ga}</td>
        <td class="py-5 px-4 text-center font-bold ${t.gf-t.ga > 0 ? 'text-primary' : t.gf-t.ga < 0 ? 'text-error' : 'text-on-surface-variant'}">${t.gf-t.ga > 0 ? '+'+(t.gf-t.ga) : t.gf-t.ga}</td>
        <td class="py-5 px-6 text-center font-black text-xl ${textClass}">${t.pts}</td></tr>`;
  };

  if (hasGroupStage()) {
    const letters = listGroupLetters();
    const adv = Math.max(1, parseInt(competitionConfig.advancePerGroup) || 2);
    // Cup vs Playoff ikut settingan (bukan fix rank 1): cupTop teratas = Cup, sisanya = Playoff.
    const cupTop = cupDirectCount(adv);
    const bestPos = [2, 3, 4, 5].includes(parseInt(competitionConfig.bestPos)) ? parseInt(competitionConfig.bestPos) : 3;
    const bestN = Math.max(0, parseInt(competitionConfig.bestPosCount) || 0);
    const bestRanked = getBestRankedAtPosition(bestPos);
    const bestSet = new Set(bestRanked.slice(0, bestN).map((r) => r.team));
    const headHtml = `<thead><tr class="bg-surface-container-highest/50 border-b border-outline-variant/10">
      <th class="py-4 px-4 text-left text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant">Rank</th>
      <th class="py-4 px-4 text-left text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant">Club</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Main (Matches Played)">MP</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Menang (Wins)">W</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Seri (Draws)">D</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Kalah (Losses)">L</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Gol Memasukkan (Goals For)">GF</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Gol Kemasukan (Goals Against)">GA</th>
      <th class="py-4 px-2 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-on-surface-variant" title="Selisih Gol (Goal Difference)">GD</th>
      <th class="py-4 px-4 text-center text-[10px] font-label font-black uppercase tracking-[0.2em] text-primary" title="Poin (Points)">Pts</th>
    </tr></thead>`;
    const legendHtml = `<div class="px-6 py-4 bg-surface-container-lowest/50 border-t border-outline-variant/10 flex flex-wrap gap-4 items-center">
      <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-primary"></div><span class="text-[10px] uppercase tracking-widest font-label font-bold text-on-surface-variant">Cup (Top ${cupTop})</span></div>
      <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-secondary"></div><span class="text-[10px] uppercase tracking-widest font-label font-bold text-on-surface-variant">Play-off${bestN > 0 ? ` / Best #${bestPos}` : ""}</span></div>
      <span class="text-[10px] uppercase tracking-widest font-label text-on-surface-variant/70">Poin 3/M • Urutan: Pts → GD → GF</span>
    </div>`;
    if (leagueWrap) leagueWrap.style.display = "none";
    if (groupWrap) {
      groupWrap.style.display = "grid";
      const groupsHtml = letters.map((letter) => {
        const data = calculateStandings(letter);
        return `<section class="bg-surface-container-high rounded-[2rem] overflow-hidden shadow-2xl border border-outline-variant/10">
          <div class="px-6 py-5 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-highest/50">
            <div><h3 class="font-headline font-black uppercase italic text-xl">Group ${letter}</h3>
            <p class="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mt-1">${data.length} tim • Cup: rank 1–${cupTop}${adv > cupTop ? ` • Play-off: rank ${cupTop + 1}–${adv}` : " (semua Cup)"}${bestN > 0 ? ` • Best ${bestN}x #${bestPos} lanjut` : ""}</p></div>
            <span class="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary">Top ${adv} lolos</span>
          </div>
          <div class="overflow-x-auto"><table class="w-full border-collapse min-w-[680px]">${headHtml}<tbody class="divide-y divide-outline-variant/5 font-label">
            ${data.map((t, i) => {
              const isQ = i < adv;
              const isBestPos = !isQ && i === bestPos - 1 && bestSet.has(t.team);
              const zones = new Map();
              if (isQ) zones.set(t.team, i < cupTop ? "cup" : "playoff");
              if (isBestPos) zones.set(t.team, "playoff");
              return rowHtml(t, i, zones);
            }).join("") || `<tr><td colspan="10" class="p-6 text-white/30 italic text-sm">Belum ada data grup ${letter}.</td></tr>`}
          </tbody></table></div>${legendHtml}</section>`;
      }).join("");
      const thirdHtml = bestN > 0 ? `<section class="bg-surface-container-high rounded-[2rem] overflow-hidden shadow-2xl border border-secondary/20 xl:col-span-2">
          <div class="px-6 py-5 border-b border-outline-variant/10 flex items-center justify-between bg-secondary/5">
            <h3 class="font-headline font-black uppercase italic text-xl">Best #${bestPos} Place</h3>
            <span class="rounded-full bg-secondary/10 border border-secondary/20 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-secondary">Best ${bestN} lolos ke knockout</span>
          </div>
          <div class="p-4 space-y-2">
            ${bestRanked.map((t, i) => `
              <div class="flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${i < bestN ? "bg-secondary/10 border border-secondary/20" : "bg-black/20 border border-white/5 opacity-60"}">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                  <span class="font-headline font-black ${i < bestN ? "text-secondary" : "text-on-surface-variant"}">${i + 1}</span>
                  <img src="${resolveTeam(t.team).logo}" class="w-8 h-8 object-contain bg-surface-container-highest p-1 rounded-lg">
                  <div class="min-w-0"><p class="truncate font-bold text-white">${t.team}</p><p class="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">Grup ${t.group} • MP ${t.p} • W${t.w}-D${t.d}-L${t.l} • GF${t.gf}-GA${t.ga}</p></div>
                </div>
                <div class="text-right shrink-0">
                  <p class="font-headline font-black text-xl ${i < bestN ? "text-secondary" : "text-on-surface-variant"}">${t.pts}<span class="text-[10px] font-bold"> pts</span></p>
                  <p class="text-[9px] uppercase tracking-widest ${i < bestN ? "text-secondary" : "text-on-surface-variant"} font-bold">GD ${t.gf - t.ga > 0 ? "+" : ""}${t.gf - t.ga} • <span class="${i < bestN ? "" : ""}">${i < bestN ? "Lolos" : "Out"}</span></p>
                </div>
              </div>`).join("") || `<p class="p-4 text-white/30 italic text-sm">Belum ada peringkat 3.</p>`}
          </div></section>` : "";
      groupWrap.innerHTML = (groupsHtml + thirdHtml) || `<p class="text-white/30 italic">Belum ada grup.</p>`;
    }
    // Tetap isi tabel liga tersembunyi untuk kompatibilitas dashboard
    const data = calculateStandings();
    const cCut = Math.max(parseInt(championsCutoff) || 4, 0);
    const pCut = Math.max(parseInt(playoffCutoff) || 6, cCut);
    const hCut = Math.max(parseInt(relegationCutoff) || 1, 0);
    standingsTable.innerHTML = data.map((t, i) => rowHtml(t, i, getLockedStandingsZones(data, cCut, pCut, hCut))).join("");
    return;
  }

  if (groupWrap) groupWrap.style.display = "none";
  if (leagueWrap) leagueWrap.style.display = "block";
  const data = calculateStandings();
  const cCut = Math.max(parseInt(championsCutoff) || 4, 0);
  const pCut = Math.max(parseInt(playoffCutoff) || 6, cCut);
  const hCut = Math.max(parseInt(relegationCutoff) || 1, 0);
  const lockedZones = getLockedStandingsZones(data, cCut, pCut, hCut);
  standingsTable.innerHTML = data.map((t, i) => rowHtml(t, i, lockedZones)).join("");
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
      const liveClock = formatLiveClock(m);

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
                    <span class="font-label text-on-surface-variant font-bold mt-2 uppercase text-xs">${m.live && liveClock ? liveClock : safe(m.date, '90\' MINUTES')}</span>
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
        if (isAdmin) {
          const kt = document.getElementById("koTieFormat"); if (kt) kt.value = knockout.tieFormat || "single";
          const kb = document.getElementById("koByeFill"); if (kb) kb.checked = (knockout.byeFill || "1") !== "0";
          const cb = document.getElementById("compByeFill"); if (cb) cb.checked = (knockout.byeFill || "1") !== "0";
          const km = document.getElementById("koMirrorTeam"); if (km) km.checked = knockout.mirrorTeam === true;
        }
        renderKnockout();
        ensureKnockoutScheduleMatches();
    } else {
  knockout = { format: "single", tieFormat: "single", byeFill: "1", mirrorTeam: false, bracketSize: 0, qualifierZone: "", qualifiedCount: 0, rounds: [] };
        renderKnockout();
    }
});

    const renderLiveMatches = () => {
      const live = matches.filter(m => m.live);
      document.getElementById("liveMatches").innerHTML = live.length ? live.map(m => {
        const liveClock = formatLiveClock(m);
        const events = getEventsForMatch(m);
        const goalEvents = events.filter((event) => normalizeKey(event.eventType).includes("goal"));
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
                    ${goalEvents.length ? `<div class="mt-4 pt-3 border-t border-white/5 text-[10px] uppercase tracking-widest text-tertiary font-bold">${goalEvents.slice(-4).map((event) => event.scorer || event.player || formatGoalMinute(event)).join(" / ")}</div>` : ""}
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
  const tie = String(raw?.tieFormat || "single").toLowerCase();
  const tieFormat = ["single", "h2", "bo3", "bo5"].includes(tie) ? tie : "single";
  const byeFill = String(raw?.byeFill ?? "1") === "0" ? "0" : "1";
  if (!raw || !Array.isArray(raw.rounds)) {
    return { format: "single", tieFormat, byeFill, mirrorTeam: raw?.mirrorTeam === true, bracketSize: 0, qualifierZone: "", qualifiedCount: 0, rounds: [] };
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
      p1: sanitizeScore(match.p1),
      p2: sanitizeScore(match.p2),
      tieFormat: ["single", "h2", "bo3", "bo5"].includes(String(match.tieFormat || "").toLowerCase()) ? String(match.tieFormat).toLowerCase() : tieFormat,
      mirrorTeam: match.mirrorTeam === true ? true : (raw?.mirrorTeam === true),
      isReset: !!match.isReset,
      visible: match.visible !== false
    })) : []
  }));

  return {
    format: raw.format === "double" ? "double" : "single",
    tieFormat,
    byeFill,
    mirrorTeam: raw?.mirrorTeam === true,
    bracketSize: parseInt(raw.bracketSize) || 0,
    qualifierZone: raw.qualifierZone || "",
    qualifiedCount: parseInt(raw.qualifiedCount) || parseInt(raw.bracketSize) || 0,
    rounds
  };
};

const TIE_META = {
  single: { games: 1, winsNeeded: 1, label: "1 Game" },
  h2: { games: 2, winsNeeded: 0, label: "H & A 2 Leg" },
  bo3: { games: 3, winsNeeded: 2, label: "Best of 3" },
  bo5: { games: 5, winsNeeded: 3, label: "Best of 5" }
};
const tieFormatOf = (match, fallback) => {
  const v = String(match?.tieFormat || fallback || knockout?.tieFormat || "single").toLowerCase();
  return TIE_META[v] ? v : "single";
};
const winsNeededFor = (tieFormat) => TIE_META[tieFormat]?.winsNeeded || 0;
const gamesForTie = (tieFormat) => TIE_META[tieFormat]?.games || 1;

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

const buildDoubleEliminationTop6 = (rankedTeams, fillers = []) => {
  const seeds = rankedTeams.slice(0, 6);
  // Slot lb3 (pecundang WB4) tidak punya lawan jika 6 tim pas — diisi peringkat terbaik
  // berikutnya agar tidak walkover. Tanpa filler, seed2 kosong = BYE.
  const fill1 = fillers[0] || "";
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
        { id: "lb3", seed1: "", seed2: fill1, source1: { matchId: "wb4", outcome: "loser" }, source2: null, s1: null, s2: null }
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

const buildDoubleEliminationRounds = (rankedTeams, teamCount, fillers = []) => {
  if (teamCount <= 4) return buildDoubleEliminationTop4(rankedTeams);
  if (teamCount <= 6) return buildDoubleEliminationTop6(rankedTeams, fillers);
  return buildDoubleEliminationTop8(rankedTeams);
};

// Standar turnamen (FIFA-style): ronde pembuka hindari rematch segrup bila bisa.
// Repair deterministik khusus match TANPA source (ronde 1, semua seed sudah tahu):
// tukar seed2 antar 2 tie yang clash selama total clash berkurang.
const groupOfTeam = (name) => {
  const t = teams.find((x) => normalizeKey(x.name) === normalizeKey(name));
  return (t?.group || "").toString().trim().toUpperCase();
};
const repairOpeningTies = (openingMatches) => {
  if (!hasGroupStage() || !Array.isArray(openingMatches)) return 0;
  let fixed = 0;
  for (let iter = 0; iter < 10; iter++) {
    let moved = false;
    for (let i = 0; i < openingMatches.length && !moved; i++) {
      for (let j = i + 1; j < openingMatches.length && !moved; j++) {
        const A = openingMatches[i], B = openingMatches[j];
        if (A.source1 || A.source2 || B.source1 || B.source2) continue;
        const clash = (m) => {
          const g1 = groupOfTeam(m.seed1), g2 = groupOfTeam(m.seed2);
          return g1 && g1 === g2 ? 1 : 0;
        };
        const before = clash(A) + clash(B);
        if (!before) continue;
        const tmp = A.seed2; A.seed2 = B.seed2; B.seed2 = tmp;
        if (clash(A) + clash(B) < before) { moved = true; fixed++; }
        else { const t2 = A.seed2; A.seed2 = B.seed2; B.seed2 = t2; }
      }
    }
    if (!moved) break;
  }
  return fixed;
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

  // Multi-pass agar aliran winner/loser selalu tuntas walau urutan round tidak topologis
  // (mis. lower bracket yang feed dari upper final yang posisinya belakangan).
  const totalMatches = Object.keys(matchMap).length;
  for (let pass = 0; pass <= totalMatches + 1; pass++) {
    let stable = true;
    rounds.forEach((round) => {
      round.matches.forEach((match) => {
        const prev = `${match.team1}|${match.team2}|${match.winner}|${match.loser}|${match.isDraw ? 1 : 0}`;
        match.team1 = match.source1 ? teamFromOutcome(match.source1) : (match.seed1 || "");
        match.team2 = match.source2 ? teamFromOutcome(match.source2) : (match.seed2 || "");
      match.s1 = sanitizeScore(match.s1);
      match.s2 = sanitizeScore(match.s2);
      match.p1 = sanitizeScore(match.p1);
      match.p2 = sanitizeScore(match.p2);
      match.tieFormat = tieFormatOf(match, safe.tieFormat);

      const hasTeams = !!match.team1 && !!match.team2;
      const hasScore = match.s1 !== null && match.s2 !== null;
      const need = winsNeededFor(match.tieFormat);

      match.winner = "";
      match.loser = "";
      match.isDraw = false;
      // BO3/BO5: s1/s2 = jumlah game menang. Pemenang hanya jika sudah rebut 2 (BO3) / 3 (BO5).
      if (hasTeams && hasScore && need > 1) {
        const decided = (match.s1 >= need || match.s2 >= need) && match.s1 !== match.s2;
        if (decided) {
          match.winner = match.s1 > match.s2 ? match.team1 : match.team2;
          match.loser = match.s1 > match.s2 ? match.team2 : match.team1;
        } else if (match.s1 === match.s2 && (match.s1 >= need || hasScore)) {
          // Seri atau belum rebut cukup game → tunggu game penentu, bukan auto-lolos.
          match.isDraw = match.s1 === match.s2 && match.s1 > 0;
        }
      } else if (hasTeams && hasScore && match.s1 !== match.s2) {
        match.winner = match.s1 > match.s2 ? match.team1 : match.team2;
        match.loser = match.s1 > match.s2 ? match.team2 : match.team1;
      } else if (hasTeams && hasScore && match.s1 === match.s2) {
        // Seri di knockout tidak boleh auto-lolos — tunggu adu penalti (p1/p2) atau input ulang.
        if (match.p1 !== null && match.p2 !== null && match.p1 !== match.p2) {
          match.winner = match.p1 > match.p2 ? match.team1 : match.team2;
          match.loser = match.p1 > match.p2 ? match.team2 : match.team1;
        } else {
          match.isDraw = true;
        }
      } else if (match.team1 && !match.team2 && !match.source2) {
        // Hanya auto-lolos bila slot lawan memang BYE (tanpa source), bukan menunggu pemenang.
        match.winner = match.team1;
      } else if (!match.team1 && match.team2 && !match.source1) {
        match.winner = match.team2;
      }
        const next = `${match.team1}|${match.team2}|${match.winner}|${match.loser}|${match.isDraw ? 1 : 0}`;
        if (next !== prev) stable = false;
      });
    });
    if (stable) break;
  }

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

  const sectionHtmlById = {};
  visibleRounds.forEach((round, roundIndex) => {
    const baseGap = resolved.format === "single" ? Math.max(14, 14 * Math.pow(2, roundIndex)) : 14;
    const rn = String(round.name || "").toLowerCase();
    const sectionTone = rn.includes("grand") ? "grand" : rn.includes("lower") ? "lower" : rn.includes("upper") ? "upper" : "";

    const matchesHtml = round.matches
      .filter((match) => match.visible !== false)
      .map((match) => {
        const locked = !match.team1 || !match.team2;
        const team1Class = match.winner && match.winner === match.team1 ? "win" : "";
        const team2Class = match.winner && match.winner === match.team2 ? "win" : "";
        const logo1 = resolveTeam(match.team1).logo || "https://i.imgur.com/xnTuRnl.png";
        const logo2 = resolveTeam(match.team2).logo || "https://i.imgur.com/xnTuRnl.png";
        const showPens = !locked && match.s1 !== null && match.s2 !== null && match.s1 === match.s2;
        const status = match.isDraw
          ? `<span class="text-secondary">Draw — isi penalti</span>`
          : match.winner
            ? `<span class="text-primary">✓ ${match.winner}</span>`
            : (locked ? `<span class="text-white/40">Waiting Teams</span>` : `<span class="text-secondary">Waiting Result</span>`);

        const teamRow = (logo, name, cls, inputHtml) => `
          <div class="ko-team-row ${cls}">
            <img src="${logo}" class="ko-logo" alt="">
            <p class="ko-team-name">${name || "BYE"}</p>
            ${inputHtml}
          </div>`;

        return `
          <article class="ko-match-card ${locked ? "ko-locked" : ""}" id="ko-${match.id}" data-ko-id="${match.id}" data-src1="${match.source1?.matchId || ""}" data-out1="${match.source1?.outcome || ""}" data-src2="${match.source2?.matchId || ""}" data-out2="${match.source2?.outcome || ""}">
            <div class="ko-match-head">
              <span>${match.id.toUpperCase()}</span>
              <span>${status}</span>
            </div>
            <div class="space-y-2">
              ${teamRow(logo1, match.team1, team1Class, isAdmin
                ? `<input type="number" class="ko-score" value="${match.s1 ?? ""}" data-action="updateScoreKO" data-id="${match.id}" data-side="s1" ${locked ? "disabled" : ""}>`
                : `<span class="ko-score text-center ${locked ? "opacity-50" : ""}">${match.s1 ?? "-"}</span>`)}
              ${teamRow(logo2, match.team2, team2Class, isAdmin
                ? `<input type="number" class="ko-score" value="${match.s2 ?? ""}" data-action="updateScoreKO" data-id="${match.id}" data-side="s2" ${locked ? "disabled" : ""}>`
                : `<span class="ko-score text-center ${locked ? "opacity-50" : ""}">${match.s2 ?? "-"}</span>`)}
              ${showPens ? `
              <div class="grid grid-cols-2 gap-2">
                <label class="rounded-lg bg-black/30 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-secondary">Pens ${match.team1 || ""}
                  ${isAdmin ? `<input type="number" class="ko-score mt-1 w-full" value="${match.p1 ?? ""}" data-action="updateScoreKO" data-id="${match.id}" data-side="p1">` : `<span>${match.p1 ?? "-"}</span>`}
                </label>
                <label class="rounded-lg bg-black/30 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-secondary">Pens ${match.team2 || ""}
                  ${isAdmin ? `<input type="number" class="ko-score mt-1 w-full" value="${match.p2 ?? ""}" data-action="updateScoreKO" data-id="${match.id}" data-side="p2">` : `<span>${match.p2 ?? "-"}</span>`}
                </label>
              </div>` : ""}
            </div>
          </article>
        `;
      })
      .join("");

    sectionHtmlById[round.id] = `
      <section class="ko-round ${sectionTone}">
        <h3 class="ko-round-title">${round.name}</h3>
        <div class="ko-stack" style="gap: ${baseGap}px;">
          ${matchesHtml}
        </div>
      </section>
    `;
  });

  const champion = getKnockoutChampion(resolved);
  const pathPanel = renderKnockoutPath(resolved, champion);
  const isDouble = resolved.format === "double";
  const isUpper = (r) => /upper/i.test(r.name || "");
  const isLower = (r) => /lower/i.test(r.name || "");
  const laneHtml = (list) => list.map((r) => sectionHtmlById[r.id] || "").join("");
  let gridInner = "";
  if (isDouble) {
    const up = visibleRounds.filter(isUpper);
    const lo = visibleRounds.filter(isLower);
    const fin = visibleRounds.filter((r) => !isUpper(r) && !isLower(r));
    gridInner = `
      <div class="de-left">
        <div class="de-panel de-winner">
          <div class="de-title de-title-win">Winner's bracket</div>
          <div class="de-lane">${laneHtml(up)}</div>
        </div>
        <div class="de-panel de-lower">
          <div class="de-title de-title-lose">Loser's bracket</div>
          <div class="de-lane">${laneHtml(lo)}</div>
        </div>
      </div>
      <div class="de-panel de-champ">
        <div class="de-champ-head">
          <span class="material-symbols-outlined de-trophy">workspace_premium</span>
          <div><p class="de-champ-label">Champion</p><p class="de-champ-name">${champion || "TBD"}</p></div>
        </div>
        <div class="de-lane de-lane-final">${laneHtml(fin)}</div>
      </div>`;
  } else {
    gridInner = visibleRounds.map((r) => sectionHtmlById[r.id] || "").join("");
  }

  const championPanel = champion && !isDouble
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
      <span class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">Tie: ${TIE_META[resolved.tieFormat]?.label || "1 Game"}</span>
      ${resolved.mirrorTeam ? `<span class="px-3 py-1 rounded-full bg-tertiary/10 border border-tertiary/20 text-tertiary">Mirror ON</span>` : ""}
      <span class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">Qualified: ${resolved.qualifierZone || `Top ${resolved.bracketSize || "-"}`}</span>
      <span class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">Teams: ${resolved.qualifiedCount || resolved.bracketSize || "-"}</span>
      ${champion ? `<span class="px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary">Champion: ${champion}</span>` : ""}
    </div>
    ${championPanel}
    ${pathPanel}
    <div id="ko-canvas">
      <div class="ko-grid${isDouble ? " de" : ""}">
        <svg class="ko-wires" aria-hidden="true"></svg>
        ${gridInner}
      </div>
    </div>
  `;
  applyKoZoom();
  requestAnimationFrame(drawKoWires);
};

// Gambar garis tree antar match: dari sisi kanan kartu sumber ke sisi kiri kartu tujuan.
// Hijau = jalur pemenang, merah = jalur pecundang (drop ke lower bracket).
const drawKoWires = () => {
  document.querySelectorAll("#knockoutBracket .ko-grid").forEach((grid) => {
    const svg = grid.querySelector(":scope > svg.ko-wires");
    if (!svg) return;
    const cards = new Map();
    grid.querySelectorAll(":scope article.ko-match-card[data-ko-id]").forEach((el) => {
      cards.set(el.dataset.koId, el);
    });
    const posIn = (el) => {
      let x = 0, y = 0, node = el;
      while (node && node !== grid) {
        x += node.offsetLeft || 0;
        y += node.offsetTop || 0;
        node = node.offsetParent;
      }
      return { x, y, w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
    };
    let html = "";
    grid.querySelectorAll(":scope article.ko-match-card[data-ko-id]").forEach((target) => {
      const t = posIn(target);
      if (!t.w) return;
      [
        { id: target.dataset.src1, out: target.dataset.out1, frac: 0.36 },
        { id: target.dataset.src2, out: target.dataset.out2, frac: 0.64 }
      ].forEach((feed) => {
        if (!feed.id) return;
        const src = cards.get(feed.id);
        if (!src) return;
        const s = posIn(src);
        if (!s.w) return;
        const x1 = s.x + s.w, y1 = s.y + s.h / 2;
        const x2 = t.x, y2 = t.y + t.h * feed.frac;
        if (x2 <= x1 + 2) return; // sumber di belakang/tidak searah — lewati agar tidak coret kartu
        const dx = Math.max(24, (x2 - x1) / 2);
        const cls = feed.out === "winner" ? "win" : feed.out === "loser" ? "lose" : "";
        html += `<path class="ko-wire ${cls}" d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/>`;
      });
    });
    svg.setAttribute("viewBox", `0 0 ${grid.scrollWidth} ${grid.scrollHeight}`);
    svg.setAttribute("width", grid.scrollWidth);
    svg.setAttribute("height", grid.scrollHeight);
    svg.innerHTML = html;
  });
};

const knockoutScheduleDocId = (matchId, game = 1, total = 1) => {
  const base = `knockout-${normalizeKey(matchId).replace(/[^a-z0-9_-]+/g, "-")}`;
  return total <= 1 ? base : `${base}-g${game}`;
};
const knockoutGameLabel = (tieFormat, game, total) => {
  if (tieFormat === "h2") return game === 2 ? "Leg 2" : "Leg 1";
  if (tieFormat === "bo3" || tieFormat === "bo5") return `Game ${game}`;
  return total <= 1 ? "" : `Game ${game}`;
};

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

      const tie = tieFormatOf(match, resolved.tieFormat);
      const total = gamesForTie(tie);
      const mirror = match.mirrorTeam === true || resolved.mirrorTeam === true;
      for (let game = 1; game <= total; game++) {
        const isReturnLeg = tie === "h2" && game === 2;
        // Leg 2 kandang ditukar: tuan rumah jadi tim tandang leg 1.
        const gTeam1 = isReturnLeg ? match.team2 : match.team1;
        const gTeam2 = isReturnLeg ? match.team1 : match.team2;
        const gameLabel = knockoutGameLabel(tie, game, total);
        const matchDocId = knockoutScheduleDocId(match.id, game, total);
        activeIds.add(matchDocId);
        const matchRef = doc(db, "matches", matchDocId);
        const payload = {
          team1: gTeam1,
          team2: gTeam2,
          type: "knockout",
          knockoutGenerated: true,
          knockoutMatchId: match.id,
          knockoutRoundId: round.id,
          knockoutRoundName: round.name,
          knockoutFormat: resolved.format,
          knockoutTieFormat: tie,
          knockoutGame: game,
          knockoutGames: total,
          knockoutGameLabel: gameLabel,
          mirrorTeam: mirror,
          useTeam: mirror ? gTeam1 : "",
          knockoutQualifierZone: resolved.qualifierZone || "",
          Matchweek: 900,
          date: `Knockout - ${round.name}${gameLabel ? ` • ${gameLabel}` : ""}`,
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
      }
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

  const byTie = new Map();
  scheduleItems.forEach((s) => {
    if (!byTie.has(s.knockoutMatchId)) byTie.set(s.knockoutMatchId, []);
    byTie.get(s.knockoutMatchId).push(s);
  });
  byTie.forEach((list) => list.sort((a, b) => (parseInt(a.knockoutGame) || 1) - (parseInt(b.knockoutGame) || 1)));

  const resolved = resolveKnockout(knockout);
  let changed = false;

  resolved.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      const games = byTie.get(match.id) || [];
      if (!games.length) return;
      const tie = tieFormatOf(match, resolved.tieFormat);
      const norm = (v) => (isScoreEmpty(v) ? null : parseInt(v));
      const num = (v) => (Number.isFinite(v) ? v : null);

      if (tie === "single") {
        const g = games[0];
        const nextS1 = num(norm(g.s1)), nextS2 = num(norm(g.s2));
        const nextP1 = num(norm(g.p1)), nextP2 = num(norm(g.p2));
        if (match.s1 !== nextS1 || match.s2 !== nextS2 || match.p1 !== nextP1 || match.p2 !== nextP2) {
          match.s1 = nextS1; match.s2 = nextS2; match.p1 = nextP1; match.p2 = nextP2;
          changed = true;
        }
      } else if (tie === "h2") {
        const leg1 = games.find((g) => (parseInt(g.knockoutGame) || 1) === 1);
        const leg2 = games.find((g) => (parseInt(g.knockoutGame) || 1) === 2);
        const l1s1 = num(norm(leg1?.s1)), l1s2 = num(norm(leg1?.s2));
        const l2s1 = num(norm(leg2?.s1)), l2s2 = num(norm(leg2?.s2));
        // Leg 2 sisi ditukar saat generate, jadi agregat tim bracket-1 = leg1.s1 + leg2.s2.
        if (l1s1 !== null && l1s2 !== null && l2s1 !== null && l2s2 !== null) {
          const agg1 = l1s1 + l2s2, agg2 = l1s2 + l2s1;
          if (match.s1 !== agg1 || match.s2 !== agg2) { match.s1 = agg1; match.s2 = agg2; changed = true; }
        } else if (match.s1 !== null || match.s2 !== null) {
          // Belum lengkap 2 leg → kosongkan agregat agar tidak lolos prematur.
          match.s1 = null; match.s2 = null; changed = true;
        }
      } else if (tie === "bo3" || tie === "bo5") {
        const need = winsNeededFor(tie);
        let w1 = 0, w2 = 0, scored = 0;
        games.forEach((g) => {
          const a = num(norm(g.s1)), b = num(norm(g.s2));
          if (a !== null && b !== null && a !== b) { scored++; if (a > b) w1++; else w2++; }
        });
        if (w1 >= need || w2 >= need) {
          if (match.s1 !== w1 || match.s2 !== w2) { match.s1 = w1; match.s2 = w2; changed = true; }
        } else if (match.s1 !== null || match.s2 !== null) {
          match.s1 = null; match.s2 = null; changed = true;
        }
      }
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
  const key = String(side || "").toLowerCase();
  if (key === "1" || key === "s1") targetMatch.s1 = parsed;
  else if (key === "2" || key === "s2") targetMatch.s2 = parsed;
  else if (key === "p1") targetMatch.p1 = parsed;
  else if (key === "p2") targetMatch.p2 = parsed;
  else return;

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
  const tieSel = String(document.getElementById("koTieFormat")?.value || knockout?.tieFormat || "single").toLowerCase();
  const tieFormat = ["single", "h2", "bo3", "bo5"].includes(tieSel) ? tieSel : "single";
  const mirrorTeam = document.getElementById("koMirrorTeam")?.checked === true;
  const tieLabel = TIE_META[tieFormat]?.label || "1 Game";
  const mirrorLabel = mirrorTeam ? " • Mirror ON (away pakai tim home)" : "";
  // Grup-aware: Top N tiap grup (interleaved cross-grup) + Best K peringkat #P → knockout/lower bracket.
  // Cup langsung = posisi teratas per grup (ikut settingan cupDirect); sisanya Play-off.
  // Seeding menaruh Cup duluan → bila ada BYE, jatahnya ke seed teratas (= tier Cup).
  let rankedTeams = calculateStandings().map((row) => row.team);
  let qualifierLabel = "";
  let cupNames = [], playoffNames = [];
  if (hasGroupStage()) {
    const adv = Math.max(1, parseInt(competitionConfig.advancePerGroup) || 2);
    const cupTop = cupDirectCount(adv);
    const bestPos = [2, 3, 4, 5].includes(parseInt(competitionConfig.bestPos)) ? parseInt(competitionConfig.bestPos) : 3;
    const bestN = Math.max(0, parseInt(competitionConfig.bestPosCount) || 0);
    const { letters, qualified, bestRanked } = getQualifiedFromGroups(adv, bestPos, bestN);
    const perGroup = letters.map((letter) => calculateStandings(letter).map((r) => r.team));
    perGroup.forEach((list) => {
      list.slice(0, cupTop).forEach((t) => { if (!cupNames.includes(t)) cupNames.push(t); });
      list.slice(cupTop, adv).forEach((t) => { if (!playoffNames.includes(t)) playoffNames.push(t); });
    });
    const interleaved = [];
    for (let pos = 0; pos < adv; pos++) {
      for (let gi = 0; gi < perGroup.length; gi++) {
        if (perGroup[gi][pos]) interleaved.push(perGroup[gi][pos]);
      }
    }
    bestRanked.forEach((t) => { if (!interleaved.includes(t)) interleaved.push(t); });
    if (interleaved.length >= 2) rankedTeams = interleaved;
    else if (qualified.length >= 2) rankedTeams = qualified;
    qualifierLabel = `Grup (${letters.map((l) => `Grup ${l}`).join("+") || "Group Stage"} • Top ${adv}/grup [Cup: ${cupNames.join(", ") || "-"}${playoffNames.length ? ` • Playoff: ${playoffNames.join(", ")}` : " (semua Cup)"}]${bestN > 0 ? ` + Best ${Math.min(bestN, bestRanked.length)}x#${bestPos}` : ""} • ${rankedTeams.length} tim)`;
  }
  const championsSize = Math.max(parseInt(championsCutoff) || 4, 2);
  const playoffSize = Math.max(parseInt(playoffCutoff) || 6, championsSize);
  const requestedSize =
    sizeSelection === "auto" ? (hasGroupStage() ? rankedTeams.length : playoffSize) :
    sizeSelection === "champions" ? championsSize :
    (parseInt(sizeSelection) || (hasGroupStage() ? rankedTeams.length : playoffSize));

  if (!qualifierLabel) {
    qualifierLabel =
      sizeSelection === "champions" ? `Zona Champions Top ${championsSize}` :
      sizeSelection === "auto" ? `Zona Play-off Top ${playoffSize}` :
      `Manual Top ${requestedSize}`;
  }

  if (format === "double") {
    const doubleTeamCount = Math.max(4, Math.min(requestedSize, rankedTeams.length, 8));
    const normalizedDoubleTeamCount = doubleTeamCount <= 4 ? 4 : doubleTeamCount <= 6 ? 6 : 8;
    if (rankedTeams.length < normalizedDoubleTeamCount) {
      alert(`Double elimination butuh minimal ${normalizedDoubleTeamCount} tim untuk pilihan ini.`);
      return;
    }
    // Double hanya support struktur 4/6/8: kelebihan tim (mis. 10 lolos) dipangkas eksplisit.
    const droppedDouble = rankedTeams.slice(normalizedDoubleTeamCount);
    const trimNote = droppedDouble.length ? ` Diambil ${normalizedDoubleTeamCount} teratas (${droppedDouble.join(", ")} tidak ikut).` : "";
    const doubleLabel =
      sizeSelection === "champions" ? `Zona Champions Top ${normalizedDoubleTeamCount}` :
      sizeSelection === "auto" ? `Zona Play-off Top ${normalizedDoubleTeamCount}` :
      `Manual Top ${normalizedDoubleTeamCount}`;
    const byeFill = readByeFill();
    // Peringkat terbaik = urutan klasemen keseluruhan pertama di luar kuota lolos —
    // ngikutin Top N apa pun (Top 2/4/6/8, grup + 3rd, manual). Bukan hardcode peringkat 7.
    const fullRanking = calculateStandings().map((row) => row.team);
    const qualifiedSet = new Set(rankedTeams.slice(0, normalizedDoubleTeamCount));
    const fillerPool = byeFill === "1" ? fullRanking.filter((t) => !qualifiedSet.has(t)).slice(0, 1) : [];
    const fillerLabel = fillerPool.length ? ` + Best next (${fillerPool.join(", ")}) isi slot lower` : (byeFill !== "0" ? " (tim kurang — sisa slot jadi BYE)" : "");

    if (!confirm(`Generate Double Elimination bracket untuk ${doubleLabel}? Tie ${tieLabel}${mirrorLabel}${fillerLabel}.${trimNote}`)) return;
    const doubleRounds = buildDoubleEliminationRounds(rankedTeams.slice(0, normalizedDoubleTeamCount), normalizedDoubleTeamCount, fillerPool);
    repairOpeningTies((doubleRounds.find((r) => r.id === "d1") || { matches: [] }).matches);
    doubleRounds.forEach((r) => r.matches.forEach((mm) => { mm.tieFormat = tieFormat; mm.mirrorTeam = mirrorTeam; }));
    knockout = {
      format: "double",
      tieFormat,
      byeFill,
      mirrorTeam,
      bracketSize: normalizedDoubleTeamCount,
      qualifierZone: `${doubleLabel} • ${tieLabel}${mirrorLabel}${fillerLabel}`,
      qualifiedCount: normalizedDoubleTeamCount,
      rounds: doubleRounds
    };
    await saveKnockout();
    await ensureKnockoutScheduleMatches({ resetScores: true, cleanupStale: true });
    renderKnockout();
    return;
  }

  const teamCount = Math.max(2, Math.min(requestedSize, rankedTeams.length));
  const seeded = rankedTeams.slice(0, teamCount);
  const bracketSize = nextPowerOfTwo(teamCount);
  // Matematika BYE: BYE = bracket - tim, selalu jatuh ke seed teratas (seed 1..BYE).
  const byeCount = bracketSize - teamCount;
  const byeNote = byeCount > 0 ? ` ${byeCount} BYE untuk seed teratas.` : " Tanpa BYE.";

  if (!confirm(`Generate Single Elimination untuk ${qualifierLabel} (${teamCount} tim, bracket ${bracketSize})? Tie ${tieLabel}${mirrorLabel}.${byeNote}`)) return;

  const singleRounds = buildSingleEliminationRounds(seeded, bracketSize);
  repairOpeningTies((singleRounds[0] || { matches: [] }).matches); // hindari rematch segrup di ronde 1
  singleRounds.forEach((r) => r.matches.forEach((mm) => { mm.tieFormat = tieFormat; mm.mirrorTeam = mirrorTeam; }));
  knockout = {
    format: "single",
    tieFormat,
    byeFill: readByeFill(),
    mirrorTeam,
    bracketSize: teamCount,
    qualifierZone: `${qualifierLabel} • ${tieLabel}${mirrorLabel}`,
    qualifiedCount: teamCount,
    rounds: singleRounds
  };

  await saveKnockout();
  await ensureKnockoutScheduleMatches({ resetScores: true, cleanupStale: true });
  renderKnockout();
}

const clearKnockoutData = async () => {
  if (!isAdmin) return;
  knockout = { format: "single", tieFormat: "single", byeFill: "1", mirrorTeam: false, bracketSize: 0, qualifierZone: "", qualifiedCount: 0, rounds: [] };
  await saveKnockout();
  await cleanupGeneratedKnockoutSchedules(new Set());
  renderKnockout();
};


    // --- INIT & SCORERS LOGIC ---
    (function populateMatchweek() {
      const s = document.getElementById("matchMatchweek");
      if (s) s.innerHTML = Array.from({ length: 60 }, (_, i) => `<option value="${i+1}">Matchweek ${i+1}</option>`).join('');
      const compModeEl = document.getElementById("compMode");
      if (compModeEl) compModeEl.addEventListener("change", syncCompetitionUI);
      const compByeEl = document.getElementById("compByeFill");
      if (compByeEl) compByeEl.addEventListener("change", async () => {
        if (!isAdmin) return;
        try {
          await setDoc(doc(db, "tournament", "knockout"), { byeFill: compByeEl.checked ? "1" : "0" }, { merge: true });
        } catch (e) { console.error("Gagal simpan byeFill:", e); }
      });
      const koByeEl = document.getElementById("koByeFill");
      if (koByeEl) koByeEl.addEventListener("change", async () => {
        if (!isAdmin) return;
        try {
          await setDoc(doc(db, "tournament", "knockout"), { byeFill: koByeEl.checked ? "1" : "0" }, { merge: true });
        } catch (e) { console.error("Gagal simpan byeFill:", e); }
      });
      initKoPanZoom();
      applyKoZoom();
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
    const BACKUP_DOCUMENTS = ["config/standings", "config/competition", "settings/liveBanner", "settings/trophyCabinet", "tournament/knockout"];

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
          (incoming.pesTeamId && String(team.pesTeamId || "") === String(incoming.pesTeamId)) ||
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
        let incomingPlayers = parseRosterImportPlayers(parsed)
          .filter((player) => player && (player.docId || player.playerId) && player.player && player.teamKey);
        const targetTeam = await resolveImportTargetTeam(parsed, incomingPlayers);
        incomingPlayers = applyImportTargetTeam(incomingPlayers, targetTeam);

        if (!incomingPlayers.length) {
          throw new Error("Tidak ada player valid di file import.");
        }

        const faceFileMap = buildFaceFileMap();
        const faceMessage = faceFileMap.size
          ? `\n${faceFileMap.size} file gambar dipilih dan akan diupload ke Supabase.`
          : "\nTidak ada folder faces dipilih; import hanya memakai path/URL yang sudah ada di JSON.";
        const teamKeys = [...new Set(incomingPlayers.map((player) => player.teamKey).filter(Boolean))];
        const teamLabel = teamKeys.length <= 5 ? teamKeys.join(", ") : `${teamKeys.length} teams`;
        const targetMessage = targetTeam ? `\nTarget team: ${targetTeam.name} (${targetTeam.source}).` : "";
        if (!confirm(`Import ${incomingPlayers.length} pemain untuk ${teamLabel}? Roster lama untuk team yang sama akan diganti.${targetMessage}${faceMessage}`)) {
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

document.addEventListener("pointerdown", (e) => {
    if (!isAdmin) return;
    const playerNode = e.target.closest("[data-tactic-player]");
    if (!playerNode) return;
    const board = playerNode.closest(".tactic-board");
    if (!board) return;

    e.preventDefault();
    playerNode.setPointerCapture?.(e.pointerId);

    const move = (event) => {
      const rect = board.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
      playerNode.style.left = `${x}%`;
      playerNode.style.top = `${y}%`;
      playerNode.dataset.x = x.toFixed(1);
      playerNode.dataset.y = y.toFixed(1);
    };

    const up = async () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      const tacticX = parseFloat(playerNode.dataset.x);
      const tacticY = parseFloat(playerNode.dataset.y);
      if (!Number.isFinite(tacticX) || !Number.isFinite(tacticY)) return;
      try {
        await updateDoc(doc(db, "players", playerNode.dataset.tacticPlayer), {
          tacticX,
          tacticY,
          updatedAtMs: Date.now()
        });
      } catch (error) {
        console.error("Failed to save tactic position:", error);
      }
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
});

document.addEventListener("dragstart", (e) => {
    if (!isAdmin) return;
    const row = e.target.closest("[data-roster-list-player]");
    if (!row) return;
    activeDraggedRosterPlayerId = row.dataset.rosterListPlayer || "";
    e.dataTransfer.setData("text/plain", row.dataset.rosterListPlayer);
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("opacity-60", "scale-[0.98]");
});

document.addEventListener("dragover", (e) => {
    if (!isAdmin) return;
    const board = e.target.closest(".tactic-board");
    const listZone = e.target.closest("[data-roster-drop-zone]");
    if (!board && !listZone) return;
    e.preventDefault();
    if (board) {
      const targetNode = getNearestTacticPlayerNode(board, e, activeDraggedRosterPlayerId);
      setTacticDropHighlight(board, targetNode);
    }
});

document.addEventListener("dragleave", (e) => {
    if (!isAdmin) return;
    const board = e.target.closest(".tactic-board");
    if (!board) return;
    const next = e.relatedTarget;
    if (next && board.contains(next)) return;
    clearTacticDropHighlight();
});

document.addEventListener("drop", async (e) => {
    if (!isAdmin) return;
    const playerId = e.dataTransfer.getData("text/plain");
    if (!playerId) return;
    const board = e.target.closest(".tactic-board");
    const listZone = e.target.closest("[data-roster-drop-zone]");
    if (!board && !listZone) return;
    e.preventDefault();

    if (listZone && !board) {
      const targetKind = listZone.dataset.rosterDropZone;
      const targetRow = e.target.closest("[data-roster-list-player]");
      const replacedPlayerId = targetKind === "starter" ? targetRow?.dataset.rosterListPlayer || "" : "";
      let replacementPoint = null;

      if (replacedPlayerId && replacedPlayerId !== playerId) {
        const targetNode = Array.from(document.querySelectorAll("[data-tactic-player]"))
          .find((node) => node.dataset.tacticPlayer === replacedPlayerId);
        const x = parseFloat(targetNode?.dataset.x || targetNode?.style.left || "");
        const y = parseFloat(targetNode?.dataset.y || targetNode?.style.top || "");
        if (Number.isFinite(x) && Number.isFinite(y)) replacementPoint = { x, y };
      }

      try {
        await moveRosterPlayerBetweenLists(playerId, targetKind, replacedPlayerId, replacementPoint);
      } catch (error) {
        console.error("Failed to move roster player:", error);
      }
      return;
    }

    const rect = board.getBoundingClientRect();
    const targetNode = getNearestTacticPlayerNode(board, e, playerId);
    const replacedPlayerId = targetNode?.dataset?.tacticPlayer || "";
    const targetX = parseFloat(targetNode?.dataset.x || targetNode?.style.left || "");
    const targetY = parseFloat(targetNode?.dataset.y || targetNode?.style.top || "");
    const fallbackX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const fallbackY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    const tacticX = Number.isFinite(targetX) ? targetX : fallbackX;
    const tacticY = Number.isFinite(targetY) ? targetY : fallbackY;
    try {
      if (replacedPlayerId && replacedPlayerId !== playerId) {
        await moveRosterPlayerBetweenLists(playerId, "starter", replacedPlayerId, { x: tacticX, y: tacticY });
      } else {
        await updateDoc(doc(db, "players", playerId), {
          isSubstitute: false,
          tacticX,
          tacticY,
          updatedAtMs: Date.now()
        });
      }
    } catch (error) {
      console.error("Failed to drop player to tactic board:", error);
    } finally {
      clearTacticDropHighlight();
    }
});

document.addEventListener("dragend", () => {
    activeDraggedRosterPlayerId = "";
    document.querySelectorAll("[data-roster-list-player].opacity-60").forEach((node) => {
      node.classList.remove("opacity-60", "scale-[0.98]");
    });
    clearTacticDropHighlight();
});

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
    else if (action === 'toggleFolder') toggleFolder(btn.dataset.mw);
    else if (action === 'koZoomIn') setKoZoom(koZoom + 0.1);
    else if (action === 'koZoomOut') setKoZoom(koZoom - 0.1);
    else if (action === 'koZoomReset') {
      setKoZoom(1);
      const vp = document.getElementById("knockout-viewport");
      if (vp) { vp.scrollLeft = 0; vp.scrollTop = 0; }
    }
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
    else if (action === 'resetTeamTactic') await resetTeamTactic(id);
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
    else if (action === 'updateScoreKO') await updateScoreKO(target.dataset.id, target.dataset.side, target.value);
    else if (action === 'importBackup') await importBackup(e);
    else if (action === 'importRosterPlayers') await importRosterPlayers(e);
    else if (action === 'selectScorerTeam') renderRosterPlayerOptions();
});

    document.addEventListener('input', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      if (target.dataset.action === 'searchScorer') renderScorers();
    });
