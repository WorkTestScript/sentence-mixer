const sentenceEl = document.getElementById("sentence")
const userInput = document.getElementById("user-input")
const inputOverlay = document.getElementById("input-overlay")
const skipBtn = document.getElementById("skip-btn")
const hintBtn = document.getElementById("hint-btn")
const sentenceCount = document.getElementById("sentence-count")
const voiceSelect = document.getElementById("voice-select")
const speedControl = document.getElementById("speed")
const pitchControl = document.getElementById("pitch")
const volumeControl = document.getElementById("volume")
const popup = document.getElementById("popup")
const popupText = document.getElementById("popup-text")
const exampleText = document.getElementById("example-text")
const closePopup = document.getElementById("close-popup")
const saveSentence = document.getElementById("repeat-sentence")
const trainerRepeatBtn = document.getElementById("trainer-repeat-btn")
const settingsBtn = document.getElementById("settings-btn")
const settings = document.getElementById("settings")
const navbar = document.getElementById("navbar")
const trainerVoiceBtn = document.getElementById("trainerVoiceBtn")
const voiceInputBtn = document.getElementById("voice-input-btn")

const sentences = JSON.parse(localStorage.getItem("sentences")) || []
let usedIndexes = JSON.parse(localStorage.getItem("usedIndexes")) || []
let currentSentenceIndex = null
let hintMode = false
let randomNumber = null
let previousNumber = null
// Add a new state variable for ignoring punctuation
let ignorePunctuation = JSON.parse(localStorage.getItem("ignorePunctuation")) || false

// Speech Recognition variables
let recognition = null
let isRecording = false
let voiceInputActive = false // Track if voice input is currently active
let permissionGranted = false // Track if permission was granted
let isListening = false // Track if we're currently listening
let lastTranscript = "" // Store the last recognized transcript
let voiceEngineActive = false;
// True while the microphone is actually listening (false while it is paused
// for speech, restarting, or off). Together with voiceEngineActive it drives
// the red recording dot in the hint popup (see refreshSpeechIndicator).
let micReady = false

const speechIndicator = document.getElementById("voice-status")

// The red dot is shown only when a spoken command can be heard right now:
// the mic is on and listening, and the app is not speaking. The dot lives
// inside the popup, so it is only ever visible while the popup is open.
function refreshSpeechIndicator() {
  if (!speechIndicator) return
  const listening = isRecording && micReady && !voiceEngineActive
  speechIndicator.classList.toggle("active", listening)
}

function setVoiceEngineActive(value) {
  voiceEngineActive = value
  refreshSpeechIndicator()
}
// Timestamp until which incoming speech-recognition results should be
// ignored. This swallows results that the microphone picks up right after
// the app finishes speaking (either genuine mic echo of the TTS voice, or
// a recognition event that was queued during playback and only delivered
// afterwards) so an already-answered word can't reappear in the field
// once the next sentence has loaded.
let ignoreRecognitionUntil = 0
// When true, recognition.onend must NOT auto-restart the mic. We set this
// while deliberately pausing recognition for TTS playback (see
// pauseRecognitionForSpeech/resumeRecognitionAfterSpeech below), so the
// mic is fully off - not just ignored - while the app is speaking. This
// stops it from being able to pick up its own voice as an "answer" at
// all, rather than trying to filter that out after the fact.
let suppressAutoRestart = false
let consecutiveNetworkErrors = 0
let recognitionRestartTimer = null

// Input field event management
let inputKeydownHandler = null;
let inputPasteHandler = null;
let inputCutHandler = null;
let inputDropHandler = null;

// Result indexes already handled during the current recognition session.
const handledCommandResults = new Set()
let pendingVoiceCommand = null
let pendingVoiceCommandTimer = null
const VOICE_COMMAND_STABILITY_MS = 220

function isVoiceCommandText(text) {
  const commandText = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return /\b(next point|skip (?:this )?sentence|come up|show (?:the )?hint|got it|hide it|close (?:the )?hint|keep it|save (?:this )?sentence|say it|read (?:the )?sentence)\b/.test(commandText)
}

