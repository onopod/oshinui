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

const state = {
  view: "front",
  options: { hair: [], face: [], wear: [] },
  selected: { hair: "", face: "", wear: "" },
  srcCache: new Map(),
  baseImagePath: "",
  offsets: {
    hair: { x: "0px", y: "0px" },
    face: { x: "0px", y: "0px" },
    wear: { x: "0px", y: "0px" },
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

  const slugCandidates = getSlugCandidates(slug);
  for (const baseDir of IMAGE_BASE_DIR_CANDIDATES) {
    for (const candidateSlug of slugCandidates) {
      for (const ext of IMAGE_EXT_CANDIDATES) {
        const path = `${baseDir}/${category}/${view}/${candidateSlug}${ext}`;
        try {
          const res = await fetch(path, { method: "HEAD" });
          if (res.ok) {
            state.srcCache.set(cacheKey, path);
            return path;
          }
        } catch (_err) {
          // ignore
        }
      }
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
    try {
      const res = await fetch(path, { method: "HEAD" });
      if (res.ok) {
        state.baseImagePath = path;
        return path;
      }
    } catch (_err) {
      // ignore
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

function parsePixelValue(value) {
  const parsed = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function readInitialOffsets() {
  const computed = getComputedStyle(ui.previewStage);
  for (const [category, cfg] of Object.entries(DRAGGABLE_LAYERS)) {
    state.offsets[category] = {
      x: computed.getPropertyValue(cfg.xVar).trim() || "0px",
      y: computed.getPropertyValue(cfg.yVar).trim() || "0px",
    };
  }
}

function resetOffsets() {
  for (const [category, cfg] of Object.entries(DRAGGABLE_LAYERS)) {
    const offset = state.offsets[category];
    ui.previewStage.style.setProperty(cfg.xVar, offset.x);
    ui.previewStage.style.setProperty(cfg.yVar, offset.y);
  }
}

function bindDragEvents(cfg) {
  const { el, xVar, yVar } = cfg;
  if (!el) return;

  el.addEventListener("pointerdown", (event) => {
    if (el.style.display === "none") return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const computed = getComputedStyle(ui.previewStage);
    const initialX = parsePixelValue(computed.getPropertyValue(xVar));
    const initialY = parsePixelValue(computed.getPropertyValue(yVar));

    el.style.cursor = "grabbing";
    el.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent) => {
      const nextX = initialX + (moveEvent.clientX - startX);
      const nextY = initialY + (moveEvent.clientY - startY);
      ui.previewStage.style.setProperty(xVar, `${nextX}px`);
      ui.previewStage.style.setProperty(yVar, `${nextY}px`);
    };

    const onPointerUp = (upEvent) => {
      el.releasePointerCapture(upEvent.pointerId);
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
