/* ============================================================
   Editor page logic (create / manage sentence lists)
   Includes: form builder, saved-list rendering, edit/delete,
   search functionality.
   ============================================================ */

const $ = (sel) => document.getElementById(sel) || document.querySelector(sel)

const container = $("form-container")
const hideFormBtn = $("hide-form-btn")
const editModal = $("edit-modal")
const editModalCloseBtn = $("edit-modal-close")
const editModalSaveBtn = $("edit-modal-save")
const editModalDeleteBtn = $("edit-modal-delete")
const deleteModalRemoveBtn = $("delete-btn")
const saveButton = $("save-button")
const increaseBtn = $("increase-btn")
const decreaseBtn = $("decrease-btn")
const clearListBtn = $("clear-list-btn")
const searchInput = $("navbar-search-input")
const searchSuggestionsModal = $(".search-suggestions-modal")
const searchSuggestionsList = $("search-suggestions")
const searchSuggestionsStatus = $("search-suggestions-status")
let currentSearchResults = []
const FORM_HIDDEN_STORAGE_KEY = "createdListFormHidden"

const STORAGE_KEY = "createdSentences"

const readSentences = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

let currentEditIndex = -1
let sectionCount = 1
let currentPage = 1
const itemsPerPage = 50
let inputData = []

/* ============================================================
   Form builder
   ============================================================ */

function renderForm() {
  container.innerHTML = ""

  for (let i = 0; i < sectionCount; i++) {
    const data = inputData[i] || {}
    const section = document.createElement("div")
    section.classList.add("section")

    const en = document.createElement("input")
    en.type = "text"
    en.className = "en"
    en.placeholder = "English text"
    en.value = data.en || ""

    const ua = document.createElement("input")
    ua.type = "text"
    ua.className = "ua"
    ua.placeholder = "Ukrainian translation"
    ua.value = data.ua || ""

    const example = document.createElement("textarea")
    example.className = "example"
    example.placeholder = "Example sentences (optional)"
    example.rows = 3
    example.value = data.example || ""

    en.addEventListener("input", () => {
      inputData[i] = { ...(inputData[i] || {}), en: en.value }
      validateInputs()
    })
    ua.addEventListener("input", () => {
      inputData[i] = { ...(inputData[i] || {}), ua: ua.value }
    })
    example.addEventListener("input", () => {
      inputData[i] = { ...(inputData[i] || {}), example: example.value }
    })

    section.appendChild(en)
    section.appendChild(ua)
    section.appendChild(example)
    container.appendChild(section)
  }
}

