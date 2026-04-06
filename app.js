const CSV_FILE_PATH = "files/50013020548.csv";

const CATEGORY_MAP = {
  髪パーツ: "hair",
  顔パーツ: "face",
  服パーツ: "wear",
};

const SELECT_IDS = {
  hair: "hairSelect",
  face: "faceSelect",
  wear: "wearSelect",
};

const IMAGE_EXT_CANDIDATES = [".png", ".PNG"];
const WHOLE_BODY_IMAGE_PATH = "images/front/wholebody.png";
const WHOLE_BODY_FALLBACK_PATHS = [
  WHOLE_BODY_IMAGE_PATH,
  "images/front/wholebody.PNG",
  "images/output/wholebody.png",
  "images/output/wholebody.PNG",
];
const LOCAL_FALLBACK_OPTIONS = {
  hair: [{ name: "推しぬいワッペン 髪パーツ（サンプル）", sku: "SAMPLE-HAIR" }],
  face: [{ name: "推しぬいワッペン 顔パーツ（サンプル）", sku: "SAMPLE-FACE" }],
  wear: [{ name: "推しぬいワッペン 服パーツ（サンプル）", sku: "SAMPLE-WEAR" }],
};
const IS_FILE_PROTOCOL = window.location.protocol === "file:" || window.location.origin === "null";

const state = {
  view: "front",
  options: { hair: [], face: [], wear: [] },
  selected: { hair: "", face: "", wear: "" },
  srcCache: new Map(),
  baseImagePath: "",
  offsets: {
    initial: {
      hair: { x: "0%", y: "0%" },
      face: { x: "0%", y: "0%" },
      wear: { x: "0%", y: "0%" },
    },
    front: {
      hair: { x: "0%", y: "0%" },
      face: { x: "0%", y: "0%" },
      wear: { x: "0%", y: "0%" },
    },
    back: {
      hair: { x: "0%", y: "0%" },
      face: { x: "0%", y: "0%" },
      wear: { x: "0%", y: "0%" },
    },
  },
};

const ui = {
  frontButton: document.getElementById("frontButton"),
  backButton: document.getElementById("backButton"),
  resetPositionButton: document.getElementById("resetPositionButton"),
  previewStage: document.getElementById("previewStage"),
  previewMessage: document.getElementById("previewMessage"),
  hairSelect: document.getElementById("hairSelect"),
  faceSelect: document.getElementById("faceSelect"),
  wearSelect: document.getElementById("wearSelect"),
  baseLayer: document.getElementById("baseLayer"),
  hairLayer: document.getElementById("hairLayer"),
  faceLayer: document.getElementById("faceLayer"),
  wearLayer: document.getElementById("wearLayer"),
};

const DRAGGABLE_LAYERS = {
  hair: { el: ui.hairLayer, xVar: "--hair-offset-x", yVar: "--hair-offset-y" },
  face: { el: ui.faceLayer, xVar: "--face-offset-x", yVar: "--face-offset-y" },
  wear: { el: ui.wearLayer, xVar: "--wear-offset-x", yVar: "--wear-offset-y" },
};
const X_VAR_TO_CATEGORY = Object.fromEntries(
  Object.entries(DRAGGABLE_LAYERS).map(([category, cfg]) => [cfg.xVar, category]),
);

function normalizeCategory(value) {
  if (!value) return null;
  for (const [label, key] of Object.entries(CATEGORY_MAP)) {
    if (String(value).includes(label)) return key;
  }
  return null;
}

function toOptionLabel(item) {
  return item.name;
}

function uniqueBySku(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.sku)) return false;
    seen.add(item.sku);
    return true;
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsvRows(csvText) {
  return csvText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line));
}

function parseCsvOptions(rows) {
  if (!rows.length) return { hair: [], face: [], wear: [] };

  const header = rows[0];
  const skuIndex = header.indexOf("sku");
  const nameIndex = header.indexOf("商品名");
  if (skuIndex === -1 || nameIndex === -1) {
    throw new Error("CSVヘッダーに sku / 商品名 列が見つかりません");
  }

  const parsed = { hair: [], face: [], wear: [] };
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const sku = String(row[skuIndex] || "").trim();
    const productName = String(row[nameIndex] || "").trim();
    const category = normalizeCategory(productName);
    if (!category || !sku) continue;

    parsed[category].push({ name: productName, sku });
  }

  parsed.hair = uniqueBySku(parsed.hair);
  parsed.face = uniqueBySku(parsed.face);
  parsed.wear = uniqueBySku(parsed.wear);
  return parsed;
}

