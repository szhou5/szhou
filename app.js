const DEFAULT_DATA_PATH = "./data/cards.json";

const state = {
  cards: [],
  activeCardId: null,
  importState: {
    status: "muted",
    message: "Loading stored card history.",
  },
};

const cardSelect = document.querySelector("#card-select");
const cardUrl = document.querySelector("#card-url");
const metricsGrid = document.querySelector("#metrics-grid");
const signalCard = document.querySelector("#signal-card");
const priceChart = document.querySelector("#price-chart");
const rsiChart = document.querySelector("#rsi-chart");
const feedChip = document.querySelector("#feed-chip");
const historyFileInput = document.querySelector("#history-file");
const resetDataButton = document.querySelector("#reset-data");
const importStatus = document.querySelector("#import-status");

init();

async function init() {
  cardSelect.addEventListener("change", (event) => {
    state.activeCardId = event.target.value;
    render();
  });

  historyFileInput.addEventListener("change", handleHistoryImport);
  resetDataButton.addEventListener("click", resetImportedData);

  await loadStoredHistory();
  render();
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
    state.activeCardId = state.cards[0]?.id ?? null;

    if (!state.cards.length) {
      throw new Error("No stored card history was found.");
    }

    state.importState = {
      status: "success",
      message: `Loaded ${state.cards.length} stored card history file${state.cards.length === 1 ? "" : "s"} from data/cards.json.`,
    };
    populateCardSelect();
  } catch (error) {
    state.cards = [];
    state.activeCardId = null;
    state.importState = {
      status: "error",
      message:
        "The stored history manifest could not be loaded. Run the collector script or import a CSV/JSON file manually.",
    };
    populateCardSelect();
  }
}

function normalizeStoredCard(card) {
  const prices = Array.isArray(card.prices) ? card.prices.map(normalizeHistoryRow) : [];

  return {
    id: card.id,
    name: card.name,
    sourceUrl: card.sourceUrl || "",
    feedLabel: card.feedLabel || "Stored Data",
    sourceName: card.sourceName || "",
    priceField: card.priceField || "price",
    prices,
  };
}

function populateCardSelect() {
  cardSelect.innerHTML = "";

  for (const card of state.cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    cardSelect.append(option);
  }

  if (state.activeCardId) {
    cardSelect.value = state.activeCardId;
  }
}

async function handleHistoryImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const importedPrices = parseImportedHistory(text, file.name);
    const importedCard = {
      id: "manual-import",
      name: `Imported History (${file.name})`,
      sourceUrl: "",
      feedLabel: "Manual Import",
      sourceName: "Local File",
      priceField: "price",
      prices: importedPrices,
    };

    state.cards = [importedCard, ...state.cards.filter((card) => card.id !== importedCard.id)];
    state.activeCardId = importedCard.id;
    state.importState = {
      status: "success",
      message: `Imported ${importedPrices.length} daily rows from ${file.name}. All chart metrics now use that file.`,
    };
    populateCardSelect();
    render();
  } catch (error) {
    state.importState = {
      status: "error",
      message: error instanceof Error ? error.message : "Could not read that history file.",
    };
    historyFileInput.value = "";
    renderImportStatus();
  }
}

async function resetImportedData() {
  historyFileInput.value = "";
  await loadStoredHistory();
  render();
}

