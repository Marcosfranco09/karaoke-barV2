const socket = io(window.djConfig.serverUrl, {
  auth: { token: window.djConfig.djToken }
});

// Referencias al DOM - Panel principal
const requestsContainer = document.getElementById('requests-container');
const emptyRequestsMsg = document.getElementById('empty-requests-msg');
const pendingCount = document.getElementById('pending-count');
const queueContainer = document.getElementById('queue-container');
const queueCount = document.getElementById('queue-count');
const btnPlayNext = document.getElementById('btn-play-next');
const btnPlayPrev = document.getElementById('btn-play-prev');
const btnTogglePlay = document.getElementById('btn-toggle-play');
const autoplaySwitch = document.getElementById('autoplay-switch');
const btnIniciar = document.getElementById('btn-iniciar');
const delayContainer = document.getElementById('delay-container');
const delayInput = document.getElementById('autoplay-delay-input');
const delayMinus = document.getElementById('delay-minus');
const delayPlus = document.getElementById('delay-plus');
const lastSongSwitch = document.getElementById('last-song-switch');
const requestsSwitch = document.getElementById('requests-switch');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const pitchSlider = document.getElementById('pitch-slider');
const pitchValue = document.getElementById('pitch-value');

// Referencias al DOM - Petición Manual
const btnManualAdd = document.getElementById('btn-manual-add');
const manualModal = document.getElementById('manual-modal');
const manualForm = document.getElementById('manual-form');
const btnManualCancel = document.getElementById('btn-manual-cancel');

// Referencias al DOM - Edición de Cola
const editQueueModal = document.getElementById('edit-queue-modal');
const editQueueForm = document.getElementById('edit-queue-form');
const editQueueId = document.getElementById('edit-queue-id');
const editQueueTable = document.getElementById('edit-queue-table');
// Botón: Cerrar aplicación
const btnLogout = document.getElementById('btn-logout');
btnLogout.addEventListener('click', () => {
  socket.emit('set-requests-enabled', false);
  window.close();
});

// Botón: Resetear cola
const btnResetQueue = document.getElementById('btn-reset-queue');
btnResetQueue.addEventListener('click', () => {
  showConfirmModal(
    'Vaciar Cola', 
    '¿Estás seguro de que quieres eliminar TODAS las canciones de la cola? Esta acción no se puede deshacer.',
    () => {
      socket.emit('reset-queue');
      showToast('Cola vaciada completamente', 'info');
    }
  );
});

// ------------------------


let pendingRequests = new Map();
let queue = [];

