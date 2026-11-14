/* ============================================================
   List page logic (browse / search / favorite sentences)
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const $ = (sel) => document.getElementById(sel) || document.querySelector(sel)

  const sentencesList = $("sentencesList")
  const toggleLanguageBtn = $("toggleLanguage")
  const searchInput = $("searchInput")
  const listModal = $("listModal")
  const translationModal = $("translationModal")
  const searchModal = $("searchModal")
  const translationText = $("translationText")
  const translationExampleText = $("translationExampleText")
  const searchResults = $("searchResults")
  const voiceBtn = $("voiceBtn")
  const openListBtn = $("list-open-modal-btn") || document.querySelector(".list-open-modal")

  let currentLanguage = "en"

  const getSentences = () => {
    try {
      const value = JSON.parse(localStorage.getItem("sentences"))
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  let sentences = getSentences()

  const readSaved = () => {
    try {
      const value = JSON.parse(localStorage.getItem("saveSelected"))
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  /* ---------- Favorite (heart) icons ---------- */

  const HEART_ICON =
    '<svg viewBox="0 0 24 24" width="1em" height="1em" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'
  const favoriteIcons = new Map()

  const isSaved = (saved, sentence) => saved.some((s) => s.ua === sentence.ua && s.en === sentence.en)

  // Lit state always mirrors saveSelected: once added, a heart stays lit
  function syncFavoriteIcons() {
    const saved = readSaved()
    favoriteIcons.forEach((sentence, icon) => {
      if (!icon.isConnected) {
        favoriteIcons.delete(icon)
        return
      }
      icon.classList.toggle("active", isSaved(saved, sentence))
    })
  }

  function registerFavoriteIcon(icon, sentence) {
    favoriteIcons.set(icon, sentence)
    icon.classList.toggle("active", isSaved(readSaved(), sentence))
  }

  /* ---------- Voice engine (uses existing engine or fallback) ---------- */

  function initializeVoiceEngine() {
    if (typeof voiceEngine === "undefined") return
    if (voiceEngine.isInitialized) return
    const dummySelect = document.createElement("select")
    const dummySpeed = document.createElement("input")
    const dummyPitch = document.createElement("input")
    const dummyVolume = document.createElement("input")
    dummySpeed.type = "range"
    dummyPitch.type = "range"
    dummyVolume.type = "range"
    dummySpeed.value = localStorage.getItem("speed") || 1
    dummyPitch.value = localStorage.getItem("pitch") || 1
    dummyVolume.value = localStorage.getItem("volume") || 1
    voiceEngine.init(dummySelect, dummySpeed, dummyPitch, dummyVolume)
  }

  function speakTranslation() {
    const text = translationText.textContent
    if (text && typeof voiceEngine !== "undefined") voiceEngine.speak(text)
  }

  /* ---------- Rendering ---------- */

  function displaySentences() {
    if (!sentencesList) return
    sentences = getSentences()
    sentencesList.innerHTML = ""

    if (sentences.length === 0) {
      const empty = document.createElement("li")
      empty.className = "empty-state"
      empty.textContent = "Список порожній. Створіть або завантажте список на головній сторінці."
      sentencesList.appendChild(empty)
      return
    }

    const saved = readSaved()

    sentences.forEach((sentence, index) => {
      const li = document.createElement("li")
      li.className = "sentence-item"

      const indexItem = document.createElement("span")
      indexItem.className = "index-item"
      indexItem.textContent = index + 1

      const text = document.createElement("span")
      text.className = "sentence-text"
      text.textContent = sentence[currentLanguage]

      const voiceButton = document.createElement("button")
      voiceButton.className = "sentence-voice-btn"
      voiceButton.title = "Проголосити"
      voiceButton.innerHTML =
        '<div class="speaker-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg></div>'

      const favorite = document.createElement("span")
      favorite.className = "favorite-icon"
      favorite.innerHTML = HEART_ICON
      registerFavoriteIcon(favorite, sentence)
      if (saved.some((s) => s.ua === sentence.ua && s.en === sentence.en)) {
        favorite.classList.add("active")
      }

      li.appendChild(indexItem)
      li.appendChild(text)
      li.appendChild(voiceButton)
      li.appendChild(favorite)

      li.addEventListener("click", () => showTranslation(sentence))
      voiceButton.addEventListener("click", (e) => {
        e.stopPropagation()
        if (typeof voiceEngine !== "undefined") {
          voiceEngine.speak(sentence.en)
        }
      })
      favorite.addEventListener("click", (e) => {
        e.stopPropagation()
        toggleFavoriteSentence(sentence)
        syncFavoriteIcons()
      })

      sentencesList.appendChild(li)
    })
  }

  function toggleLanguage() {
    currentLanguage = currentLanguage === "en" ? "ua" : "en"
    toggleLanguageBtn.textContent = currentLanguage === "en" ? "Show Ukrainian" : "Show English"
    displaySentences()
  }

  /* ---------- Translation modal ---------- */

  function showTranslation(sentence) {
    const opposite = currentLanguage === "en" ? "ua" : "en"
    translationText.textContent = sentence[opposite]

    if (sentence.example && sentence.example.trim()) {
      translationExampleText.textContent = sentence.example
      translationExampleText.style.display = "block"
    } else {
      translationExampleText.style.display = "none"
    }

    const showVoice = opposite === "en"
    voiceBtn.style.display = showVoice ? "flex" : "none"
    openModal(translationModal)
  }

  /* ---------- Search ---------- */

  function handleSearch() {
    if (!searchInput) return
    const term = searchInput.value.trim().toLowerCase()
    if (term.length < 2) {
      if (searchModal) closeModal(searchModal)
      return
    }
    sentences = getSentences()
    const results = sentences.filter(
      (s) => (s.en && s.en.toLowerCase().includes(term)) || (s.ua && s.ua.toLowerCase().includes(term))
    )
    displaySearchResults(results)
  }

  function displaySearchResults(results) {
    if (!searchResults) return
    searchResults.innerHTML = ""

    if (results.length === 0) {
      const li = document.createElement("li")
      li.textContent = "No results found"
      searchResults.appendChild(li)
    } else {
      results.forEach((result) => {
        const li = document.createElement("li")

        const content = document.createElement("div")
        content.className = "result-content"

        const text = document.createElement("span")
        text.className = "result-text"
        text.textContent = `${result.en} - ${result.ua}`
        content.appendChild(text)

        if (result.example && result.example.trim()) {
          const example = document.createElement("div")
          example.className = "search-example-text"
          example.textContent = result.example
          content.appendChild(example)
        }

        const actions = document.createElement("div")
        actions.className = "item-actions"

        const voiceButton = document.createElement("button")
        voiceButton.className = "sentence-voice-btn"
        voiceButton.title = "Проголосити"
        voiceButton.innerHTML =
          '<div class="speaker-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg></div>'

        const favorite = document.createElement("span")
        favorite.className = "favorite-icon"
        favorite.innerHTML = HEART_ICON
        registerFavoriteIcon(favorite, result)

        actions.appendChild(voiceButton)
        actions.appendChild(favorite)
        li.appendChild(content)
        li.appendChild(actions)
        searchResults.appendChild(li)

        voiceButton.addEventListener("click", (e) => {
          e.stopPropagation()
          if (typeof voiceEngine !== "undefined") {
            voiceEngine.speak(result.en)
          }
        })
        favorite.addEventListener("click", (e) => {
          e.stopPropagation()
          toggleFavoriteSentence(result)
          syncFavoriteIcons()
        })
      })
    }

    if (searchModal) {
      updateSearchModalPosition()
      openModal(searchModal)
    }
  }

  function updateSearchModalPosition() {
    if (!listModal || !searchModal) return
    const input = $("searchInput")
    const listModalContent = listModal.querySelector(".modal-content")
    if (input && listModalContent) {
      const inputRect = input.getBoundingClientRect()
      const contentRect = listModalContent.getBoundingClientRect()
      const topOffset = inputRect.bottom - contentRect.top + 8
      searchModal.style.top = `${topOffset}px`
    }
  }

  /* ---------- Favorites (Toggle Add / Remove) ---------- */

  function toggleFavoriteSentence(sentence) {
    const stored = readSaved()
    const index = stored.findIndex((s) => s.ua === sentence.ua && s.en === sentence.en)

    if (index === -1) {
      stored.push({
        ua: sentence.ua,
        en: sentence.en,
        example: sentence.example || "",
      })
      localStorage.setItem("saveSelected", JSON.stringify(stored))
      window.dispatchEvent(new Event("saveSelectedChanged"))
      showNotification("Речення додано до списку")
    } else {
      stored.splice(index, 1)
      localStorage.setItem("saveSelected", JSON.stringify(stored))
      window.dispatchEvent(new Event("saveSelectedChanged"))
      showNotification("Речення видалено зі списку")
    }
  }

  /* ---------- Helpers ---------- */

  const openModal = (modal) => {
    if (modal) modal.style.display = "flex"
  }

  const closeModal = (modal) => {
    if (modal) modal.style.display = "none"
  }

  function showNotification(message) {
    if (typeof showInformationModal === "function") {
      showInformationModal(message)
      return
    }
    let notification = document.querySelector(".notification")
    if (!notification) {
      notification = document.createElement("div")
      notification.className = "notification"
      document.body.appendChild(notification)
    }
    notification.textContent = message
    notification.classList.add("show")
    setTimeout(() => notification.classList.remove("show"), 3000)
  }

  /* ---------- Open list modal ---------- */

  function openListModal() {
    if (!listModal) return
    sentences = getSentences()
    displaySentences()
    syncFavoriteIcons()
    openModal(listModal)
  }

  /* ---------- Wire up ---------- */

  displaySentences()
  initializeVoiceEngine()

  if (openListBtn) {
    openListBtn.addEventListener("click", openListModal)
  }

  if (toggleLanguageBtn) {
    toggleLanguageBtn.addEventListener("click", toggleLanguage)
  }
  if (searchInput) {
    searchInput.addEventListener("input", handleSearch)
  }
  if (voiceBtn) {
    voiceBtn.addEventListener("click", speakTranslation)
  }

  window.addEventListener("saveSelectedChanged", syncFavoriteIcons)
  window.addEventListener("resize", updateSearchModalPosition)
  window.addEventListener("storage", (e) => {
    if (e.key === "saveSelected" || e.key === null) syncFavoriteIcons()
    if (e.key === "sentences" || e.key === null) displaySentences()
  })

  window.addEventListener("click", (event) => {
    if (listModal && event.target === listModal) closeModal(listModal)
    if (translationModal && event.target === translationModal) closeModal(translationModal)
    const searchVisible = searchModal && searchModal.style.display !== "none"
    if (searchVisible && !event.target.closest(".search-container") && !event.target.closest("#searchModal")) {
      if (searchInput) searchInput.value = ""
      closeModal(searchModal)
    }
  })

  const closeBtns = document.querySelectorAll(".close-btn, .close-list-modal-btn")
  closeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal")
      if (modal) closeModal(modal)
    })
  })

  window.openListModal = openListModal
})
