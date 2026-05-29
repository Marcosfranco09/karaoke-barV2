const socket = io(window.djConfig.serverUrl, {
  auth: { token: window.djConfig.djToken }
});

const idleMessage = document.getElementById('idle-message');
const htmlPlayer = document.getElementById('html-player');
const audioPlayer = document.getElementById('audio-player');
const screenQueue = document.getElementById('screen-queue');
const queueLabel = document.getElementById('queue-label');
const queueDisabledMsg = document.getElementById('queue-disabled-msg');

let autoplayEnabled = false;
let autoplayDelay = 5;
let playbackVolume = 50;
let playbackPitch = 0;
let karaokeRunning = false;
let transitionTimeout;
let audioContext = null;
let htmlAudioGraph = null;
let audioAudioGraph = null;

const pauseOverlay = document.getElementById('pause-overlay');
const queueSection = document.querySelector('.queue-section');

let sidebarVisible = false;
let sidebarHideTimeout = null;
let sidebarMonitorInterval = null;

function showSidebar() {
  if (sidebarVisible) return;
  sidebarVisible = true;
  queueSection.classList.remove('sidebar-hidden');
}

function hideSidebar() {
  if (!sidebarVisible) return;
  sidebarVisible = false;
  queueSection.classList.add('sidebar-hidden');
}

function clearSidebarTiming() {
  clearTimeout(sidebarHideTimeout);
  clearInterval(sidebarMonitorInterval);
  sidebarHideTimeout = null;
  sidebarMonitorInterval = null;
}

function getVideoProgress() {
  if (!htmlPlayer.classList.contains('hidden')) {
    return { currentTime: htmlPlayer.currentTime, duration: htmlPlayer.duration };
  }
  return null;
}

function startSidebarMonitor() {
  clearInterval(sidebarMonitorInterval);
  sidebarMonitorInterval = setInterval(() => {
    const prog = getVideoProgress();
    if (!prog || prog.duration <= 0) return;
    const remaining = prog.duration - prog.currentTime;
    if (remaining <= 10 && prog.currentTime > 10) {
      showSidebar();
    }
  }, 500);
}

function startSidebarTiming() {
  clearSidebarTiming();
  showSidebar();

  const prog = getVideoProgress();
  const duration = prog ? prog.duration : 0;

  if (duration <= 0) {
    let retry = setInterval(() => {
      const p = getVideoProgress();
      if (p && p.duration > 0) {
        clearInterval(retry);
        if (p.duration > 20) {
          sidebarHideTimeout = setTimeout(hideSidebar, 10000);
          startSidebarMonitor();
        }
      }
    }, 500);
    sidebarHideTimeout = setTimeout(() => { hideSidebar(); clearInterval(retry); }, 10000);
  } else if (duration > 20) {
    sidebarHideTimeout = setTimeout(hideSidebar, 10000);
    startSidebarMonitor();
  }
}

