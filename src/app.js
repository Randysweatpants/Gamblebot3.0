// Show all picks count near top
const allPicksCountEl = document.getElementById("all-picks-count");
const state = {
  props: [],
  topEv: null,
  topOver: [],
  topUnder: [],
};

const els = {
  healthStatus: document.getElementById("health-status"),
  filtersForm: document.getElementById("filters-form"),
  refreshBtn: document.getElementById("refresh-btn"),
  resetBtn: document.getElementById("reset-btn"),
  sport: document.getElementById("sport"),
  market: document.getElementById("market"),
  sportsbook: document.getElementById("sportsbook"),
  team: document.getElementById("team"),
  minEV: document.getElementById("min_ev"),
  date: document.getElementById("date"),
  statBestEV: document.getElementById("stat-best-ev"),
  statBestPlayer: document.getElementById("stat-best-player"),
  statTopOver: document.getElementById("stat-top-over"),
  statTopOverPlayer: document.getElementById("stat-top-over-player"),
  statTopUnder: document.getElementById("stat-top-under"),
  statTopUnderPlayer: document.getElementById("stat-top-under-player"),
  topOverList: document.getElementById("top-over-list"),
  topUnderList: document.getElementById("top-under-list"),
  tableBody: document.getElementById("props-table-body"),
  tableMeta: document.getElementById("table-meta"),
  propCardTemplate: document.getElementById("prop-card-template"),
};

const today = new Date().toISOString().slice(0, 10);
els.date.value = today;

function currencyPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function decimal(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(digits);
}

function marketLabel(market) {
  if (!market) return "—";
  return market.replaceAll("_", " ");
}

function evClass(bestEV) {
  if (bestEV === null || bestEV === undefined) return "ev-weak";
  if (bestEV >= 0.05) return "ev-strong";
  if (bestEV >= 0.02) return "ev-medium";
  return "ev-weak";
}

function setHealth(message, tone = "warning") {
  els.healthStatus.textContent = message;
  const dot = document.querySelector(".status-dot");
  if (!dot) return;

  if (tone === "success") {
    dot.style.background = "#8bffb5";
    dot.style.boxShadow = "0 0 0 4px rgba(139,255,181,.15)";
  } else if (tone === "danger") {
    dot.style.background = "#ff8a8a";
    dot.style.boxShadow = "0 0 0 4px rgba(255,138,138,.15)";
  } else {
    dot.style.background = "#ffd36d";
    dot.style.boxShadow = "0 0 0 4px rgba(255,211,109,.15)";
  }
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  });
  return query.toString();
}

async function fetchJSON(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
  }

  return response.json();
}

function renderStatCards() {

  if (state.topEv) {
    els.statBestEV.textContent = currencyPercent(state.topEv.best_ev);
    els.statBestEV.className = `stat-value ${evClass(state.topEv.best_ev)}`;
    els.statBestPlayer.textContent = `${state.topEv.player_name} • ${marketLabel(state.topEv.market)} ${state.topEv.line}`;
  } else {
    els.statBestEV.textContent = "—";
    els.statBestPlayer.textContent = "No edge found";
  }

  if (state.topOver.length) {
    els.statTopOver.textContent = currencyPercent(state.topOver[0].best_ev);
    els.statTopOverPlayer.textContent = `${state.topOver[0].player_name} • ${marketLabel(state.topOver[0].market)}`;
  } else {
    els.statTopOver.textContent = "—";
    els.statTopOverPlayer.textContent = "No over edge yet";
  }

  if (state.topUnder.length) {
    els.statTopUnder.textContent = currencyPercent(state.topUnder[0].best_ev);
    els.statTopUnderPlayer.textContent = `${state.topUnder[0].player_name} • ${marketLabel(state.topUnder[0].market)}`;
  } else {
    els.statTopUnder.textContent = "—";
    els.statTopUnderPlayer.textContent = "No under edge yet";
  }
}

function makeMiniStat(label, value, extraClass = "") {
  const span = document.createElement("span");
  span.className = `pill ${extraClass}`.trim();
  span.textContent = `${label}: ${value}`;
  return span;
}

function createPropCard(prop) {
  const fragment = els.propCardTemplate.content.cloneNode(true);
  fragment.querySelector(".prop-player").textContent = prop.player_name;
  // Side
  const side = fragment.querySelector(".prop-side");
  side.textContent = prop.best_side ? prop.best_side.toUpperCase() : "N/A";
  side.classList.add(prop.best_side === "under" ? "under" : "over");
  // Market
  fragment.querySelector(".prop-card-meta").textContent = `Market: ${marketLabel(prop.market)}`;
  // Line
  fragment.querySelector(".prop-card-line").textContent = `Line: ${decimal(prop.line, 2)}`;
  // Book
  fragment.querySelector(".prop-card-book").textContent = `Book: ${prop.sportsbook ?? "—"}`;
  // Odds
  fragment.querySelector(".prop-card-odds").textContent = `Odds: ${prop.odds ?? "—"}`;
  // Implied Prob
  fragment.querySelector(".prop-card-implied").textContent = `Implied Prob: ${typeof prop.implied_prob === "number" ? currencyPercent(prop.implied_prob) : "—"}`;
  // Fair Prob (prominent for shots)
  const fairProbText = typeof prop.fair_prob === "number" ? currencyPercent(prop.fair_prob) : "—";
  fragment.querySelector(".prop-card-fair").innerHTML = prop.market === "shots_on_goal" ? `<b>Fair Prob: ${fairProbText}</b>` : `Fair Prob: ${fairProbText}`;
  // EV (prominent for shots)
  let evClass = "";
  if (typeof prop.ev === "number") {
    if (prop.ev > 0) evClass = "ev-positive";
    else if (prop.ev < 0) evClass = "ev-negative";
  }
  const evText = typeof prop.ev === "number" ? currencyPercent(prop.ev) : "—";
  fragment.querySelector(".prop-card-ev").innerHTML = prop.market === "shots_on_goal" ? `<b>EV: <span class="${evClass}">${evText}</span></b>` : `EV: <span class="${evClass}">${evText}</span>`;
  // Notes
  const noteText = prop.matchup_notes || "Model and matchup notes will appear here once the API returns them.";
  fragment.querySelector(".prop-notes").textContent = noteText;
  // Remove old stats area (optional, or repurpose for extra info)
  fragment.querySelector(".prop-card-stats").innerHTML = '';
  return fragment;
}

