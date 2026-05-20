const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

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
let recentRequestHistory = []; // Historial de las mesas que han pedido recientemente

// Websockets
io.on('connection', (socket) => {
  // Cuando se conecta un cliente (DJ o Screen), enviar estado inicial si es necesario
  
  // Cliente solicita canción
  socket.on('new-request', (data) => {
    const clientId = data.table ? `Mesa ${data.table}` : (data.clientName || 'Sin Nombre');
    
    // --- Lógica de Límite de Pedidos ---
    let count_T = 0;
    let count_other = 0;
    for (let i = recentRequestHistory.length - 1; i >= 0; i--) {
      if (recentRequestHistory[i] === clientId) {
        count_T++;
      } else {
        count_other++;
      }
      if (count_other >= 3) break;
    }
    
    if (count_T >= 2) {
      socket.emit('request-error', { 
        message: 'Límite alcanzado: Has pedido 2 canciones seguidas. Esperá a que otras 3 mesas pidan para volver a pedir.' 
      });
      return;
    }
    
    recentRequestHistory.push(clientId);
    if (recentRequestHistory.length > 100) recentRequestHistory.shift();
    // -----------------------------------

    const id = uuidv4();
    const request = {
      id,
      socketId: socket.id, // para responderle a este cliente
      clientName: data.clientName,
      table: data.table || '',
      song: data.song,
      observation: data.observation || '', // Capturar observación del cliente
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
      const reqToCancel = pendingRequests.get(requestId);
      const clientIdToCancel = reqToCancel.table ? `Mesa ${reqToCancel.table}` : (reqToCancel.clientName || 'Sin Nombre');
      
      pendingRequests.delete(requestId);
      io.emit('request-cancelled', requestId);
      
      // Reembolsar el cupo eliminando su último registro en el historial
      const lastIndex = recentRequestHistory.lastIndexOf(clientIdToCancel);
      if (lastIndex !== -1) recentRequestHistory.splice(lastIndex, 1);
    } 
    // 2. Buscar en la cola
    else {
      const reqToCancel = queue.find(req => req.id === requestId);
      if (reqToCancel) {
        const clientIdToCancel = reqToCancel.table ? `Mesa ${reqToCancel.table}` : (reqToCancel.clientName || 'Sin Nombre');
        queue = queue.filter(req => req.id !== requestId);
        
        // Reembolsar cupo
        const lastIndex = recentRequestHistory.lastIndexOf(clientIdToCancel);
        if (lastIndex !== -1) recentRequestHistory.splice(lastIndex, 1);
        
        io.emit('queue-updated', { queue });
      }
    }
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
      io.to(request.socketId).emit('request-rejected', { id: data.id, reason: data.reason });
    }
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

  // DJ o Screen pide reproducir la siguiente manualmente
  socket.on('play-next', () => {
    if (!karaokeRunning) {
      karaokeRunning = true;
      io.emit('karaoke-running-state', karaokeRunning);
    }
    playNextLogic();
  });

  // La pantalla avisa que terminó la canción actual
  socket.on('song-ended', () => {
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

  // Sincronización inicial para DJ / Screen que se recarga
  socket.on('get-state', () => {
    socket.emit('initial-state', {
      pending: Array.from(pendingRequests.values()),
      queue,
      nowPlaying,
      autoplayEnabled,
      autoplayDelay,
      karaokeRunning,
      lastSongMode,
      requestsEnabled
    });
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
