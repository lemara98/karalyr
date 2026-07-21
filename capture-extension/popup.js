// Thin view over the service worker's state. All the sequencing lives there,
// because the popup closes the moment the operator clicks away and a run takes
// minutes.

const phaseEl = document.getElementById("phase");
const jobEl = document.getElementById("job");
const logEl = document.getElementById("log");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");

const BUSY = new Set(["claiming", "capturing", "uploading", "aligning"]);

function render(state) {
  const phase = state?.phase ?? "idle";
  phaseEl.textContent = phase;
  phaseEl.classList.toggle("busy", BUSY.has(phase));

  if (state?.job) {
    jobEl.hidden = false;
    jobEl.innerHTML = `<b></b><br /><span></span>`;
    jobEl.querySelector("b").textContent = state.job.track_name ?? "";
    jobEl.querySelector("span").textContent = state.job.artist_name ?? "";
  } else {
    jobEl.hidden = true;
  }

  startBtn.disabled = BUSY.has(phase);
  // Only a live recording can be cut short; once the audio is with the
  // aligner, stopping would just orphan the job.
  stopBtn.disabled = phase !== "capturing";

  logEl.textContent = (state?.log ?? []).join("\n") || "Ready.";
  logEl.scrollTop = logEl.scrollHeight;
}

startBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "start-run" }));
stopBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "stop-run" }));

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "state") render(message.state);
});

chrome.runtime.sendMessage({ type: "get-state" }, (res) => render(res?.state));