function render() {
  const card = state.cards.find((entry) => entry.id === state.activeCardId) ?? state.cards[0];
  if (!card || !card.prices?.length) {
    cardSelect.innerHTML = "";
    cardUrl.value = "";
    cardUrl.placeholder = "No stored data loaded";
    feedChip.textContent = "No Data";
    metricsGrid.innerHTML = "";
    signalCard.innerHTML = `
      <h3>No historical data loaded</h3>
      <p>Run the collector script or import a CSV or JSON file to calculate the chart, moving averages, and RSI.</p>
    `;
    priceChart.innerHTML = "";
    rsiChart.innerHTML = "";
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
  cardUrl.placeholder = card.sourceUrl ? "" : "Imported file has no source URL";
  feedChip.textContent = card.feedLabel;
  renderMetrics(latest, card);
  renderSignal(signal, latest, card);
  renderPriceChart(card.prices, sma20, sma50);
  renderRsiChart(card.prices, rsi14);
  renderImportStatus();
}

function renderMetrics(latest, card) {
  const metrics = [
    ["Last Price", formatUsd(latest.price)],
    ["20D SMA", formatUsd(latest.sma20)],
    ["50D SMA", formatUsd(latest.sma50)],
    ["RSI (14)", formatIndicatorNumber(latest.rsi)],
    ["Vs 20D", formatPercent(latest.vsSma20)],
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

function renderSignal(signal, latest, card) {
  signalCard.innerHTML = `
    <h3>${signal.title}</h3>
    <p>${signal.description(latest, card)}</p>
    <span class="signal-score">${signal.label} · Score ${signal.score}/100</span>
  `;

  signalCard.style.borderColor = signal.border;
  signalCard.style.background = `
    linear-gradient(180deg, ${signal.glowTop}, ${signal.glowBottom}),
    rgba(255, 255, 255, 0.04)
  `;
}

function renderImportStatus() {
  importStatus.textContent = state.importState.message;
  importStatus.className = `import-status import-status--${state.importState.status}`;
}

function renderPriceChart(prices, sma20, sma50) {
  const width = 860;
  const height = 360;
  const padding = { top: 22, right: 22, bottom: 32, left: 52 };
  const values = [
    ...prices.map((entry) => entry.price),
    ...sma20.filter(isFiniteNumber),
    ...sma50.filter(isFiniteNumber),
  ];
  const chart = buildLineChartSvg({
    width,
    height,
    padding,
    labels: prices.map((entry) => entry.label),
    series: [
      { values: prices.map((entry) => entry.price), color: "var(--price)", strokeWidth: 3.2 },
      { values: sma20, color: "var(--sma20)", strokeWidth: 2.4 },
      { values: sma50, color: "var(--sma50)", strokeWidth: 2.4 },
    ],
    yDomain: paddedExtent(values, 0.08),
    yTickFormatter: formatUsd,
  });

  priceChart.innerHTML = chart.svg + buildLegend([
    ["Price", "var(--price)"],
    ["20-day SMA", "var(--sma20)"],
    ["50-day SMA", "var(--sma50)"],
  ]);
}

function renderRsiChart(prices, rsi) {
  const width = 860;
  const height = 220;
  const padding = { top: 16, right: 22, bottom: 32, left: 52 };
  const chart = buildLineChartSvg({
    width,
    height,
    padding,
    labels: prices.map((entry) => entry.label),
    series: [{ values: rsi, color: "var(--rsi)", strokeWidth: 2.8 }],
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

function buildLineChartSvg({
  width,
  height,
  padding,
  labels,
  series,
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
    .map((index) => `
      <text x="${xAt(index)}" y="${height - 10}" text-anchor="middle" class="axis-text">${labels[index]}</text>
    `)
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

  return {
    svg: `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Card price chart">
        ${yGrid}
        ${guides}
        ${paths}
        ${latestDots}
        ${xTicks}
      </svg>
    `,
  };
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
  let score = 50;

  if (isFiniteNumber(snapshot.vsSma20) && snapshot.vsSma20 < -0.03) {
    score += 18;
  } else if (isFiniteNumber(snapshot.vsSma20) && snapshot.vsSma20 < 0) {
    score += 10;
  }

  if (isFiniteNumber(snapshot.vsSma50) && snapshot.vsSma50 < -0.05) {
    score += 15;
  } else if (isFiniteNumber(snapshot.vsSma50) && snapshot.vsSma50 < 0) {
    score += 8;
  }

  if (isFiniteNumber(snapshot.rsi) && snapshot.rsi <= 35) {
    score += 18;
  } else if (isFiniteNumber(snapshot.rsi) && snapshot.rsi < 45) {
    score += 10;
  } else if (isFiniteNumber(snapshot.rsi) && snapshot.rsi > 65) {
    score -= 14;
  }

  score = clamp(Math.round(score), 0, 100);

  if (score >= 75) {
    return {
      score,
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

function parseImportedHistory(text, fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const rawRows =
    extension === "json" ? parseJsonHistory(text) : extension === "csv" ? parseCsvHistory(text) : parseUnknownHistory(text);

  if (rawRows.length < 15) {
    throw new Error("Imported history needs at least 15 rows to calculate RSI(14).");
  }

  const normalizedRows = rawRows
    .map(normalizeHistoryRow)
    .sort((left, right) => left.date.localeCompare(right.date));

  ensureUniqueDates(normalizedRows);
  return normalizedRows;
}

function parseUnknownHistory(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonHistory(text);
  }

  return parseCsvHistory(text);
}

function parseJsonHistory(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.prices)) {
    return parsed.prices;
  }

  if (Array.isArray(parsed?.data)) {
    return parsed.data;
  }

  throw new Error("JSON must be an array of rows or contain a prices/data array.");
}

function parseCsvHistory(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const headers = splitCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const dateIndex = headers.findIndex((header) => ["date", "day", "timestamp"].includes(header));
  const priceIndex = headers.findIndex((header) =>
    ["price", "close", "marketprice", "market_price", "last_price", "lastprice"].includes(header),
  );

  if (dateIndex === -1 || priceIndex === -1) {
    throw new Error("CSV must contain date and price columns.");
  }

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    if (values.length <= Math.max(dateIndex, priceIndex)) {
      throw new Error(`CSV row ${index + 2} is missing a required value.`);
    }

    return {
      date: values[dateIndex],
      price: values[priceIndex],
    };
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
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

function ensureUniqueDates(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.date)) {
      throw new Error(`Duplicate date found in import: ${row.date}`);
    }
    seen.add(row.date);
  }
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
  const [year, month, day] = dateString.split("-");
  void year;
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