// Runs a voice command if the text contains one. Returns true if handled.
function runVoiceCommand(text) {
  const commandText = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (/\b(next point|skip (?:this )?sentence)\b/.test(commandText)) {
    skipSentence()
    return true
  }
  if (/\b(come up|show (?:the )?hint)\b/.test(commandText)) {
    showHint()
    return true
  }
  if (/\b(got it|hide it|close (?:the )?hint)\b/.test(commandText)) {
    if (popup.style.display === 'flex') {
      hidePopup()
      return true
    }
    return false
  }
  if (/\b(keep it|save (?:this )?sentence)\b/.test(commandText)) {
    saveSentenceToLocalStorageNoAdvance()
    // Close the hint popup if it is open (hintMode is true here, so
    // hidePopup() will not advance to the next sentence).
    if (popup.style.display === 'flex') {
      hintMode = true
      hidePopup()
    }
    return true
  }
  if (/\b(say it|read (?:the )?sentence)\b/.test(commandText)) {
    speakCurrentSentence()
    return true
  }
  return false
}

// Initialize Speech Recognition (called once on page load)
function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('Speech recognition not supported in this browser')
    if (voiceInputBtn) {
      voiceInputBtn.style.display = 'none'
    }
    return
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition = new SpeechRecognition()

  recognition.continuous = true // Changed to true to keep it running
  recognition.interimResults = true
  recognition.lang = 'en-US' // English language

  recognition.onstart = function () {
    handledCommandResults.clear()
    if (pendingVoiceCommandTimer) clearTimeout(pendingVoiceCommandTimer)
    pendingVoiceCommandTimer = null
    pendingVoiceCommand = null
    micReady = true
    isRecording = true
    voiceInputActive = true
    permissionGranted = true
    isListening = true
    refreshSpeechIndicator()
    if (voiceInputBtn) {
      voiceInputBtn.classList.add('recording')
      voiceInputBtn.title = 'Зупинити запис'
    }
  }

  recognition.onresult = function (event) {
    if (voiceEngineActive) return
    if (Date.now() < ignoreRecognitionUntil) return
    consecutiveNetworkErrors = 0

    userInput.value = ""
    inputOverlay.innerHTML = ""
    let interimTranscript = ''
    let finalTranscript = ''
    hintMode = true

    // SpeechRecognition results are cumulative. Rebuild from the complete
    // result list rather than treating each event as a fresh transcript.
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.trim()
      if (event.results[i].isFinal) {
        if (pendingVoiceCommand?.index === i) {
          clearTimeout(pendingVoiceCommandTimer)
          pendingVoiceCommandTimer = null
          pendingVoiceCommand = null
        }
        if (!handledCommandResults.has(i)) {
          handledCommandResults.add(i)
          if (runVoiceCommand(transcript)) continue
          finalTranscript += `${transcript} `
        }
      } else {
        interimTranscript = transcript
        if (!handledCommandResults.has(i) && isVoiceCommandText(transcript)) {
          const samePending = pendingVoiceCommand?.index === i && pendingVoiceCommand.text === transcript
          if (!samePending) {
            if (pendingVoiceCommandTimer) clearTimeout(pendingVoiceCommandTimer)
            pendingVoiceCommand = { index: i, text: transcript }
            pendingVoiceCommandTimer = setTimeout(() => {
              const command = pendingVoiceCommand
              pendingVoiceCommand = null
              pendingVoiceCommandTimer = null
              if (!command || !isRecording || voiceEngineActive || handledCommandResults.has(command.index)) return
              if (runVoiceCommand(command.text)) handledCommandResults.add(command.index)
            }, VOICE_COMMAND_STABILITY_MS)
          }
        } else if (pendingVoiceCommand?.index === i) {
          clearTimeout(pendingVoiceCommandTimer)
          pendingVoiceCommandTimer = null
          pendingVoiceCommand = null
        }
      }
    }
    finalTranscript = finalTranscript.trim()

    if (finalTranscript) {
      // Store the transcript
      lastTranscript = finalTranscript

      // While the hint popup is open, don't treat further speech as an
      // answer attempt. checkAnswer() resets hintMode as a side effect
      // even when the answer is wrong, and closing the hint afterwards
      // (via "got it", F8, the close button, etc.) would then
      // incorrectly jump to the next sentence, even though nothing
      // correct was ever said. Voice commands above still work as
      // normal since they're checked first and return early.
      if (popup.style.display === 'flex') {
        return
      }

      // Visual feedback when text is recognized
      showRecognizedTextIndicator()

      userInput.value = finalTranscript
      checkAnswer()
      // Let the popup system handle moving to next sentence
      // Don't call getRandomSentence() here - let hidePopup() handle it
    } else if (interimTranscript) {
      // Same reasoning as the final-transcript guard above: while the
      // popup is open there's nothing to usefully show here, and this was
      // the actual source of the brief "flash" of a word appearing in the
      // field right around when the popup was open - an in-progress
      // (not yet final) recognition result, most likely the mic hearing
      // the app's own spoken answer/hint, was being written straight into
      // the field with no check at all.
      if (popup.style.display === 'flex') {
        return
      }

      // Show interim results visually
      userInput.value = interimTranscript.trim()
      // The overlay (not the native input) is what actually renders visible
      // characters here - it was previously only refreshed on a *final*
      // result, so a word being spoken looked invisible (only the caret
      // moved) until recognition finalized it. Refresh it on every interim
      // update too - but in plain mode (no red underline): errors are only
      // marked once the phrase is final (checkAnswer -> highlightErrors()).
      highlightErrors(true)
    }
  }

  recognition.onerror = function (event) {
    // 'network' errors are logged separately below with extra details.
    if (event.error !== 'no-speech' && event.error !== 'network') console.error('Speech recognition error:', event.error)

    if (event.error === 'network') {
      consecutiveNetworkErrors += 1
      // Log only (no change in handling) so voice input reliability can be evaluated.
      console.warn(
        `[Voice input] Network error #${consecutiveNetworkErrors} at ${new Date().toLocaleTimeString()}`,
        { error: event.error, message: event.message || '', online: navigator.onLine }
      )
      return
    }

    // Handle permission denied specifically
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      permissionGranted = false
      isRecording = false
      voiceInputActive = false
      if (voiceInputBtn) {
        voiceInputBtn.classList.remove('recording')
        voiceInputBtn.title = 'Голосовий ввід'
      }
      showInformationModal('Доступ до мікрофона заборонено. Будь ласка, дозвольте доступ до мікрофона в налаштуваннях браузера та оновіть сторінку.')
    } else if (event.error === 'no-speech') {
      // Nothing to do here: the browser always fires onend right after a
      // no-speech error, and onend already restarts recognition (and
      // respects suppressAutoRestart). Restarting here as well caused a
      // second start() call -> "recognition has already started".
    }
  }

  recognition.onend = function () {
    micReady = false
    refreshSpeechIndicator()
    // Only stop if permission was revoked or there's an error
    // Otherwise, restart to keep listening - unless we deliberately
    // paused it ourselves to let the app speak without the mic hearing it
    if (permissionGranted && isRecording && !suppressAutoRestart) {
      if (recognitionRestartTimer) clearTimeout(recognitionRestartTimer)
      if (consecutiveNetworkErrors >= 3) {
        console.error(`[Voice input] ${consecutiveNetworkErrors} consecutive network errors - voice recognition stopped at ${new Date().toLocaleTimeString()}`)
        stopVoiceRecording()
        // Close a hint without advancing the exercise. This leaves the app
        // usable when the browser's speech service cannot be reached.
        if (popup.style.display === 'flex') {
          hintMode = true
          hidePopup()
        }
        showInformationModal('Не вдалося відновити голосове розпізнавання через мережеву помилку. Підказку закрито, поточне речення збережено. Перевірте з’єднання та спробуйте ввімкнути мікрофон знову.')
        consecutiveNetworkErrors = 0
        return
      }
      const retryDelay = consecutiveNetworkErrors
        ? Math.min(1000 * (2 ** (consecutiveNetworkErrors - 1)), 4000)
        : 300
      if (consecutiveNetworkErrors) {
        console.info(`[Voice input] Restarting recognition after network error in ${retryDelay} ms`)
      }
      recognitionRestartTimer = setTimeout(() => {
        recognitionRestartTimer = null
        if (recognition && permissionGranted && isRecording && !suppressAutoRestart) {
          try {
            recognition.start()
          } catch (e) {
            // "already started" just means it is running - not an error
            if (e.name !== 'InvalidStateError') console.log('Recognition restart failed:', e)
          }
        }
      }, retryDelay)
    } else if (!suppressAutoRestart) {
      isListening = false
      stopVoiceRecording()
    }
  }
}

