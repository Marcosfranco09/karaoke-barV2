const socket = io();

const idleMessage = document.getElementById('idle-message');
const htmlPlayer = document.getElementById('html-player');
const audioPlayer = document.getElementById('audio-player');
const screenQueue = document.getElementById('screen-queue');
const queueLabel = document.getElementById('queue-label');
const queueDisabledMsg = document.getElementById('queue-disabled-msg');

let ytPlayer;
let ytReady = false;
let autoplayEnabled = false;
let autoplayDelay = 5;
let karaokeRunning = false;
let transitionTimeout;

const pauseOverlay = document.getElementById('pause-overlay');

// Configuración de YouTube iframe API
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    videoId: '',
    playerVars: {
      'autoplay': 1,
      'controls': 0,
      'rel': 0,
      'disablekb': 1,
      'modestbranding': 1,
      'iv_load_policy': 3
    },
    events: {
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
  ytReady = true;
}

function onPlayerError(event) {
  let msg = 'Error en YouTube';
  if (event.data === 2) msg = 'Link de YouTube inválido';
  if (event.data === 100) msg = 'Video no encontrado o privado';
  if (event.data === 101 || event.data === 150) msg = 'El video no permite reproducción en sitios externos';
  
  socket.emit('screen-error', msg);
  showErrorOverlay();
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

// Detectar cuando termina una canción (YouTube)
function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    handleSongEnd();
  }
}

// Detectar cuando termina una canción (HTML5)
htmlPlayer.addEventListener('ended', handleSongEnd);
audioPlayer.addEventListener('ended', handleSongEnd);

function handleSongEnd() {
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
  idleMessage.classList.remove('hidden');
  document.getElementById('yt-player').classList.add('hidden');
  htmlPlayer.classList.add('hidden');
  audioPlayer.classList.add('hidden');
  document.getElementById('error-overlay').classList.add('hidden');
  
  if (ytReady && ytPlayer && ytPlayer.stopVideo) {
    ytPlayer.stopVideo();
  }
  htmlPlayer.pause();
  audioPlayer.pause();
}

// Extraer ID de YouTube de un link
function extractVideoID(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function playSong(song) {
  clearTimeout(transitionTimeout);
  showIdle(); // Reset UI
  
  if (!song) return;
  
  idleMessage.classList.add('hidden');
  
  // Mostrar overlay de transición
  const overlay = document.getElementById('next-overlay');
  document.getElementById('next-song-title').textContent = song.song;
  document.getElementById('next-client-name').textContent = song.clientName;
  document.getElementById('next-table-info').textContent = song.table ? `(Mesa ${song.table})` : '';
  
  overlay.classList.remove('hidden');
  
  transitionTimeout = setTimeout(() => {
    overlay.classList.add('hidden');

    if (song.type === 'youtube') {
      const videoId = extractVideoID(song.resourceUrl);
      if (videoId && ytReady) {
        document.getElementById('yt-player').classList.remove('hidden');
        ytPlayer.loadVideoById({ videoId: videoId, suggestedQuality: 'hd1080' });
      } else {
        socket.emit('screen-error', "Link de YouTube no válido o API no lista");
        showErrorOverlay();
      }
    } else if (song.type === 'file') {
      const ext = song.resourceUrl.split('.').pop().toLowerCase();
      if (['mp4', 'webm', 'ogg'].includes(ext)) {
        htmlPlayer.src = song.resourceUrl;
        htmlPlayer.classList.remove('hidden');
        htmlPlayer.play();
      } else {
        // asume audio
        audioPlayer.src = song.resourceUrl;
        audioPlayer.classList.remove('hidden');
        audioPlayer.play();
      }
    }
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
        <p style="font-size: 1rem;">${item.clientName} (Mesa ${item.table || '-'})</p>
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
  autoplayEnabled = state.autoplayEnabled;
  autoplayDelay = state.autoplayDelay || 5;
  karaokeRunning = state.karaokeRunning;
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
  if (!document.getElementById('yt-player').classList.contains('hidden')) {
    if (ytReady && ytPlayer && ytPlayer.getPlayerState) {
      if (ytPlayer.getPlayerState() === 1) {
        ytPlayer.pauseVideo();
      } else {
        ytPlayer.playVideo();
      }
    }
  } else if (!htmlPlayer.classList.contains('hidden')) {
    if (htmlPlayer.paused) htmlPlayer.play();
    else htmlPlayer.pause();
  } else if (!audioPlayer.classList.contains('hidden')) {
    if (audioPlayer.paused) audioPlayer.play();
    else audioPlayer.pause();
  }
});

socket.emit('get-state');

// Ocultar Splash Screen cuando todo cargue
window.addEventListener('load', () => {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 500);
  }
});