function validateInputs() {
  let allValid = true
  const pattern = /^[a-zA-Z0-9,.!?'"\-\s:;]*$/
  const containsCyrillic = /[а-яА-ЯЁёЇїІіЄєҐґ]/

  document.querySelectorAll(".en").forEach((input) => {
    const value = input.value.trim()
    input.classList.remove("invalid", "valid")

    if (!value) return
    if (pattern.test(value) && !containsCyrillic.test(value)) {
      input.classList.add("valid")
    } else {
      input.classList.add("invalid")
      allValid = false
    }
  })

  saveButton.disabled = !allValid
}

function saveData() {
  let sentences = readSentences()
  const created = []

  document.querySelectorAll(".section").forEach((section) => {
    const en = section.querySelector(".en").value.trim()
    const ua = section.querySelector(".ua").value.trim()
    const example = section.querySelector(".example").value.trim()

    if (en && ua && !sentences.some((s) => s.en === en && s.ua === ua)) {
      created.unshift({ en, ua, example: example || "" })
    }
    section.querySelector(".en").value = ""
    section.querySelector(".ua").value = ""
    section.querySelector(".example").value = ""
  })

  if (!created.length) {
    showInformationModal("Список порожній")
    return
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify([...created, ...sentences]))
  inputData = []
  sectionCount = 1
  increaseBtn.textContent = "+ 1"
  renderForm()
  currentPage = 1
  renderSentences()
}

/* ============================================================
   Saved list rendering
   ============================================================ */

function renderSentences() {
  const sentences = readSentences()
  const listContainer = $("sentences-container")
  if (!listContainer) return

  listContainer.innerHTML = ""

  if (sentences.length === 0) {
    const empty = document.createElement("p")
    empty.className = "empty-state"
    empty.textContent = "Немає збережених речень"
    listContainer.appendChild(empty)
    return
  }

  const totalPages = Math.ceil(sentences.length / itemsPerPage)
  if (currentPage > totalPages) currentPage = totalPages

  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = Math.min(startIndex + itemsPerPage, sentences.length)

  for (let i = startIndex; i < endIndex; i++) {
    const pair = sentences[i]
    const card = document.createElement("div")
    card.className = "sentence-pair"

    const content = document.createElement("div")
    content.className = "sentence-content"

    const en = document.createElement("div")
    en.className = "sentence en"
    en.textContent = pair.en

    const ua = document.createElement("div")
    ua.className = "sentence"
    ua.textContent = pair.ua

    content.appendChild(en)
    content.appendChild(ua)

    if (pair.example && pair.example.trim()) {
      const ex = document.createElement("div")
      ex.className = "sentence example-sentence"
      ex.textContent = pair.example
      content.appendChild(ex)
    }

    const actions = document.createElement("div")
    actions.className = "buttons"

    const editBtn = document.createElement("button")
    editBtn.textContent = "Edit"
    editBtn.addEventListener("click", () => editSentence(i))

    const delBtn = document.createElement("button")
    delBtn.textContent = "Delete"
    delBtn.addEventListener("click", () => showDeleteModal(i))

    const num = document.createElement("span")
    num.textContent = sentences.length - i

    actions.appendChild(editBtn)
    actions.appendChild(delBtn)
    actions.appendChild(num)

    card.appendChild(content)
    card.appendChild(actions)
    listContainer.appendChild(card)
  }

  // Pagination
  const pagination = document.createElement("div")
  pagination.className = "pagination"

  const prev = document.createElement("button")
  prev.textContent = "←"
  prev.disabled = currentPage === 1
  prev.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--
      renderSentences()
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  })

  const indicator = document.createElement("span")
  indicator.textContent = `${currentPage} / ${totalPages || 1}`

  const next = document.createElement("button")
  next.textContent = "→"
  next.disabled = currentPage === totalPages || totalPages === 0
  next.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++
      renderSentences()
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  })

  pagination.appendChild(prev)
  pagination.appendChild(indicator)
  pagination.appendChild(next)
  listContainer.appendChild(pagination)
}

/* ============================================================
   Edit / delete
   ============================================================ */

function editSentence(index) {
  const sentences = readSentences()
  if (!sentences[index]) return
  currentEditIndex = index
  $("editEn").value = sentences[index].en
  $("editUa").value = sentences[index].ua
  $("editExample").value = sentences[index].example || ""
  editModal.style.display = "flex"
}

function closeEditModal() {
  editModal.style.display = "none"
  currentEditIndex = -1
}

function saveChanges() {
  const sentences = readSentences()
  if (currentEditIndex === -1) return

  sentences[currentEditIndex] = {
    en: $("editEn").value,
    ua: $("editUa").value,
    example: $("editExample").value || "",
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sentences))
  closeEditModal()
  renderSentences()
}

function showDeleteModal(index) {
  deleteModalRemoveBtn.dataset.index = index
  document.querySelector(".delete-modal").style.display = "flex"
}

function deleteSentence() {
  let sentences = readSentences()
  const index = +deleteModalRemoveBtn.dataset.index
  document.querySelector(".delete-modal").style.display = "none"

  if (isNaN(index)) {
    localStorage.removeItem(STORAGE_KEY)
    currentPage = 1
    closeEditModal()
    renderSentences()
    return
  }

  sentences = sentences.filter((_, i) => i !== index)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sentences))
  closeEditModal()

  const totalPages = Math.ceil(sentences.length / itemsPerPage)
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages
  renderSentences()
}

/* ============================================================
   Search
   ============================================================ */

