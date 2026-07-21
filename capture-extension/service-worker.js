// Orchestrator. Sequence for one song:
//
//   claim a job from the native host  ->  open its link in a tab
//   start capturing that tab          ->  play from the beginning
//   playback ends                     ->  stop, ship audio to the host
//   host aligns + reports             ->  close the tab
//
// The host holds WORKER_TOKEN and does all Karalyr traffic. This extension
// never sees the token — it only moves audio.

const HOST_NAME = "com.karalyr.capture_host";
const CHUNK_BYTES = 512 * 1024; // native messaging takes big messages, but chunking keeps memory flat

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
  // The popup may be closed; that rejection is expected and uninteresting.
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
      cleanupTab();
      return setPhase("idle", { job: null });
    }
    if (msg.type === "error") {
      pushLog(`Error: ${msg.message}`);
      cleanupTab();
      return setPhase("idle", { job: null });
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

// ---------------------------------------------------------------- run

async function startRun() {
  if (state.phase !== "idle") return;
  state.log = [];
  setPhase("claiming");
  pushLog("Asking Karalyr for the next promoted song…");
  connectHost().postMessage({ type: "claim" });
}

async function onJobClaimed(job) {
  if (!job.video_url) {
    pushLog("That job has no link, so there is nothing to play. Abandoning it.");
    connectHost().postMessage({ type: "abandon" });
    return setPhase("idle");
  }

  setPhase("capturing", { job });
  pushLog(`Job #${job.id}: ${job.artist_name} — ${job.track_name}`);

  try {
    const tab = await chrome.tabs.create({ url: job.video_url, active: true });
    state.tabId = tab.id;
    await waitForTabComplete(tab.id);

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await ensureOffscreen();

    const started = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "start-capture",
      streamId,
      maxSeconds: job.duration_seconds || 600,
    });
    if (!started?.ok) throw new Error(started?.error || "could not start capture");

    pushLog("Recording. Leave the tab playing — it runs at normal speed.");
    connectHost().postMessage({ type: "audio_start", job_id: job.id, mime: "audio/webm" });

    // Restart from 0 and tell us when it ends, so we capture the whole song
    // and not whatever was left of an autoplay that already began.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: playFromStart,
    });
  } catch (err) {
    pushLog(`Capture failed: ${err.message}`);
    connectHost().postMessage({ type: "abandon" });
    cleanupTab();
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
    /* some players reject seeking before metadata; playback still works */
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
    cleanupTab();
    return setPhase("idle", { job: null });
  }

  const base64 = result.base64 || "";
  for (let i = 0; i < base64.length; i += CHUNK_BYTES) {
    connectHost().postMessage({ type: "audio_chunk", data: base64.slice(i, i + CHUNK_BYTES) });
  }
  connectHost().postMessage({ type: "audio_end" });

  setPhase("aligning");
  pushLog("Audio sent. Aligning — Demucs takes a few minutes on CPU.");
}

function cleanupTab() {
  if (state.tabId != null) {
    chrome.tabs.remove(state.tabId).catch(() => {});
    state.tabId = null;
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        // Players need a beat past "complete" before <video> exists.
        setTimeout(resolve, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
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
  if (message.type === "start-run") {
    startRun();
    return false;
  }
  if (message.type === "stop-run") {
    finishCapture("stopped by hand");
    return false;
  }
  if (message.type === "playback-ended") {
    finishCapture("finished");
    return false;
  }
  if (message.type === "capture-timeout") {
    finishCapture("hit the time limit");
    return false;
  }
  return false;
});
