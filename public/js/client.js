const socket = io();

// Detectar mesa desde URL (?table=X)
const urlParams = new URLSearchParams(window.location.search);
const tableNumber = urlParams.get('table');

// Elementos UI
const requestPanel = document.getElementById('request-panel');
const statusPanel = document.getElementById('status-panel');

const btnRequest = document.getElementById('btn-request');
const btnNewRequest = document.getElementById('btn-new-request');

const inputName = document.getElementById('client-name');
const inputSong = document.getElementById('song-name');
const inputArtist = document.getElementById('artist-name');

const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
const statusLoader = document.getElementById('status-loader');
const btnCancelRequest = document.getElementById('btn-cancel-request');
const approvedCard = document.getElementById('approved-card');
const approvedSongTitle = document.getElementById('approved-song-title');
const approvedClientName = document.getElementById('approved-client-name');
const obsToggle = document.getElementById('obs-toggle');
const obsContainer = document.getElementById('obs-container');
const inputObs = document.getElementById('song-obs');

const requestsFormContainer = document.getElementById('requests-form-container');
const requestsDisabledMsg = document.getElementById('requests-disabled-msg');
const splashScreen = document.getElementById('splash-screen');

let currentRequestId = null;
let currentRequestData = { name: '', song: '' };

// Función para ocultar el Splash Screen suavemente
function hideSplash() {
  if (splashScreen) {
    splashScreen.style.opacity = '0';
    setTimeout(() => {
      splashScreen.style.visibility = 'hidden';
    }, 500);
  }
}

// Ocultar Splash Screen después de 1 segundo (Seguridad total)
setTimeout(() => {
  hideSplash();
}, 1000);

// Inicialización
function init() {
  const savedName = localStorage.getItem('karaoke_name');
  if (savedName) {
    inputName.value = savedName;
  }
  
  if (tableNumber) {
    document.getElementById('table-num').textContent = tableNumber;
    document.getElementById('table-badge').classList.remove('hidden');
  }
}

// Navegación
function showRequestPanel() {
  statusPanel.classList.add('hidden');
  requestPanel.classList.remove('hidden');
  inputSong.value = '';
  inputArtist.value = '';
}

function showStatusPanel(state, message = '') {
  requestPanel.classList.add('hidden');
  statusPanel.classList.remove('hidden');
  
  if (state === 'loading') {
    statusTitle.textContent = '¡PETICIÓN ENVIADA!';
    statusTitle.style.background = 'linear-gradient(to right, #00ff88, var(--primary-color))';
    statusTitle.style.webkitBackgroundClip = 'text';
    statusTitle.style.whiteSpace = 'nowrap';
    statusTitle.style.fontSize = '1.8rem'; // Ajuste para asegurar una línea
    statusMessage.textContent = 'El DJ está revisando tu canción. Te avisaremos aquí mismo cuando sea aprobada.';
    statusLoader.classList.add('hidden'); // Ocultar spinner
    btnNewRequest.classList.add('hidden');
    btnCancelRequest.classList.remove('hidden');
    approvedCard.classList.add('hidden');
  } else if (state === 'approved') {
    statusTitle.textContent = 'PEDIDO APROBADO';
    statusTitle.style.background = 'linear-gradient(to right, #00ff88, #00b3ff)';
    statusTitle.style.webkitBackgroundClip = 'text';
    statusMessage.textContent = 'Tu canción ya está en la cola.';
    statusLoader.classList.add('hidden');
    btnNewRequest.classList.remove('hidden');
    btnCancelRequest.classList.remove('hidden');
    
    // Mostrar la card con info
    approvedSongTitle.textContent = currentRequestData.song;
    approvedClientName.textContent = `Cantante: ${currentRequestData.name}`;
    approvedCard.classList.remove('hidden');
  } else if (state === 'rejected') {
    statusTitle.textContent = 'PEDIDO RECHAZADO';
    statusTitle.style.background = 'linear-gradient(to right, #ff3366, #ff0000)';
    statusTitle.style.webkitBackgroundClip = 'text';
    statusMessage.textContent = message || 'El DJ no pudo procesar tu canción.';
    statusLoader.classList.add('hidden');
    btnNewRequest.classList.remove('hidden');
    btnCancelRequest.classList.add('hidden');
  } else if (state === 'cancelled') {
    statusTitle.textContent = 'PETICIÓN CANCELADA';
    statusTitle.style.background = 'linear-gradient(to right, #999, #666)';
    statusTitle.style.webkitBackgroundClip = 'text';
    statusMessage.textContent = 'Has cancelado tu pedido.';
    statusLoader.classList.add('hidden');
    btnNewRequest.classList.remove('hidden');
    btnCancelRequest.classList.add('hidden');
  }
}