function updateSearchSuggestions() {
  const term = searchInput.value.trim().toLowerCase()
  if (!term) {
    currentSearchResults = []
    searchSuggestionsModal.style.display = "none"
    return
  }

  currentSearchResults = readSentences()
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) =>
      String(sentence.en || "").toLowerCase().includes(term) ||
      String(sentence.ua || "").toLowerCase().includes(term)
    )
    .sort((first, second) => {
      const firstStarts = String(first.sentence.en || "").toLowerCase().startsWith(term) ||
        String(first.sentence.ua || "").toLowerCase().startsWith(term)
      const secondStarts = String(second.sentence.en || "").toLowerCase().startsWith(term) ||
        String(second.sentence.ua || "").toLowerCase().startsWith(term)
      return Number(secondStarts) - Number(firstStarts)
    })
    .slice(0, 15)

  searchSuggestionsList.innerHTML = ""
  if (!currentSearchResults.length) {
    searchSuggestionsStatus.textContent = "Нічого не знайдено"
  } else {
    searchSuggestionsStatus.textContent = `Знайдено варіантів: ${currentSearchResults.length}`
    currentSearchResults.forEach(({ sentence }, resultIndex) => {
      const item = document.createElement("li")
      const button = document.createElement("button")
      const english = document.createElement("span")
      const ukrainian = document.createElement("span")

      button.type = "button"
      button.dataset.resultIndex = resultIndex
      english.className = "search-suggestion-en"
      english.textContent = sentence.en || ""
      ukrainian.className = "search-suggestion-ua"
      ukrainian.textContent = sentence.ua || ""

      button.append(english, ukrainian)
      item.appendChild(button)
      searchSuggestionsList.appendChild(item)
    })
  }

  searchSuggestionsModal.style.display = "flex"
}

function selectSearchResult(resultIndex) {
  const result = currentSearchResults[resultIndex]
  if (!result) return

  searchSuggestionsModal.style.display = "none"
  searchInput.value = ""
  currentSearchResults = []
  editSentence(result.index)
}


/* ============================================================
   Event listeners
   ============================================================ */

increaseBtn.addEventListener("click", () => {
  sectionCount = sectionCount >= 20 ? 1 : sectionCount + 1
  while (inputData.length < sectionCount) inputData.push({})
  increaseBtn.textContent = `+ ${sectionCount}`
  renderForm()
})

decreaseBtn.addEventListener("click", () => {
  if (sectionCount > 1) sectionCount--
  increaseBtn.textContent = `+ ${sectionCount}`
  renderForm()
})

saveButton.addEventListener("click", saveData)
clearListBtn?.addEventListener("click", () => showDeleteModal())
hideFormBtn?.addEventListener("click", () => {
  const formWrapper = $("sentence-form-wrapper")
  if (!formWrapper) return

  const isHidden = formWrapper.classList.toggle("hide")
  localStorage.setItem(FORM_HIDDEN_STORAGE_KEY, String(isHidden))
  hideFormBtn.textContent = isHidden ? "Показати форму" : "Сховати форму"
})

editModalCloseBtn?.addEventListener("click", closeEditModal)
editModalSaveBtn?.addEventListener("click", saveChanges)
editModalDeleteBtn?.addEventListener("click", () => showDeleteModal(currentEditIndex))
deleteModalRemoveBtn?.addEventListener("click", deleteSentence)

searchInput?.addEventListener("input", updateSearchSuggestions)
searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    selectSearchResult(0)
  } else if (e.key === "Escape") {
    searchSuggestionsModal.style.display = "none"
  }
})

searchSuggestionsList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-result-index]")
  if (button) selectSearchResult(Number(button.dataset.resultIndex))
})

$("#search-suggestions-close")?.addEventListener("click", () => {
  searchSuggestionsModal.style.display = "none"
})

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.altKey) {
    if (editModal.style.display === "flex") return
    e.preventDefault()
    searchInput.focus()
    searchInput.select()
  }

  if (e.key === "ArrowUp") window.scrollBy(0, -window.innerHeight)
  if (e.key === "ArrowDown") window.scrollBy(0, window.innerHeight)
})

/* Close edit modal by clicking overlay */
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) closeEditModal()
})

/* ============================================================
   Cross-module + init
   ============================================================ */

window.renderSentences = renderSentences
window.setCurrentPage = (n) => {
  currentPage = n
}

window.addEventListener("dataLoaded", () => setTimeout(renderSentences, 100))
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) setTimeout(renderSentences, 100)
})

renderForm()
renderSentences()

const shouldHideForm = localStorage.getItem(FORM_HIDDEN_STORAGE_KEY) !== "false"
const sentenceFormWrapper = $("sentence-form-wrapper")
sentenceFormWrapper?.classList.toggle("hide", shouldHideForm)
if (localStorage.getItem(FORM_HIDDEN_STORAGE_KEY) === null) {
  localStorage.setItem(FORM_HIDDEN_STORAGE_KEY, "true")
}
if (hideFormBtn) {
  hideFormBtn.textContent = shouldHideForm ? "Показати форму" : "Сховати форму"
}
