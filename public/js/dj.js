const socket = io();

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

// Referencias al DOM - Petición Manual
const btnManualAdd = document.getElementById('btn-manual-add');
const manualModal = document.getElementById('manual-modal');
const manualForm = document.getElementById('manual-form');
const btnManualCancel = document.getElementById('btn-manual-cancel');

// Referencias al DOM - Login
const loginOverlay = document.getElementById('login-overlay');
const btnLogin = document.getElementById('btn-login');
const emailInput = document.getElementById('dj-email');
const passInput = document.getElementById('dj-pass');
const loginError = document.getElementById('login-error');
const togglePass = document.getElementById('toggle-pass');
const btnLogout = document.getElementById('btn-logout');
const logoutOverlay = document.getElementById('logout-loader-overlay');
const initShield = document.getElementById('init-shield-loader');

// --- Firebase Authentication ---
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

let isInitialLoad = true;

// Función segura para quitar el shield (evita quedarse pegado)
function hideInitShield() {
  if (initShield && !initShield.classList.contains('hidden')) {
    initShield.style.opacity = '0';
    setTimeout(() => initShield.classList.add('hidden'), 500);
  }
}

// Timeout de emergencia: si Firebase tarda más de 3s, forzar salida
setTimeout(hideInitShield, 3000);

// Observador de estado de autenticación
auth.onAuthStateChanged((user) => {
  if (user) {
    document.body.style.overflow = 'auto';
    loginOverlay.style.opacity = '0';
    setTimeout(() => {
      loginOverlay.classList.add('hidden');
      logoutOverlay.classList.add('hidden');
      hideInitShield();
      if (!isInitialLoad) {
        showToast(`Sesión activa: DJ de Puerto Chopp`, 'success');
      }
      isInitialLoad = false;
    }, 500);
  } else {
    document.body.style.overflow = 'hidden';
    loginOverlay.classList.remove('hidden');
    loginOverlay.style.opacity = '1';
    logoutOverlay.classList.add('hidden');
    hideInitShield();
    if (requestsSwitch) requestsSwitch.checked = false;
    isInitialLoad = false;
    btnLogin.disabled = false;
    btnLogin.innerHTML = 'Entrar <span class="material-symbols-rounded">login</span>';
    passInput.value = '';
    emailInput.value = '';
    loginError.classList.add('hidden');
  }
});

// Botón: Ver/ocultar contraseña
togglePass.addEventListener('click', () => {
  const type = passInput.getAttribute('type') === 'password' ? 'text' : 'password';
  passInput.setAttribute('type', type);
  togglePass.querySelector('.material-symbols-rounded').textContent =
    type === 'password' ? 'visibility' : 'visibility_off';
  passInput.style.letterSpacing = type === 'password' ? '5px' : 'normal';
});

// Botón: Iniciar sesión
btnLogin.addEventListener('click', () => {
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if (!email || !pass) {
    loginError.textContent = 'Completá todos los campos';
    loginError.classList.remove('hidden');
    return;
  }
  const originalContent = btnLogin.innerHTML;
  btnLogin.disabled = true;
  btnLogin.innerHTML = '<div class="loader-small"></div>';
  loginError.classList.add('hidden');
  auth.signInWithEmailAndPassword(email, pass).catch(err => {
    btnLogin.disabled = false;
    btnLogin.innerHTML = originalContent;
    loginError.textContent = 'Correo o contraseña incorrectos';
    loginError.classList.remove('hidden');
    console.error(err);
  });
});

// Enter en el campo de contraseña dispara login
passInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') btnLogin.click();
});

