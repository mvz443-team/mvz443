const fileInput = document.getElementById("fileInput");
const pathInput = document.getElementById("pathInput");
const exportBtn = document.getElementById("exportBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
const tree = document.getElementById("tree");
const sidebarTree = document.getElementById("sidebarTree");
const status = document.getElementById("status");
const draftStore = window.LocaleDraftStorage;

const observerState = {
  observer: null,
};

const state = {
  data: null,
  fileName: "",
};

const isObject = (value) => value && typeof value === "object";

const clearTree = () => {
  tree.innerHTML = "";
};

const clearSidebar = () => {
  sidebarTree.innerHTML = "";
};

const updateStatus = (message) => {
  status.textContent = message;
};

const saveDraft = () => {
  if (!draftStore) {
    return;
  }
  draftStore.saveDraft(state.data, state.fileName, pathInput.value);
};

const formatMeta = (value) => {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
};

const autoSizeTextarea = (textarea) => {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
};

const autoSizeAllTextareas = () => {
  const textareas = tree.querySelectorAll("textarea");
  textareas.forEach((textarea) => autoSizeTextarea(textarea));
};

const createLeafEditor = (key, value, onChange) => {
  const leaf = document.createElement("div");
  leaf.className = "leaf";

  const keyEl = document.createElement("div");
  keyEl.className = "leaf-key";
  keyEl.textContent = key;

  const editorWrap = document.createElement("div");

  if (typeof value === "string") {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    autoSizeTextarea(textarea);
    textarea.addEventListener("input", () => {
      autoSizeTextarea(textarea);
      onChange(textarea.value);
      saveDraft();
    });
    editorWrap.appendChild(textarea);
  } else if (typeof value === "number") {
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    input.addEventListener("input", () => {
      const next = Number(input.value);
      onChange(Number.isNaN(next) ? value : next);
      saveDraft();
    });
    editorWrap.appendChild(input);
  } else if (typeof value === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.addEventListener("change", () => {
      onChange(input.checked);
      saveDraft();
    });
    editorWrap.appendChild(input);
  } else if (value === null) {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "null";
    input.addEventListener("input", () => {
      onChange(input.value);
      saveDraft();
    });
    editorWrap.appendChild(input);
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.value = JSON.stringify(value);
    input.addEventListener("input", () => {
      onChange(input.value);
      saveDraft();
    });
    editorWrap.appendChild(input);
  }

  leaf.appendChild(keyEl);
  leaf.appendChild(editorWrap);
  return leaf;
};

const renderNode = (container, key, value, parentRef, path) => {
  const currentPath = path ? `${path}.${key}` : key;
  if (isObject(value)) {
    const details = document.createElement("details");
    details.open = true;
    details.dataset.path = currentPath;

    const summary = document.createElement("summary");
    const toggle = document.createElement("span");
    toggle.className = "node-toggle";
    summary.appendChild(toggle);
    summary.appendChild(document.createTextNode(key));

    const meta = document.createElement("span");
    meta.className = "node-meta";
    meta.textContent = formatMeta(value);
    summary.appendChild(meta);

    details.appendChild(summary);

    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);

    entries.forEach(([childKey, childValue]) => {
      renderNode(details, childKey, childValue, value, currentPath);
    });

    container.appendChild(details);
    return;
  }

  const leaf = createLeafEditor(key, value, (nextValue) => {
    parentRef[key] = nextValue;
    exportBtn.disabled = false;
  });
  leaf.dataset.path = currentPath;
  container.appendChild(leaf);
};

const renderStructureNode = (container, key, value, path) => {
  const nextPath = path ? `${path}.${key}` : key;
  if (isObject(value)) {
    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    const toggle = document.createElement("span");
    toggle.className = "node-toggle";
    summary.appendChild(toggle);
    summary.appendChild(document.createTextNode(key));

    const meta = document.createElement("span");
    meta.className = "node-meta";
    meta.textContent = formatMeta(value);
    summary.appendChild(meta);

    details.appendChild(summary);

    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);

    entries.forEach(([childKey, childValue]) => {
      renderStructureNode(details, childKey, childValue, nextPath);
    });

    container.appendChild(details);
    return;
  }

  const leaf = document.createElement("div");
  leaf.className = "leaf";
  const keyEl = document.createElement("a");
  keyEl.className = "leaf-key nav-item";
  keyEl.href = `#${encodeURIComponent(nextPath)}`;
  keyEl.textContent = key;
  leaf.appendChild(keyEl);
  container.appendChild(leaf);
};

