const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const youtubeDl = require('youtube-dl-exec');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOADS_DIR = path.join(__dirname, 'tmp', 'karaoke-uploads');

// Asegurar que el directorio de subidas existe
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(console.error);

// Configuración de Multer para archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
// Servir archivos temporales estáticamente
app.use('/uploads', express.static(UPLOADS_DIR));



// Generar QR para el DJ
app.get('/api/qr', async (req, res) => {
  try {
    const host = req.headers.host;
    const url = `http://${host}/`;
    const qrCode = await QRCode.toDataURL(url);
    res.json({ qrCode, url });
  } catch (err) {
    res.status(500).json({ error: 'Error generating QR' });
  }
});

// Endpoint de subida de archivos
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, filename: req.file.filename });
});

const pendingRequests = new Map(); // id -> request
let queue = []; // array of approved requests
let history = []; // array of played requests
let nowPlaying = null; // current song
let autoplayEnabled = true; // estado global de autoplay (Activado por defecto)
let autoplayDelay = 5; // tiempo de espera en segundos
let karaokeRunning = false; // estado del evento
let lastSongMode = false; // modo última canción
let requestsEnabled = false; // habilitar/deshabilitar pedidos de clientes
let approvalHistory = []; // Historial de las mesas que tuvieron pedidos aprobados
let playbackVolume = 50; // volumen global de reproduccion (50 = 100% normal, 100 = 200% overdrive)
let playbackPitch = 0; // tonalidad global en semitonos
let prevFileToDelete = null; // archivo a borrar cuando termine la próxima canción

function getPendingCount(clientId) {
  let count = 0;
  for (const req of pendingRequests.values()) {
    const reqClientId = req.table ? `Mesa ${req.table}` : (req.clientName || 'Sin Nombre');
    if (reqClientId === clientId) count++;
  }
  return count;
}

function getUnrefreshedApprovedCount(clientId) {
  let count_T = 0;
  let count_other = 0;
  for (let i = approvalHistory.length - 1; i >= 0; i--) {
    if (approvalHistory[i] === clientId) {
      count_T++;
    } else {
      count_other++;
    }
    if (count_other >= 3) break;
  }
  return count_T;
}

function getBlockedTables() {
  const blocked = [];
  const activeClients = new Set();
  for (const req of pendingRequests.values()) {
    activeClients.add(req.table ? `Mesa ${req.table}` : (req.clientName || 'Sin Nombre'));
  }
  for (const clientId of approvalHistory) {
    activeClients.add(clientId);
  }
  
  for (const clientId of activeClients) {
    if ((getPendingCount(clientId) + getUnrefreshedApprovedCount(clientId)) >= 2) {
      blocked.push(clientId);
    }
  }
  return blocked;
}

function broadcastLimits() {
  io.emit('blocked-clients', getBlockedTables());
}