function createPitchShifter(context) {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const delayA = context.createDelay(0.12);
  const delayB = context.createDelay(0.12);
  const fadeA = context.createGain();
  const fadeB = context.createGain();
  const modA = context.createBufferSource();
  const modB = context.createBufferSource();
  const fadeBufferA = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const fadeBufferB = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const modBufferA = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const modBufferB = context.createBuffer(1, context.sampleRate, context.sampleRate);

  const fadeDataA = fadeBufferA.getChannelData(0);
  const fadeDataB = fadeBufferB.getChannelData(0);
  const modDataA = modBufferA.getChannelData(0);
  const modDataB = modBufferB.getChannelData(0);
  const grainTime = 0.1;
  const grainSamples = Math.floor(context.sampleRate * grainTime);

  for (let i = 0; i < context.sampleRate; i++) {
    const grainPos = i % grainSamples;
    const half = grainSamples / 2;
    const fade = grainPos < half ? grainPos / half : 1 - ((grainPos - half) / half);
    const secondVoice = (i + half) % grainSamples;
    const fadeSecond = secondVoice < half ? secondVoice / half : 1 - ((secondVoice - half) / half);
    fadeDataA[i] = Math.max(0, Math.min(1, fade));
    fadeDataB[i] = Math.max(0, Math.min(1, fadeSecond));
  }

  function fillModBuffers(ratio) {
    const shiftUp = ratio >= 1;
    const depth = Math.min(0.08, Math.abs(1 - ratio) * 0.045);
    for (let i = 0; i < context.sampleRate; i++) {
      const phaseA = (i % grainSamples) / grainSamples;
      const phaseB = ((i + grainSamples / 2) % grainSamples) / grainSamples;
      modDataA[i] = shiftUp ? depth * (1 - phaseA) : depth * phaseA;
      modDataB[i] = shiftUp ? depth * (1 - phaseB) : depth * phaseB;
    }
  }

  modA.buffer = modBufferA;
  modB.buffer = modBufferB;
  modA.loop = true;
  modB.loop = true;

  const fadeSourceA = context.createBufferSource();
  const fadeSourceB = context.createBufferSource();
  fadeSourceA.buffer = fadeBufferA;
  fadeSourceB.buffer = fadeBufferB;
  fadeSourceA.loop = true;
  fadeSourceB.loop = true;

  input.connect(dry);
  dry.connect(output);
  input.connect(delayA);
  input.connect(delayB);
  delayA.connect(fadeA);
  delayB.connect(fadeB);
  fadeA.connect(wet);
  fadeB.connect(wet);
  wet.connect(output);
  fadeSourceA.connect(fadeA.gain);
  fadeSourceB.connect(fadeB.gain);
  modA.connect(delayA.delayTime);
  modB.connect(delayB.delayTime);

  fadeSourceA.start();
  fadeSourceB.start();
  modA.start();
  modB.start();

  return {
    input,
    output,
    setPitch(semitones) {
      const ratio = Math.pow(2, semitones / 12);
      fillModBuffers(ratio);
      dry.gain.value = semitones === 0 ? 1 : 0;
      wet.gain.value = semitones === 0 ? 0 : 1;
    }
  };
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

function ensureAudioGraph(mediaElement, existingGraph) {
  if (existingGraph) return existingGraph;

  const context = ensureAudioContext();
  const source = context.createMediaElementSource(mediaElement);
  const volume = context.createGain();
  const shifter = createPitchShifter(context);

  source.connect(shifter.input);
  shifter.output.connect(volume);
  volume.connect(context.destination);

  return { volume, shifter };
}

function applyPlaybackSettings() {
  // El marcador va de 0 a 100. Queremos que 50 sea el 100% real (ganancia 1.0) y 100 sea 2.0 (Boost).
  const linearGain = playbackVolume / 50;
  const boundedVolume = Math.max(0, Math.min(1, linearGain));

  htmlPlayer.playbackRate = 1;
  audioPlayer.playbackRate = 1;
  htmlPlayer.volume = htmlAudioGraph ? 1 : boundedVolume;
  audioPlayer.volume = audioAudioGraph ? 1 : boundedVolume;

  if (htmlAudioGraph) {
    htmlAudioGraph.volume.gain.value = linearGain;
    htmlAudioGraph.shifter.setPitch(playbackPitch);
  }
  if (audioAudioGraph) {
    audioAudioGraph.volume.gain.value = linearGain;
    audioAudioGraph.shifter.setPitch(playbackPitch);
  }

}

function showErrorOverlay() {
  const errorOverlay = document.getElementById('error-overlay');
  errorOverlay.classList.remove('hidden');
  
  // Saltar automáticamente después de 5 segundos
  setTimeout(() => {
    errorOverlay.classList.add('hidden');
    handleSongEnd(); // Pedir la siguiente
  }, 5000);
}

// Detectar cuando termina una canción
htmlPlayer.addEventListener('ended', handleSongEnd);
audioPlayer.addEventListener('ended', handleSongEnd);

function handleSongEnd() {
  clearSidebarTiming();
  socket.emit('song-ended');
}

function updatePauseOverlay() {
  if (karaokeRunning) {
    pauseOverlay.classList.add('hidden');
  } else {
    pauseOverlay.classList.remove('hidden');
    showIdle();
  }
}

function showIdle() {
  clearSidebarTiming();
  idleMessage.classList.remove('hidden');
  htmlPlayer.classList.add('hidden');
  audioPlayer.classList.add('hidden');
  document.getElementById('error-overlay').classList.add('hidden');
  htmlPlayer.pause();
  audioPlayer.pause();
}

function playSong(song) {
  clearTimeout(transitionTimeout);
  showIdle(); // Reset UI
  
  if (!song) return;
  
  idleMessage.classList.add('hidden');
  
  // Mostrar overlay de transición
  const overlay = document.getElementById('next-overlay');
  document.getElementById('next-song-title').textContent = song.song;
  document.getElementById('next-table-info').textContent = song.table ? `Mesa ${song.table}` : '';
  
  overlay.classList.remove('hidden');
  
  transitionTimeout = setTimeout(() => {
    overlay.classList.add('hidden');

    if (song.type === 'file') {
      const ext = song.resourceUrl.split('.').pop().toLowerCase();
      const fullUrl = song.resourceUrl.startsWith('http') ? song.resourceUrl : window.djConfig.serverUrl + song.resourceUrl;
      
      if (['mp4', 'webm', 'ogg'].includes(ext)) {
        htmlPlayer.src = fullUrl;
        htmlPlayer.classList.remove('hidden');
        htmlAudioGraph = ensureAudioGraph(htmlPlayer, htmlAudioGraph);
        applyPlaybackSettings();
        htmlPlayer.play();
      } else {
        // asume audio
        audioPlayer.src = fullUrl;
        audioPlayer.classList.remove('hidden');
        audioAudioGraph = ensureAudioGraph(audioPlayer, audioAudioGraph);
        applyPlaybackSettings();
        audioPlayer.play();
      }
    }

    setTimeout(startSidebarTiming, 500);
  }, autoplayDelay * 1000);
}

function renderQueue(queue) {
  screenQueue.innerHTML = '';
  if (queue.length === 0) {
    screenQueue.innerHTML = '<p style="text-align: center; color: var(--text-muted);">La cola está vacía</p>';
    return;
  }
  
  queue.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'queue-item fade-in';
    div.innerHTML = `
      <div class="rank">#${index + 1}</div>
      <div class="info">
        <h4 style="font-size: 1.2rem;">${item.song}</h4>
        <p style="font-size: 1rem; color: var(--primary-color);">${item.table ? `Mesa ${item.table}` : ''}</p>
      </div>
    `;
    screenQueue.appendChild(div);
  });
}

