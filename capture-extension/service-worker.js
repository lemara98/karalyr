// Orchestrator. Two operator steps, for a reason:
//
//   1. "Claim next song"  -> ask the host for a job, open its link in a tab
//   2. "Record this tab"  -> capture, play from 0:00, ship the audio
//
// They are separate because tabCapture only works on a tab the extension has
// been *invoked* on by a user gesture. A tab this worker opens itself has no
// such gesture, so capturing it straight away fails with "Extension has not
// been invoked for the current page". Step 2 lives in the popup, where the
// click supplies the gesture, and the resulting streamId is handed here.
//
// The host holds WORKER_TOKEN and does all Karalyr traffic; this extension
// only ever moves audio.

const HOST_NAME = "com.karalyr.capture_host";
const CHUNK_BYTES = 512 * 1024; // keeps memory flat on a long song

let port = null;
let state = { phase: "idle", job: null, log: [], tabId: null };

function setPhase(phase, extra = {}) {
  state = { ...state, phase, ...extra };
  broadcast();
}

function pushLog(line) {
  state.log = [...state.log.slice(-80), line];
  broadcast();
}

function broadcast() {
  // The popup is usually closed; that rejection is expected.
  chrome.runtime.sendMessage({ type: "state", state }).catch(() => {});
}

function connectHost() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);

  port.onMessage.addListener((msg) => {
    if (msg.type === "log") return pushLog(msg.line);
    if (msg.type === "job") return onJobClaimed(msg.job);
    if (msg.type === "none") {
      pushLog("Nothing queued. Promote a song in /admin first.");
      return setPhase("idle");
    }
    if (msg.type === "done") {
      pushLog(`Done — revision #${msg.revision_id} on track #${msg.track_id} (${msg.revision_status})`);
      return setPhase("idle", { job: null, tabId: null });
    }
    if (msg.type === "error") {
      pushLog(`Error: ${msg.message}`);
      return setPhase("idle", { job: null, tabId: null });
    }
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    pushLog(`Native host disconnected${err ? `: ${err.message}` : ""}`);
    port = null;
    setPhase("idle", { job: null });
  });

  return port;
}

// ------------------------------------------------------------ step 1: claim

function claimNext() {
  if (state.phase !== "idle") return;
  state.log = [];
  setPhase("claiming");
  pushLog("Asking Karalyr for the next promoted song…");
  connectHost().postMessage({ type: "claim" });
}

async function onJobClaimed(job) {
  pushLog(`Job #${job.id}: ${job.artist_name} — ${job.track_name}`);

  if (!job.video_url) {
    pushLog("This request has no link, so there is nothing to play. Releasing it.");
    connectHost().postMessage({ type: "abandon" });
    return setPhase("idle", { job: null });
  }

  const tab = await chrome.tabs.create({ url: job.video_url, active: true });
  setPhase("claimed", { job, tabId: tab.id });
  pushLog("Opened the song. Now click the Karalyr icon again and press “Record this tab”.");
}

// ---------------------------------------------------------- step 2: capture

async function beginCapture(streamId, tabId) {
  if (state.phase !== "claimed" || !state.job) return;
  setPhase("capturing", { tabId });

  try {
    await ensureOffscreen();
    const started = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "start-capture",
      streamId,
      maxSeconds: state.job.duration_seconds || 600,
    });
    if (!started?.ok) throw new Error(started?.error || "could not start capture");

    connectHost().postMessage({ type: "audio_start", job_id: state.job.id, mime: "audio/webm" });
    pushLog("Recording. Leave the tab playing — it runs at normal speed.");

    // Restart from 0 and tell us when it ends, so we get the whole song and
    // not just what was left of an autoplay already in progress.
    await chrome.scripting.executeScript({ target: { tabId }, func: playFromStart });
  } catch (err) {
    pushLog(`Capture failed: ${err.message}`);
    connectHost().postMessage({ type: "abandon" });
    setPhase("idle", { job: null });
  }
}

/** Injected into the page: rewind, play, and report when playback finishes. */
function playFromStart() {
  const video = document.querySelector("video");
  if (!video) return;
  video.muted = false;
  try {
    video.currentTime = 0;
  } catch {
    /* some players refuse to seek before metadata; playback still works */
  }
  video.play();
  video.addEventListener(
    "ended",
    () => chrome.runtime.sendMessage({ type: "playback-ended" }),
    { once: true }
  );
}

async function finishCapture(reason) {
  if (state.phase !== "capturing") return;
  setPhase("uploading");
  pushLog(`Playback ${reason}. Stopping the recording…`);

  const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "stop-capture" });
  if (!result?.ok) {
    pushLog(`Could not finish the recording: ${result?.error}`);
    connectHost().postMessage({ type: "abandon" });
    return setPhase("idle", { job: null });
  }

  const base64 = result.base64 || "";
  for (let i = 0; i < base64.length; i += CHUNK_BYTES) {
    connectHost().postMessage({ type: "audio_chunk", data: base64.slice(i, i + CHUNK_BYTES) });
  }
  connectHost().postMessage({ type: "audio_end" });

  setPhase("aligning");
  pushLog("Audio sent. Aligning — this is the slow part.");
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Records tab audio for the Karalyr aligner.",
  });
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-state") {
    sendResponse({ state });
    return false;
  }
  if (message.type === "claim-next") claimNext();
  if (message.type === "begin-capture") beginCapture(message.streamId, message.tabId);
  if (message.type === "stop-run") finishCapture("stopped by hand");
  if (message.type === "playback-ended") finishCapture("finished");
  if (message.type === "capture-timeout") finishCapture("hit the time limit");
  if (message.type === "abandon-run") {
    connectHost().postMessage({ type: "abandon" });
    pushLog("Released the job.");
    setPhase("idle", { job: null });
  }
  return false;
});