async function loadOptionsFromCsv() {
  if (IS_FILE_PROTOCOL) {
    return LOCAL_FALLBACK_OPTIONS;
  }

  try {
    const response = await fetch(CSV_FILE_PATH);
    if (!response.ok) {
      throw new Error(`csvの取得に失敗: ${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseCsvRows(csvText);
    const parsed = parseCsvOptions(rows);
    if (!parsed.hair.length || !parsed.face.length || !parsed.wear.length) {
      throw new Error("csvから必要なパーツ情報を読み取れませんでした");
    }
    return parsed;
  } catch (_error) {
    ui.previewMessage.textContent = "ローカルフォールバックのパーツ候補を使用します。";
    return LOCAL_FALLBACK_OPTIONS;
  }
}

function toPathCandidates(view, sku) {
  return IMAGE_EXT_CANDIDATES.map((ext) => `images/${view}/${sku}${ext}`);
}

async function findFirstExistingPath(paths) {
  for (const path of paths) {
    if (IS_FILE_PROTOCOL) {
      return path;
    }

    if (await loadImagePath(path)) {
      return path;
    }
  }

  return "";
}

function loadImagePath(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = path;
  });
}

function fillSelect(selectEl, items, category) {
  selectEl.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.sku;
    option.textContent = toOptionLabel(item);
    selectEl.appendChild(option);
  }

  const first = items[0];
  if (first) {
    state.selected[category] = first.sku;
    selectEl.value = first.sku;
  }
}

async function chooseExistingPath(category, view, sku) {
  const cacheKey = `${category}:${view}:${sku}`;
  if (state.srcCache.has(cacheKey)) return state.srcCache.get(cacheKey);

  const src = await findFirstExistingPath(toPathCandidates(view, sku));
  if (src) {
    state.srcCache.set(cacheKey, src);
    return src;
  }

  if (view === "back") {
    const frontFallbackSrc = await findFirstExistingPath(toPathCandidates("front", sku));
    if (frontFallbackSrc) {
      state.srcCache.set(cacheKey, frontFallbackSrc);
      return frontFallbackSrc;
    }
  }

  state.srcCache.set(cacheKey, "");
  return "";
}

async function setLayerImage(layerEl, category, sku) {
  const view = category === "face" ? "front" : state.view;
  const src = await chooseExistingPath(category, view, sku);

  if (src) {
    layerEl.src = src;
    layerEl.style.display = "block";
  } else {
    layerEl.removeAttribute("src");
    layerEl.style.display = "none";
  }
}

async function resolveWholeBodyPath() {
  if (state.baseImagePath) return state.baseImagePath;

  for (const path of WHOLE_BODY_FALLBACK_PATHS) {
    if (IS_FILE_PROTOCOL) {
      state.baseImagePath = path;
      return path;
    }

    if (await loadImagePath(path)) {
      state.baseImagePath = path;
      return path;
    }
  }
  return WHOLE_BODY_IMAGE_PATH;
}

async function renderPreview() {
  ui.previewStage.dataset.view = state.view;
  ui.baseLayer.src = await resolveWholeBodyPath();
  ui.baseLayer.style.display = "block";

  const jobs = [
    setLayerImage(ui.wearLayer, "wear", state.selected.wear),
    setLayerImage(ui.hairLayer, "hair", state.selected.hair),
  ];

  if (state.view === "front") {
    jobs.push(setLayerImage(ui.faceLayer, "face", state.selected.face));
    ui.faceLayer.style.display = "block";
    ui.previewMessage.textContent = "前面を表示中";
  } else {
    ui.faceLayer.removeAttribute("src");
    ui.faceLayer.style.display = "none";
    ui.previewMessage.textContent = "背面を表示中（顔パーツは非表示）";
  }

  await Promise.all(jobs);
}

function parseOffsetValue(value) {
  const text = String(value || "").trim();
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function formatPercentValue(value) {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function readInitialOffsets() {
  const computed = getComputedStyle(ui.previewStage);
  for (const [category, cfg] of Object.entries(DRAGGABLE_LAYERS)) {
    const initial = {
      x: computed.getPropertyValue(cfg.xVar).trim() || "0%",
      y: computed.getPropertyValue(cfg.yVar).trim() || "0%",
    };
    state.offsets.initial[category] = initial;
    state.offsets.front[category] = { ...initial };
    state.offsets.back[category] = { ...initial };
  }
}

function applyOffsetsForView(view) {
  for (const [category, cfg] of Object.entries(DRAGGABLE_LAYERS)) {
    const offset = state.offsets[view][category];
    ui.previewStage.style.setProperty(cfg.xVar, offset.x);
    ui.previewStage.style.setProperty(cfg.yVar, offset.y);
  }
}

function resetOffsets() {
  for (const [category, cfg] of Object.entries(DRAGGABLE_LAYERS)) {
    const offset = state.offsets.initial[category];
    state.offsets[state.view][category] = { ...offset };
    ui.previewStage.style.setProperty(cfg.xVar, offset.x);
    ui.previewStage.style.setProperty(cfg.yVar, offset.y);
  }
}

function bindDragEvents(cfg) {
  const { el, xVar, yVar } = cfg;
  if (!el) return;

  el.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

  el.addEventListener("pointerdown", (event) => {
    if (el.style.display === "none") return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const computed = getComputedStyle(ui.previewStage);
    const stageRect = ui.previewStage.getBoundingClientRect();
    const initialX = parseOffsetValue(computed.getPropertyValue(xVar));
    const initialY = parseOffsetValue(computed.getPropertyValue(yVar));

    el.style.cursor = "grabbing";
    if (typeof el.setPointerCapture === "function") {
      el.setPointerCapture(event.pointerId);
    }

    const onPointerMove = (moveEvent) => {
      const deltaXPercent = stageRect.width ? ((moveEvent.clientX - startX) / stageRect.width) * 100 : 0;
      const deltaYPercent = stageRect.height ? ((moveEvent.clientY - startY) / stageRect.height) * 100 : 0;
      const nextXText = formatPercentValue(initialX + deltaXPercent);
      const nextYText = formatPercentValue(initialY + deltaYPercent);
      ui.previewStage.style.setProperty(xVar, nextXText);
      ui.previewStage.style.setProperty(yVar, nextYText);
      const category = X_VAR_TO_CATEGORY[xVar];
      if (category) {
        state.offsets[state.view][category] = { x: nextXText, y: nextYText };
      }
    };

    const onPointerUp = (upEvent) => {
      if (typeof el.releasePointerCapture === "function" && el.hasPointerCapture(upEvent.pointerId)) {
        el.releasePointerCapture(upEvent.pointerId);
      }
      el.style.cursor = "grab";
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
  });
}

function bindEvents() {
  for (const [view, button] of [
    ["front", ui.frontButton],
    ["back", ui.backButton],
  ]) {
    button.addEventListener("click", async () => {
      state.view = view;
      ui.frontButton.classList.toggle("active", view === "front");
      ui.backButton.classList.toggle("active", view === "back");
      applyOffsetsForView(view);
      await renderPreview();
    });
  }

  for (const category of ["hair", "face", "wear"]) {
    const select = ui[SELECT_IDS[category]];
    select.addEventListener("change", async (event) => {
      state.selected[category] = event.target.value;
      await renderPreview();
    });
  }

  for (const cfg of Object.values(DRAGGABLE_LAYERS)) {
    bindDragEvents(cfg);
  }

  ui.resetPositionButton.addEventListener("click", () => {
    resetOffsets();
  });
}

async function init() {
  try {
    state.options = await loadOptionsFromCsv();

    fillSelect(ui.hairSelect, state.options.hair, "hair");
    fillSelect(ui.faceSelect, state.options.face, "face");
    fillSelect(ui.wearSelect, state.options.wear, "wear");

    readInitialOffsets();
    resetOffsets();
    bindEvents();
    await renderPreview();
  } catch (error) {
    ui.previewMessage.textContent = `初期化エラー: ${error.message}`;
  }
}

init();
