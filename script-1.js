(function () {
  var KEY = "callbreak-v4";
  var MIN_BID = 1, MAX_BID = 8, MAX_ROUNDS = 20, HIST_MAX = 10;

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function blankCell() { return { bid: 0, won: 0, manual: "", neg: false }; }
  function blankRound() { return { done: false, phase: "bid", turn: 0, mode: "auto", cells: [blankCell(), blankCell(), blankCell(), blankCell()] }; }
  function freshState(names, blind, auto, n) {
    var rs = [];
    for (var i = 0; i < (n || 5); i++) rs.push(blankRound());
    return { id: uid(), names: names || ["", "", "", ""], rounds: rs, current: 0, blind: !!blind, auto: auto !== false, sbUnlocked: false, namesOpen: true };
  }
  function norm(st) {
    if (!st || !Array.isArray(st.names) || !Array.isArray(st.rounds) || !st.rounds.length) return null;
    while (st.names.length < 4) st.names.push("");
    st.rounds.forEach(function (r) {
      if (!Array.isArray(r.cells) || r.cells.length !== 4) r.cells = [blankCell(), blankCell(), blankCell(), blankCell()];
      r.cells.forEach(function (c) { if (typeof c.manual !== "string") c.manual = ""; if (typeof c.neg !== "boolean") c.neg = false; c.bid = c.bid || 0; c.won = c.won || 0; });
      r.mode = r.mode || "auto"; r.turn = r.turn || 0; r.phase = r.phase || "bid";
    });
    st.auto = true; st.blind = !!st.blind; st.sbUnlocked = !!st.sbUnlocked; st.namesOpen = st.namesOpen !== false;
    st.id = st.id || uid();
    st.showTotal = !!st.showTotal;
    st.current = Math.max(0, Math.min(st.current || 0, st.rounds.length - 1));
    return st;
  }

  var state = freshState();
  try {
    var saved = localStorage.getItem(KEY);
    if (saved) { var n0 = norm(JSON.parse(saved)); if (n0) state = n0; }
  } catch (e) {}
  var theme = "dark", font = "m";
  try { theme = localStorage.getItem(KEY + "-theme") || "dark"; font = localStorage.getItem(KEY + "-font") || "m"; if (font === "xl") font = "l"; } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-font", font);

  var tab = "game";
  var pendingBid = 1;
  var armed = null, armTimer = null;
  var sheetView = "main";
  var saveMsg = "", saveTimer = null;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function nmOf(st, p) { return (st.names[p] || "").trim() || "Player " + (p + 1); }
  function nm(p) { return nmOf(state, p); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cur() { return state.rounds[state.current]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- scoring (kept in tenths so 3.1 never becomes 3.0999) ----
  function manualScore(c) {
    var m = parseFloat(c.manual);
    if (isNaN(m)) return null;
    var t = Math.round(m * 10);
    return c.neg && t !== 0 ? -t : t;
  }
  function autoScore(c) {
    if (!c.bid) return null;
    return c.won >= c.bid ? c.bid * 10 + (c.won - c.bid) : -c.bid * 10;
  }
  function cellScore(st, r, c) {
    var mode = r.done ? (r.mode || "auto") : (st.auto ? "auto" : "manual");
    return mode === "manual" ? manualScore(c) : autoScore(c);
  }
  function totalsOf(st) {
    return [0, 1, 2, 3].map(function (p) {
      return st.rounds.reduce(function (s, r) {
        if (!r.done) return s;
        var t = cellScore(st, r, r.cells[p]);
        return s + (t === null ? 0 : t);
      }, 0);
    });
  }
  function completeOf(st) { return st.rounds.every(function (r) { return r.done; }); }
  function complete() { return completeOf(state); }
  function fmt(t) { if (t === null) return "·"; return t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1); }
  function cls(t) { return t === null ? "none" : t < 0 ? "neg" : "pos"; }
  function allBid(r) { return r.cells.every(function (c) { return c.bid >= MIN_BID; }); }
  function allManual(r) { return r.cells.every(function (c) { return manualScore(c) !== null; }); }

  function stage() {
    if (state.blind && complete()) return "complete";
    if (!state.auto) return "manual";
    if (!state.blind) return "both";
    var r = cur();
    if (!r.done && r.phase !== "won") return "bidturn";
    return "won";
  }
  function canSeeScores() { return !state.blind || state.sbUnlocked; }

  // ---- history ----
  function loadHist() { try { var h = JSON.parse(localStorage.getItem(KEY + "-hist") || "[]"); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
  function storeHist(h) { try { localStorage.setItem(KEY + "-hist", JSON.stringify(h)); } catch (e) {} }
  function hasProgress() { return state.rounds.some(function (r) { return r.done; }); }
  function saveToHistory() {
    var h = loadHist().filter(function (x) { return x.id !== state.id; });
    h.unshift({ id: state.id, savedAt: Date.now(), state: JSON.parse(JSON.stringify(state)) });
    storeHist(h.slice(0, HIST_MAX));
  }

  var $ = function (id) { return document.getElementById(id); };

  function renderNames() {
    var h = "";
    for (var p = 0; p < 4; p++) {
      h += '<input class="name-in" data-p="' + p + '" value="' + esc(state.names[p]) + '" placeholder="Player ' + (p + 1) + '" maxlength="14" aria-label="Player ' + (p + 1) + ' name" autocomplete="off">';
    }
    $("names").innerHTML = h;
  }
  function renderFold() {
    $("fold").setAttribute("aria-expanded", state.namesOpen ? "true" : "false");
    $("names").hidden = !state.namesOpen;
    $("sum").textContent = state.namesOpen ? "" : [0, 1, 2, 3].map(nm).join(", ");
  }

  function renderChips() {
    var h = "", st = state.blind && state.auto;
    state.rounds.forEach(function (r, i) {
      h += '<button class="chip' + (i === state.current ? " on" : "") + (r.done ? " done" : "") + (st ? " static" : "") + '" data-round="' + i + '"' + (st ? ' tabindex="-1"' : "") + ">Round " + (i + 1) + "</button>";
    });
    var box = $("chips");
    box.innerHTML = h;
    var on = box.querySelector(".chip.on");
    if (on) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2;
  }

  function stepper(p, f, label, text) {
    return '<div class="stepper">' +
      '<button class="step-btn" data-p="' + p + '" data-f="' + f + '" data-d="-1" aria-label="Decrease ' + label + ' for ' + esc(nm(p)) + '">-</button>' +
      '<div class="val"><strong>' + text + "</strong><span>" + label + "</span></div>" +
      '<button class="step-btn" data-p="' + p + '" data-f="' + f + '" data-d="1" aria-label="Increase ' + label + ' for ' + esc(nm(p)) + '">+</button></div>';
  }

  function updateAction() {
    var s = stage(), r = cur(), btn = $("action"), hint = $("hint"), n = state.rounds.length;
    var finishText = r.done ? "Save round " + (state.current + 1) : state.current === n - 1 ? "Finish game" : "Finish round " + (state.current + 1);
    hint.textContent = ""; btn.disabled = false;
    if (s === "complete") btn.textContent = "Show scoreboard";
    else if (s === "bidturn") { var t = r.turn || 0; btn.textContent = t < 3 ? "Hide bid and pass to " + nm(t + 1) : "Hide bid and enter tricks won"; }
    else if (s === "won") btn.textContent = finishText;
    else if (s === "both") {
      var ok = allBid(r); btn.textContent = finishText; btn.disabled = !ok;
      hint.textContent = ok ? "" : "Every player needs a bid from " + MIN_BID + " to " + MAX_BID + ".";
    } else {
      var ok2 = allManual(r); btn.textContent = finishText; btn.disabled = !ok2;
      hint.textContent = ok2 ? "" : "Enter points for every player.";
    }
  }

  function renderGame() {
    var r = cur(), s = stage(), n = state.rounds.length;
    var title = "Round " + (state.current + 1) + " of " + n;
    var note = $("roundNote"), h = "";
    note.className = "note"; note.textContent = "";

    if (s === "complete") {
      title = "Game complete";
      h = '<article class="glass done-card"><p class="who">All ' + n + ' rounds are done</p><p>Open the scoreboard to see the final points.</p></article>';
    } else if (s === "bidturn") {
      title += " · Bidding";
      var t = r.turn || 0;
      note.textContent = "Bid " + (t + 1) + " of 4";
      var dots = "";
      for (var i = 0; i < 4; i++) dots += '<i class="' + (i <= t ? "on" : "") + '"></i>';
      h = '<article class="glass turn"><div class="step-of">Pass the phone to</div><div class="who">' + esc(nm(t)) + '</div>' +
        '<p class="ask">Pick a bid from ' + MIN_BID + " to " + MAX_BID + ". Nobody else should look.</p>" +
        '<div class="stepper"><button class="step-btn" data-f="pending" data-d="-1" aria-label="Decrease bid">-</button>' +
        '<div class="val"><strong>' + pendingBid + "</strong><span>Your bid</span></div>" +
        '<button class="step-btn" data-f="pending" data-d="1" aria-label="Increase bid">+</button></div>' +
        '<div class="dots" aria-hidden="true">' + dots + "</div></article>";
    } else if (s === "won") {
      title += " · Tricks won";
      var won = r.cells.reduce(function (a, c) { return a + c.won; }, 0);
      note.textContent = "Tricks won: " + won + " of 13";
      note.className = "note" + (won !== 13 ? " warn" : "");
      h = '<div class="players">';
      r.cells.forEach(function (c, p) {
        h += '<article class="glass player"><div class="p-top"><div class="p-name">' + esc(nm(p)) + '</div></div>' +
          '<div class="steppers one">' + stepper(p, "won", "Tricks won", c.won) + "</div></article>";
      });
      h += "</div>";
    } else if (s === "manual") {
      h = '<div class="players">';
      r.cells.forEach(function (c, p) {
        var sc = manualScore(c);
        h += '<article class="glass player"><div class="p-top"><div class="p-name">' + esc(nm(p)) + '</div><div class="rscore ' + cls(sc) + '" data-score="' + p + '">' + (sc === null ? "" : fmt(sc)) + "</div></div>" +
          '<div class="score-in"><button class="sign" data-sign="' + p + '" aria-pressed="' + (c.neg ? "true" : "false") + '" aria-label="Negative points for ' + esc(nm(p)) + '">-</button>' +
          '<input class="manual" data-p="' + p + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Points" value="' + esc(c.manual) + '" aria-label="Points for ' + esc(nm(p)) + '"></div></article>';
      });
      h += "</div>";
    } else {
      var w = r.cells.reduce(function (a, c) { return a + c.won; }, 0);
      note.textContent = "Tricks won: " + w + " of 13";
      note.className = "note" + (w !== 13 ? " warn" : "");
      h = '<div class="players">';
      r.cells.forEach(function (c, p) {
        var sc = autoScore(c);
        h += '<article class="glass player"><div class="p-top"><div class="p-name">' + esc(nm(p)) + '</div><div class="rscore ' + cls(sc) + '">' + (sc === null ? "" : fmt(sc)) + "</div></div>" +
          '<div class="steppers">' + stepper(p, "bid", "Bid", c.bid ? c.bid : "–") + stepper(p, "won", "Won", c.won) + "</div></article>";
      });
      h += "</div>";
    }
    $("roundTitle").textContent = title;
    $("stage").innerHTML = h;
    updateAction();
  }

  function renderScore() {
    var see = canSeeScores();
    $("scoreLocked").hidden = see;
    $("scoreOpen").hidden = !see;
    if (!see) return;
    $("hideWrap").hidden = !state.blind;

    var done = complete(), tot = totalsOf(state);
    var h = "<thead><tr><th></th>";
    for (var p = 0; p < 4; p++) h += "<th>" + esc(nm(p)) + "</th>";
    h += "</tr></thead><tbody>";
    state.rounds.forEach(function (r, i) {
      h += "<tr><td>Round " + (i + 1) + "</td>";
      r.cells.forEach(function (c) {
        var t = r.done ? cellScore(state, r, c) : null;
        h += '<td class="' + cls(t) + '">' + fmt(t) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody>";
    if (state.showTotal) {
      h += "<tfoot><tr><td>" + (done ? "Final points" : "Total so far") + "</td>";
      tot.forEach(function (t) { h += '<td class="' + cls(t) + '">' + fmt(t) + "</td>"; });
      h += "</tr></tfoot>";
    }
    $("table").innerHTML = h;

    $("totalBtn").textContent = state.showTotal ? "Hide total" : "Total";
    $("totalBtn").classList.toggle("ghost", state.showTotal);
    $("totalWrap").hidden = !state.showTotal;
    if (!state.showTotal) return;
    $("standTitle").textContent = done ? "Final standings" : "Standings so far";
    var st = $("standings");
    if (!hasProgress()) { st.innerHTML = '<div class="empty">Finish a round on the Game tab to see points here.</div>'; return; }
    var order = tot.map(function (t, p) { return { t: t, p: p }; }).sort(function (a, b) { return b.t - a.t || a.p - b.p; });
    var rows = "";
    order.forEach(function (o, i) {
      var lead = o.t === order[0].t;
      rows += '<div class="t-row' + (lead ? " lead" : "") + '"><div class="rank">' + (i + 1) + '</div><div class="t-name">' + esc(nm(o.p)) +
        (done && lead ? ' <span class="t-tag">Winner</span>' : "") + '</div><div class="t-total ' + cls(o.t) + '">' + fmt(o.t) + "</div></div>";
    });
    st.innerHTML = rows;
  }

  function renderTabs() {
    $("viewGame").hidden = tab !== "game";
    $("viewScore").hidden = tab !== "score";
    ["game", "score"].forEach(function (k) {
      var b = $(k === "game" ? "tabGame" : "tabScore");
      b.classList.toggle("on", tab === k);
      b.setAttribute("aria-selected", tab === k ? "true" : "false");
    });
  }

  function renderHistory() {
    var h = loadHist();
    $("histCount").textContent = h.length === 0 ? "No saved games yet." : h.length + (h.length === 1 ? " saved game" : " saved games");
    var box = $("histList");
    if (!h.length) { box.innerHTML = '<div class="empty">Saved and finished games show up here.</div>'; return; }
    var out = "";
    h.forEach(function (e) {
      var st = e.state, tot = totalsOf(st), doneN = st.rounds.filter(function (r) { return r.done; }).length;
      var vis = !st.blind || completeOf(st);
      var d = new Date(e.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      var openArmed = armed === "open:" + e.id, delArmed = armed === "del:" + e.id;
      out += '<div class="h-item"><div class="h-top"><div><div class="h-date">' + esc(d) + '</div><div class="h-meta">' + doneN + " of " + st.rounds.length + " rounds" + (st.blind ? ", blind bidding" : "") + '</div></div>' +
        '<div class="h-acts"><button class="act' + (openArmed ? " armed" : "") + '" data-hopen="' + e.id + '">' + (openArmed ? "Tap to open" : "Open") + '</button>' +
        '<button class="act bad' + (delArmed ? " armed" : "") + '" data-hdel="' + e.id + '">' + (delArmed ? "Tap to delete" : "Delete") + "</button></div></div>" +
        '<div class="h-scores">';
      for (var p = 0; p < 4; p++) {
        out += '<div class="h-p"><span>' + esc(nmOf(st, p)) + "</span>" + (vis ? '<b class="' + cls(tot[p]) + '">' + fmt(tot[p]) + "</b>" : '<b class="none">?</b>') + "</div>";
      }
      out += "</div></div>";
    });
    box.innerHTML = out;
  }

  function renderSettings() {
    $("blindSwitch").setAttribute("aria-checked", state.blind ? "true" : "false");
    $("blindBadge").hidden = !state.blind;
    var curTheme = document.documentElement.getAttribute("data-theme");
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme-set]"), function (b) { b.classList.toggle("on", b.getAttribute("data-theme-set") === curTheme); });
    var curFont = document.documentElement.getAttribute("data-font");
    Array.prototype.forEach.call(document.querySelectorAll("#fontSeg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-font") === curFont); });
    $("resetBtn").classList.toggle("armed", armed === "reset");
    $("resetBtn").textContent = armed === "reset" ? "Tap to confirm" : "Reset game";
    $("saveGame").textContent = saveMsg || "Save game";
    $("sheetMain").hidden = sheetView !== "main";
    $("sheetHist").hidden = sheetView !== "hist";
    renderHistory();
  }

  function renderAll() { renderTabs(); renderFold(); renderChips(); renderGame(); renderScore(); renderSettings(); }

  function openSettings() { sheetView = "main"; $("overlay").hidden = false; renderSettings(); $("closeSettings").focus(); }
  function closeSettings() { $("overlay").hidden = true; armed = null; clearTimeout(armTimer); sheetView = "main"; renderSettings(); $("openSettings").focus(); }
  function arm(key) {
    armed = key; clearTimeout(armTimer);
    armTimer = setTimeout(function () { armed = null; renderSettings(); }, 4000);
    renderSettings();
  }
  function disarm() { armed = null; clearTimeout(armTimer); }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) { if (e.target === $("overlay")) closeSettings(); return; }

    if (t.id === "fold") { state.namesOpen = !state.namesOpen; save(); renderFold(); return; }
    if (t.dataset.tab) { tab = t.dataset.tab; renderTabs(); window.scrollTo(0, 0); return; }
    if (t.id === "showSb") { state.sbUnlocked = true; save(); renderScore(); return; }
    if (t.id === "hideSb") { state.sbUnlocked = false; state.showTotal = false; save(); renderScore(); return; }
    if (t.id === "totalBtn") { state.showTotal = !state.showTotal; save(); renderScore(); return; }
    if (t.dataset.round !== undefined) {
      if (state.blind && state.auto) return;
      state.current = +t.dataset.round; save(); renderChips(); renderGame(); return;
    }

    if (t.dataset.f === "pending") { pendingBid = clamp(pendingBid + (+t.dataset.d), MIN_BID, MAX_BID); renderGame(); return; }
    if (t.dataset.f) {
      var cell = cur().cells[+t.dataset.p], f = t.dataset.f, d = +t.dataset.d;
      if (f === "bid") {
        if (cell.bid === 0 && d < 0) return;
        cell.bid = clamp(cell.bid + d, MIN_BID, MAX_BID);
      } else cell.won = clamp(cell.won + d, 0, 13);
      save(); renderGame(); renderScore(); return;
    }
    if (t.dataset.sign !== undefined) {
      var sp = +t.dataset.sign, sc = cur().cells[sp];
      sc.neg = !sc.neg;
      t.setAttribute("aria-pressed", sc.neg ? "true" : "false");
      paintScore(sp); save(); updateAction(); renderScore(); return;
    }

    if (t.id === "action") {
      var s = stage(), r = cur();
      if (s === "complete") { state.sbUnlocked = true; tab = "score"; save(); renderAll(); window.scrollTo(0, 0); return; }
      if (s === "bidturn") {
        var turn = r.turn || 0;
        r.cells[turn].bid = pendingBid;
        r.turn = turn + 1;
        if (r.turn >= 4) r.phase = "won";
        pendingBid = 1;
        save(); renderGame(); window.scrollTo(0, 0); return;
      }
      if (s === "both" && !allBid(r)) return;
      if (s === "manual" && !allManual(r)) return;
      var wasDone = r.done;
      r.done = true; r.mode = state.auto ? "auto" : "manual";
      if (!wasDone) {
        if (state.current < state.rounds.length - 1) { state.current++; pendingBid = 1; }
        else if (!state.blind) tab = "score";
      } else if (state.blind) {
        for (var k = 0; k < state.rounds.length; k++) {
          if (!state.rounds[k].done) { state.current = k; pendingBid = 1; break; }
        }
      }
      if (complete()) saveToHistory();
      save(); renderAll(); window.scrollTo(0, 0);
      return;
    }

    if (t.id === "openSettings") { openSettings(); return; }
    if (t.id === "closeSettings") { closeSettings(); return; }
    if (t.id === "openHist") { sheetView = "hist"; renderSettings(); return; }
    if (t.id === "backHist") { sheetView = "main"; disarm(); renderSettings(); return; }
    if (t.id === "blindSwitch") { state.blind = !state.blind; pendingBid = 1; save(); renderAll(); return; }
    if (t.dataset.font) {
      document.documentElement.setAttribute("data-font", t.dataset.font);
      try { localStorage.setItem(KEY + "-font", t.dataset.font); } catch (err) {}
      renderSettings(); renderChips(); return;
    }
    if (t.dataset.themeSet) {
      document.documentElement.setAttribute("data-theme", t.dataset.themeSet);
      try { localStorage.setItem(KEY + "-theme", t.dataset.themeSet); } catch (err) {}
      renderSettings(); return;
    }
    if (t.id === "saveGame") {
      clearTimeout(saveTimer);
      if (!hasProgress()) saveMsg = "Finish a round first";
      else { saveToHistory(); saveMsg = "Saved"; }
      saveTimer = setTimeout(function () { saveMsg = ""; renderSettings(); }, 1800);
      renderSettings(); return;
    }
    if (t.dataset.hopen) {
      var id = t.dataset.hopen;
      if (armed !== "open:" + id) { arm("open:" + id); return; }
      disarm();
      var en = loadHist().filter(function (x) { return x.id === id; })[0];
      var ns = en && norm(JSON.parse(JSON.stringify(en.state)));
      if (ns) { state = ns; tab = "game"; pendingBid = 1; save(); renderNames(); renderAll(); closeSettings(); }
      return;
    }
    if (t.dataset.hdel) {
      var did = t.dataset.hdel;
      if (armed !== "del:" + did) { arm("del:" + did); return; }
      disarm();
      storeHist(loadHist().filter(function (x) { return x.id !== did; }));
      renderSettings(); return;
    }
    if (t.dataset.confirm) {
      if (armed !== "reset") { arm("reset"); return; }
      disarm();
      var keepOpen = state.namesOpen;
      state = freshState(state.names.slice(), state.blind, true, 5);
      state.namesOpen = keepOpen;
      pendingBid = 1; tab = "game";
      save(); renderNames(); renderAll(); closeSettings();
    }
  });

  function paintScore(p) {
    var c = cur().cells[p], el = document.querySelector('[data-score="' + p + '"]');
    if (!el) return;
    var sc = manualScore(c);
    el.textContent = sc === null ? "" : fmt(sc);
    el.className = "rscore " + cls(sc);
  }

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.classList.contains("name-in")) {
      state.names[+el.dataset.p] = el.value;
      save(); renderFold();
      var keep = document.activeElement;
      renderGame(); renderScore();
      if (keep && keep.classList && keep.classList.contains("name-in")) keep.focus();
      return;
    }
    if (el.classList.contains("manual")) {
      var p = +el.dataset.p, c = cur().cells[p], v = el.value;
      if (v.indexOf("-") > -1) { c.neg = true; var sb = document.querySelector('[data-sign="' + p + '"]'); if (sb) sb.setAttribute("aria-pressed", "true"); }
      v = v.replace(/[^0-9.]/g, "");
      var dot = v.indexOf(".");
      if (dot > -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
      el.value = v; c.manual = v;
      save(); paintScore(p); updateAction(); renderScore();
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("overlay").hidden) closeSettings(); });

  renderNames();
  renderAll();
})();