// Renderizados
function renderRequests() {
  if (pendingRequests.size === 0) {
    requestsContainer.innerHTML = '';
    requestsContainer.appendChild(emptyRequestsMsg);
    emptyRequestsMsg.style.display = 'block';
  } else {
    emptyRequestsMsg.style.display = 'none';
    requestsContainer.innerHTML = '';
    
    const requestsArray = Array.from(pendingRequests.values());
    const req = requestsArray[0];
    const total = requestsArray.length;

    const card = document.createElement('div');
    card.id = `request-${req.id}`;
    card.className = 'request-card fade-in';
    card.style.border = '1px solid rgba(255,255,255,0.05)';
    card.style.background = 'rgba(255,255,255,0.02)';
    card.style.padding = '2vh';
    card.style.height = '100%';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'space-between';
    card.style.overflow = 'hidden';
    card.style.position = 'relative';

    card.innerHTML = `
      <!-- In-Card Overlay (Hidden by default) -->
      <div id="obs-overlay-${req.id}" class="hidden" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 100; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem 2.5rem; text-align: center; backdrop-filter: blur(10px);">
        <h4 style="color: var(--primary-color); font-size: 0.8rem; margin-bottom: 1rem; text-transform: uppercase;">Observación de ${req.clientName} (Mesa ${req.table})</h4>
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; overflow-y: auto; width: 100%; margin-bottom: 1rem;">
          <p style="font-size: 1.1rem; color: #fff; font-style: italic; line-height: 1.4; margin: 0;">"${req.observation}"</p>
        </div>
        <button class="btn btn-secondary" style="width: 100%; padding: 0.8rem; border-radius: 10px;" onclick="hideCardObservation('${req.id}')">Cerrar</button>
      </div>

      <!-- Header (Fixed) -->
      <div style="flex: 0 0 auto; text-align: center; margin-bottom: 1vh;">
        <strong style="font-size: clamp(0.75rem, 1.6vh, 0.85rem); color: #fff; display: block;">Petición ${requestsArray.indexOf(req) + 1} de ${total}</strong>
        <p style="font-size: clamp(0.6rem, 1.3vh, 0.7rem); color: var(--text-muted); opacity: 0.6; margin: 0;">${new Date(req.timestamp).toLocaleTimeString()}</p>
      </div>

      <!-- Song Info (Shrinkable) -->
      <div style="flex: 0 1 auto; text-align: center; margin-bottom: 1.5vh; min-height: 0;">
        <h3 style="color: var(--primary-color); font-size: clamp(1.1rem, 3vh, 1.5rem); font-weight: 800; margin-bottom: 0.1rem; line-height: 1.1; word-break: break-word;">${req.song}</h3>
        <p style="font-size: clamp(0.8rem, 1.8vh, 0.95rem); color: #fff; margin: 0;">De: <strong>${req.clientName}</strong> <span class="badge" style="background: var(--primary-color); color: #000; font-weight: 800; font-size: clamp(0.55rem, 1.3vh, 0.65rem); padding: 1px 4px; vertical-align: middle;">Mesa ${req.table}</span></p>
      </div>

      <!-- Observation (Priority - Fixed size based on content) -->
      ${req.observation ? `
      <div style="flex: 0 0 auto; background: rgba(255, 204, 0, 0.05); border: 1px solid rgba(255, 204, 0, 0.1); padding: 0.8vh 1.2vw; border-radius: 12px; margin-bottom: 1.5vh; display: flex; flex-direction: column; align-items: center; gap: 0.1rem;">
        <p style="font-size: clamp(0.55rem, 1.3vh, 0.65rem); color: var(--primary-color); text-transform: uppercase; font-weight: 800; margin: 0;">Observación:</p>
        <div style="display: flex; align-items: center; gap: 0.8rem; width: 100%; justify-content: center; padding: 0 0.5rem;">
          <p style="font-size: clamp(0.75rem, 1.6vh, 0.85rem); color: #fff; font-style: italic; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; text-align: center;">"${req.observation}"</p>
          ${req.observation.length > 55 ? `<button class="btn-text" onclick="showCardObservation('${req.id}')" style="font-size: clamp(0.6rem, 1.4vh, 0.7rem); color: var(--primary-color); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; flex: 0 0 auto;">Ver todo</button>` : ''}
        </div>
      </div>
      ` : ''}

      <!-- Inputs Area (Fixed but responsive heights) -->
      <div id="media-drop-zone-${req.id}" class="media-drop-zone" style="flex: 0 0 auto; background: rgba(0,0,0,0.3); padding: 1.5vh 1vw; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 1.5vh;">
        <div class="media-drop-overlay">
          <div class="file-drop-box">
            <span class="material-symbols-rounded">upload_file</span>
            <h2>Soltar archivo aqui</h2>
            <p>Se cargara en esta peticion.</p>
          </div>
        </div>
        <!-- Local File -->
        <div style="display: flex; gap: 0.4rem; margin-bottom: 1vh;">
          <label for="file-${req.id}" id="file-label-${req.id}" class="btn" style="margin: 0; padding: 0 1rem; font-size: clamp(0.75rem, 1.6vh, 0.85rem); flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.6rem; height: clamp(34px, 4.5vh, 44px); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;">
            <span id="label-icon-${req.id}" class="material-symbols-rounded" style="font-size: clamp(16px, 2vh, 20px);">upload_file</span> 
            <span id="label-text-${req.id}">Seleccionar archivo</span>
          </label>
          <button class="btn-icon" style="width: clamp(34px, 4.5vh, 44px); height: clamp(34px, 4.5vh, 44px); border-radius: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);" onclick="previewLocalFile('${req.id}')" title="Vista previa local">
            <span class="material-symbols-rounded" style="font-size: clamp(16px, 2vh, 20px);">visibility</span>
          </button>
          <input type="file" id="file-${req.id}" accept="video/*,audio/*" style="display: none;" 
            onchange="
              const hasFile = this.files.length > 0;
              document.getElementById('label-text-${req.id}').textContent = hasFile ? this.files[0].name : 'Seleccionar archivo';
              document.getElementById('label-icon-${req.id}').textContent = hasFile ? 'movie' : 'upload_file';
            ">
        </div>

        <div style="display: flex; align-items: center; text-align: center; margin: 0.8vh 0;">
          <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.1);"></div>
          <span style="padding: 0 0.8rem; font-size: clamp(0.5rem, 1.2vh, 0.6rem); color: var(--text-muted); font-weight: bold; text-transform: uppercase;">O YOUTUBE</span>
          <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.1);"></div>
        </div>

        <!-- YouTube Alternative -->
        <div style="display: flex; gap: 0.4rem;">
          <input type="text" id="yt-${req.id}" placeholder="Link de YouTube (Opcional)" style="margin-bottom: 0; padding: 0.5rem 0.7rem; font-size: clamp(0.8rem, 1.6vh, 0.9rem); flex: 1; border-radius: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; height: clamp(34px, 4.5vh, 44px);">
          <button class="btn-icon" style="width: clamp(34px, 4.5vh, 44px); height: clamp(34px, 4.5vh, 44px); border-radius: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);" onclick="previewYouTube('${req.id}')">
            <span class="material-symbols-rounded" style="font-size: clamp(16px, 2vh, 20px);">visibility</span>
          </button>
        </div>
      </div>
      
      <!-- Actions Area (Fixed) -->
      <div style="flex: 0 0 auto; display: flex; flex-direction: column;">
        <div style="display: flex; gap: 0.8rem; width: 100%;" id="action-buttons-${req.id}">
          <button class="btn" style="flex: 1; padding: 1.2vh 1vw; background: linear-gradient(135deg, var(--primary-color), #ffb800) !important; color: #000; font-weight: 800; border-radius: 14px; font-size: clamp(0.85rem, 1.8vh, 1rem); min-height: 38px; display: flex; align-items: center; justify-content: center;" onclick="approveRequest('${req.id}')">Aprobar</button>
          <button class="btn btn-danger" style="flex: 1; padding: 1.2vh 1vw; background: rgba(255, 51, 102, 0.1); border: 1px solid #ff3366; color: #ff3366; font-weight: 800; border-radius: 14px; font-size: clamp(0.85rem, 1.8vh, 1rem); min-height: 38px; display: flex; align-items: center; justify-content: center;" onclick="showRejectInput('${req.id}')">Rechazar</button>
        </div>

        <div id="reject-container-${req.id}" class="hidden" style="width: 100%;">
          <input type="text" id="reject-reason-${req.id}" placeholder="Motivo de rechazo" style="margin-bottom: 1vh; padding: 0.6vh 0.8rem; font-size: clamp(0.8rem, 1.6vh, 0.9rem); width: 100%; border-radius: 10px; height: clamp(34px, 4.5vh, 44px);">
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn btn-secondary" style="flex: 1; padding: 0.8vh 0.5rem; border-radius: 10px; font-size: clamp(0.75rem, 1.6vh, 0.85rem); min-height: 34px; display: flex; align-items: center; justify-content: center;" onclick="cancelReject('${req.id}')">Cancelar</button>
            <button class="btn btn-danger" style="flex: 1; padding: 0.8vh 0.5rem; border-radius: 10px; font-size: clamp(0.75rem, 1.6vh, 0.85rem); min-height: 34px; display: flex; align-items: center; justify-content: center;" onclick="confirmReject('${req.id}')">Confirmar</button>
          </div>
        </div>
      </div>
    `;
    requestsContainer.appendChild(card);
  }
  pendingCount.textContent = pendingRequests.size;
}

