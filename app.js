const DEFAULT_DATA_PATH = "./data/cards.json";
const CARD_SEARCH_PATH = "./api/cards/search";
const CARD_HISTORY_PATH = "./api/cards";
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 250;

const state = {
  cards: [],
  activeCardId: null,
  importState: {
    status: "muted",
    message: "Loading stored card history.",
  },
  searchState: {
    query: "",
    status: "muted",
    message: "Search by name, slug, type, rarity, or color.",
    results: [],
  },
};

const cardSearchForm = document.querySelector("#card-search-form");
const cardSelect = document.querySelector("#card-select");
const cardSearch = document.querySelector("#card-search");
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const cardUrl = document.querySelector("#card-url");
const metricsGrid = document.querySelector("#metrics-grid");
const signalCard = document.querySelector("#signal-card");
const priceChart = document.querySelector("#price-chart");
const priceSummary = document.querySelector("#price-summary");
const trendSummary = document.querySelector("#trend-summary");
const selectedCardMeta = document.querySelector("#selected-card-meta");
const rsiChart = document.querySelector("#rsi-chart");
const feedChip = document.querySelector("#feed-chip");
const importStatus = document.querySelector("#data-status");

let searchDebounceHandle = null;
let activeSearchController = null;
let activeHistoryController = null;
let resizeRenderHandle = null;

init();

async function init() {
  cardSelect.addEventListener("change", (event) => {
    state.activeCardId = event.target.value || null;
    render();
  });
  cardSearchForm.addEventListener("submit", handleSearchSubmit);
  cardSearch.addEventListener("input", handleSearchInput);
  searchResults.addEventListener("click", handleSearchResultClick);
  window.addEventListener("resize", handleWindowResize, { passive: true });

  await loadStoredHistory();
  renderSearch();
  render();
}

function handleWindowResize() {
  if (resizeRenderHandle) {
    window.clearTimeout(resizeRenderHandle);
  }

  resizeRenderHandle = window.setTimeout(() => {
    resizeRenderHandle = null;
    render();
  }, 120);
}

