const socket = io(window.djConfig.serverUrl, {
  auth: { token: window.djConfig.djToken }
});

const queueContainer = document.getElementById('queue-container');
const emptyQueueMsg = document.getElementById('empty-queue-msg');

let currentQueue = [];

function renderQueue() {
  const queue = currentQueue;

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
  renderQueue();
});

socket.on('queue-updated', (data) => {
  currentQueue = data.queue || [];
  renderQueue();
});

// Pedir estado inicial al conectar
socket.emit('get-state');