function updateQueueLabel(isNowPlaying) {
  if (isNowPlaying) {
    queueLabel.textContent = 'Siguiente canción';
  } else {
    queueLabel.textContent = 'Canciones en cola';
  }
}

function updateRequestsEnabled(enabled) {
  if (enabled) {
    queueDisabledMsg.classList.add('hidden');
  } else {
    queueDisabledMsg.classList.remove('hidden');
  }
}

// Socket Events
socket.on('initial-state', (state) => {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 500);
  }

  autoplayEnabled = state.autoplayEnabled;
  autoplayDelay = state.autoplayDelay || 5;
  playbackVolume = state.playbackVolume ?? 50;
  playbackPitch = state.playbackPitch ?? 0;
  karaokeRunning = state.karaokeRunning;
  applyPlaybackSettings();
  updatePauseOverlay();
  renderQueue(state.queue);
  updateQueueLabel(!!state.nowPlaying);
  updateRequestsEnabled(state.requestsEnabled);
  if (state.nowPlaying) {
    playSong(state.nowPlaying);
  }
});

socket.on('autoplay-state', (state) => {
  autoplayEnabled = state;
});

socket.on('autoplay-delay-state', (delay) => {
  autoplayDelay = delay;
});

socket.on('playback-volume-state', (volume) => {
  playbackVolume = volume;
  applyPlaybackSettings();
});

socket.on('playback-pitch-state', (pitch) => {
  playbackPitch = pitch;
  applyPlaybackSettings();
});

socket.on('karaoke-running-state', (isRunning) => {
  karaokeRunning = isRunning;
  updatePauseOverlay();
});

socket.on('requests-enabled-state', (enabled) => {
  updateRequestsEnabled(enabled);
});

socket.on('queue-updated', (data) => {
  renderQueue(data.queue);
});

socket.on('now-playing', (song) => {
  updateQueueLabel(!!song);
  if (song) {
    playSong(song);
  } else {
    showIdle();
  }
});

socket.on('toggle-play', () => {
  if (!htmlPlayer.classList.contains('hidden')) {
    if (htmlPlayer.paused) htmlPlayer.play();
    else htmlPlayer.pause();
  } else if (!audioPlayer.classList.contains('hidden')) {
    if (audioPlayer.paused) audioPlayer.play();
    else audioPlayer.pause();
  }
});

socket.emit('get-state');

socket.emit('get-state');