// Botón: Cerrar sesión
btnLogout.addEventListener('click', () => {
  socket.emit('set-requests-enabled', false);
  logoutOverlay.classList.remove('hidden');
  setTimeout(() => {
    auth.signOut().then(() => {
      showToast('Sesión cerrada', 'info');
    });
  }, 800);
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
    card.style.padding = '1rem';
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
      <div style="flex: 0 0 auto; text-align: center; margin-bottom: 0.5rem;">
        <strong style="font-size: 0.85rem; color: #fff; display: block;">Petición ${requestsArray.indexOf(req) + 1} de ${total}</strong>
        <p style="font-size: 0.7rem; color: var(--text-muted); opacity: 0.6; margin: 0;">${new Date(req.timestamp).toLocaleTimeString()}</p>
      </div>

      <!-- Song Info (Shrinkable) -->
      <div style="flex: 0 1 auto; text-align: center; overflow: hidden; margin-bottom: 0.5rem;">
        <h3 style="color: var(--primary-color); font-size: clamp(1.2rem, 3.5vh, 1.6rem); font-weight: 800; margin-bottom: 0.1rem; line-height: 1.1; word-break: break-word;">${req.song}</h3>
        <p style="font-size: clamp(0.85rem, 2vh, 1rem); color: #fff; margin: 0;">De: <strong>${req.clientName}</strong> <span class="badge" style="background: var(--primary-color); color: #000; font-weight: 800; font-size: 0.65rem; padding: 2px 5px; vertical-align: middle;">Mesa ${req.table}</span></p>
      </div>

      <!-- Observation (Priority - Fixed size based on content) -->
      ${req.observation ? `
      <div style="flex: 0 0 auto; background: rgba(255, 204, 0, 0.05); border: 1px solid rgba(255, 204, 0, 0.1); padding: 0.5rem 0.8rem; border-radius: 12px; margin-bottom: 0.8rem; display: flex; flex-direction: column; align-items: center; gap: 0.2rem;">
        <p style="font-size: 0.65rem; color: var(--primary-color); text-transform: uppercase; font-weight: 800; margin: 0;">Observación:</p>
        <div style="display: flex; align-items: center; gap: 0.8rem; width: 100%; justify-content: center; padding: 0 0.5rem;">
          <p style="font-size: 0.85rem; color: #fff; font-style: italic; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; text-align: center;">"${req.observation}"</p>
          ${req.observation.length > 55 ? `<button class="btn-text" onclick="showCardObservation('${req.id}')" style="font-size: 0.7rem; color: var(--primary-color); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; flex: 0 0 auto;">Ver todo</button>` : ''}
        </div>
      </div>
      ` : ''}

      <!-- Inputs Area (Fixed) -->
      <div style="flex: 0 0 auto; background: rgba(0,0,0,0.3); padding: 0.8rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 1rem;">
        <!-- Local File -->
        <div style="display: flex; gap: 0.4rem; margin-bottom: 0.5rem;">
          <label for="file-${req.id}" id="file-label-${req.id}" class="btn" style="margin: 0; padding: 0 1rem; font-size: 0.85rem; flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.6rem; height: 44px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;">
            <span id="label-icon-${req.id}" class="material-symbols-rounded" style="font-size: 20px;">upload_file</span> 
            <span id="label-text-${req.id}">Seleccionar archivo</span>
          </label>
          <button class="btn-icon" style="width: 44px; height: 44px; border-radius: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);" onclick="previewLocalFile('${req.id}')" title="Vista previa local">
            <span class="material-symbols-rounded" style="font-size: 20px;">visibility</span>
          </button>
          <input type="file" id="file-${req.id}" accept="video/*,audio/*" style="display: none;" 
            onchange="
              const hasFile = this.files.length > 0;
              document.getElementById('label-text-${req.id}').textContent = hasFile ? this.files[0].name : 'Seleccionar archivo';
              document.getElementById('label-icon-${req.id}').textContent = hasFile ? 'movie' : 'upload_file';
            ">
        </div>

        <div style="display: flex; align-items: center; text-align: center; margin: 0.6rem 0;">
          <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.1);"></div>
          <span style="padding: 0 0.8rem; font-size: 0.55rem; color: var(--text-muted); font-weight: bold; text-transform: uppercase;">O YOUTUBE</span>
          <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.1);"></div>
        </div>

        <!-- YouTube Alternative -->
        <div style="display: flex; gap: 0.4rem;">
          <input type="text" id="yt-${req.id}" placeholder="Link de YouTube (Opcional)" style="margin-bottom: 0; padding: 0.7rem; font-size: 0.9rem; flex: 1; border-radius: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; height: 44px;">
          <button class="btn-icon" style="width: 44px; height: 44px; border-radius: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);" onclick="previewYouTube('${req.id}')">
            <span class="material-symbols-rounded" style="font-size: 20px;">visibility</span>
          </button>
        </div>
      </div>
      
      <!-- Actions Area (Fixed) -->
      <div style="flex: 0 0 auto; min-height: 85px; display: flex; flex-direction: column; justify-content: flex-end;">
        <div style="display: flex; gap: 0.8rem; width: 100%;" id="action-buttons-${req.id}">
          <button class="btn" style="flex: 1; padding: 0.9rem; background: linear-gradient(135deg, var(--primary-color), #ffb800) !important; color: #000; font-weight: 800; border-radius: 14px; font-size: 1rem;" onclick="approveRequest('${req.id}')">Aprobar</button>
          <button class="btn btn-danger" style="flex: 1; padding: 0.9rem; background: rgba(255, 51, 102, 0.1); border: 1px solid #ff3366; color: #ff3366; font-weight: 800; border-radius: 14px; font-size: 1rem;" onclick="showRejectInput('${req.id}')">Rechazar</button>
        </div>

        <div id="reject-container-${req.id}" class="hidden" style="width: 100%;">
          <input type="text" id="reject-reason-${req.id}" placeholder="Motivo de rechazo" style="margin-bottom: 0.5rem; padding: 0.6rem; font-size: 0.9rem; width: 100%; border-radius: 10px;">
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn btn-secondary" style="flex: 1; padding: 0.6rem; border-radius: 10px; font-size: 0.85rem;" onclick="cancelReject('${req.id}')">Cancelar</button>
            <button class="btn btn-danger" style="flex: 1; padding: 0.6rem; border-radius: 10px; font-size: 0.85rem;" onclick="confirmReject('${req.id}')">Confirmar</button>
          </div>
        </div>
      </div>
    `;
    requestsContainer.appendChild(card);
  }
  pendingCount.textContent = pendingRequests.size;
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

function renderQueue() {
  queueContainer.innerHTML = '';
  queue.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'queue-item fade-in';
    div.innerHTML = `
      <div class="rank">#${index + 1}</div>
      <div class="info" style="text-align: center; flex: 1;">
        <h4 style="margin:0; font-size: 1.1rem;">${item.song}</h4>
        <p style="margin:0; font-size: 0.9rem; opacity: 0.8;">${item.clientName} (Mesa ${item.table || '-'})</p>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-end;">
        <div class="badge" style="background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); font-size: 0.65rem;">${item.type === 'youtube' ? 'YT' : 'FILE'}</div>
        <button class="btn-danger" style="padding: 0.4rem; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; background: rgba(255, 51, 102, 0.15); border: 1px solid var(--primary-color); color: var(--primary-color);" onclick="removeFromQueue('${item.id}')" title="Eliminar de la cola">
          <span class="material-symbols-rounded" style="font-size: 1.2rem;">delete</span>
        </button>
      </div>
    `;
    queueContainer.appendChild(div);
  });
  queueCount.textContent = queue.length;
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
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
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
    // Es YouTube
    if (!isValidYouTubeUrl(ytInput)) {
      showToast('El link de YouTube no parece ser válido.', 'error');
      return;
    }

    socket.emit('approve-request', {
      id,
      youtubeUrl: ytInput,
      type: 'youtube',
      clientName: req.clientName
    });
    animateAndRemove(id, 'right');
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
  btnPlayNext.disabled = autoplayOn;
  if (autoplayOn) {
    btnPlayNext.style.opacity = '0.3';
    btnPlayNext.style.cursor = 'not-allowed';
    delayContainer.style.opacity = '1';
    delayInput.disabled = false;
    delayMinus.disabled = false;
    delayPlus.disabled = false;
    delayMinus.style.cursor = 'pointer';
    delayPlus.style.cursor = 'pointer';
  } else {
    btnPlayNext.style.opacity = '1';
    btnPlayNext.style.cursor = 'pointer';
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
  
  const clientName = capitalizeWords(document.getElementById('manual-client').value.trim());
  const songName = capitalizeWords(document.getElementById('manual-song').value.trim());
  const artistName = capitalizeWords(document.getElementById('manual-artist').value.trim());
  
  const fullSongName = artistName ? `${songName} - ${artistName}` : songName;
  
  socket.emit('new-request', {
    clientName,
    song: fullSongName,
    observation: manualObsToggle.checked ? inputManualObs.value.trim() : '',
    table: 'DJ' // Distintivo para peticiones manuales
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
  renderQueue();
});

socket.on('autoplay-state', (state) => {
  autoplaySwitch.checked = state;
  updatePlayNextBtn(state);
});

socket.on('autoplay-delay-state', (delay) => {
  delayInput.value = delay;
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