function getActiveRequestId() {
  const firstRequest = Array.from(pendingRequests.values())[0];
  return firstRequest ? firstRequest.id : null;
}

function setRequestFile(id, file) {
  const fileInput = document.getElementById(`file-${id}`);
  const labelText = document.getElementById(`label-text-${id}`);
  const labelIcon = document.getElementById(`label-icon-${id}`);

  if (!fileInput) return false;

  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  if (labelText) labelText.textContent = file.name;
  if (labelIcon) labelIcon.textContent = 'movie';
  return true;
}

function getDraggedFiles(event) {
  return Array.from(event.dataTransfer?.files || [])
    .filter(file => file.type.startsWith('audio/') || file.type.startsWith('video/'));
}

function setActiveDropZone(isActive) {
  const activeRequestId = getActiveRequestId();
  const zone = activeRequestId ? document.getElementById(`media-drop-zone-${activeRequestId}`) : null;
  document.querySelectorAll('.media-drop-zone.drop-active').forEach(item => {
    if (item !== zone) item.classList.remove('drop-active');
  });
  if (zone) zone.classList.toggle('drop-active', isActive);
}

function animateAndRemove(id, direction = 'right') {
  const card = document.getElementById(`request-${id}`);
  if (card) {
    card.classList.remove('fade-in');
    card.classList.add(direction === 'right' ? 'slide-out-right' : 'slide-out-left');
    setTimeout(() => {
      pendingRequests.delete(id);
      renderRequests();
    }, 400);
  } else {
    pendingRequests.delete(id);
    renderRequests();
  }
}