// Start voice recording
function startVoiceRecording() {
  if (!recognition) return

  try {
    recognition.start()
  } catch (error) {
    console.error('Error starting speech recognition:', error)
    // If already started, this is normal
    if (error.name !== 'InvalidStateError') {
      permissionGranted = false
    }
  }
}

// Fully stop the recognition engine while the app is speaking (a hint,
// or the correct-answer confirmation), so the microphone cannot pick up
// that speech and have it misread as the user's own answer. This is
// deliberately a hard stop (not just ignoring results) - restarting
// afterwards is handled by resumeRecognitionAfterSpeech.
function pauseRecognitionForSpeech() {
  if (!recognition || !isRecording) return
  suppressAutoRestart = true
  micReady = false
  refreshSpeechIndicator()
  try {
    recognition.stop()
  } catch (e) {
    console.log('Recognition pause failed:', e)
  }
}

// Restart the recognition engine after the app has finished speaking.
// Waits a short moment first so any trailing audio/echo from the speech
// has already died out before the mic starts listening again.
function resumeRecognitionAfterSpeech(delay = 500) {
  if (!recognition || !isRecording) return
  setTimeout(() => {
    suppressAutoRestart = false
    if (recognition && isRecording) {
      try {
        recognition.start()
      } catch (e) {
        // Already running is fine - nothing to do
      }
    }
  }, delay)
}

