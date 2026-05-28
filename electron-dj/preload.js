const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('djConfig', {
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  djToken: process.env.DJ_TOKEN || 'puertochoppdj'
});

contextBridge.exposeInMainWorld('djAPI', {
  openWindow: (file) => ipcRenderer.send('open-window', file)
});
