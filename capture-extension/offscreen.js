// Offscreen document: the only place that touches audio.
//
// tabCapture hands back a MediaStream of whatever the tab is playing. We do two
// things with it: record it (Opus in a WebM container — small enough to ship
// over native messaging, and plenty for forced alignment), and route it to the
// speakers so the operator still hears the song. That second part is not
// optional: a captured stream is silent by default, and a silent tab is very
// easy to mistake for a working capture.

let recorder = null;
let audioContext = null;
let chunks = [];
let stopTimer = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "start-capture") {
    startCapture(message.streamId, message.maxSeconds)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }

  if (message.type === "stop-capture") {
    stopCapture()
      .then((base64) => sendResponse({ ok: true, base64, mime: "audio/webm" }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

async function startCapture(streamId, maxSeconds) {
  if (recorder) throw new Error("a capture is already running");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  // Keep the song audible. Capturing a tab mutes it otherwise.
  audioContext = new AudioContext();
  audioContext.createMediaStreamSource(stream).connect(audioContext.destination);

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000); // flush every second so a crash doesn't lose everything

  // Hard stop, so a video that never ends can't record forever. The service
  // worker normally stops us first, when playback reports it finished.
  if (maxSeconds && maxSeconds > 0) {
    stopTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: "capture-timeout" }).catch(() => {});
    }, (maxSeconds + 5) * 1000);
  }
}

async function stopCapture() {
  if (!recorder) throw new Error("no capture running");
  clearTimeout(stopTimer);
  stopTimer = null;

  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.stop();
  await finished;

  recorder.stream.getTracks().forEach((t) => t.stop());
  recorder = null;
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  const blob = new Blob(chunks, { type: "audio/webm" });
  chunks = [];
  return await blobToBase64(blob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    // Strips the "data:audio/webm;base64," prefix.
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