// Stop voice recording
function stopVoiceRecording() {
  if (!recognition) return

  if (recognitionRestartTimer) {
    clearTimeout(recognitionRestartTimer)
    recognitionRestartTimer = null
  }
  isRecording = false
  voiceInputActive = false // Reset voice input active flag
  micReady = false
  refreshSpeechIndicator()
  permissionGranted = false
  if (voiceInputBtn) {
    voiceInputBtn.classList.remove('recording')
    voiceInputBtn.title = 'Голосовий ввід'
  }

  try {
    recognition.stop()
  } catch (error) {
    console.error('Error stopping speech recognition:', error)
  }
}

// Toggle voice recording with improved permission handling
function toggleVoiceRecording() {
  if (isRecording) {
    // Just stop listening, don't reset permission state
    isRecording = false
    voiceInputActive = false
    if (voiceInputBtn) {
      voiceInputBtn.classList.remove('recording')
      voiceInputBtn.title = 'Голосовий ввід'
    }

    try {
      recognition.stop()
    } catch (error) {
      console.error('Error stopping speech recognition:', error)
    }
  } else {
    consecutiveNetworkErrors = 0
    // Clear input for new voice input
    userInput.value = ""
    inputOverlay.innerHTML = ""

    // Initialize speech recognition if not already done
    if (!recognition) {
      initSpeechRecognition()
    }

    // Check permission state first
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' }).then((permissionStatus) => {
        if (permissionStatus.state === 'granted' || permissionStatus.state === 'prompt') {
          // Start recording - this will prompt for permission if needed
          isRecording = true
          voiceInputActive = true
          startVoiceRecording()
        } else {
          // Permission denied
          showInformationModal('Доступ до мікрофона заборонено. Будь ласка, дозвольте доступ до мікрофона в налаштуваннях браузера.')
        }
      }).catch(() => {
        // Fallback - just try to start
        isRecording = true
        voiceInputActive = true
        startVoiceRecording()
      })
    } else {
      // Fallback for older browsers
      isRecording = true
      voiceInputActive = true
      startVoiceRecording()
    }
  }
}

