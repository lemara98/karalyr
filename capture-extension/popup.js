// Thin view over the service worker's state, plus the one thing that *must*
// happen here: getMediaStreamId. tabCapture only grants a stream for a tab the
// extension was invoked on, and clicking this button is that invocation — call
// it from the service worker instead and Chrome refuses with "Extension has not
// been invoked for the current page".

const phaseEl = document.getElementById("phase");
const jobEl = document.getElementById("job");
const logEl = document.getElementById("log");
const primaryBtn = document.getElementById("primary");
const secondaryBtn = document.getElementById("secondary");

const BUSY = new Set(["claiming", "capturing", "uploading", "aligning"]);
let current = { phase: "idle" };

function render(state) {
  current = state ?? { phase: "idle" };
  const phase = current.phase;
  phaseEl.textContent = phase;
  phaseEl.classList.toggle("busy", BUSY.has(phase));

  if (current.job) {
    jobEl.hidden = false;
    jobEl.querySelector("b").textContent = current.job.track_name ?? "";
    jobEl.querySelector("span").textContent = current.job.artist_name ?? "";
  } else {
    jobEl.hidden = true;
  }

  if (phase === "claimed") {
    primaryBtn.textContent = "Record this tab";
    primaryBtn.disabled = false;
    secondaryBtn.textContent = "Release";
    secondaryBtn.disabled = false;
  } else if (phase === "capturing") {
    primaryBtn.textContent = "Recording…";
    primaryBtn.disabled = true;
    secondaryBtn.textContent = "Stop";
    secondaryBtn.disabled = false;
  } else {
    primaryBtn.textContent = "Claim next song";
    primaryBtn.disabled = BUSY.has(phase);
    secondaryBtn.textContent = "Stop";
    secondaryBtn.disabled = true;
  }

  logEl.textContent = (current.log ?? []).join("\n") || "Ready.";
  logEl.scrollTop = logEl.scrollHeight;
}

primaryBtn.addEventListener("click", async () => {
  if (current.phase === "claimed") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    if (current.tabId && tab.id !== current.tabId) {
      logEl.textContent += "\nSwitch to the tab this job opened, then press again.";
      return;
    }
    try {
      // Must be called here, in the click handler, for the gesture to count.
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      chrome.runtime.sendMessage({ type: "begin-capture", streamId, tabId: tab.id });
      window.close(); // let it run; reopen the popup to watch progress
    } catch (err) {
      logEl.textContent += `\nCould not capture this tab: ${err.message}`;
    }
    return;
  }
  chrome.runtime.sendMessage({ type: "claim-next" });
});

secondaryBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({
    type: current.phase === "capturing" ? "stop-run" : "abandon-run",
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "state") render(message.state);
});

chrome.runtime.sendMessage({ type: "get-state" }, (res) => render(res?.state));