let sortableQueue = null;
let isDraggingQueueItem = false;
let pendingQueueUpdate = false;

function initSortableQueue() {
  if (sortableQueue) sortableQueue.destroy();
  sortableQueue = Sortable.create(queueContainer, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    onStart: function () {
      isDraggingQueueItem = true;
    },
    onEnd: function (evt) {
      isDraggingQueueItem = false;
      const itemId = evt.item.dataset.id;
      if (evt.oldIndex !== evt.newIndex) {
        socket.emit('reorder-queue', { id: itemId, newIndex: evt.newIndex });
      } else if (pendingQueueUpdate) {
        renderQueue();
      }
      pendingQueueUpdate = false;
    }
  });
}

function renderQueue() {
  // Guardamos un mapa de IDs a nodos actuales para no rehacer todo el DOM si no es necesario,
  // pero para mayor seguridad, vamos a limpiarlo por ahora y dejar que SortableJS lo maneje.
  queueContainer.innerHTML = '';
  queue.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'queue-item fade-in';
    div.dataset.id = item.id;
    
    div.innerHTML = `
      <div class="drag-handle" style="display: flex; align-items: center; justify-content: center; cursor: grab; padding-right: 0.5rem; color: var(--text-muted);" onmousedown="this.style.cursor='grabbing'" onmouseup="this.style.cursor='grab'">
        <span class="material-symbols-rounded">drag_indicator</span>
      </div>
      <div class="rank">#${index + 1}</div>
      <div class="info" style="text-align: center; flex: 1; padding: 0 0.5rem;">
        <h4 style="margin:0; font-size: 1.1rem; word-break: break-word;">${item.song}</h4>
        <p style="margin:0; font-size: 0.9rem; opacity: 0.8;">
          ${item.clientName}
          <span
            class="queue-table-badge"
            onclick="openEditQueueModal('${item.id}')"
            title="Toca para cambiar mesa"
            style="display:inline-flex; align-items:center; gap:2px; margin-left:4px; cursor:pointer; background:rgba(255,204,0,0.12); border:1px solid rgba(255,204,0,0.4); border-radius:20px; padding:1px 8px; font-size:0.8rem; color:var(--primary-color); transition:background 0.2s;"
          >Mesa ${item.table || '-'} <span class="material-symbols-rounded" style="font-size:0.85rem;">edit</span></span>
        </p>
        ${item.observation ? `<p style="margin:0; font-size: 0.8rem; color: #ffcc00; margin-top: 2px;">Obs: ${item.observation}</p>` : ''}
      </div>
      <div style="display: flex; gap: 0.3rem; align-items: center;">
        <button class="btn-danger" onclick="removeFromQueue('${item.id}')" style="width:36px; height:36px; padding:0; border-radius: 8px; background: rgba(255, 51, 102, 0.15); border: 1px solid #ff3366; color: #ff3366; display:flex; align-items:center; justify-content:center;" title="Eliminar de la cola">
          <span class="material-symbols-rounded" style="font-size: 1.2rem;">delete</span>
        </button>
      </div>
    `;
    queueContainer.appendChild(div);
  });
  queueCount.textContent = queue.length;
  initSortableQueue();
}

