(() => {
  const STORAGE_KEY = "locale_editor_draft_v1";

  const safeParse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const hasDraft = () => {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  };

  const loadDraft = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return safeParse(raw);
  };

  const saveDraft = (data, fileName, path) => {
    if (!data) {
      return;
    }
    const payload = {
      data,
      fileName: fileName || "",
      path: path || "",
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };

  const clearDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
  };

  window.LocaleDraftStorage = {
    hasDraft,
    loadDraft,
    saveDraft,
    clearDraft,
  };
})();