// Create the ignore punctuation icon element
const createIgnorePunctuationIcon = () => {
  const iconContainer = document.createElement("div")
  iconContainer.id = "ignore-punctuation-icon"
  iconContainer.className = ignorePunctuation ? "active" : ""
  iconContainer.innerHTML = ".!?"
  iconContainer.title = ignorePunctuation
    ? "Ігнорування знаків пунктуації увімкнено"
    : "Ігнорування знаків пунктуації вимкнено"
  iconContainer.style.position = "absolute"
  iconContainer.style.top = "10px"
  iconContainer.style.left = "10px"
  iconContainer.style.cursor = "pointer"
  iconContainer.style.fontSize = "16px"
  iconContainer.style.padding = "5px"
  iconContainer.style.borderRadius = "4px"
  iconContainer.style.backgroundColor = "transparent"
  iconContainer.style.border = "1px solid var(--dark-color)"

  iconContainer.addEventListener("click", toggleIgnorePunctuation)

  return iconContainer
}

// Toggle the ignore punctuation feature
function toggleIgnorePunctuation() {
  ignorePunctuation = !ignorePunctuation
  localStorage.setItem("ignorePunctuation", JSON.stringify(ignorePunctuation))

  const icon = document.getElementById("ignore-punctuation-icon")
  if (icon) {
    icon.className = ignorePunctuation ? "active" : ""
    icon.innerHTML = ".!?"
    icon.title = ignorePunctuation
      ? "Ігнорування знаків пунктуації увімкнено"
      : "Ігнорування знаків пунктуації вимкнено"
    icon.style.backgroundColor = "transparent"
  }
}

// Function to escape HTML characters
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    ' ': '&nbsp;'
  }
  return text.replace(/[&<>"' ]/g, m => map[m])
}

// Function to highlight typing errors.
// When `plain` is true the text is rendered in the overlay WITHOUT any error
// marking. This is used for interim (still being recognised) voice results,
// so correctly spoken words are not flashed red while the phrase is unfinished.
function highlightErrors(plain = false) {
  if (currentSentenceIndex === null) return

  const correctAnswer = sentences[currentSentenceIndex].en
  const userAnswer = userInput.value

  let overlayHTML = ""

  for (let i = 0; i < userAnswer.length; i++) {
    const userChar = userAnswer[i]
    const correctChar = correctAnswer[i]
    const escapedChar = escapeHtml(userChar)

    if (!plain && userChar !== correctChar) {
      // Character is incorrect - wrap it in error span.
      // The background/color are also set inline (not only via the
      // .error-char class in style.css) because some older Chromium
      // builds (e.g. the last Chrome versions still able to run on
      // Windows 7) fail to paint a class-based background-color that
      // relies on a CSS custom property (var(--primary-color)) on
      // elements injected via innerHTML. Inline styles always win and
      // don't depend on var() support or stylesheet load order.
      overlayHTML += `<span class="error-char" style="background-color:#fd7878;color:#111827;border-radius:2px;">${escapedChar}</span>`
    } else {
      // Character is correct - add transparent character
      overlayHTML += escapedChar
    }
  }

  inputOverlay.innerHTML = overlayHTML

  // Force a reflow/repaint. Older Chromium engines sometimes don't
  // repaint newly inserted inline elements inside an absolutely
  // positioned, flex-centered overlay until layout is recalculated -
  // reading offsetHeight forces that recalculation immediately.
  void inputOverlay.offsetHeight
}

// Modified function to check answer with punctuation ignoring option and case sensitivity
function checkAnswer() {
  hintMode = false
  if (currentSentenceIndex === null) return

  // Highlight errors first
  highlightErrors()

  let correctAnswer = sentences[currentSentenceIndex].en.trim()
  let userAnswer = userInput.value.trim()

  // If ignore punctuation is enabled, remove punctuation from both strings
  if (ignorePunctuation) {
    correctAnswer = correctAnswer.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
    userAnswer = userAnswer.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  }

  // If voice input was used, ignore case; otherwise, consider case
  let isCorrect = false
  if (voiceInputActive) {
    isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase()
  } else {
    isCorrect = userAnswer === correctAnswer
  }

  if (isCorrect) {
    if (!usedIndexes.includes(currentSentenceIndex)) {
      usedIndexes.push(currentSentenceIndex)
      localStorage.setItem("usedIndexes", JSON.stringify(usedIndexes))
    }
    // Ignore any recognition results from the moment we've confirmed the
    // answer is correct until well after the popup closes. Without this,
    // a result that was already "in flight" (e.g. the mic picking up the
    // tail of the word, or the app's own spoken confirmation) can land
    // just after the field was cleared and write the old word straight
    // back into it, even while the popup is visible.
    ignoreRecognitionUntil = Date.now() + 15000
    showPopup(sentences[currentSentenceIndex], true)
  }
}

function randomizer(num) {
  if (num === 0) return 0
  let newNumber
  do {
    newNumber = Math.floor(Math.random() * num)
  } while (newNumber === previousNumber)
  previousNumber = newNumber
  return newNumber
}

// Voice settings functions now handled by voiceEngine

function getRandomSentence() {
  if (!sentences.length) return
  const count = sentences.length - usedIndexes.length
  sentenceCount.innerText = count
  let availableIndexes = sentences.map((_, index) => index).filter((index) => !usedIndexes.includes(index))

  if (availableIndexes.length === 0) {
    showInformationModal("Усі речення використані!")
    localStorage.removeItem("usedIndexes")
    usedIndexes = []
    sentenceCount.innerText = sentences.length
    availableIndexes = sentences.map((_, index) => index)
  }

  if (count <= 1) currentSentenceIndex = availableIndexes[0]
  else if (randomNumber !== null) currentSentenceIndex = availableIndexes[randomNumber]
  else currentSentenceIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)]

  sentenceEl.textContent = sentences[currentSentenceIndex].ua
  userInput.value = ""
  inputOverlay.innerHTML = ""
  userInput.focus()
  hintMode = false
  randomNumber = null
  updateFavoriteIndicator()
}