window.removeFromQueue = (id) => {
  socket.emit('remove-from-queue', id);
  showToast('Canción eliminada de la cola', 'info');
};

// Acciones
window.approveRequest = async (id) => {
  const ytInput = document.getElementById(`yt-${id}`).value.trim();
  const fileInput = document.getElementById(`file-${id}`).files[0];
  
  if (!ytInput && !fileInput) {
    showToast('Debes proveer un link de YouTube o un archivo.', 'error');
    return;
  }
  
  const req = pendingRequests.get(id);
  
  if (fileInput) {
    // Subir archivo
    const formData = new FormData();
    formData.append('file', fileInput);
    
    try {
      const btn = document.querySelector(`button[onclick="approveRequest('${id}')"]`);
      btn.textContent = 'Subiendo...';
      btn.disabled = true;
      
      const res = await fetch(`${window.djConfig.serverUrl}/api/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'x-dj-token': window.djConfig.djToken
        }
      });
      const data = await res.json();
      
      socket.emit('approve-request', {
        id,
        fileUrl: data.fileUrl,
        type: 'file',
        clientName: req.clientName
      });
      animateAndRemove(id, 'right');
    } catch (e) {
      console.error(e);
      showToast('Error al subir archivo', 'error');
      return;
    }
  } else {
    // Es YouTube: descargar y usar como archivo local
    if (!isValidYouTubeUrl(ytInput)) {
      showToast('El link de YouTube no parece ser válido.', 'error');
      return;
    }

    const btn = document.querySelector(`button[onclick="approveRequest('${id}')"]`);
    btn.textContent = 'Descargando...';
    btn.disabled = true;

    socket.emit('download-youtube', { id, youtubeUrl: ytInput });
  }
};

window.showRejectInput = (id) => {
  document.getElementById(`action-buttons-${id}`).classList.add('hidden');
  document.getElementById(`reject-container-${id}`).classList.remove('hidden');
  document.getElementById(`reject-reason-${id}`).focus();
};

window.cancelReject = (id) => {
  document.getElementById(`reject-container-${id}`).classList.add('hidden');
  document.getElementById(`action-buttons-${id}`).classList.remove('hidden');
};

window.confirmReject = (id) => {
  const reason = document.getElementById(`reject-reason-${id}`).value.trim();
  socket.emit('reject-request', { id, reason: reason || 'Rechazado por el DJ' });
  animateAndRemove(id, 'left');
};

btnPlayNext.addEventListener('click', () => {
  socket.emit('play-next');
});

btnPlayPrev.addEventListener('click', () => {
  socket.emit('play-previous');
});

btnTogglePlay.addEventListener('click', () => {
  socket.emit('toggle-play');
});

btnIniciar.addEventListener('click', () => {
  socket.emit('toggle-karaoke');
});

// Funciones de UI
function updateKaraokeBtn(isRunning) {
  if (isRunning) {
    btnIniciar.innerHTML = '<span class="material-symbols-rounded">stop_circle</span> Parar Karaoke';
    btnIniciar.style.background = 'rgba(255, 51, 102, 0.2)';
    btnIniciar.style.borderColor = 'var(--primary-color)';
    btnIniciar.style.color = 'var(--primary-color)';
  } else {
    btnIniciar.innerHTML = '<span class="material-symbols-rounded">rocket_launch</span> Iniciar Karaoke';
    btnIniciar.style.background = 'rgba(255, 255, 255, 0.05)';
    btnIniciar.style.borderColor = 'var(--glass-border)';
    btnIniciar.style.color = 'var(--text-light)';
  }
}

function updatePlayNextBtn(autoplayOn) {
  // El botón "Siguiente" siempre está habilitado
  btnPlayNext.disabled = false;
  btnPlayNext.style.opacity = '1';
  btnPlayNext.style.cursor = 'pointer';

  if (autoplayOn) {
    delayContainer.style.opacity = '1';
    delayInput.disabled = false;
    delayMinus.disabled = false;
    delayPlus.disabled = false;
    delayMinus.style.cursor = 'pointer';
    delayPlus.style.cursor = 'pointer';
  } else {
    delayContainer.style.opacity = '0.5';
    delayInput.disabled = true;
    delayMinus.disabled = true;
    delayPlus.disabled = true;
    delayMinus.style.cursor = 'not-allowed';
    delayPlus.style.cursor = 'not-allowed';
  }
}

// Autoplay
autoplaySwitch.addEventListener('change', (e) => {
  socket.emit('set-autoplay', e.target.checked);
  updatePlayNextBtn(e.target.checked);
});

delayInput.addEventListener('change', (e) => {
  let val = Number(e.target.value);
  if (val < 0) val = 0;
  socket.emit('set-autoplay-delay', val);
});

delayMinus.addEventListener('click', () => {
  if (delayInput.disabled) return;
  let val = Number(delayInput.value);
  val = val > 0 ? val - 1 : 0;
  delayInput.value = val;
  socket.emit('set-autoplay-delay', val);
});

delayPlus.addEventListener('click', () => {
  if (delayInput.disabled) return;
  let val = Number(delayInput.value);
  val = val < 60 ? val + 1 : 60;
  delayInput.value = val;
  socket.emit('set-autoplay-delay', val);
});

volumeSlider.addEventListener('input', (e) => {
  const value = Number(e.target.value);
  volumeValue.textContent = `${value}%`;
  socket.emit('set-playback-volume', value);
});

pitchSlider.addEventListener('input', (e) => {
  const value = Number(e.target.value);
  pitchValue.textContent = value > 0 ? `+${value}` : `${value}`;
  socket.emit('set-playback-pitch', value);
});

lastSongSwitch.addEventListener('change', (e) => {
  socket.emit('set-last-song', e.target.checked);
});

requestsSwitch.addEventListener('change', (e) => {
  socket.emit('set-requests-enabled', e.target.checked);
});

// Funciones Manuales
function capitalizeWords(str) {
  return str.replace(/\b[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+\b/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function isValidYouTubeUrl(url) {
  const regExp = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/|.+\?v=)?([^&=%\?]{11})/;
  return regExp.test(url);
}

function extractVideoID(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

window.previewYouTube = (id) => {
  const url = document.getElementById(`yt-${id}`).value.trim();
  if (isValidYouTubeUrl(url)) {
    const videoId = extractVideoID(url);
    if (videoId) {
      const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
      document.getElementById('preview-iframe').src = embedUrl;
      document.getElementById('preview-iframe').style.display = 'block';
      document.getElementById('preview-video').style.display = 'none';
      document.getElementById('video-preview-modal').classList.remove('hidden');
    }
  } else {
    showToast('Ingresá un link de YouTube válido para previsualizar.', 'error');
  }
};

window.previewLocalFile = (id) => {
  const fileInput = document.getElementById(`file-${id}`);
  if (fileInput && fileInput.files[0]) {
    const file = fileInput.files[0];
    const blobUrl = URL.createObjectURL(file);
    const video = document.getElementById('preview-video');
    video.src = blobUrl;
    video.style.display = 'block';
    document.getElementById('preview-iframe').style.display = 'none';
    document.getElementById('preview-iframe').src = '';
    document.getElementById('video-preview-modal').classList.remove('hidden');
    video.play().catch(e => console.log("Auto-play blocked or error:", e));
  } else {
    showToast('Seleccioná un archivo primero para previsualizar.', 'error');
  }
};

window.closePreviewModal = function() {
  document.getElementById('preview-iframe').src = '';
  const video = document.getElementById('preview-video');
  video.pause();
  video.src = '';
  document.getElementById('video-preview-modal').classList.add('hidden');
};

window.showCardObservation = (id) => {
  document.getElementById(`obs-overlay-${id}`).classList.remove('hidden');
};

window.hideCardObservation = (id) => {
  document.getElementById(`obs-overlay-${id}`).classList.add('hidden');
};

window.showConfirmModal = (title, message, onConfirm) => {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const btnConfirm = document.getElementById('btn-confirm-action');
  
  // Clonar para limpiar eventos previos
  const newBtn = btnConfirm.cloneNode(true);
  btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
  
  newBtn.onclick = () => {
    onConfirm();
    closeConfirmModal();
  };
  
  document.getElementById('confirm-modal').classList.remove('hidden');
};

window.closeConfirmModal = () => {
  document.getElementById('confirm-modal').classList.add('hidden');
};

const manualObsToggle = document.getElementById('manual-obs-toggle');
const manualObsContainer = document.getElementById('manual-obs-container');
const inputManualObs = document.getElementById('manual-obs');

btnManualAdd.addEventListener('click', () => {
  manualModal.classList.add('active');
  document.getElementById('manual-client').focus();
});

window.closeManualModal = function() {
  manualModal.classList.remove('active');
  manualForm.reset();
  if (manualObsContainer) {
    manualObsContainer.style.maxHeight = '0';
    manualObsContainer.style.opacity = '0';
  }
};

btnManualCancel.addEventListener('click', closeManualModal);

// Lógica para mostrar/ocultar observaciones manuales con animación
manualObsToggle.addEventListener('change', () => {
  if (manualObsToggle.checked) {
    manualObsContainer.style.maxHeight = '200px';
    manualObsContainer.style.opacity = '1';
    inputManualObs.focus();
  } else {
    manualObsContainer.style.maxHeight = '0';
    manualObsContainer.style.opacity = '0';
    inputManualObs.value = '';
  }
});

manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const tableNumber = document.getElementById('manual-table').value.trim();
  const clientName = capitalizeWords(document.getElementById('manual-client-name').value.trim());
  const songName = capitalizeWords(document.getElementById('manual-song').value.trim());
  const artistName = capitalizeWords(document.getElementById('manual-artist').value.trim());
  
  if (!tableNumber) {
    showToast('Ingresá el número de mesa', 'error');
    return;
  }
  
  const fullSongName = artistName ? `${songName} - ${artistName}` : songName;
  
  socket.emit('new-request', {
    clientName: clientName || `Mesa ${tableNumber}`,
    song: fullSongName,
    observation: manualObsToggle.checked ? inputManualObs.value.trim() : '',
    table: tableNumber,
    source: 'dj-manual'
  });
  
  manualModal.classList.remove('active');
  manualForm.reset();
  manualObsContainer.style.maxHeight = '0';
  manualObsContainer.style.opacity = '0';
});

// Socket Events
socket.on('initial-state', (state) => {
  state.pending.forEach(p => pendingRequests.set(p.id, p));
  queue = state.queue;
  autoplaySwitch.checked = state.autoplayEnabled;
  delayInput.value = state.autoplayDelay;
  volumeSlider.value = state.playbackVolume ?? 50;
  volumeValue.textContent = `${volumeSlider.value}%`;
  pitchSlider.value = state.playbackPitch ?? 0;
  pitchValue.textContent = Number(pitchSlider.value) > 0 ? `+${pitchSlider.value}` : `${pitchSlider.value}`;
  lastSongSwitch.checked = state.lastSongMode;
  requestsSwitch.checked = state.requestsEnabled;
  updatePlayNextBtn(state.autoplayEnabled);
  updateKaraokeBtn(state.karaokeRunning);
  renderRequests();
  renderQueue();
});

socket.on('request-incoming', (req) => {
  pendingRequests.set(req.id, req);
  renderRequests();
});

socket.on('queue-updated', (data) => {
  queue = data.queue;
  if (isDraggingQueueItem) {
    pendingQueueUpdate = true;
  } else {
    renderQueue();
  }
});

socket.on('autoplay-state', (state) => {
  autoplaySwitch.checked = state;
  updatePlayNextBtn(state);
});

socket.on('autoplay-delay-state', (delay) => {
  delayInput.value = delay;
});

socket.on('playback-volume-state', (volume) => {
  volumeSlider.value = volume;
  volumeValue.textContent = `${volume}%`;
});

socket.on('playback-pitch-state', (pitch) => {
  pitchSlider.value = pitch;
  pitchValue.textContent = Number(pitch) > 0 ? `+${pitch}` : `${pitch}`;
});

socket.on('karaoke-running-state', (isRunning) => {
  updateKaraokeBtn(isRunning);
});

socket.on('last-song-state', (state) => {
  lastSongSwitch.checked = state;
});

socket.on('requests-enabled-state', (state) => {
  requestsSwitch.checked = state;
});

// Eventos de descarga de YouTube
socket.on('download-progress', (data) => {
  const btn = document.querySelector(`button[onclick="approveRequest('${data.id}')"]`);
  if (btn) {
    btn.textContent = `Descargando ${data.percentage}%`;
  }
});

socket.on('download-complete', (data) => {
  animateAndRemove(data.id, 'right');
  showToast('Video descargado y agregado a la cola', 'success');
});

socket.on('download-error', (data) => {
  const btn = document.querySelector(`button[onclick="approveRequest('${data.id}')"]`);
  if (btn) {
    btn.textContent = 'Aprobar';
    btn.disabled = false;
  }
  showToast(data.message || 'Error al descargar video', 'error');
});

// Init
socket.emit('get-state');

// Notificaciones Toast
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'info';
  if (type === 'error') icon = 'error';
  if (type === 'success') icon = 'check_circle';

  toast.innerHTML = `
    <span class="material-symbols-rounded">${icon}</span>
    <div style="flex: 1;">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // Auto-eliminar
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

socket.on('screen-error', (msg) => {
  showToast(`Error en Pantalla: ${msg}`, 'error');
});

socket.on('request-cancelled', (requestId) => {
  const card = document.getElementById(`request-${requestId}`);
  if (card) {
    card.classList.add('fade-out');
    setTimeout(() => {
      pendingRequests.delete(requestId);
      renderRequests();
    }, 300);
  }
});

let dragDepth = 0;

window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  setActiveDropZone(true);
});

window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setActiveDropZone(false);
});

