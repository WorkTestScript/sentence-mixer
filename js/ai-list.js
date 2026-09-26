;(() => {
  const API_KEY_STORAGE = "geminiApiKey"
  const LIST_STORAGE = "createdSentences"
  const modal = document.getElementById("ai-list-modal")
  const apiKeyModal = document.getElementById("ai-api-key-modal")
  const openButton = document.getElementById("ai-list-open")
  const cancelButton = document.getElementById("ai-list-cancel")
  const openApiKeyButton = document.getElementById("ai-api-key-open")
  const saveApiKeyButton = document.getElementById("ai-api-key-save")
  const cancelApiKeyButton = document.getElementById("ai-api-key-cancel")
  const generateButton = document.getElementById("ai-list-generate")
  const input = document.getElementById("ai-list-input")
  const highlightLayer = document.getElementById("ai-list-highlight")
  const apiKeyInput = document.getElementById("gemini-api-key")
  const status = document.getElementById("ai-list-status")
  let isGenerating = false

  if (!modal || !openButton) return

  apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) || ""
  openApiKeyButton.textContent = apiKeyInput.value ? "API key ✓" : "API key"

  const closeModal = () => {
    modal.style.display = "none"
  }

  openButton.addEventListener("click", () => {
    status.textContent = ""
    modal.style.display = "flex"
    input.focus()
  })

  cancelButton.addEventListener("click", closeModal)
  input.addEventListener("input", () => {
    updateOverflowHighlight()
    const entryCount = entriesFromInput().length
    syncGenerateButton()
    if (entryCount > 50) {
      status.textContent = `Забагато рядків: ${entryCount}. Максимум — 50 за один раз.`
    } else if (status.textContent.startsWith("Забагато рядків:")) {
      status.textContent = ""
    }
  })
  input.addEventListener("scroll", () => {
    highlightLayer.scrollTop = input.scrollTop
    highlightLayer.scrollLeft = input.scrollLeft
  })
  openApiKeyButton.addEventListener("click", () => {
    apiKeyModal.style.display = "flex"
    apiKeyInput.focus()
  })
  saveApiKeyButton.addEventListener("click", () => {
    const key = apiKeyInput.value.trim()
    if (key) localStorage.setItem(API_KEY_STORAGE, key)
    else localStorage.removeItem(API_KEY_STORAGE)
    openApiKeyButton.textContent = key ? "API key ✓" : "API key"
    apiKeyModal.style.display = "none"
  })
  cancelApiKeyButton.addEventListener("click", () => {
    apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) || ""
    apiKeyModal.style.display = "none"
  })
  apiKeyModal.addEventListener("click", (event) => {
    if (event.target === apiKeyModal) apiKeyModal.style.display = "none"
  })
  updateOverflowHighlight()
  syncGenerateButton()
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal()
  })

  generateButton.addEventListener("click", async () => {
    const entries = entriesFromInput()
    const apiKey = localStorage.getItem(API_KEY_STORAGE) || ""

    if (entries.length === 0) {
      status.textContent = "Додайте хоча б один рядок."
      return
    }
    if (entries.length > 50) {
      status.textContent = `Забагато рядків: ${entries.length}. Максимум — 50 за один раз.`
      return
    }
    if (!apiKey) {
      status.textContent = "Вкажіть Gemini API key."
      apiKeyModal.style.display = "flex"
      apiKeyInput.focus()
      return
    }

    isGenerating = true
    syncGenerateButton()
    status.textContent = "Шукаю доступні моделі Gemini…"

    try {
      const models = await discoverModels(apiKey)
      if (!models.length) {
        throw new Error("Gemini повернув список, але в ньому не знайдено сумісних моделей. Перевірте API key і проєкт у Google AI Studio або спробуйте створити новий ключ.")
      }

      let payload
      let lastApiError
      status.textContent = `Знайдено ${models.length} моделей. Перевіряю доступність…`
      for (const model of models) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${model.name}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: buildPrompt(entries) }],
              }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      en: { type: "STRING" },
                      ua: { type: "STRING" },
                      example: { type: "STRING" },
                    },
                    required: ["en", "ua", "example"],
                    propertyOrdering: ["en", "ua", "example"],
                  },
                },
              },
            }),
          }
        )

        const result = await response.json()
        if (response.ok) {
          payload = result
          break
        }
        lastApiError = result.error?.message || `Помилка Gemini API (${response.status}).`
      }

      if (!payload) throw new Error(lastApiError || "Не вдалося звернутися до Gemini API.")

      const generatedText = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
      if (!generatedText) throw new Error("Gemini не повернув список. Спробуйте ще раз.")

      const generated = JSON.parse(generatedText)
      if (!Array.isArray(generated) || generated.length === 0 || generated.some((item) =>
        !item || typeof item.en !== "string" || typeof item.ua !== "string" || typeof item.example !== "string"
      )) {
        throw new Error("Відповідь AI має неправильний формат. Спробуйте ще раз.")
      }

      const existing = JSON.parse(localStorage.getItem(LIST_STORAGE) || "[]")
      const knownEnglish = new Set(existing.map((item) => String(item.en || "").trim().toLocaleLowerCase()))
      const uniqueGenerated = []
      for (const item of generated) {
        const normalized = item.en.trim().toLocaleLowerCase()
        if (!normalized || !item.ua.trim() || knownEnglish.has(normalized)) continue
        knownEnglish.add(normalized)
        uniqueGenerated.push({ en: item.en.trim(), ua: item.ua.trim(), example: item.example.trim() })
      }

      if (!uniqueGenerated.length) {
        throw new Error("Усі згенеровані записи вже є у списку.")
      }

      localStorage.setItem(LIST_STORAGE, JSON.stringify([...uniqueGenerated, ...existing]))
      if (typeof renderSentences === "function") renderSentences()
      closeModal()
      input.value = ""
    } catch (error) {
      status.textContent = error instanceof SyntaxError
        ? "Не вдалося прочитати відповідь AI. Спробуйте ще раз."
        : error.message || "Сталася помилка під час генерації."
    } finally {
      isGenerating = false
      syncGenerateButton()
    }
  })

  function buildPrompt(entries) {
    return `Створи JSON-масив об'єктів для кожного рядка вхідного списку. Поверни рівно ${entries.length} об'єктів, по одному для кожного рядка, у тому самому порядку. Структура кожного об'єкта має містити тільки три рядкові поля: "en", "ua", "example". "en" — англійський рядок без змін. "ua" — короткий український переклад, після нього в круглих дужках коротко поясни контекст чи значення; не починай опис словами «використовується», «застосовується» або подібними. Якщо слово має кілька поширених значень або є іменником та прикметником, стисло наведи їх окремо. Не використовуй символ косої риски. "example" — суцільний рядок із двох простих англійських речень, кожне має природно містити вказане слово чи вираз; якщо значень кілька, дай приклади для основних значень. Не додавай markdown чи текст поза JSON.

Вхідний список:
${entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}`
  }

  function entriesFromInput() {
    return input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  }

  function syncGenerateButton() {
    generateButton.disabled = isGenerating || entriesFromInput().length > 50
  }

  function updateOverflowHighlight() {
    const lines = input.value.split(/\r?\n/)
    let nonEmptyCount = 0
    highlightLayer.replaceChildren()

    lines.forEach((line, index) => {
      if (line.trim()) nonEmptyCount++

      if (line.trim() && nonEmptyCount > 50) {
        const extraLine = document.createElement("span")
        extraLine.className = "ai-list-extra-line"
        extraLine.textContent = line || " "
        highlightLayer.appendChild(extraLine)
      } else {
        highlightLayer.appendChild(document.createTextNode(line || " "))
      }

      if (index < lines.length - 1) highlightLayer.appendChild(document.createTextNode("\n"))
    })

    if (!input.value) {
      highlightLayer.textContent = input.placeholder
    }
    highlightLayer.scrollTop = input.scrollTop
    highlightLayer.scrollLeft = input.scrollLeft
  }

  async function discoverModels(apiKey) {
    const models = []
    let pageToken = ""

    do {
      const query = new URLSearchParams({ pageSize: "1000" })
      if (pageToken) query.set("pageToken", pageToken)
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${query}`, {
        headers: { "x-goog-api-key": apiKey },
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error?.message || "Не вдалося отримати список моделей Gemini.")
      }
      models.push(...(result.models || []))
      pageToken = result.nextPageToken || ""
    } while (pageToken)

    const excludedModel = /(embedding|image|audio|tts|live|veo|robotics)/i
    return models
      .map((model) => ({
        ...model,
        resolvedModelId: model.baseModelId || model.name?.replace(/^models\//, "") || "",
        generationMethods: model.supportedGenerationMethods || model.supportedActions || [],
      }))
      .filter((model) =>
        model.generationMethods.includes("generateContent") &&
        /^(gemini|gemma)/i.test(model.resolvedModelId) &&
        /(flash|lite|gemma)/i.test(model.resolvedModelId) &&
        !excludedModel.test(model.resolvedModelId)
      )
      .map((model) => ({ ...model, name: `models/${model.resolvedModelId}` }))
      .sort((first, second) => modelPriority(first) - modelPriority(second))
  }

  function modelPriority(model) {
    const name = model.resolvedModelId || model.baseModelId || model.name || ""
    if (/flash.?lite/i.test(name)) return 0
    if (/flash/i.test(name)) return 1
    if (/preview|experimental/i.test(name)) return 3
    return 2
  }
})()