function showPopup(text, autoClose = false) {
  popupText.textContent = text.en
  // Clear the field once the answer has been confirmed correct
  // (autoClose) - this used to only happen for voice input, so typing
  // the correct answer with the keyboard left the word sitting in the
  // field until the popup closed. Don't clear it for the hint popup
  // (autoClose === false), so keyboard users keep whatever they'd
  // already typed while just checking the hint.
  if (voiceInputActive || autoClose) {
    userInput.value = '';
    inputOverlay.innerHTML = '';
  }
  // Show example if it exists and is not empty
  if (text.example && text.example.trim()) {
    exampleText.textContent = text.example
    exampleText.style.display = "block"
  } else {
    exampleText.style.display = "none"
  }

  popup.style.display = "flex"
  updateFavoriteIndicator(text)
  // Always speak the sentence, including hints shown while the microphone
  // is on. speak() pauses the recognizer for the duration of the speech
  // (pauseRecognitionForSpeech), so the mic can't hear the app's own voice,
  // and onSpeechFinished() turns it back on when the speech ends.
  speak(text.en, autoClose)
}

function hidePopup() {
  voiceEngine.stop()
  setVoiceEngineActive(false);
  // Give the microphone a brief moment before trusting new results again,
  // so leftover audio from the answer we just spoke doesn't get written
  // into the (already cleared) field for the next sentence.
  ignoreRecognitionUntil = Date.now() + 500
  resumeRecognitionAfterSpeech()
  popup.style.display = "none"
  userInput.focus()
  if (!hintMode) {
    getRandomSentence()
  }
}

function speak(text, autoClose = false) {
  setVoiceEngineActive(true);
  pauseRecognitionForSpeech()
  voiceEngine.speak(text, autoClose ? hidePopup : null, autoClose)
}

function speakCurrentSentence() {
  hintMode = true;
  setVoiceEngineActive(true);
  pauseRecognitionForSpeech()

  if (voiceInputActive) {
    userInput.value = '';
    inputOverlay.innerHTML = '';
  }

  if (currentSentenceIndex !== null && sentences[currentSentenceIndex]) {
    const currentSentence = sentences[currentSentenceIndex]
    voiceEngine.speak(currentSentence.en)
  }
}

// Voice loading now handled by voiceEngine

function skipSentence() {
  if (currentSentenceIndex === null) return

  // Mark current sentence as used (same as correct answer)
  if (!usedIndexes.includes(currentSentenceIndex)) {
    usedIndexes.push(currentSentenceIndex)
    localStorage.setItem("usedIndexes", JSON.stringify(usedIndexes))
    hidePopup()
    getRandomSentence()
  }

}

