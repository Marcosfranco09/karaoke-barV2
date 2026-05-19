const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('djConfig', {
  serverUrl: process.env.SERVER_URL || 'https://puertochop-karaoke.onrender.com',
  djToken: process.env.DJ_TOKEN
});

contextBridge.exposeInMainWorld('djAPI', {
  openWindow: (file) => ipcRenderer.send('open-window', file)
});