window.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  dragDepth = 0;
  setActiveDropZone(false);

  const [file] = getDraggedFiles(event);
  if (!file) {
    showToast('Solta un archivo de audio o video.', 'error');
    return;
  }

  const activeRequestId = getActiveRequestId();
  if (!activeRequestId) {
    showToast('No hay peticiones pendientes para cargar el archivo.', 'error');
    return;
  }

  if (setRequestFile(activeRequestId, file)) {
    showToast(`Archivo cargado: ${file.name}`, 'success');
  }
});

// Lógica de Edición de Mesa
window.openEditQueueModal = (id) => {
  const item = queue.find(q => q.id === id);
  if (!item) return;
  editQueueId.value = item.id;
  editQueueTable.value = item.table || '';
  editQueueModal.classList.add('active');
  setTimeout(() => editQueueTable.focus(), 100);
};

window.closeEditQueueModal = () => {
  editQueueModal.classList.remove('active');
  editQueueForm.reset();
};

editQueueForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = editQueueId.value;
  const table = editQueueTable.value.trim();
  if (!table) {
    showToast('Ingresá un número de mesa', 'error');
    return;
  }
  socket.emit('edit-queue-item', { id, updates: { table } });
  closeEditQueueModal();
  showToast('Mesa actualizada', 'success');
});
