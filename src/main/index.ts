import {
	app,
	BrowserWindow,
	ipcMain,
	dialog,
	session,
	globalShortcut,
	screen,
} from "electron";
import { join } from "path";
import { electronApp, is } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";

// --- CRITICAL NOTIFICATION FIX ---
// This must be set at the top level for Windows to trust your notifications
const appId = "com.swarm.app";
if (process.platform === "win32") {
	app.setAppUserModelId(appId);
}

autoUpdater.autoDownload = true;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

// --- FORCE SINGLE INSTANCE LOCK ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});
}

function checkUpdates(): void {
	if (!is.dev) {
		autoUpdater.checkForUpdatesAndNotify();
	}
	autoUpdater.on("update-downloaded", () => {
		dialog
			.showMessageBox({
				type: "info",
				title: "Update Ready",
				message: "A new version of The Swarm has been downloaded. Restart to apply?",
				buttons: ["Restart", "Later"],
				defaultId: 0,
			})
		.then((result) => {
			if (result.response === 0) autoUpdater.quitAndInstall();
		});
	});
}

function createOverlayWindow(): void {
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		return;
	}

	try {
		const primaryDisplay = screen.getPrimaryDisplay();
		const { height } = primaryDisplay.workAreaSize;
		const overlayWidth = 400;
		const overlayHeight = 850;
	
		overlayWindow = new BrowserWindow({
			width: overlayWidth,
			height: overlayHeight,
			x: 20,
			y: height - overlayHeight - 20,
			skipTaskbar: true,
			type: "toolbar",
			transparent: true,
			frame: false,
			alwaysOnTop: true,
			show: true,
			opacity: 0,
			resizable: false,
			hasShadow: false,
			focusable: false,
			paintWhenInitiallyHidden: true,
			backgroundColor: "#00000000",
			webPreferences: {
				sandbox: false,
				preload: join(__dirname, "../preload/index.js"),
				devTools: true,
			},
		});
	
		overlayWindow.setMenuBarVisibility(false);
		overlayWindow.setIgnoreMouseEvents(true, { forward: true });
		
		overlayWindow.on("closed", () => {
			overlayWindow = null;
		});
		
		if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
			overlayWindow.loadURL(
				`${process.env["ELECTRON_RENDERER_URL"]}/#/overlay`
			);
		} else {
			overlayWindow.loadFile(join(__dirname, "../renderer/index.html"), {
				hash: "/overlay",
			});
		}
	} catch (error) {
		console.error("Overlay failed to initialize: ", error);
	}
}

function createWindow(): void {
	mainWindow = new BrowserWindow({
		width: 900,
		height: 670,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			sandbox: false,
			preload: join(__dirname, "../preload/index.js"),
			devTools: true,
		},
	});

	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (input.key === "F12" && input.type === "keyDown") {
			mainWindow!.webContents.toggleDevTools();
			event.preventDefault();
		}
	});
	
	if (is.dev) {
		mainWindow!.webContents.openDevTools({ mode: "detach" });
	}
	
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		const responseHeaders = { ...details.responseHeaders };
		if (details.url.includes("twitch.tv")) {
			delete responseHeaders["content-security-policy"];
			delete responseHeaders["x-frame-options"];
		}
		callback({ cancel: false, responseHeaders });
	});
	
	mainWindow.on("close", () => {
		if (overlayWindow && !overlayWindow.isDestroyed()) {
			overlayWindow.destroy();
		}
		overlayWindow = null;
	});
	
	mainWindow.on("closed", () => {
		mainWindow = null;
		app.quit();
	});
	
	mainWindow.on("ready-to-show", () => {
		mainWindow!.show();
		mainWindow!.focus();
		createOverlayWindow();
		checkUpdates();
	});
	
	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

function handleTwitchCallback(url: string, authWindow: BrowserWindow) {
	if (!url.startsWith("http://localhost/callback")) {
		return false;
	}

	console.log("callback URL: ", url);

	const hash = new URL(url).hash;
	const params = new URLSearchParams(
		hash.startsWith("#") ? hash.slice(1) : hash
	);

	const accessToken = params.get("access_token");

	if (!accessToken) {
		console.error("No access token found in callback URL");
		authWindow.close();
		return true;
	}

	console.log("access token received");
	mainWindow?.webContents.send("twitch-token-received", accessToken);
	
	if (!authWindow.isDestroyed()) {
		authWindow.close();
	}

	return true;
}

app.whenReady().then(() => {
	// Use the local appId variable here as well for consistency
	electronApp.setAppUserModelId(appId);
	createWindow();

	let isOverlayVisible = false;

	globalShortcut.register("F8", () => {
		if (!overlayWindow || overlayWindow.isDestroyed()) {
			return;
		}

		isOverlayVisible = !isOverlayVisible;

		if (isOverlayVisible) {
			overlayWindow.setFocusable(true);
			overlayWindow.setAlwaysOnTop(true, "screen-saver");
			overlayWindow.setIgnoreMouseEvents(false);
			overlayWindow.setOpacity(1.0);
			overlayWindow.focus();
		} else {
			overlayWindow.setOpacity(0.0);
			overlayWindow.setIgnoreMouseEvents(true, { forward: true });
			overlayWindow.setFocusable(false);
			overlayWindow.blur();
			if (mainWindow &&
				!mainWindow.isDestroyed() &&
				!mainWindow.isMinimized()
				) {
				mainWindow.focus();
			}
		}
	});

	ipcMain.on("start-twitch-auth", (_, data) => {
		const clientId = typeof data === "string" ? data : data?.clientId;
	
		console.log("start-twitch-auth data: ", data);
		console.log("resolved clientId: ", clientId);
	
		if (!clientId) {
			console.error("Missing Twitch client ID");
			return;
		}
	
		const authWindow = new BrowserWindow({
			width: 600,
			height: 800,
			parent: mainWindow!,
			modal: true,
			autoHideMenuBar: true,
		});
	
		authWindow.webContents.on("will-redirect", (event, url) => {
			if (url.startsWith("http://localhost/callback")) {
				event.preventDefault();
				handleTwitchCallback(url, authWindow);
			}
		});
		
		authWindow.webContents.on("will-navigate", (event, url) => {
			if (url.startsWith("http://localhost/callback")) {
				event.preventDefault();
				handleTwitchCallback(url, authWindow);
			}
		});
		
		authWindow.webContents.on(
			"did-fail-load",
			(_event, errorCode, errorDescription, validatedURL) => {
				console.log(
				"did-fail-load: ",
				errorCode,
				errorDescription,
				validatedURL
				);
			
				if (validatedURL.startsWith("http://localhost/callback")) {
					const handled = handleTwitchCallback(validatedURL, authWindow);
					if (handled) return;
				}
			}
		);
	
		authWindow.on("closed", () => {
			console.log("auth window closed");
		});
		
		const redirectUri = "http://localhost/callback";
		const scopes = encodeURIComponent("user: read: email chat: read chat: edit");
		const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scopes}`;
		
		console.log("Twitch auth URL: ", authUrl);
		
		authWindow.webContents.openDevTools();
		authWindow.loadURL(authUrl);
	});
});

app.on("window-all-closed", () => {
	app.quit();
});