const setupScrollSpy = () => {
  if (observerState.observer) {
    observerState.observer.disconnect();
  }

  const targets = tree.querySelectorAll("details[data-path], .leaf[data-path]");
  const sidebarLinks = sidebarTree.querySelectorAll(".nav-item");
  const linkMap = new Map();

  sidebarLinks.forEach((link) => {
    const hash = link.getAttribute("href");
    if (!hash) {
      return;
    }
    linkMap.set(decodeURIComponent(hash.slice(1)), link);
  });

  const setActive = (path) => {
    sidebarLinks.forEach((link) => link.classList.remove("active"));
    const activeLink = linkMap.get(path);
    if (activeLink) {
      activeLink.classList.add("active");
      activeLink.scrollIntoView({ block: "nearest" });
    }
  };

  observerState.observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
      filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible.length > 0) {
        const path = visible[0].target.dataset.path;
        if (path) {
          setActive(path);
        }
      }
    },
    { root: null, rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.4, 0.8] }
  );

  targets.forEach((target) => observerState.observer.observe(target));

  sidebarTree.addEventListener("click", (event) => {
    const link = event.target.closest("a.nav-item");
    if (!link) {
      return;
    }
    event.preventDefault();
    const path = decodeURIComponent(link.getAttribute("href").slice(1));
    const target = tree.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(path);
    }
  });
};

const renderTree = () => {
  clearTree();
  clearSidebar();

  if (!state.data) {
    updateStatus("Please import a locale JSON file.");
    return;
  }

  renderNode(tree, "root", state.data, { root: state.data }, "");
  renderStructureNode(sidebarTree, "root", state.data, "");
  requestAnimationFrame(autoSizeAllTextareas);
  requestAnimationFrame(setupScrollSpy);
  updateStatus("Loaded. You can edit and export.");
};

const tryRestoreDraft = () => {
  if (!draftStore || !draftStore.hasDraft()) {
    renderTree();
    return;
  }

  const draft = draftStore.loadDraft();
  if (!draft || !draft.data) {
    renderTree();
    return;
  }

  const confirmRestore = window.confirm("Load the last auto-saved draft?");
  if (!confirmRestore) {
    renderTree();
    return;
  }

  state.data = draft.data;
  state.fileName = draft.fileName || "locale.json";
  pathInput.value = draft.path || "";
  exportBtn.disabled = false;
  saveAsBtn.disabled = false;
  renderTree();
  updateStatus("Loaded the last auto-saved draft.");
};

const handleFile = (file) => {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state.data = parsed;
      state.fileName = file.name || "locale.json";
      pathInput.value = file.webkitRelativePath || file.name || "";
      exportBtn.disabled = false;
      saveAsBtn.disabled = false;
      saveDraft();
      renderTree();
    } catch (error) {
      updateStatus("Parse failed. Please ensure this is a JSON file.");
      exportBtn.disabled = true;
      saveAsBtn.disabled = true;
    }
  };

  reader.readAsText(file);
};

const exportFile = () => {
  if (!state.data) {
    return;
  }

  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.fileName || "locale.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const saveAsFile = async () => {
  if (!state.data) {
    return;
  }

  const jsonText = JSON.stringify(state.data, null, 2);
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: state.fileName || "locale.json",
        types: [
          {
            description: "JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      updateStatus("Saved as a new file.");
      return;
    } catch (error) {
      updateStatus("Save As canceled or failed. Falling back to download.");
    }
  }

  exportFile();
};

fileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  handleFile(file);
});

exportBtn.addEventListener("click", exportFile);
saveAsBtn.addEventListener("click", saveAsFile);

tryRestoreDraft();