// Utilidad para capitalizar la primera letra de cada palabra (soporta tildes)
function capitalizeWords(str) {
  return str.toLowerCase().replace(/(^|\s)\S/g, char => char.toUpperCase());
}

// Eventos de botones
btnRequest.addEventListener('click', () => {
  let name = inputName.value.trim();
  let song = inputSong.value.trim();
  let artist = inputArtist.value.trim();
  
  const errorMsg = document.getElementById('client-error-msg');
  errorMsg.classList.add('hidden');
  
  if (!name) {
    errorMsg.textContent = 'Por favor ingresá tu nombre.';
    errorMsg.classList.remove('hidden');
    return;
  }
  if (!song || !artist) {
    errorMsg.textContent = 'Por favor ingresá la canción y el artista.';
    errorMsg.classList.remove('hidden');
    return;
  }
  
  name = capitalizeWords(name);
  song = capitalizeWords(song);
  artist = capitalizeWords(artist);
  
  const fullSong = artist ? `${song} - ${artist}` : song;
  currentRequestData = { name, song: fullSong };
  
  localStorage.setItem('karaoke_name', name);
  
  socket.emit('new-request', { 
    clientName: name, 
    table: tableNumber || '', // Mesa dinámica
    song: fullSong,
    observation: obsToggle.checked ? inputObs.value.trim() : ''
  });

  // Limpiar campos de observación
  obsToggle.checked = false;
  obsContainer.classList.add('hidden');
  inputObs.value = '';

  showStatusPanel('loading');
});

// Lógica para mostrar/ocultar observaciones con animación
obsToggle.addEventListener('change', () => {
  if (obsToggle.checked) {
    obsContainer.style.maxHeight = '200px';
    obsContainer.style.opacity = '1';
    inputObs.focus();
  } else {
    obsContainer.style.maxHeight = '0';
    obsContainer.style.opacity = '0';
    inputObs.value = '';
  }
});

btnNewRequest.addEventListener('click', () => {
  currentRequestId = null;
  showRequestPanel();
});

btnCancelRequest.addEventListener('click', () => {
  if (currentRequestId) {
    socket.emit('cancel-request', currentRequestId);
    showStatusPanel('cancelled');
    currentRequestId = null;
  }
});

// Eventos de Socket.IO
socket.on('request-received', (data) => {
  currentRequestId = data.id;
});

socket.on('request-approved', () => {
  showStatusPanel('approved');
});

socket.on('request-rejected', (data) => {
  showStatusPanel('rejected', data.reason);
});

socket.on('requests-enabled-state', (enabled) => {
  if (enabled) {
    requestsFormContainer.classList.remove('hidden');
    requestsDisabledMsg.classList.add('hidden');
  } else {
    requestsFormContainer.classList.add('hidden');
    requestsDisabledMsg.classList.remove('hidden');
  }
});

socket.on('initial-state', (state) => {
  // Manejar estado de pedidos habilitados
  if (state.requestsEnabled) {
    requestsFormContainer.classList.remove('hidden');
    requestsDisabledMsg.classList.add('hidden');
  } else {
    requestsFormContainer.classList.add('hidden');
    requestsDisabledMsg.classList.remove('hidden');
  }
});

init();
socket.emit('get-state');
