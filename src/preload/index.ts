import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
	ipcRenderer: {
		send: (channel: string, data?: unknown) => ipcRenderer.send(channel, data)
	}
})

contextBridge.exposeInMainWorld('api', {
	onTwitchToken: (callback: (token: string) => void) =>
	    ipcRenderer.on('twitch-token-received', (_event, token) => callback(token))
})
