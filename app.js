const XLSX_FILE_PATH = "files/推しぬいワッペンデザイナー.xlsx";

const CATEGORY_MAP = {
  "髪パーツ": "hair",
  "顔パーツ": "face",
  "服パーツ": "wear",
};

const SELECT_IDS = {
  hair: "hairSelect",
  face: "faceSelect",
  wear: "wearSelect",
};

const IMAGE_EXT_CANDIDATES = [".png", ".PNG"];
const IMAGE_BASE_DIR_CANDIDATES = ["images/output", "images"];
const WHOLE_BODY_IMAGE_PATH = "images/output/wholebody.png";
const WHOLE_BODY_FALLBACK_PATHS = [
  WHOLE_BODY_IMAGE_PATH,
  "images/output/wholebody.PNG",
  "images/wholebody.png",
  "images/wholebody.PNG",
];
const SLUG_FALLBACK_MAP = {
  short_brown: ["short_bronw"],
  tare_black: ["tare_brown"],
};
const LOCAL_FALLBACK_OPTIONS = {
  hair: [
    { name: "センターパート", color: "ブラック", slug: "centerpart_black" },
    { name: "センターパート", color: "ブラウン", slug: "centerpart_brown" },
    { name: "ショート", color: "ブラック", slug: "short_black" },
    { name: "ショート", color: "ブラウン", slug: "short_brown" },
  ],
  face: [
    { name: "じと目", color: "ブラック", slug: "jito_black" },
    { name: "じと目", color: "ブラウン", slug: "jito_brown" },
    { name: "たれ目", color: "グレー", slug: "tare_gray" },
    { name: "たれ目", color: "ブラウン", slug: "tare_brown" },
  ],
  wear: [
    { name: "アイドル衣装", color: "ブルー", slug: "idol_blue" },
    { name: "アイドル衣装", color: "グリーン", slug: "idol_green" },
  ],
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
  return `${item.name} (${item.color})`;
}

function uniqueBySlug(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

function parseWorkbookRows(rows) {
  const parsed = { hair: [], face: [], wear: [] };
  for (let i = 1; i < rows.length; i += 1) {
    const [rawCategory, rawName, rawColor, rawSlug] = rows[i];
    const category = normalizeCategory(rawCategory);
    const slug = String(rawSlug || "").trim();
    if (!category || !slug) continue;

    parsed[category].push({
      name: String(rawName || "名称不明").trim(),
      color: String(rawColor || "色不明").trim(),
      slug,
    });
  }

  parsed.hair = uniqueBySlug(parsed.hair);
  parsed.face = uniqueBySlug(parsed.face);
  parsed.wear = uniqueBySlug(parsed.wear);
  return parsed;
}

async function loadOptionsFromXlsx() {
  if (IS_FILE_PROTOCOL) {
    return LOCAL_FALLBACK_OPTIONS;
  }

  try {
    const response = await fetch(XLSX_FILE_PATH);
    if (!response.ok) {
      throw new Error(`xlsxの取得に失敗: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    const parsed = parseWorkbookRows(rows);
    if (!parsed.hair.length || !parsed.face.length || !parsed.wear.length) {
      throw new Error("xlsxから必要なパーツ情報を読み取れませんでした");
    }
    return parsed;
  } catch (_error) {
    ui.previewMessage.textContent = "ローカルフォールバックのパーツ候補を使用します。";
    return LOCAL_FALLBACK_OPTIONS;
  }
}

function toPathCandidates(category, view, slug) {
  const slugCandidates = getSlugCandidates(slug);
  const candidates = [];
  for (const baseDir of IMAGE_BASE_DIR_CANDIDATES) {
    for (const candidateSlug of slugCandidates) {
      for (const ext of IMAGE_EXT_CANDIDATES) {
        candidates.push(`${baseDir}/${category}/${view}/${candidateSlug}${ext}`);
      }
    }
  }
  return candidates;
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
    option.value = item.slug;
    option.textContent = toOptionLabel(item);
    selectEl.appendChild(option);
  }

  const first = items[0];
  if (first) {
    state.selected[category] = first.slug;
    selectEl.value = first.slug;
  }
}

function getSlugCandidates(slug) {
  const fallback = SLUG_FALLBACK_MAP[slug] || [];
  return [slug, ...fallback];
}

async function chooseExistingPath(category, view, slug) {
  const cacheKey = `${category}:${view}:${slug}`;
  if (state.srcCache.has(cacheKey)) return state.srcCache.get(cacheKey);

  const candidates = toPathCandidates(category, view, slug);
  for (const path of candidates) {
    if (IS_FILE_PROTOCOL) {
      state.srcCache.set(cacheKey, path);
      return path;
    }

    if (await loadImagePath(path)) {
      state.srcCache.set(cacheKey, path);
      return path;
    }
  }

  state.srcCache.set(cacheKey, "");
  return "";
}

async function setLayerImage(layerEl, category, slug) {
  const view = category === "face" ? "front" : state.view;
  const src = await chooseExistingPath(category, view, slug);

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
    state.options = await loadOptionsFromXlsx();

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
