const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// Deshabilitar la política que exige interacción del usuario para el autoplay con sonido
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gestures-requirement');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, 'dj', 'launcher.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

ipcMain.on('open-window', (event, filename) => {
  const newWin = new BrowserWindow({
    width: filename === 'dj.html' ? 1200 : 1000,
    height: filename === 'dj.html' ? 800 : 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  newWin.setMenuBarVisibility(false);
  newWin.loadFile(path.join(__dirname, 'dj', filename));
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