async function loadStoredHistory() {
  try {
    const response = await fetch(DEFAULT_DATA_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${DEFAULT_DATA_PATH}`);
    }

    const payload = await response.json();
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];

    state.cards = cards.map(normalizeStoredCard).filter((card) => card.prices.length >= 15);
    state.activeCardId = null;

    if (!state.cards.length) {
      throw new Error("No stored card history was found.");
    }

    state.importState = {
      status: "success",
      message: `Loaded ${state.cards.length} stored card history file${state.cards.length === 1 ? "" : "s"} from data/cards.json. Search DotGG to load a live card.`,
    };
    populateCardSelect();
  } catch (error) {
    state.cards = [];
    state.activeCardId = null;
    state.importState = {
      status: "error",
      message: "The stored history manifest could not be loaded. Search DotGG to load a live card.",
    };
    populateCardSelect();
  }
}

function normalizeStoredCard(card) {
  const prices = Array.isArray(card.prices) ? card.prices.map(normalizeHistoryRow) : [];

  return {
    id: card.id,
    dotggCardId: card.dotggCardId || card.id,
    name: card.name,
    slug: card.slug || "",
    setName: card.setName || "",
    rarity: card.rarity || "",
    type: card.type || "",
    supertype: card.supertype || "",
    colors: Array.isArray(card.colors) ? card.colors : [],
    imageUrl: card.imageUrl || "",
    currentPrice: normalizePrice(card.currentPrice),
    sourceUrl: card.sourceUrl || "",
    feedLabel: card.feedLabel || "Stored Data",
    sourceName: card.sourceName || "",
    priceField: card.priceField || "price",
    prices,
  };
}

function populateCardSelect() {
  cardSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.cards.length
    ? "Select a card to load"
    : "No cards available";
  cardSelect.append(placeholder);

  for (const card of state.cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    cardSelect.append(option);
  }

  cardSelect.value = state.activeCardId || "";
}

function handleSearchInput(event) {
  const query = event.target.value.trim();

  if (searchDebounceHandle) {
    window.clearTimeout(searchDebounceHandle);
  }

  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

  if (!prepareSearch(query)) {
    return;
  }

  searchDebounceHandle = window.setTimeout(() => {
    void performCardSearch(query, {
      autoLoadTopResult: shouldAutoLoadTopResult(query),
      requireTopResultMatch: true,
    });
  }, SEARCH_DEBOUNCE_MS);
}

async function handleSearchSubmit(event) {
  event.preventDefault();

  const query = cardSearch.value.trim();
  if (searchDebounceHandle) {
    window.clearTimeout(searchDebounceHandle);
    searchDebounceHandle = null;
  }

  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

  if (!prepareSearch(query)) {
    return;
  }

  await performCardSearch(query, {
    autoLoadTopResult: true,
    requireTopResultMatch: false,
  });
}

function prepareSearch(query) {
  state.searchState.query = query;

  if (!query) {
    state.searchState = {
      query: "",
      status: "muted",
      message: "Search by name, slug, type, rarity, or color.",
      results: [],
    };
    renderSearch();
    return false;
  }

  if (query.length < 2) {
    state.searchState = {
      query,
      status: "muted",
      message: "Type at least 2 characters to search DotGG.",
      results: [],
    };
    renderSearch();
    return false;
  }

  state.searchState = {
    query,
    status: "muted",
    message: `Searching DotGG for "${query}"...`,
    results: [],
  };
  renderSearch();
  return true;
}

function shouldAutoLoadTopResult(query) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return false;
  }

  return normalizedQuery.length >= 4;
}

async function performCardSearch(
  query,
  { autoLoadTopResult = false, requireTopResultMatch = true } = {},
) {
  activeSearchController = new AbortController();

  try {
    const url = `${CARD_SEARCH_PATH}?q=${encodeURIComponent(query)}&limit=${SEARCH_RESULT_LIMIT}`;
    const response = await fetch(url, {
      signal: activeSearchController.signal,
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || "Card search failed.");
    }

    state.searchState = {
      query,
      status: payload.cards.length ? "success" : "muted",
      message: payload.cards.length
        ? `Found ${payload.cards.length} matching Riftbound card${payload.cards.length === 1 ? "" : "s"}.`
        : `No Riftbound cards matched "${query}".`,
      results: payload.cards,
    };
    renderSearch();

    const shouldLoadTopCard =
      autoLoadTopResult &&
      payload.cards.length &&
      (!requireTopResultMatch || shouldLoadResultForQuery(query, payload.cards[0]));

    if (shouldLoadTopCard) {
      await loadLiveCard(payload.cards[0].id);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    state.searchState = {
      query,
      status: "error",
      message:
        error instanceof Error ? error.message : "The live DotGG search is unavailable right now.",
      results: [],
    };
    renderSearch();
  } finally {
    activeSearchController = null;
  }
}

function shouldLoadResultForQuery(query, card) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery || !card) {
    return false;
  }

  const normalizedName = normalizeSearchValue(card.name);
  const normalizedSlug = normalizeSearchValue(card.slug);

  if (normalizedQuery === normalizedName || normalizedQuery === normalizedSlug) {
    return true;
  }

  if (normalizedName.startsWith(normalizedQuery) || normalizedSlug.startsWith(normalizedQuery)) {
    return true;
  }

  return false;
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function handleSearchResultClick(event) {
  const trigger = event.target.closest("[data-card-id]");
  if (!trigger) {
    return;
  }

  const cardId = trigger.getAttribute("data-card-id");
  if (!cardId) {
    return;
  }

  await loadLiveCard(cardId);
}

async function loadLiveCard(cardId) {
  if (activeHistoryController) {
    activeHistoryController.abort();
  }

  const matchedResult = state.searchState.results.find((card) => card.id === cardId);
  const cardName = matchedResult?.name || cardId;

  state.importState = {
    status: "muted",
    message: `Loading live DotGG history for ${cardName}...`,
  };
  renderImportStatus();

  activeHistoryController = new AbortController();

  try {
    const response = await fetch(
      `${CARD_HISTORY_PATH}/${encodeURIComponent(cardId)}/history?timepattern=6m`,
      {
        signal: activeHistoryController.signal,
        cache: "no-store",
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Could not load live card history.");
    }

    const liveCard = normalizeStoredCard(payload.card);
    upsertCard(liveCard);
    state.activeCardId = liveCard.id;
    state.importState = {
      status: "success",
      message: `Loaded ${liveCard.prices.length} live price rows for ${liveCard.name} from DotGG.`,
    };
    populateCardSelect();
    render();
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    state.importState = {
      status: "error",
      message: error instanceof Error ? error.message : `Could not load live history for ${cardName}.`,
    };
    renderImportStatus();
  } finally {
    activeHistoryController = null;
  }
}

function upsertCard(card) {
  const existingIndex = state.cards.findIndex((entry) => entry.id === card.id);
  if (existingIndex >= 0) {
    state.cards.splice(existingIndex, 1, card);
    return;
  }

  state.cards = [card, ...state.cards];
}

function render() {
  const card = state.cards.find((entry) => entry.id === state.activeCardId) ?? null;
  if (!card || !card.prices?.length) {
    cardSelect.value = "";
    cardUrl.value = "";
    cardUrl.placeholder = "Select a card to see its source URL";
    feedChip.textContent = state.cards.length ? "Awaiting Card" : "No Data";
    metricsGrid.innerHTML = "";
    signalCard.innerHTML = `
      <h3>No card selected</h3>
      <p>Choose a card from the list or search DotGG to load live history, price trends, and RSI.</p>
    `;
    selectedCardMeta.innerHTML = `
      <div class="selected-card-meta__empty-panel">
        <div class="selected-card-meta__empty-copy">
          <p class="selected-card-meta__eyebrow">Selected card</p>
          <h3 class="selected-card-meta__title">Nothing loaded yet</h3>
          <p class="selected-card-meta__empty-text">
            Search DotGG or pick a tracked card to populate this panel with card art and details.
          </p>
        </div>
      </div>
    `;
    priceChart.innerHTML = buildEmptyChartState("Pick a card to load the price chart.");
    priceSummary.innerHTML = "";
    trendSummary.innerHTML = "";
    rsiChart.innerHTML = buildEmptyChartState("Pick a card to calculate RSI.", true);
    renderSearch();
    renderImportStatus();
    return;
  }

  const closePrices = card.prices.map((entry) => entry.price);
  const sma20 = calculateSma(closePrices, 20);
  const sma50 = calculateSma(closePrices, 50);
  const rsi14 = calculateRsi(closePrices, 14);
  const latest = getLatestSnapshot(card.prices, sma20, sma50, rsi14);
  const signal = scoreBuyingOpportunity(latest);

  cardSelect.value = card.id;
  cardUrl.value = card.sourceUrl || "";
  cardUrl.placeholder = card.sourceUrl ? "" : "This card has no source URL";
  feedChip.textContent = card.feedLabel;
  renderSelectedCardMeta(card, latest);
  renderMetrics(latest, card);
  renderSignalCard(signal, latest, card);
  renderPriceChart(card.prices, sma20, sma50);
  renderPriceSummary(latest);
  renderTrendSummary(latest);
  renderRsiChart(card.prices, rsi14);
  renderSearch();
  renderImportStatus();
}

function renderSearch() {
  searchStatus.textContent = state.searchState.message;
  searchStatus.className = `import-status import-status--${state.searchState.status}`;

  if (!state.searchState.results.length) {
    searchResults.innerHTML = state.searchState.query
      ? `<p class="search-results__empty">No live DotGG cards are ready to load yet.</p>`
      : "";
    return;
  }

  searchResults.innerHTML = state.searchState.results
    .map(
      (card) => `
        <button class="search-result" type="button" data-card-id="${escapeHtml(card.id)}">
          <img
            class="search-result__image"
            src="${escapeHtml(card.imageUrl || "")}"
            alt="${escapeHtml(card.name)}"
            loading="lazy"
          />
          <span class="search-result__content">
            <span class="search-result__title">${escapeHtml(card.name)}</span>
            <span class="search-result__meta">${escapeHtml(buildSearchMeta(card))}</span>
            <span class="search-result__price">${escapeHtml(buildSearchPriceLabel(card))}</span>
          </span>
        </button>
      `,
    )
    .join("");
}

function buildSearchMeta(card) {
  const parts = [
    card.setName,
    card.rarity,
    card.type,
    Array.isArray(card.colors) ? card.colors.join(" / ") : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

function buildSearchPriceLabel(card) {
  const priceLabel = card.priceField === "Normal" ? "Market" : "Foil";
  return isFiniteNumber(card.currentPrice)
    ? `${priceLabel}: ${formatUsd(card.currentPrice)}`
    : `${priceLabel}: No live price`;
}

function renderMetrics(latest, card) {
  const metrics = [
    ["Source", card.sourceName || card.feedLabel],
  ];

  metricsGrid.innerHTML = metrics
    .map(
      ([label, value]) => `
        <article class="metric">
          <div class="metric-label">${label}</div>
          <div class="metric-value">${value}</div>
        </article>
      `,
    )
    .join("");
}

function renderSelectedCardMeta(card, latest) {
  const metadata = [
    ["Set", buildSetLabel(card)],
    ["Card ID", buildCardCode(card) || "N/A"],
    ["Rarity", card.rarity || "N/A"],
    ["Type", buildTypeLabel(card)],
    ["Color", buildColorLabel(card.colors)],
    ["Feed", card.feedLabel || "N/A"],
  ];

  selectedCardMeta.innerHTML = `
    <div class="selected-card-meta__media">
      ${
        card.imageUrl
          ? `<img class="selected-card-meta__image" src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}" loading="lazy" />`
          : `<div class="selected-card-meta__image selected-card-meta__image--empty">No card art</div>`
      }
    </div>
    <div class="selected-card-meta__content">
      <div class="selected-card-meta__header">
        <div>
          <p class="selected-card-meta__eyebrow">Selected card</p>
          <h3 class="selected-card-meta__title">${escapeHtml(buildMetaTitle(card))}</h3>
          <p class="selected-card-meta__subtitle">${escapeHtml(buildMetaSubtitle(card, latest))}</p>
        </div>
        <a
          class="selected-card-meta__link"
          href="${escapeHtml(card.sourceUrl || "#")}"
          target="_blank"
          rel="noreferrer"
          ${card.sourceUrl ? "" : 'aria-disabled="true" tabindex="-1"'}
        >
          Open on Riftbound.gg
        </a>
      </div>
      <div class="selected-card-meta__grid">
        ${metadata
          .map(
            ([label, value]) => `
              <article class="selected-card-meta__item">
                <div class="selected-card-meta__label">${escapeHtml(label)}</div>
                <div class="selected-card-meta__value">${escapeHtml(value)}</div>
              </article>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function buildMetaTitle(card) {
  const code = buildCardCode(card);
  if (!code) {
    return card.name || "Selected card";
  }

  return `${code} ${card.name}`.trim();
}

function buildCardCode(card) {
  return String(card.dotggCardId || card.id || "").trim();
}

function buildSetLabel(card) {
  const code = buildCardCode(card);
  const setCode = code.split("-")[0] || "";
  return [setCode, card.setName].filter(Boolean).join(" - ") || "N/A";
}

function buildColorLabel(colors) {
  return Array.isArray(colors) && colors.length ? colors.join(" / ") : "N/A";
}

function buildTypeLabel(card) {
  return [card.supertype, card.type].filter(Boolean).join(" / ") || card.type || "N/A";
}

function buildMetaSubtitle(card, latest) {
  const parts = [
    card.rarity,
    buildColorLabel(card.colors),
    isFiniteNumber(latest.price) ? `Live ${formatUsd(latest.price)}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

function buildEmptyChartState(message, compact = false) {
  const className = compact
    ? "empty-chart-state empty-chart-state--compact"
    : "empty-chart-state";
  return `<div class="${className}">${escapeHtml(message)}</div>`;
}

function renderImportStatus() {
  importStatus.textContent = state.importState.message;
  importStatus.className = `import-status import-status--${state.importState.status}`;
}

function renderSignalCard(signal, latest, card) {
  signalCard.innerHTML = `
    <h3>${signal.title}</h3>
    <p>${signal.description(latest, card)}</p>
    <span class="signal-score">${signal.label} &middot; Score ${signal.score}/100</span>
    <p class="signal-footnote">${signal.scoreFootnote}</p>
  `;

  signalCard.style.borderColor = signal.border;
  signalCard.style.background = `
    linear-gradient(180deg, ${signal.glowTop}, ${signal.glowBottom}),
    rgba(255, 255, 255, 0.04)
  `;
}

function renderPriceChart(prices, sma20, sma50) {
  const chartViewport = getChartViewport(priceChart, { compact: false });
  const series = [
    {
      name: "Price",
      values: prices.map((entry) => entry.price),
      color: "var(--price)",
      strokeWidth: 3.2,
    },
    {
      name: "20-day SMA",
      values: sma20,
      color: "var(--sma20)",
      strokeWidth: 2.4,
    },
    {
      name: "50-day SMA",
      values: sma50,
      color: "var(--sma50)",
      strokeWidth: 2.4,
    },
  ];
  const values = [
    ...prices.map((entry) => entry.price),
    ...sma20.filter(isFiniteNumber),
    ...sma50.filter(isFiniteNumber),
  ];
  const chart = buildLineChartSvg({
    width: chartViewport.width,
    height: chartViewport.height,
    padding: chartViewport.padding,
    labels: prices.map((entry) => entry.label),
    series,
    pointAnnotations: chartViewport.isPhone
      ? buildSeriesPointAnnotations(series[0].values, {
          color: series[0].color,
          formatter: formatUsd,
          seriesIndex: 0,
          includeLast: false,
          extremaCount: 1,
        })
      : series.flatMap((entry, seriesIndex) =>
          buildSeriesPointAnnotations(entry.values, {
            color: entry.color,
            formatter: formatUsd,
            seriesIndex,
            includeLast: false,
            extremaCount: 1,
          }),
        ),
    yDomain: paddedExtent(values, 0.08),
    yTickFormatter: formatUsd,
  });

  priceChart.innerHTML = chart.svg + buildLegend([
    ["Price", "var(--price)"],
    ["20-day SMA", "var(--sma20)"],
    ["50-day SMA", "var(--sma50)"],
  ]);
}

function renderPriceSummary(latest) {
  const cards = [
    ["Latest Price", formatUsd(latest.price), "price"],
    ["Latest 20D SMA", formatUsd(latest.sma20), "sma20"],
    ["Latest 50D SMA", formatUsd(latest.sma50), "sma50"],
  ];

  priceSummary.innerHTML = cards
    .map(
      ([label, value, tone]) => `
        <article class="price-summary__card price-summary__card--${tone}">
          <div class="price-summary__label">${label}</div>
          <div class="price-summary__value">${value}</div>
        </article>
      `,
    )
    .join("");
}

function renderTrendSummary(latest) {
  const cards = [
    ["RSI (14)", formatIndicatorNumber(latest.rsi)],
    ["Vs 20D", formatPercent(latest.vsSma20)],
    ["Vs 50D", formatPercent(latest.vsSma50)],
  ];

  trendSummary.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="trend-summary__card">
          <div class="trend-summary__label">${label}</div>
          <div class="trend-summary__value">${value}</div>
        </article>
      `,
    )
    .join("");
}

function renderRsiChart(prices, rsi) {
  const chartViewport = getChartViewport(rsiChart, { compact: true });
  const rsiSeries = { values: rsi, color: "var(--rsi)", strokeWidth: 2.8 };
  const chart = buildLineChartSvg({
    width: chartViewport.width,
    height: chartViewport.height,
    padding: chartViewport.padding,
    labels: prices.map((entry) => entry.label),
    series: [rsiSeries],
    pointAnnotations: buildLastPointAnnotation(rsiSeries.values, {
      color: rsiSeries.color,
      formatter: formatIndicatorNumber,
      seriesIndex: 0,
    }),
    yDomain: [0, 100],
    yTickFormatter: (value) => value.toFixed(0),
    horizontalGuides: [
      { value: 30, color: "var(--oversold)", dasharray: "5 5" },
      { value: 70, color: "var(--overbought)", dasharray: "5 5" },
    ],
  });

  rsiChart.innerHTML = chart.svg + buildLegend([
    ["RSI", "var(--rsi)"],
    ["Oversold (30)", "var(--oversold)"],
    ["Overbought (70)", "var(--overbought)"],
  ]);
}

function getChartViewport(container, { compact = false } = {}) {
  const containerWidth = Math.floor(container?.clientWidth || 0);
  const width = Math.max(containerWidth, compact ? 320 : 360);
  const isPhone = width <= 420;
  const isCompact = width <= 620;

  const height = compact
    ? isPhone
      ? 184
      : isCompact
        ? 198
        : 220
    : isPhone
      ? 248
      : isCompact
        ? 292
        : 360;

  const padding = isPhone
    ? { top: 16, right: 14, bottom: 28, left: 42 }
    : isCompact
      ? { top: 18, right: 18, bottom: 30, left: 46 }
      : compact
        ? { top: 16, right: 22, bottom: 32, left: 52 }
        : { top: 22, right: 22, bottom: 32, left: 52 };

  return {
    width,
    height,
    padding,
    isPhone,
    isCompact,
  };
}

function buildLineChartSvg({
  width,
  height,
  padding,
  labels,
  series,
  pointAnnotations = [],
  yDomain,
  yTickFormatter,
  horizontalGuides = [],
}) {
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  const [yMin, yMax] = yDomain;
  const xAt = (index) => padding.left + (index / Math.max(labels.length - 1, 1)) * usableWidth;
  const yAt = (value) =>
    padding.top + ((yMax - value) / (yMax - yMin || 1)) * usableHeight;

  const yTicks = 4;
  const yGrid = Array.from({ length: yTicks + 1 }, (_, index) => {
    const value = yMin + ((yMax - yMin) * index) / yTicks;
    const y = yAt(value);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--grid)" />
      <text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" class="axis-text">${yTickFormatter(
        value,
      )}</text>
    `;
  }).join("");

  const tickIndexes = dedupe([0, Math.floor(labels.length / 2), labels.length - 1]).filter(
    (index) => index >= 0,
  );
  const xTicks = tickIndexes
    .map(
      (index) => `
      <text x="${xAt(index)}" y="${height - 10}" text-anchor="middle" class="axis-text">${labels[index]}</text>
    `,
    )
    .join("");

  const guides = horizontalGuides
    .map(({ value, color, dasharray }) => {
      const y = yAt(value);
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${color}" stroke-dasharray="${dasharray}" opacity="0.9" />`;
    })
    .join("");

  const paths = series
    .map(({ values, color, strokeWidth }) => {
      let started = false;
      const path = values.reduce((acc, value, index) => {
        if (!isFiniteNumber(value)) {
          started = false;
          return acc;
        }

        const command = started ? "L" : "M";
        started = true;
        return `${acc} ${command} ${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`;
      }, "");

      return `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("");

  const latestDots = series
    .map(({ values, color }) => {
      const index = findLastFiniteIndex(values);
      if (index === -1) {
        return "";
      }

      return `<circle cx="${xAt(index)}" cy="${yAt(values[index])}" r="4.5" fill="${color}" />`;
    })
    .join("");

  const positionedAnnotations = positionPointAnnotations(pointAnnotations, {
    xAt,
    yAt,
    width,
    height,
    padding,
  });
  const annotationMarks = positionedAnnotations
    .map((annotation) => buildPointAnnotation(annotation))
    .join("");

  return {
    svg: `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Card price chart">
        ${yGrid}
        ${guides}
        ${paths}
        ${latestDots}
        ${annotationMarks}
        ${xTicks}
      </svg>
    `,
  };
}

function buildSeriesPointAnnotations(
  values,
  { color, formatter, seriesIndex, includeLast = true, extremaCount = 2 },
) {
  const finitePoints = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => isFiniteNumber(value));

  if (!finitePoints.length) {
    return [];
  }

  const annotationKindsByIndex = new Map();
  const highest = [...finitePoints]
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .slice(0, extremaCount);
  const lowest = [...finitePoints]
    .sort((left, right) => left.value - right.value || left.index - right.index)
    .slice(0, extremaCount);
  const lastPoint = finitePoints[finitePoints.length - 1];

  for (const point of highest) {
    addAnnotationKind(annotationKindsByIndex, point.index, "high");
  }

  for (const point of lowest) {
    addAnnotationKind(annotationKindsByIndex, point.index, "low");
  }

  if (includeLast) {
    addAnnotationKind(annotationKindsByIndex, lastPoint.index, "last");
  }

  return [...annotationKindsByIndex.entries()].map(([index, kinds]) => ({
    index,
    value: values[index],
    label: formatter(values[index]),
    color,
    seriesIndex,
    totalPoints: values.length,
    kinds,
  }));
}

function buildLastPointAnnotation(values, { color, formatter, seriesIndex }) {
  const index = findLastFiniteIndex(values);
  if (index === -1) {
    return [];
  }

  return [
    {
      index,
      value: values[index],
      label: formatter(values[index]),
      color,
      seriesIndex,
      totalPoints: values.length,
      kinds: ["last"],
    },
  ];
}

function addAnnotationKind(annotationKindsByIndex, index, kind) {
  const kinds = annotationKindsByIndex.get(index) ?? [];
  if (!kinds.includes(kind)) {
    kinds.push(kind);
  }

  annotationKindsByIndex.set(index, kinds);
}

function positionPointAnnotations(annotations, { xAt, yAt, width, height, padding }) {
  const positioned = [];
  const lastAnnotations = [];

  for (const annotation of annotations) {
    const positionedAnnotation = buildBasePointAnnotationLayout(annotation, {
      xAt,
      yAt,
      width,
      height,
      padding,
    });

    if (annotation.kinds.includes("last")) {
      lastAnnotations.push(positionedAnnotation);
      continue;
    }

    positioned.push(positionedAnnotation);
  }

  layoutLastAnnotations(lastAnnotations, { height, padding });
  return [...positioned, ...lastAnnotations];
}

function buildBasePointAnnotationLayout(annotation, { xAt, yAt, width, height, padding }) {
  const x = xAt(annotation.index);
  const y = yAt(annotation.value);
  const labelWidth = Math.max(54, annotation.label.length * 7.4 + 12);
  const labelHeight = 20;
  const labelGap = 10;
  const verticalOffset = annotation.seriesIndex * 18;
  const horizontalOffset = annotation.seriesIndex * 6;

  let boxX = x - labelWidth / 2;
  let boxY = y - labelHeight - labelGap - verticalOffset;
  let textX = x;
  let textY = boxY + 13.5;

  if (annotation.kinds.includes("last")) {
    const preferredLeft = annotation.index > annotation.totalPoints * 0.7;
    if (preferredLeft) {
      boxX = x - labelWidth - labelGap - horizontalOffset;
    } else {
      boxX = x + labelGap + horizontalOffset;
    }
    boxY = y - labelHeight / 2;
    textX = boxX + labelWidth / 2;
    textY = boxY + 13.5;
  } else if (annotation.kinds.includes("low")) {
    boxY = y + labelGap + verticalOffset;
    textY = boxY + 13.5;
  }

  boxX = clamp(boxX, padding.left + 4, width - padding.right - labelWidth - 4);
  boxY = clamp(boxY, padding.top + 4, height - padding.bottom - labelHeight - 4);
  textX = boxX + labelWidth / 2;
  textY = boxY + 13.5;

  return {
    ...annotation,
    x,
    y,
    boxX,
    boxY,
    textX,
    textY,
    labelWidth,
    labelHeight,
  };
}

function layoutLastAnnotations(annotations, { height, padding }) {
  if (!annotations.length) {
    return;
  }

  const spacing = 6;
  const minY = padding.top + 4;
  const maxY = height - padding.bottom - annotations[0].labelHeight - 4;
  const sorted = [...annotations].sort((left, right) => left.y - right.y || left.boxY - right.boxY);

  for (let index = 0; index < sorted.length; index += 1) {
    const annotation = sorted[index];
    const previous = sorted[index - 1];
    const minimumBoxY = previous ? previous.boxY + previous.labelHeight + spacing : minY;
    annotation.boxY = clamp(Math.max(annotation.boxY, minimumBoxY), minY, maxY);
  }

  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const annotation = sorted[index];
    const next = sorted[index + 1];
    const maximumBoxY = next.boxY - annotation.labelHeight - spacing;
    annotation.boxY = clamp(Math.min(annotation.boxY, maximumBoxY), minY, maxY);
  }

  for (const annotation of annotations) {
    annotation.textY = annotation.boxY + 13.5;
  }
}

function buildPointAnnotation(annotation) {
  const { x, y, boxX, boxY, textX, textY, labelWidth, labelHeight } = annotation;

  return `
    <g class="point-annotation">
      <circle cx="${x}" cy="${y}" r="3.6" fill="${annotation.color}" class="point-annotation-dot" />
      <rect x="${boxX}" y="${boxY}" width="${labelWidth}" height="${labelHeight}" rx="10" fill="rgba(9, 17, 31, 0.88)" stroke="${annotation.color}" />
      <text x="${textX}" y="${textY}" text-anchor="middle" class="point-annotation-text">${annotation.label}</text>
    </g>
  `;
}

function buildLegend(items) {
  return `
    <div class="legend">
      ${items
        .map(
          ([label, color]) => `
            <span class="legend-item">
              <span class="legend-swatch" style="background:${color}"></span>
              ${label}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function getLatestSnapshot(prices, sma20, sma50, rsi14) {
  const index = prices.length - 1;
  const price = prices[index].price;
  const latestSma20 = sma20[index];
  const latestSma50 = sma50[index];
  const latestRsi = rsi14[index];

  return {
    price,
    sma20: latestSma20,
    sma50: latestSma50,
    rsi: latestRsi,
    vsSma20: isFiniteNumber(latestSma20) ? (price - latestSma20) / latestSma20 : null,
    vsSma50: isFiniteNumber(latestSma50) ? (price - latestSma50) / latestSma50 : null,
  };
}

function scoreBuyingOpportunity(snapshot) {
  const breakdown = buildSignalScoreBreakdown(snapshot);
  const score = breakdown.score;

  if (score >= 75) {
    return {
      score,
      scoreFootnote: breakdown.footnote,
      label: "Strong buy zone",
      title: "Potential accumulation window",
      border: "rgba(128, 237, 153, 0.26)",
      glowTop: "rgba(128, 237, 153, 0.18)",
      glowBottom: "rgba(128, 237, 153, 0.05)",
      description: (latest, card) =>
        `Price from ${card.sourceName || card.feedLabel} is trading beneath both trend averages while RSI cools to ${formatIndicatorNumber(
          latest.rsi,
        )}. This is the kind of pullback where accumulating becomes more attractive.`,
    };
  }

  if (score >= 60) {
    return {
      score,
      scoreFootnote: breakdown.footnote,
      label: "Watch closely",
      title: "Interesting pullback, not fully washed out",
      border: "rgba(246, 189, 96, 0.28)",
      glowTop: "rgba(246, 189, 96, 0.16)",
      glowBottom: "rgba(246, 189, 96, 0.05)",
      description: (latest, card) =>
        `${card.sourceName || card.feedLabel} history is drifting under recent averages, but RSI at ${formatIndicatorNumber(
          latest.rsi,
        )} suggests momentum has not reached a classic oversold extreme yet.`,
    };
  }

  return {
    score,
    scoreFootnote: breakdown.footnote,
    label: "Wait",
    title: "Momentum is not offering a discount yet",
    border: "rgba(242, 132, 130, 0.24)",
    glowTop: "rgba(242, 132, 130, 0.16)",
    glowBottom: "rgba(242, 132, 130, 0.05)",
    description: (latest, card) =>
      `${card.sourceName || card.feedLabel} shows RSI at ${formatIndicatorNumber(
        latest.rsi,
      )}, and price is not discounted enough versus the moving averages to qualify as a strong value setup.`,
  };
}

function buildSignalScoreBreakdown(snapshot) {
  const baseScore = 50;
  const vsSma20Points = getVsSma20Points(snapshot.vsSma20);
  const vsSma50Points = getVsSma50Points(snapshot.vsSma50);
  const rsiPoints = getRsiPoints(snapshot.rsi);
  const score = clamp(Math.round(baseScore + vsSma20Points + vsSma50Points + rsiPoints), 0, 100);

  return {
    score,
    footnote:
      "Score starts at 50. " +
      `Price vs 20D SMA contributes ${describeTrendPoints(vsSma20Points, snapshot.vsSma20, 18, 10, 0.03)}; ` +
      `price vs 50D SMA contributes ${describeTrendPoints(vsSma50Points, snapshot.vsSma50, 15, 8, 0.05)}; ` +
      `RSI contributes ${describeRsiPoints(rsiPoints, snapshot.rsi)}. ` +
      `Current breakdown: 50 base ${formatSignedPoints(vsSma20Points)} ${formatSignedPoints(vsSma50Points)} ${formatSignedPoints(rsiPoints)} = ${score}.`,
  };
}

function getVsSma20Points(vsSma20) {
  if (!isFiniteNumber(vsSma20)) {
    return 0;
  }

  if (vsSma20 < -0.03) {
    return 18;
  }

  if (vsSma20 < 0) {
    return 10;
  }

  return 0;
}

function getVsSma50Points(vsSma50) {
  if (!isFiniteNumber(vsSma50)) {
    return 0;
  }

  if (vsSma50 < -0.05) {
    return 15;
  }

  if (vsSma50 < 0) {
    return 8;
  }

  return 0;
}

function getRsiPoints(rsi) {
  if (!isFiniteNumber(rsi)) {
    return 0;
  }

  if (rsi <= 35) {
    return 18;
  }

  if (rsi < 45) {
    return 10;
  }

  if (rsi > 65) {
    return -14;
  }

  return 0;
}

function describeTrendPoints(points, value, deepDiscountPoints, discountPoints, deepDiscountThreshold) {
  if (!isFiniteNumber(value)) {
    return "0 when that average is unavailable";
  }

  if (points === deepDiscountPoints) {
    return `${formatSignedPoints(points)} because price is ${formatPercent(value)} below trend`;
  }

  if (points === discountPoints) {
    return `${formatSignedPoints(points)} because price is ${formatPercent(value)} below trend`;
  }

  return `0 because price is ${formatPercent(value)} vs trend and not more than ${formatPercent(-deepDiscountThreshold)} below it`;
}

function describeRsiPoints(points, rsi) {
  if (!isFiniteNumber(rsi)) {
    return "0 when RSI is unavailable";
  }

  if (points !== 0) {
    return `${formatSignedPoints(points)} at RSI ${formatIndicatorNumber(rsi)}`;
  }

  return `0 at RSI ${formatIndicatorNumber(rsi)}`;
}

function normalizeHistoryRow(row, index) {
  const sourceDate = row?.date ?? row?.day ?? row?.timestamp;
  const sourcePrice =
    row?.price ?? row?.close ?? row?.marketPrice ?? row?.market_price ?? row?.last_price;

  const normalizedDate = normalizeDate(sourceDate);
  const normalizedPrice = normalizePrice(sourcePrice);

  if (!normalizedDate) {
    throw new Error(`Row ${index + 1} has an invalid date.`);
  }

  if (!isFiniteNumber(normalizedPrice)) {
    throw new Error(`Row ${index + 1} has an invalid price.`);
  }

  return {
    date: normalizedDate,
    label: formatLabelFromDate(normalizedDate),
    price: normalizedPrice,
  };
}

function normalizeDate(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizePrice(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateSma(values, period) {
  return values.map((_, index) => {
    if (index < period - 1) {
      return null;
    }

    const slice = values.slice(index - period + 1, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

function calculateRsi(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length <= period) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

function paddedExtent(values, paddingRatio) {
  const finiteValues = values.filter(isFiniteNumber);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const padding = (max - min || 1) * paddingRatio;
  return [min - padding, max + padding];
}

function formatLabelFromDate(dateString) {
  const [, month, day] = dateString.split("-");
  return `${month}/${day}`;
}

function formatUsd(value) {
  if (!isFiniteNumber(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  if (!isFiniteNumber(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "always",
  }).format(value);
}

function formatIndicatorNumber(value) {
  return isFiniteNumber(value) ? value.toFixed(1) : "N/A";
}

function formatSignedPoints(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values) {
  return [...new Set(values)];
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function findLastFiniteIndex(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (isFiniteNumber(values[index])) {
      return index;
    }
  }

  return -1;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
