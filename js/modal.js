/* ============================================================
   Shared modal system
   Handles: information modal, load/replace, save-to-file,
   JSON clipboard import (edit + add), button state.
   ============================================================ */

;(() => {
  const STORAGE_KEYS = {
    sentences: "sentences",
    created: "createdSentences",
    saved: "saveSelected",
    used: "usedIndexes",
  }

  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

  const readStorage = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key))
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  const writeStorage = (key, value) => localStorage.setItem(key, JSON.stringify(value))

  const isEditorPage = () => window.location.pathname.includes("editor.html")

  const showModal = (modal) => {
    if (modal) modal.style.display = "flex"
  }

  const hideModal = (modal) => {
    if (modal) modal.style.display = "none"
  }

  /* ---------- Public helpers (exported to window) ---------- */

  const closeModal = () => {
    $$(".modal").forEach(hideModal)
    const userInput = document.getElementById("user-input")
    if (userInput) userInput.focus()
  }

  const closeInformationModal = () => hideModal($(".information-modal"))
  const closeSaveModal = () => hideModal($(".save-modal"))
  const closeLoadReplaceModal = () => hideModal($(".load-replace-modal"))
  const closeLoadMergeModal = () => hideModal($(".load-merge-modal"))
  const closeJsonConfirmationModal = () => hideModal($(".json-confirmation-modal"))
  const closeJsonAddConfirmationModal = () => hideModal($(".json-add-confirmation-modal"))

  function showInformationModal(text) {
    const infoModal = $(".information-modal")
    const infoText = $("#information-modal-text")
    if (!infoModal || !infoText) return
    infoText.innerText = text
    showModal(infoModal)
    clearTimeout(infoModal._timer)
    infoModal._timer = setTimeout(closeInformationModal, 1200)
  }

  const showSaveModal = () => showModal($(".save-modal"))
  const showLoadReplaceModal = () => {
    updateCreatedListLoadButton()
    showModal($(".load-replace-modal"))
  }
  const showLoadMergeModal = () => showModal($(".load-merge-modal"))
  const showJsonConfirmationModal = () => showModal($(".json-confirmation-modal"))
  const showJsonAddConfirmationModal = () => showModal($(".json-add-confirmation-modal"))

  /* ---------- Normalization ---------- */

  function normalizeDataFormat(data) {
    return (Array.isArray(data) ? data : []).map((item) => {
      if (item && item.hasOwnProperty("example")) return item
      return { ua: item?.ua ?? "", en: item?.en ?? "", example: "" }
    })
  }

  /* ---------- Save "selected" button state ---------- */

  function updateSaveSelectedButtonState() {
    try {
      const saved = readStorage(STORAGE_KEYS.saved)
      const hasItems = saved.length > 0
      const editor = isEditorPage()

      const openBtn = $(".save-selected-open-modal")
      if (openBtn) {
        openBtn.disabled = !editor && !hasItems
        openBtn.classList.toggle("disabled", !editor && !hasItems)
      }

      const saveBtn = $("#save-selected-to-file-btn")
      if (saveBtn) {
        if (editor) {
          saveBtn.disabled = readStorage(STORAGE_KEYS.created).length === 0
        } else {
          saveBtn.disabled = !hasItems
        }
      }
    } catch (e) {
      console.error("Error updating save button state:", e)
    }
  }

  window.addEventListener("saveSelectedChanged", updateSaveSelectedButtonState)
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEYS.saved) updateSaveSelectedButtonState()
  })

  /* ---------- File load (replace / merge) ---------- */

  function handleFileSelect(event) {
    const dataName = event.target.dataset.storage
    const loadMode = event.target.dataset.mode
    const file = event.target.files[0]
    if (event.target.id === "training-list-file") {
      const fileName = $("#training-list-file-name")
      if (fileName) fileName.textContent = file?.name || "Файл не вибрано"
    }
    if (!file) return

    if (file.type !== "text/plain" && file.type !== "application/json") {
      showInformationModal("Будь ласка, виберіть файл формату .txt або .json")
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const finishLoad = () => {
        if (loadMode === "replace") closeLoadReplaceModal()
        else if (loadMode === "merge") closeLoadMergeModal()
      }

      try {
        const parsed = JSON.parse(e.target.result)
        if (!Array.isArray(parsed) || !parsed.every((item) => item && item.ua && item.en)) {
          finishLoad()
          showInformationModal("Файл не містить правильного формату даних.")
          return
        }

        const normalized = normalizeDataFormat(parsed)
        let sentences = normalized

        if (loadMode === "merge" && dataName === STORAGE_KEYS.created) {
          const existing = readStorage(STORAGE_KEYS.created)
          const merged = [...normalized, ...existing]
          sentences = Array.from(new Map(merged.map((item) => [item.en, item])).values())
        }

        writeStorage(dataName, sentences)
        finishLoad()

        if (dataName === STORAGE_KEYS.sentences) {
          localStorage.removeItem(STORAGE_KEYS.used)
        }
        setTimeout(() => location.reload(), 600)
      } catch (err) {
        finishLoad()
        showInformationModal("Сталася помилка при обробці файлу.")
      }
    }

    reader.onerror = () => showInformationModal("Помилка читання файлу.")
    reader.readAsText(file)
  }

  function updateCreatedListLoadButton() {
    const button = $("#load-created-list-btn")
    const status = $("#created-list-load-status")
    if (!button || !status) return

    const created = readStorage(STORAGE_KEYS.created)
    button.disabled = created.length === 0
    status.textContent = created.length
      ? `Знайдено ${created.length} речень у списку зі сторінки «Створити список».`
      : "На сторінці «Створити список» ще немає збережених речень."
  }

  function loadCreatedListForTraining() {
    const created = readStorage(STORAGE_KEYS.created)
    if (!created.length) {
      showInformationModal("Спочатку створіть або завантажте список на сторінці «Створити список».")
      return
    }

    writeStorage(STORAGE_KEYS.sentences, normalizeDataFormat(created))
    localStorage.removeItem(STORAGE_KEYS.used)
    closeLoadReplaceModal()
    showInformationModal("Створений список завантажено для тренування.")
    setTimeout(() => location.reload(), 900)
  }

  /* ---------- Save to file ---------- */

  // Default file name suffix: "DD.MM.YYYY time HH.MM" in the user's local time.
  // ":" is forbidden in file names (Windows etc.), so the time uses ".".
  function getDefaultFileStamp() {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, "0")
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`
    return `${date} time ${time}`
  }

  function saveToFile(event) {
    const storageKey = event.currentTarget.dataset.storage
    const sentences = readStorage(storageKey)
    const fileNameInput = $("#file-name")
    const requestedName = fileNameInput?.value.trim()
    const safeName = requestedName
      ? requestedName.replace(/\.json$/i, "").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/[. ]+$/g, "")
      : `Sentence list ${getDefaultFileStamp()}`
    const fileName = `${safeName || "Sentence list"}.json`

    if (!sentences.length) {
      closeSaveModal()
      showInformationModal("Нічого не вибрано")
      return
    }

    closeSaveModal()
    if (fileNameInput) fileNameInput.value = ""

    const blob = new Blob([JSON.stringify(normalizeDataFormat(sentences), null, 2)], {
      type: "application/json;charset=utf-8",
    })
    const link = document.createElement("a")
    const objectUrl = URL.createObjectURL(blob)
    link.href = objectUrl
    link.download = fileName
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
      link.remove()
    }, 1000)

    if (storageKey === STORAGE_KEYS.saved) {
      localStorage.removeItem(STORAGE_KEYS.saved)
      window.dispatchEvent(new Event("saveSelectedChanged"))
      updateSaveSelectedButtonState()
    }
  }

  /* ---------- JSON clipboard (edit / add) ---------- */

  async function readClipboardData() {
    try {
      let clipboardText = ""
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          clipboardText = await navigator.clipboard.readText()
        }
      } catch (clipboardError) {
        const textarea = document.createElement("textarea")
        document.body.appendChild(textarea)
        textarea.focus()
        document.execCommand("paste")
        clipboardText = textarea.value
        document.body.removeChild(textarea)
      }

      if (!clipboardText.trim()) throw new Error("Буфер обміну порожній")
      return JSON.parse(clipboardText)
    } catch (error) {
      if (error.message !== "Буфер обміну порожній") {
        throw new Error("Дані в буфері обміну не є валідним JSON")
      }
      throw error
    }
  }

  const validateObject = (obj) =>
    obj && typeof obj === "object" && "en" in obj && "ua" in obj && "example" in obj

  async function handleJsonClipboard() {
    try {
      const data = await readClipboardData()
      let target = null

      if (Array.isArray(data)) {
        if (data.length && validateObject(data[0])) target = data[0]
      } else if (validateObject(data)) {
        target = data
      }

      if (!target) {
        showInformationModal("Об'єкт не містить необхідних полів: en, ua, example")
        return
      }

      $("#json-preview-en").textContent = target.en || ""
      $("#json-preview-ua").textContent = target.ua || ""
      $("#json-preview-example").textContent = target.example || ""
      window.pendingJsonData = target
      showJsonConfirmationModal()
    } catch (error) {
      showInformationModal(error.message)
    }
  }

  async function handleJsonAddClipboard() {
    try {
      const data = await readClipboardData()
      let target = []

      if (Array.isArray(data)) {
        if (data.length && data.every(validateObject)) target = data
        else {
          showInformationModal("Масив містить невалідні об'єкти")
          return
        }
      } else if (validateObject(data)) {
        target = [data]
      } else {
        showInformationModal("Дані повинні бути об'єктом або масивом об'єктів з полями: en, ua, example")
        return
      }

      const preview = $("#json-add-preview")
      preview.innerHTML = ""
      target.forEach((item, index) => {
        const div = document.createElement("div")
        div.className = "json-item-preview"
        div.innerHTML = `
          <h4>Речення ${index + 1}:</h4>
          <div class="json-field"><strong>English:</strong> <span>${item.en || ""}</span></div>
          <div class="json-field"><strong>Ukrainian:</strong> <span>${item.ua || ""}</span></div>
          <div class="json-field"><strong>Example:</strong> <span>${item.example || ""}</span></div>
        `
        preview.appendChild(div)
      })

      window.pendingJsonAddData = target
      showJsonAddConfirmationModal()
    } catch (error) {
      showInformationModal(error.message)
    }
  }

  function confirmJsonReplacement() {
    const data = window.pendingJsonData
    if (data) {
      $("#editEn").value = data.en || ""
      $("#editUa").value = data.ua || ""
      $("#editExample").value = data.example || ""
      window.pendingJsonData = null
    }
    closeJsonConfirmationModal()
  }

  function cancelJsonReplacement() {
    window.pendingJsonData = null
    closeJsonConfirmationModal()
  }

  function confirmJsonAdd() {
    const pending = window.pendingJsonAddData
    if (pending) {
      let sentences = readStorage(STORAGE_KEYS.created)
      const newSentences = []

      pending.forEach((item) => {
        if (!sentences.some((s) => s.en === item.en && s.ua === item.ua)) {
          newSentences.unshift({ en: item.en, ua: item.ua, example: item.example || "" })
        }
      })

      if (!newSentences.length) {
        showInformationModal("Усі речення вже існують у списку")
      } else {
        writeStorage(STORAGE_KEYS.created, [...newSentences, ...sentences])
        if (window.setCurrentPage) window.setCurrentPage(1)
        if (window.renderSentences) window.renderSentences()
      }
      window.pendingJsonAddData = null
    }
    closeJsonAddConfirmationModal()
  }

  function cancelJsonAdd() {
    window.pendingJsonAddData = null
    closeJsonAddConfirmationModal()
  }

  /* ---------- JSON copy (edit-item choice modal + whole list) ---------- */

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch (clipboardError) {
      /* fall through to legacy copy */
    }

    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    let success = false
    try {
      success = document.execCommand("copy")
    } catch {
      success = false
    }
    document.body.removeChild(textarea)
    return success
  }

  const closeJsonActionModal = () => hideModal($(".json-action-modal"))
  const showJsonActionModal = () => showModal($(".json-action-modal"))

  // Option 1: paste JSON (existing logic, unchanged)
  function handleJsonActionPaste() {
    closeJsonActionModal()
    handleJsonClipboard()
  }

  // Option 2: copy the sentence currently open in the edit modal as one array element
  async function handleJsonActionCopy() {
    const item = {
      en: $("#editEn")?.value ?? "",
      ua: $("#editUa")?.value ?? "",
      example: $("#editExample")?.value ?? "",
    }
    const copied = await copyTextToClipboard(JSON.stringify(item, null, 2))
    closeJsonActionModal()
    showInformationModal(copied ? "JSON скопійовано" : "Не вдалося скопіювати")
    // Close the edit modal once the JSON is copied (uses its own "Скасувати" handler)
    if (copied) $("#edit-modal-close")?.click()
  }

  // Save modal: copy the whole created list as a JSON array
  async function handleCopyListJson() {
    const storageKey = $("#copy-list-json-btn")?.dataset.storage || STORAGE_KEYS.created
    const sentences = readStorage(storageKey)

    if (!sentences.length) {
      closeSaveModal()
      showInformationModal("Список порожній")
      return
    }

    const copied = await copyTextToClipboard(JSON.stringify(normalizeDataFormat(sentences), null, 2))
    closeSaveModal()
    showInformationModal(copied ? "Список скопійовано" : "Не вдалося скопіювати")
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#json-action-paste-btn")?.addEventListener("click", handleJsonActionPaste)
    $("#json-action-copy-btn")?.addEventListener("click", handleJsonActionCopy)
    $("#copy-list-json-btn")?.addEventListener("click", handleCopyListJson)
    // Refresh "Зберегти" state each time the save modal opens (list may have changed since page load)
    $(".save-selected-open-modal")?.addEventListener("click", updateSaveSelectedButtonState)
  })

  /* ---------- Wire up event listeners ---------- */

  document.addEventListener("click", (event) => {
    const target = event.target

    const closeFor = (modal) => {
      if (!modal) return
      if (modal.classList.contains("information-modal")) closeInformationModal()
      else if (modal.classList.contains("save-modal")) closeSaveModal()
      else if (modal.classList.contains("load-replace-modal")) closeLoadReplaceModal()
      else if (modal.classList.contains("load-merge-modal")) closeLoadMergeModal()
      else if (modal.classList.contains("json-confirmation-modal")) closeJsonConfirmationModal()
      else if (modal.classList.contains("json-add-confirmation-modal")) closeJsonAddConfirmationModal()
      else hideModal(modal)
    }

    if (target.classList.contains("close-modal-btn")) {
      closeFor(target.closest(".modal"))
      return
    }

    // Close a visible modal when clicking its backdrop (outside content)
    $$(".modal").forEach((modal) => {
      if (modal.style.display !== "flex" || !modal.contains(target)) return
      const content = $(".modal-content", modal)
      if (content && content.contains(target)) return
      if (modal.classList.contains("information-modal")) return
      closeFor(modal)
    })
  })

  $(".load-replace-open-modal")?.addEventListener("click", showLoadReplaceModal)
  $("#load-created-list-btn")?.addEventListener("click", loadCreatedListForTraining)
  $(".load-merge-open-modal")?.addEventListener("click", showLoadMergeModal)
  $(".save-selected-open-modal")?.addEventListener("click", showSaveModal)
  $("#save-selected-to-file-btn")?.addEventListener("click", saveToFile)

  $$(".file-input").forEach((input) => {
    input.addEventListener("change", handleFileSelect)
  })

  document.addEventListener("DOMContentLoaded", () => {
    $("#json-clipboard-btn")?.addEventListener("click", showJsonActionModal)
    $("#json-confirm-btn")?.addEventListener("click", confirmJsonReplacement)
    $("#json-cancel-btn")?.addEventListener("click", cancelJsonReplacement)
    $("#json-add-button")?.addEventListener("click", handleJsonAddClipboard)
    $("#json-add-confirm-btn")?.addEventListener("click", confirmJsonAdd)
    $("#json-add-cancel-btn")?.addEventListener("click", cancelJsonAdd)
  })

  /* ---------- Expose public API ---------- */

  window.closeModal = closeModal
  window.closeInformationModal = closeInformationModal
  window.closeSaveModal = closeSaveModal
  window.closeLoadReplaceModal = closeLoadReplaceModal
  window.closeLoadMergeModal = closeLoadMergeModal
  window.closeJsonConfirmationModal = closeJsonConfirmationModal
  window.closeJsonAddConfirmationModal = closeJsonAddConfirmationModal
  window.showInformationModal = showInformationModal
  window.showSaveModal = showSaveModal
  window.showLoadReplaceModal = showLoadReplaceModal
  window.showLoadMergeModal = showLoadMergeModal
  window.showJsonConfirmationModal = showJsonConfirmationModal
  window.showJsonAddConfirmationModal = showJsonAddConfirmationModal
  window.handleJsonClipboard = handleJsonClipboard
  window.showJsonActionModal = showJsonActionModal
  window.closeJsonActionModal = closeJsonActionModal
  window.handleJsonAddClipboard = handleJsonAddClipboard
  window.confirmJsonReplacement = confirmJsonReplacement
  window.cancelJsonReplacement = cancelJsonReplacement
  window.confirmJsonAdd = confirmJsonAdd
  window.cancelJsonAdd = cancelJsonAdd

  // Initialize button state on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateSaveSelectedButtonState)
  } else {
    updateSaveSelectedButtonState()
  }
})()
