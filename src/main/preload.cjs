'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, payload) => ipcRenderer.invoke('pet:' + name, payload);
contextBridge.exposeInMainWorld('pet', Object.freeze({
  getSettings: () => invoke('settings'),
  saveSettings: patch => invoke('save-settings', patch),
  launch: () => invoke('launch'),
  status: () => invoke('status'),
  usage: () => invoke('usage'),
  action: action => invoke('action', action),
  panel: tab => invoke('panel', tab),
  menu: () => invoke('menu'),
  closePanel: () => invoke('close-panel'),
  openUsage: () => invoke('open-usage'),
  locateApp: name => invoke('locate-app', name),
  mouse: ignore => ipcRenderer.send('pet:mouse', ignore),
  drag: stage => ipcRenderer.send('pet:drag', stage),
  onUpdate: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pet:update', listener);
    return () => ipcRenderer.removeListener('pet:update', listener);
  }
}));