// Websockets
io.on('connection', (socket) => {
  // Cuando se conecta un cliente (DJ o Screen), enviar estado inicial si es necesario
  
  // Cliente solicita canción
  socket.on('new-request', (data) => {
    const clientId = data.table ? `Mesa ${data.table}` : (data.clientName || 'Sin Nombre');
    const isDjManualRequest = data.source === 'dj-manual' || data.table === 'DJ';
    const clientIP = socket.handshake.address;

    // --- Bloqueo por IP: mismo dispositivo no puede tener otro pedido activo ---
    if (!isDjManualRequest) {
      const hasActiveByIP = [...pendingRequests.values()].some(r => r.clientIP === clientIP)
        || queue.some(r => r.clientIP === clientIP)
        || (nowPlaying && nowPlaying.clientIP === clientIP);
      if (hasActiveByIP) {
        socket.emit('request-error', {
          message: 'Ya tenés un pedido activo desde este dispositivo. Esperá a que termine para pedir de nuevo.'
        });
        return;
      }
    }
    // -----------------------------------------------------------------------

    // --- Lógica de Límite de Pedidos (Aprobadas + Pendientes) ---
    const totalConsumed = getPendingCount(clientId) + getUnrefreshedApprovedCount(clientId);
    if (!isDjManualRequest && totalConsumed >= 2) {
      socket.emit('request-error', { 
        message: 'Límite alcanzado: Tienes 2 canciones pendientes o en cola. Esperá a que otras 3 mesas tengan aprobaciones para volver a pedir.' 
      });
      return;
    }
    // -----------------------------------

    const id = uuidv4();
    const request = {
      id,
      socketId: socket.id,
      clientIP,
      clientName: data.clientName,
      table: data.table || '',
      song: data.song,
      observation: data.observation || '',
      source: data.source || 'client',
      user: data.user || null,
      timestamp: Date.now()
    };
    pendingRequests.set(id, request);
    
    // Notificar al DJ
    io.emit('request-incoming', request);
    
    // Devolver el ID al cliente para que pueda cancelarla si quiere
    socket.emit('request-received', { id });
  });

  // Cliente cancela su propia solicitud (pendiente o en cola)
  socket.on('cancel-request', (requestId) => {
    // 1. Buscar en pendientes
    if (pendingRequests.has(requestId)) {
      pendingRequests.delete(requestId);
      io.emit('request-cancelled', requestId);
      broadcastLimits();
    } 
    // 2. Buscar en la cola
    else {
      const reqToCancel = queue.find(req => req.id === requestId);
      if (reqToCancel) {
        const clientIdToCancel = reqToCancel.table ? `Mesa ${reqToCancel.table}` : (reqToCancel.clientName || 'Sin Nombre');
        queue = queue.filter(req => req.id !== requestId);
        
        // Reembolsar de la cola aprobada eliminando su último registro en approvalHistory
        const lastIndex = approvalHistory.lastIndexOf(clientIdToCancel);
        if (lastIndex !== -1) {
          approvalHistory.splice(lastIndex, 1);
        }
        
        broadcastLimits();
        io.emit('queue-updated', { queue });
      }
    }
  });

  // Cliente verifica estado de un request previo (post-recarga)
  socket.on('check-request-status', (requestId, callback) => {
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pending.socketId = socket.id;
      return callback({ status: 'pending', request: pending });
    }
    const queued = queue.find(item => item.id === requestId);
    if (queued) {
      return callback({ status: 'queued', request: queued });
    }
    if (nowPlaying && nowPlaying.id === requestId) {
      return callback({ status: 'playing', request: nowPlaying });
    }
    callback({ status: 'not_found' });
  });

  // DJ aprueba solicitud
  socket.on('approve-request', (data) => {
    // data: { id, youtubeUrl | fileUrl, type: 'youtube' | 'file', clientName }
    const request = pendingRequests.get(data.id);
    if (request) {
      pendingRequests.delete(data.id);
      
      const approvedSong = {
        ...request,
        resourceUrl: data.youtubeUrl || data.fileUrl,
        type: data.type
      };
      
      queue.push(approvedSong);
      
      const clientId = request.table ? `Mesa ${request.table}` : (request.clientName || 'Sin Nombre');
      approvalHistory.push(clientId);
      if (approvalHistory.length > 100) approvalHistory.shift();
      broadcastLimits();
      
      // Notificar al cliente específico
      io.to(request.socketId).emit('request-approved', { id: data.id });
      
      // Notificar a la pantalla
      io.emit('queue-updated', { queue });
    }
  });

  // DJ rechaza solicitud
  socket.on('reject-request', (data) => {
    // data: { id, reason }
    const request = pendingRequests.get(data.id);
    if (request) {
      pendingRequests.delete(data.id);
      broadcastLimits();
      io.to(request.socketId).emit('request-rejected', { id: data.id, reason: data.reason });
    }
  });

  // DJ edita un elemento ya en cola
  socket.on('edit-queue-item', (data) => {
    const itemIndex = queue.findIndex(item => item.id === data.id);
    if (itemIndex !== -1) {
      queue[itemIndex] = { ...queue[itemIndex], ...data.updates };
      io.emit('queue-updated', { queue });
    }
  });

  // DJ elimina un elemento de la cola
  socket.on('remove-queue-item', (id) => {
    const itemIndex = queue.findIndex(item => item.id === id);
    if (itemIndex !== -1) {
      queue.splice(itemIndex, 1);
      io.emit('queue-updated', { queue });
    }
  });

  // DJ reordena la cola (mover a un índice específico por drag-and-drop)
  socket.on('reorder-queue', (data) => {
    // data: { id, newIndex }
    const index = queue.findIndex(item => item.id === data.id);
    if (index === -1) return;
    
    // Remover del índice actual y colocar en el nuevo índice
    const [item] = queue.splice(index, 1);
    queue.splice(data.newIndex, 0, item);
    io.emit('queue-updated', { queue });
  });

  function playNextLogic() {
    if (nowPlaying) {
      history.push(nowPlaying);
      if (history.length > 20) history.shift();
    }

    if (queue.length > 0) {
      nowPlaying = queue.shift();
      io.emit('now-playing', nowPlaying);
      io.emit('queue-updated', { queue });
    } else {
      nowPlaying = null;
      io.emit('now-playing', null);
    }
  }

  // Programar borrado del archivo de la canción actual para después de la próxima
  function scheduleFileCleanup() {
    // Borrar archivo pendiente de la anteúltima canción
    if (prevFileToDelete) {
      fsSync.unlink(prevFileToDelete, () => {});
      prevFileToDelete = null;
    }
    // Programar borrado del archivo actual
    if (nowPlaying && nowPlaying.type === 'file' && nowPlaying.resourceUrl && nowPlaying.resourceUrl.startsWith('/uploads/')) {
      prevFileToDelete = path.join(UPLOADS_DIR, nowPlaying.resourceUrl.replace('/uploads/', ''));
    }
  }

  // DJ o Screen pide reproducir la siguiente manualmente
  socket.on('play-next', () => {
    scheduleFileCleanup();
    if (!karaokeRunning) {
      karaokeRunning = true;
      io.emit('karaoke-running-state', karaokeRunning);
    }
    playNextLogic();
  });

  // La pantalla avisa que terminó la canción actual
  socket.on('song-ended', () => {
    scheduleFileCleanup();

    // Notificar al cliente cuya canción terminó
    if (nowPlaying && nowPlaying.socketId) {
      io.to(nowPlaying.socketId).emit('your-song-played');
    }

    // Liberar la mesa en approvalHistory para que pueda pedir de nuevo
    if (nowPlaying) {
      const playedClientId = nowPlaying.table ? `Mesa ${nowPlaying.table}` : (nowPlaying.clientName || 'Sin Nombre');
      const lastIdx = approvalHistory.lastIndexOf(playedClientId);
      if (lastIdx !== -1) {
        approvalHistory.splice(lastIdx, 1);
      }
      broadcastLimits();
    }
    if (lastSongMode) {
      // Si era la última canción, parar el karaoke
      karaokeRunning = false;
      lastSongMode = false;
      io.emit('karaoke-running-state', karaokeRunning);
      io.emit('last-song-state', lastSongMode);
      
      // Limpiar nowPlaying al cerrar
      if (nowPlaying) {
        history.push(nowPlaying);
        if (history.length > 20) history.shift();
      }
      nowPlaying = null;
      io.emit('now-playing', null);
    } else if (autoplayEnabled && karaokeRunning) {
      // Si sigue el show y hay autoplay, poner la siguiente
      playNextLogic();
    } else {
      // Si terminó pero no hay autoplay (modo manual) o el karaoke está en pausa,
      // limpiar el "Cantando Ahora" de la memoria y enviarlo al historial
      if (nowPlaying) {
        history.push(nowPlaying);
        if (history.length > 20) history.shift();
      }
      nowPlaying = null;
      io.emit('now-playing', null);
    }
  });

  // DJ pide reproducir la anterior
  socket.on('play-previous', () => {
    if (history.length > 0) {
      if (nowPlaying) {
        queue.unshift(nowPlaying);
      }
      nowPlaying = history.pop();
      io.emit('now-playing', nowPlaying);
      io.emit('queue-updated', { queue });
    }
  });

  // DJ pide pausar/reproducir
  socket.on('toggle-play', () => {
    io.emit('toggle-play');
  });

  // DJ activa/desactiva autoplay
  socket.on('set-autoplay', (state) => {
    autoplayEnabled = state;
    io.emit('autoplay-state', autoplayEnabled);
  });

  // DJ ajusta el tiempo de espera
  socket.on('set-autoplay-delay', (seconds) => {
    autoplayDelay = Number(seconds) || 5;
    io.emit('autoplay-delay-state', autoplayDelay);
  });

  // DJ ajusta el volumen global de reproduccion
  socket.on('set-playback-volume', (value) => {
    playbackVolume = Math.max(0, Math.min(100, Number(value) || 0));
    io.emit('playback-volume-state', playbackVolume);
  });

  // DJ ajusta la tonalidad global
  socket.on('set-playback-pitch', (value) => {
    playbackPitch = Math.max(-6, Math.min(6, Number(value) || 0));
    io.emit('playback-pitch-state', playbackPitch);
  });

  // DJ arranca o detiene el karaoke
  socket.on('toggle-karaoke', () => {
    karaokeRunning = !karaokeRunning;
    io.emit('karaoke-running-state', karaokeRunning);
    
    // Si se inicia y hay canciones en cola pero nada reproduciéndose, arrancar automáticamente
    if (karaokeRunning && !nowPlaying && queue.length > 0) {
      playNextLogic();
    }
  });

  // DJ activa última canción
  socket.on('set-last-song', (state) => {
    lastSongMode = state;
    io.emit('last-song-state', lastSongMode);
  });

    // DJ elimina de la cola manualmente
  socket.on('remove-from-queue', (requestId) => {
    queue = queue.filter(item => item.id !== requestId);
    io.emit('queue-updated', { queue });
  });

  // Pantalla notifica error al DJ
  socket.on('screen-error', (msg) => {
    io.emit('screen-error', msg);
  });

  // DJ habilita/deshabilita pedidos
  socket.on('set-requests-enabled', (state) => {
    requestsEnabled = state;
    io.emit('requests-enabled-state', requestsEnabled);
  });

  // DJ resetea toda la cola
  socket.on('reset-queue', () => {
    queue = [];
    nowPlaying = null;
    io.emit('queue-updated', { queue });
    io.emit('now-playing', null);
  });

  // DJ descarga video de YouTube (se usa como archivo local)
  socket.on('download-youtube', async (data) => {
    const { id, youtubeUrl } = data;
    const request = pendingRequests.get(id);
    if (!request) return;

    const filename = `${uuidv4()}.mp4`;
    const filePath = path.join(UPLOADS_DIR, filename);

    try {
      let lastErr = null;
      const methods = [
        { name: 'edge cookies', opts: { cookiesFromBrowser: 'edge' } },
        { name: 'chrome cookies', opts: { cookiesFromBrowser: 'chrome' } },
        { name: 'android', opts: { extractorArgs: 'youtube:player_client=android' } },
        { name: 'ios', opts: { extractorArgs: 'youtube:player_client=ios' } },
        { name: 'default', opts: {} }
      ];

      for (const { name, opts } of methods) {
        try {
          const child = youtubeDl.exec(youtubeUrl, {
            format: '22/18', // 720p, fallback a 360p
            output: filePath,
            noPlaylist: true,
            ...opts,
          });

          if (child.stderr) {
            child.stderr.on('data', (chunk) => {
              const text = chunk.toString();
              const match = text.match(/(\d+(?:\.\d+)?)%/);
              if (match) {
                socket.emit('download-progress', { id, percentage: parseInt(match[1]) });
              }
            });
          }

          await child;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const stderr = (err.stderr || '').substring(0, 200);
          console.log(`Download with ${name} failed:`, stderr);
        }
      }

      if (lastErr) throw lastErr;

      const fileUrl = `/uploads/${filename}`;
      socket.emit('download-complete', { id, fileUrl });

      // Auto-aprobar
      pendingRequests.delete(id);
      const approvedSong = {
        ...request,
        resourceUrl: fileUrl,
        type: 'file'
      };
      queue.push(approvedSong);

      const clientId = request.table ? `Mesa ${request.table}` : (request.clientName || 'Sin Nombre');
      approvalHistory.push(clientId);
      if (approvalHistory.length > 100) approvalHistory.shift();
      broadcastLimits();

      io.to(request.socketId).emit('request-approved', { id });
      io.emit('queue-updated', { queue });

    } catch (err) {
      console.error('Error descargando YouTube:', err.message?.substring(0, 200));
      const stderr = (err.stderr || err.message || '').toString();
      console.error('STDERR:', stderr.substring(0, 500));
      
      let msg = 'Error al descargar el video de YouTube';
      if (stderr.includes('cookies') || stderr.includes('Permission') || stderr.includes('locked')) {
        msg = 'Cerrá Edge/Chrome completamente y volvé a intentar.';
      } else if (stderr.includes('Private video')) msg = 'El video es privado';
      else if (stderr.includes('copyright')) msg = 'El video tiene restricción de copyright';
      else if (stderr.includes('Sign in') || stderr.includes('LOGIN_REQUIRED')) msg = 'Iniciá sesión en YouTube desde Edge, cerralo, y probá de nuevo.';
      socket.emit('download-error', { id, message: msg });

      // Limpiar archivo si quedó a medio descargar
      fsSync.unlink(filePath, () => {});
    }
  });

  // Sincronización inicial para DJ / Screen que se recarga
  socket.on('get-state', () => {
    socket.emit('initial-state', {
      pending: Array.from(pendingRequests.values()),
      queue,
      nowPlaying,
      autoplayEnabled,
      autoplayDelay,
      playbackVolume,
      playbackPitch,
      karaokeRunning,
      lastSongMode,
      requestsEnabled
    });
    socket.emit('blocked-clients', getBlockedTables());
  });
});


// Limpiar la carpeta tmp al iniciar el servidor (para que no queden basuras de sesiones anteriores)
async function cleanUploadsDir() {
  try {
    const files = await fs.readdir(UPLOADS_DIR);
    for (const file of files) {
      await fs.unlink(path.join(UPLOADS_DIR, file));
    }
    console.log('Directorio de uploads limpiado al iniciar.');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Error limpiando uploads:', err);
  }
}

const PORT = process.env.PORT || 3000;
const DJ_TOKEN = process.env.DJ_TOKEN || 'puertochoppdj';

app.use(express.json()); // Para leer JSON del cliente

// Middleware para proteger rutas del DJ
const djAuth = (req, res, next) => {
  const token = req.headers['x-dj-token'];
  if (token === DJ_TOKEN) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// Endpoint para verificar la conexión desde Electron
app.get('/api/dj/auth', djAuth, (req, res) => {
  res.json({ success: true, message: 'Authenticated' });
});

server.listen(PORT, async () => {
  await cleanUploadsDir();
  console.log(`🚀 Servidor de Karaoke corriendo en http://localhost:${PORT}`);
});