function renderTopLists() {
  const renderInto = (target, items, emptyMessage) => {
    target.innerHTML = "";
    if (!items.length) {
      target.className = "prop-list empty-state";
      target.textContent = emptyMessage;
      return;
    }
    target.className = "prop-list";
    items.slice(0, 10).forEach((prop) => target.appendChild(createPropCard(prop)));
  };

  // Filter and render top 10 for each market
  const points = state.props.filter(p => p.market === "points");
  const assists = state.props.filter(p => p.market === "assists");
  const shots = state.props.filter(p => p.market === "shots_on_goal");
  renderInto(document.getElementById("top-points-list"), points, "No points props returned for this filter set.");
  renderInto(document.getElementById("top-assists-list"), assists, "No assists props returned for this filter set.");
  renderInto(document.getElementById("top-shots-list"), shots, "No shots on goal props returned for this filter set.");
}

function renderTable() {
  if (!state.props.length) {
    els.tableBody.innerHTML = '<tr><td colspan="10" class="empty-table">No props matched these filters.</td></tr>';
    return;
  }

  els.tableBody.innerHTML = state.props
    .map((prop) => {
      const bestSide = prop.best_side ? `<span class="pill ${prop.best_side === "under" ? "under" : "over"}">${prop.best_side}</span>` : "—";
      return `
        <tr>
          <td>
            <span class="player-name">${prop.player_name}</span>
            <span class="small-muted">${prop.team_abbr} vs ${prop.opponent_abbr}</span>
          </td>
          <td>${prop.game}</td>
          <td>${marketLabel(prop.market)}</td>
          <td>${decimal(prop.line, 1)}</td>
          <td>${prop.sportsbook ?? "—"}</td>
          <td>${decimal(prop.projection)}</td>
          <td>${bestSide}</td>
          <td><span class="pill ${evClass(prop.best_ev)}">${currencyPercent(prop.best_ev)}</span></td>
          <td>${prop.confidence ?? "—"}</td>
          <td class="note-cell">${prop.matchup_notes ?? "—"}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadHealth() {
  try {
    await fetchJSON("/api/healthz");
    setHealth("API live", "success");
  } catch (error) {
    console.error(error);
    setHealth("API not responding", "danger");
  }
}

async function loadBoard() {
  const params = {
    sport: els.sport.value || "NHL",
    market: els.market.value,
    sportsbook: els.sportsbook.value.trim(),
    team: els.team.value.trim(),
    min_ev: els.minEV.value,
    date: els.date.value || today,
  };

  els.tableMeta.textContent = "Loading board…";

  try {
    const query = buildQuery(params);
    const [propsResponse, topResponse] = await Promise.all([
      fetchJSON(`/api/props?${query}`),
      fetchJSON(`/api/top-ev-picks?${buildQuery({ sport: params.sport, date: params.date, limit: 10 })}`),
    ]);

    state.props = propsResponse.props || [];
    state.topOver = topResponse.top_over || [];
    state.topUnder = topResponse.top_under || [];
    state.topEv = [...state.topOver, ...state.topUnder]
      .filter((prop) => typeof prop.best_ev === "number")
      .sort((a, b) => b.best_ev - a.best_ev)[0] || null;


    renderStatCards();
    renderTopLists();
    renderTable();
    if (allPicksCountEl) {
      allPicksCountEl.textContent = `All picks: ${state.props.length}`;
    }

    els.tableMeta.textContent = `${state.props.length} props • ${params.sport} • ${params.date}`;
  } catch (error) {
    console.error(error);
    els.tableMeta.textContent = `Request failed: ${error.message}`;
    els.tableBody.innerHTML = `<tr><td colspan="10" class="empty-table">${error.message}</td></tr>`;
    els.topOverList.textContent = "Could not load overs.";
    els.topUnderList.textContent = "Could not load unders.";
  }
}

async function refreshData() {
  const sport = els.sport.value || "NHL";
  const btn = els.refreshBtn;
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Refreshing…";

  try {
    await fetchJSON("/api/refresh-data", {
      method: "POST",
      body: JSON.stringify({ sport }),
    });
    await loadBoard();
  } catch (error) {
    console.error(error);
    alert(`Refresh failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

els.filtersForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadBoard();
});

els.resetBtn.addEventListener("click", () => {
  els.filtersForm.reset();
  els.sport.value = "NHL";
  els.date.value = today;
  loadBoard();
});

els.refreshBtn.addEventListener("click", refreshData);

loadHealth();
loadBoard();