function showHint() {
  if (currentSentenceIndex !== null) {
    hintMode = true
    showPopup(sentences[currentSentenceIndex], false)
  }
}

function saveSentenceToLocalStorage() {
  const storedSentences = JSON.parse(localStorage.getItem("saveSelected")) || []
  const currentSentence = sentences[currentSentenceIndex]
  if (
    currentSentence &&
    !storedSentences.some((item) => item.ua === currentSentence.ua && item.en === currentSentence.en)
  ) {
    // Ensure we save in the new format with example property
    const sentenceToSave = {
      ua: currentSentence.ua,
      en: currentSentence.en,
      example: currentSentence.example || "",
    }
    storedSentences.push(sentenceToSave)
    localStorage.setItem("saveSelected", JSON.stringify(storedSentences))
    try {
      // notify other modules to update UI
      window.dispatchEvent(new Event('saveSelectedChanged'))
    } catch (e) { }
  }
  showInformationModal("Речення в спискy")
  hidePopup()
  userInput.focus()
}

// Save current sentence to saveSelected WITHOUT advancing to the next sentence
function saveSentenceToLocalStorageNoAdvance() {
  const storedSentences = JSON.parse(localStorage.getItem("saveSelected")) || []
  const currentSentence = sentences[currentSentenceIndex]
  if (
    currentSentence &&
    !storedSentences.some((item) => item.ua === currentSentence.ua && item.en === currentSentence.en)
  ) {
    const sentenceToSave = {
      ua: currentSentence.ua,
      en: currentSentence.en,
      example: currentSentence.example || "",
    }
    storedSentences.push(sentenceToSave)
    localStorage.setItem("saveSelected", JSON.stringify(storedSentences))
    try { window.dispatchEvent(new Event('saveSelectedChanged')) } catch (e) { }
  }
  showInformationModal("Речення в спискy")
  // Keep the current sentence visible; do not call hidePopup() or getRandomSentence()
  userInput.focus()
}

// Initialize the application
function initApp() {
  // Add the ignore punctuation icon to the trainer div
  const trainerDiv = document.getElementById("trainer")
  if (trainerDiv) {
    trainerDiv.style.position = "relative" // Ensure proper positioning
    trainerDiv.prepend(createIgnorePunctuationIcon())
  }

  // Initialize voice engine
  voiceEngine.init(voiceSelect, speedControl, pitchControl, volumeControl)

  // Set callback for when speech ends
  voiceEngine.setOnSpeechEndCallback(onSpeechFinished)

  // Initialize speech recognition on page load but don't start it
  // This allows us to keep the recognition object alive
  initSpeechRecognition()

  getRandomSentence()
}

let settingsTimeout = null

// Add event listener for keydown events
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.key === 'F12') {
    e.preventDefault()
    skipSentence()
    return
  }

  if (e.key === 'F8') {
    e.preventDefault();
    if (popup.style.display === 'flex') {
      hidePopup()
    } else {
      userInput.blur();
      showHint()
    }
  }

  if (e.key === 'F9') {
    e.preventDefault();
    saveSentenceToLocalStorageNoAdvance();
  }

  if (e.key === 'F10') {
    e.preventDefault();
    toggleVoiceRecording();
  }

  if (e.key === 'Escape' && isRecording) {
    e.preventDefault();
    stopVoiceRecording();
  }
});

settingsBtn.addEventListener("click", () => {

  if (settingsTimeout !== null) {
    clearTimeout(settingsTimeout)
    settingsTimeout = null
  }

  settings.classList.toggle("hide")
  navbar.classList.toggle("hide")

  if (!settings.classList.contains("hide") && !navbar.classList.contains("hide")) {
    settingsTimeout = setTimeout(() => {
      settings.classList.toggle("hide")
      navbar.classList.toggle("hide")
      settingsTimeout = null
    }, 10000)
  }
})

document.addEventListener("click", (event) => {
  if (!popup.querySelector(".popup-content").contains(event.target) && popup.contains(event.target)) hidePopup()
})

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && popup.style.display !== "" && popup.style.display === "flex") {
    hidePopup()
  }
})

