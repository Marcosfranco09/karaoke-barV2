const socket = io();

const queueContainer = document.getElementById('queue-container');
const emptyQueueMsg = document.getElementById('empty-queue-msg');
const activeNow = document.getElementById('active-now');
const idleNow = document.getElementById('idle-now');

// Referencias Now Playing
const currentSinger = document.getElementById('current-singer-name');
const currentSong = document.getElementById('current-song-title');
const currentArtist = document.getElementById('current-song-artist');

let currentQueue = [];
let currentNowPlaying = null;

function renderQueue() {
  const queue = currentQueue;
  const nowPlaying = currentNowPlaying;

  // Manejo de "Cantando Ahora" (Izquierda)
  if (!nowPlaying) {
    activeNow.classList.add('hidden');
    idleNow.classList.remove('hidden');
  } else {
    idleNow.classList.add('hidden');
    activeNow.classList.remove('hidden');
    currentSinger.textContent = nowPlaying.clientName;
    currentSong.textContent = nowPlaying.song;
    currentArtist.textContent = nowPlaying.table ? `Mesa ${nowPlaying.table}` : 'Puerto Chopp';
  }

  // Manejo de "En Cola" (Derecha)
  queueContainer.innerHTML = '';
  if (!queue || queue.length === 0) {
    emptyQueueMsg.classList.remove('hidden');
  } else {
    emptyQueueMsg.classList.add('hidden');
    queue.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'queue-item-full';
      card.innerHTML = `
        <div class="queue-index">${index + 1}</div>
        <div class="queue-info">
          <div class="queue-singer-name">${item.clientName}</div>
          <div class="queue-song-details">
            <span class="material-symbols-rounded">music_note</span>
            ${item.song} ${item.table ? `• Mesa ${item.table}` : ''}
          </div>
        </div>
      `;
      queueContainer.appendChild(card);
    });
  }
}

// Escuchar actualizaciones
socket.on('initial-state', (state) => {
  currentQueue = state.queue || [];
  currentNowPlaying = state.nowPlaying || null;
  renderQueue();
});

socket.on('queue-updated', (data) => {
  currentQueue = data.queue || [];
  renderQueue();
});

socket.on('now-playing', (song) => {
  currentNowPlaying = song;
  renderQueue();
});

// Pedir estado inicial al conectar
socket.emit('get-state');
