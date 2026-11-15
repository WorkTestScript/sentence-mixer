;(() => {
  const LIST_STORAGE = "createdSentences"
  const providers = {
    google: { label: "Gemini", key: "geminiApiKey", url: "https://aistudio.google.com/app/apikey", help: "Ключ зберігається лише у localStorage цього браузера. <a href=\"https://aistudio.google.com/app/apikey\" target=\"_blank\" rel=\"noopener noreferrer\">Отримати API key у Google AI Studio</a>" },
    groq: { label: "Groq", key: "groqApiKey", url: "https://console.groq.com/keys", help: "Ключ зберігається лише у localStorage цього браузера. <a href=\"https://console.groq.com/keys\" target=\"_blank\" rel=\"noopener noreferrer\">Створити API key у Groq Console</a>" },
  }
  const modal = document.getElementById("ai-list-modal")
  const apiKeyModal = document.getElementById("ai-api-key-modal")
  const openButton = document.getElementById("ai-list-open")
  const cancelButton = document.getElementById("ai-list-cancel")
  const openApiKeyButton = document.getElementById("ai-api-key-open")
  const saveApiKeyButton = document.getElementById("ai-api-key-save")
  const cancelApiKeyButton = document.getElementById("ai-api-key-cancel")
  const generateButton = document.getElementById("ai-list-generate")
  const input = document.getElementById("ai-list-input")
  const providerSelect = document.getElementById("ai-provider")
  const highlightLayer = document.getElementById("ai-list-highlight")
  const apiKeyInput = document.getElementById("ai-api-key")
  const keyTitle = document.getElementById("ai-api-key-title")
  const keyLabel = document.querySelector('label[for="ai-api-key"]')
  const keyHelp = document.getElementById("ai-key-help")
  const status = document.getElementById("ai-list-status")
  const promptModal = document.getElementById("ai-prompt-modal")
  const openPromptButton = document.getElementById("ai-prompt-open")
  const promptText = document.getElementById("ai-prompt-text")
  const promptFormatModal = document.getElementById("ai-prompt-format-modal")
  const openFormatButton = document.getElementById("ai-prompt-format-open")
  const promptFormatText = document.getElementById("ai-prompt-format-text")
  const closeFormatButton = document.getElementById("ai-prompt-format-close")
  const promptStatus = document.getElementById("ai-prompt-status")
  const copyPromptButton = document.getElementById("ai-prompt-copy")
  const resetPromptButton = document.getElementById("ai-prompt-reset")
  const closePromptButton = document.getElementById("ai-prompt-close")
  let isGenerating = false
  if (!modal || !openButton) return

  const provider = () => providers[providerSelect.value] || providers.google
  const currentKey = () => localStorage.getItem(provider().key) || ""
  const syncProvider = () => {
    const selected = provider()
    keyTitle.textContent = `${selected.label} API key`
    keyLabel.textContent = `${selected.label} API key`
    keyHelp.innerHTML = selected.help
    apiKeyInput.value = currentKey()
    openApiKeyButton.textContent = currentKey() ? "API key ✓" : "API key"
  }
  syncProvider()
  providerSelect.addEventListener("change", syncProvider)
  const closeModal = () => { modal.style.display = "none" }
  openButton.addEventListener("click", () => { status.textContent = ""; modal.style.display = "flex"; input.focus() })
  cancelButton.addEventListener("click", closeModal)
  input.addEventListener("input", () => {
    updateOverflowHighlight()
    const count = entriesFromInput().length
    syncGenerateButton()
    if (count > 50) status.textContent = `Забагато рядків: ${count}. Максимум — 50 за один раз.`
    else if (status.textContent.startsWith("Забагато рядків:")) status.textContent = ""
  })
  input.addEventListener("scroll", () => { highlightLayer.scrollTop = input.scrollTop; highlightLayer.scrollLeft = input.scrollLeft })
  openApiKeyButton.addEventListener("click", () => { syncProvider(); apiKeyModal.style.display = "flex"; apiKeyInput.focus() })
  saveApiKeyButton.addEventListener("click", () => {
    const key = apiKeyInput.value.trim()
    if (key) localStorage.setItem(provider().key, key)
    else localStorage.removeItem(provider().key)
    syncProvider()
    apiKeyModal.style.display = "none"
  })
  cancelApiKeyButton.addEventListener("click", () => { syncProvider(); apiKeyModal.style.display = "none" })
  apiKeyModal.addEventListener("click", (event) => { if (event.target === apiKeyModal) apiKeyModal.style.display = "none" })

  /* ---------- Prompt customization ----------
     The JSON format and the object structure are fixed in code and are
     always added to the request, so editing the prompt can change only the
     user's own wishes, never the response format. */
  openPromptButton?.addEventListener("click", () => {
    promptText.value = getUserPrompt()
    if (promptStatus) promptStatus.textContent = ""
    promptModal.style.display = "flex"
    promptText.focus({ preventScroll: true })
  })
  promptText?.addEventListener("input", () => {
    saveUserPrompt()
    if (promptStatus) promptStatus.textContent = ""
  })
  resetPromptButton?.addEventListener("click", () => {
    localStorage.removeItem(PROMPT_STORAGE)
    promptText.value = DEFAULT_PROMPT
    if (promptStatus) promptStatus.textContent = "Промт повернуто до початкового стану."
  })
  copyPromptButton?.addEventListener("click", async () => {
    const fullPrompt = buildPromptForCopy()
    const copied = typeof copyTextToClipboard === "function"
      ? await copyTextToClipboard(fullPrompt)
      : false
    if (promptStatus) promptStatus.textContent = copied ? "Повний промт скопійовано." : "Не вдалося скопіювати промт."
  })
  closePromptButton?.addEventListener("click", () => { promptModal.style.display = "none" })
  promptModal?.addEventListener("click", (event) => { if (event.target === promptModal) promptModal.style.display = "none" })

  /* The fixed response format is shown in its own window, so the editable
     prompt stays compact and the format itself can only be read. */
  openFormatButton?.addEventListener("click", () => {
    if (promptFormatText) promptFormatText.textContent = formatPrompt(entriesFromInput().length || 1)
    promptFormatModal.style.display = "flex"
    closeFormatButton?.focus({ preventScroll: true })
  })
  closeFormatButton?.addEventListener("click", () => { promptFormatModal.style.display = "none" })
  promptFormatModal?.addEventListener("click", (event) => { if (event.target === promptFormatModal) promptFormatModal.style.display = "none" })

  updateOverflowHighlight(); syncGenerateButton()
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal() })

  generateButton.addEventListener("click", async () => {
    const entries = entriesFromInput()
    const selected = provider()
    const apiKey = currentKey()
    if (!entries.length) { status.textContent = "Додайте хоча б один рядок."; return }
    if (entries.length > 50) { status.textContent = `Забагато рядків: ${entries.length}. Максимум — 50 за один раз.`; return }
    if (entries.some((entry) => /[\u0400-\u04FF]/u.test(entry))) {
      status.textContent = "Введіть слова чи речення англійською мовою."
      return
    }
    if (!apiKey) {
      status.textContent = `Вкажіть ${selected.label} API key.`
      syncProvider(); apiKeyModal.style.display = "flex"; apiKeyInput.focus(); return
    }
    isGenerating = true; syncGenerateButton()
    try {
      status.textContent = `Шукаю доступні моделі ${selected.label}…`
      const models = selected === providers.google ? await discoverGoogleModels(apiKey) : await discoverGroqModels(apiKey)
      if (!models.length) throw new Error(`Не знайдено сумісних моделей ${selected.label}. Перевірте API key.`)
      let generated, lastError
      for (const [index, model] of models.entries()) {
        const modelName = model.resolvedModelId || model.id
        const startedAt = Date.now()
        const updateTimer = () => { status.textContent = `Модель: ${modelName} · очікування: ${Math.floor((Date.now() - startedAt) / 1000)} с` }
        updateTimer()
        const timer = setInterval(updateTimer, 250)
        try {
          generated = selected === providers.google
            ? await generateGoogle(apiKey, model, buildPrompt(entries))
            : await generateGroq(apiKey, model, buildPrompt(entries))
          if (generated) break
        } catch (error) {
          lastError = error.message
          status.textContent = `Модель ${modelName} не відповіла. Пробую наступну…`
        } finally {
          clearInterval(timer)
        }
      }
      if (!generated) throw new Error(lastError || `Не вдалося звернутися до ${selected.label} API.`)
      if (!Array.isArray(generated) || generated.length === 0 || generated.some((item) => !item || typeof item.en !== "string" || typeof item.ua !== "string" || typeof item.example !== "string")) throw new Error("Відповідь AI має неправильний формат. Спробуйте ще раз.")
      const existing = JSON.parse(localStorage.getItem(LIST_STORAGE) || "[]")
      const known = new Set(existing.map((item) => String(item.en || "").trim().toLocaleLowerCase()))
      const unique = []
      for (const item of generated) {
        const normalized = item.en.trim().toLocaleLowerCase()
        if (!normalized || !item.ua.trim() || known.has(normalized)) continue
        known.add(normalized); unique.push({ en: item.en.trim(), ua: item.ua.trim(), example: item.example.trim() })
      }
      if (!unique.length) throw new Error("Усі згенеровані записи вже є у списку.")
      localStorage.setItem(LIST_STORAGE, JSON.stringify([...unique, ...existing]))
      if (typeof renderSentences === "function") renderSentences()
      closeModal(); input.value = ""; updateOverflowHighlight()
    } catch (error) {
      status.textContent = error instanceof SyntaxError ? "Не вдалося прочитати відповідь AI. Спробуйте ще раз." : error.message || "Сталася помилка під час генерації."
    } finally { isGenerating = false; syncGenerateButton() }
  })

  /* ---------- Prompt text ----------
     DEFAULT_PROMPT is the built-in user-editable part of the prompt. The
     response format lives in formatPrompt() and is always prepended, so it
     cannot be changed or removed from the prompt modal. */
  const PROMPT_STORAGE = "aiListPrompt"
  const DEFAULT_PROMPT = `Вимоги до кожного об'єкта:
- "en" — точний англійський текст із відповідного рядка, без змін.
- "ua" — спочатку український переклад, потім пробіл і короткий опис у круглих дужках. Якщо слово має кілька поширених значень, наведи найуживаніші переклади та стисло поясни кожне значення. Якщо слово може бути іменником і прикметником, вкажи обидва значення. Пиши просто, без слів «використовується», «застосовується», «вживається» та подібних. Не використовуй знак /; розділяй значення комами або крапкою з комою.
- "example" — один суцільний рядок англійською. Додай два прості речення для кожного вказаного значення; кожне речення має містити саме це слово або фразу. Розділяй речення пробілом. Якщо значення одне, наведи рівно два речення.`

  const FORMAT_REMINDER = 'Формат відповіді зафіксований: поверни лише JSON-масив об\'єктів із властивостями "en", "ua", "example" — без інших полів.'

  function formatPrompt(count) {
    return `Створи JSON-масив рівно з ${count} об'єктів — по одному для кожного рядка вхідного списку, у тому самому порядку. Поверни тільки валідний JSON без markdown, коментарів і тексту поза JSON. Кожен об'єкт має містити рівно три рядкові властивості в такому форматі: {"en":"англійське слово або фраза","ua":"переклад (короткий опис контексту або значення)","example":"Two English sentences."}. Не додавай інших полів чи вкладених масивів або об'єктів. Не додавай trailing comma.`
  }

  function getUserPrompt() {
    const stored = localStorage.getItem(PROMPT_STORAGE)
    return stored && stored.trim() ? stored : DEFAULT_PROMPT
  }

  function saveUserPrompt() {
    if (!promptText) return
    const value = promptText.value
    if (!value.trim() || value.trim() === DEFAULT_PROMPT.trim()) {
      localStorage.removeItem(PROMPT_STORAGE)
    } else {
      localStorage.setItem(PROMPT_STORAGE, value)
    }
  }

  function buildPrompt(entries) {
    return `${formatPrompt(entries.length)}

${getUserPrompt()}

${FORMAT_REMINDER}

Вхідний список:
${entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}`
  }

  // The prompt that the copy button puts on the clipboard: the fixed format,
  // the user's wishes and, when words are already entered, the input list.
  function buildPromptForCopy() {
    const entries = entriesFromInput()
    const count = entries.length || 1
    const list = entries.length
      ? `\n\nВхідний список:\n${entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}`
      : ""
    return `${formatPrompt(count)}

${getUserPrompt()}

${FORMAT_REMINDER}${list}`
  }
  function entriesFromInput() { return input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }
  function syncGenerateButton() { generateButton.disabled = isGenerating || entriesFromInput().length > 50 }
  function updateOverflowHighlight() {
    const lines = input.value.split(/\r?\n/); let count = 0; highlightLayer.replaceChildren()
    lines.forEach((line, index) => {
      if (line.trim()) count++
      if (line.trim() && count > 50) { const span = document.createElement("span"); span.className = "ai-list-extra-line"; span.textContent = line || " "; highlightLayer.appendChild(span) }
      else highlightLayer.appendChild(document.createTextNode(line || " "))
      if (index < lines.length - 1) highlightLayer.appendChild(document.createTextNode("\n"))
    })
    highlightLayer.scrollTop = input.scrollTop; highlightLayer.scrollLeft = input.scrollLeft
  }
  async function discoverGoogleModels(apiKey) {
    const models = []; let pageToken = ""
    do {
      const query = new URLSearchParams({ pageSize: "1000" }); if (pageToken) query.set("pageToken", pageToken)
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${query}`, { headers: { "x-goog-api-key": apiKey } })
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || "Не вдалося отримати список моделей Gemini.")
      models.push(...(result.models || [])); pageToken = result.nextPageToken || ""
    } while (pageToken)
    return models.map((model) => ({ ...model, resolvedModelId: model.baseModelId || model.name?.replace(/^models\//, "") || "", generationMethods: model.supportedGenerationMethods || model.supportedActions || [] }))
      .filter((model) => model.generationMethods.includes("generateContent") && /^(gemini|gemma)/i.test(model.resolvedModelId) && /(flash|lite|gemma)/i.test(model.resolvedModelId) && !/(embedding|image|audio|tts|live|veo|robotics)/i.test(model.resolvedModelId))
      .map((model) => ({ ...model, name: `models/${model.resolvedModelId}` })).sort((a, b) => modelPriority(a.resolvedModelId) - modelPriority(b.resolvedModelId))
  }
  async function discoverGroqModels(apiKey) {
    const response = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } })
    const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || "Не вдалося отримати список моделей Groq.")
    return (result.data || []).filter((model) => model.active !== false && !/(whisper|guard|embed|distil|playai-tts|speech)/i.test(model.id || ""))
      .sort((a, b) => modelPriority(a.id) - modelPriority(b.id))
  }
  function modelPriority(name = "") {
    if (/flash.?lite|8b.*instant|instant/i.test(name)) return 0
    if (/flash|llama-3\.3|qwen.*32b/i.test(name)) return 1
    if (/preview|experimental|versatile/i.test(name)) return 3
    return 2
  }
  async function generateGoogle(apiKey, model, prompt) {
    const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/${model.name}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { en: { type: "STRING" }, ua: { type: "STRING" }, example: { type: "STRING" } }, required: ["en", "ua", "example"], propertyOrdering: ["en", "ua", "example"] } } } }) }, 25000)
    const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || `Помилка Gemini API (${response.status}).`)
    const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join(""); if (!text) throw new Error("Gemini не повернув список.")
    return JSON.parse(text)
  }
  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...options, signal: controller.signal })
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Час очікування відповіді моделі вичерпано.")
      throw error
    } finally { clearTimeout(timeout) }
  }
  async function generateGroq(apiKey, model, prompt) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: model.id, messages: [{ role: "user", content: prompt }], temperature: 0.2 }) })
    const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || `Помилка Groq API (${response.status}).`)
    const text = result.choices?.[0]?.message?.content; if (!text) throw new Error("Groq не повернув список.")
    const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : parsed.items || parsed.results || parsed.data
  }
})()