speechSynthesis.addEventListener("voiceschanged", () => voiceEngine.loadVoices())
userInput.addEventListener("input", checkAnswer)
userInput.addEventListener("input", () => {
  // When user types with keyboard, disable voice input mode
  if (!isRecording) {
    voiceInputActive = false
  }
})
userInput.addEventListener("focus", () => {
  if (popup.style.display === "flex") {
    hidePopup()
  }
})
skipBtn.addEventListener("click", skipSentence)
hintBtn.addEventListener("click", showHint)
closePopup.addEventListener("click", hidePopup)
voiceSelect.addEventListener("change", () => voiceEngine.saveSettings())
speedControl.addEventListener("input", () => voiceEngine.saveSettings())
pitchControl.addEventListener("input", () => voiceEngine.saveSettings())
volumeControl.addEventListener("input", () => voiceEngine.saveSettings())
saveSentence.addEventListener("click", saveSentenceToLocalStorage)
if (trainerRepeatBtn) {
  trainerRepeatBtn.addEventListener("click", saveSentenceToLocalStorageNoAdvance)
}
trainerVoiceBtn.addEventListener("click", speakCurrentSentence)

/* ---------- Favorite indicator in the hint popup ----------
   "+" while the sentence is not in saveSelected, a yellow heart once it is.
   Re-checked every time the popup opens and whenever saveSelected changes
   (saving a sentence, saving the list to a file, another tab). */
const FAVORITE_HEART_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'

function isSentenceFavorite(sentence) {
  if (!sentence) return false
  try {
    const stored = JSON.parse(localStorage.getItem("saveSelected"))
    return Array.isArray(stored) && stored.some((item) => item.ua === sentence.ua && item.en === sentence.en)
  } catch (e) {
    return false
  }
}

function renderFavoriteButton(button, favorite) {
  if (!button) return
  button.classList.toggle("is-favorite", favorite)
  button.title = favorite ? "Додано до вибраного" : "Додати до вибраного"
  if (favorite) button.innerHTML = FAVORITE_HEART_SVG
  else button.textContent = "+"
}

// Updates both "+" buttons: the one in the hint popup (for the sentence it shows)
// and the corner one on the main screen (for the current sentence).
function updateFavoriteIndicator(sentence = sentences[currentSentenceIndex]) {
  renderFavoriteButton(saveSentence, isSentenceFavorite(sentence))
  renderFavoriteButton(trainerRepeatBtn, isSentenceFavorite(sentences[currentSentenceIndex]))
}

window.addEventListener("saveSelectedChanged", () => updateFavoriteIndicator())
window.addEventListener("storage", (e) => {
  if (e.key === "saveSelected" || e.key === null) updateFavoriteIndicator()
})

// Voice input button event listener
if (voiceInputBtn) {
  voiceInputBtn.addEventListener("click", toggleVoiceRecording)
}

// Call initApp instead of directly calling loadVoices and getRandomSentence
initApp()

function showRecognizedTextIndicator() {
  // Flash the input to show text was recognized
  if (userInput) {
    const originalBackground = userInput.style.backgroundColor
    userInput.style.backgroundColor = '#E8F5E8'
    userInput.style.transition = 'background-color 0.3s ease'

    setTimeout(() => {
      userInput.style.backgroundColor = originalBackground
    }, 200)
  }
}

// Method that gets called when voice engine finishes speaking
function onSpeechFinished() {
  if (!hintMode) hidePopup()
  // A hint (or "say it") has just been read aloud and the popup stays open,
  // waiting for the user's next command ("got it", etc.). The microphone was
  // fully off during the speech, so turn it back on right away - any extra
  // waiting here is exactly the window in which a spoken "got it" is lost.
  if (hintMode) {
    setVoiceEngineActive(false)
    resumeRecognitionAfterSpeech(0)
    return
  }
  setTimeout(() => {
    setVoiceEngineActive(false);
    ignoreRecognitionUntil = Date.now() + 500
    // hidePopup() (above) already resumes recognition when it runs; when
    // hintMode is true it doesn't run, so resume it here instead.
    if (hintMode) {
      resumeRecognitionAfterSpeech()
    }
    // userInput.value = '';
    // inputOverlay.innerHTML = '';
  }, 500);
}
