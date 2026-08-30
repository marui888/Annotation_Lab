import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol } from "electron";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
//#region src/main/main.js
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var require = createRequire(import.meta.url);
var mainWindow = null;
var schemaEditorWindow = null;
var DEFAULT_SETTINGS = { frameTimestampToleranceSeconds: .1 };
protocol.registerSchemesAsPrivileged([{
	scheme: "lab-file",
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		corsEnabled: true
	}
}]);
function toLabFileUrl(filePath) {
	return `lab-file://local/${encodeURIComponent(filePath)}`;
}
function getAnnotationFilePath(sourceFilePath) {
	return `${sourceFilePath}.annotation.json`;
}
function getSettingsFilePath() {
	return path.join(process.cwd(), "lab-settings.json");
}
function normalizeSettings(settings = {}) {
	const tolerance = Number(settings.frameTimestampToleranceSeconds);
	return {
		...DEFAULT_SETTINGS,
		...settings,
		frameTimestampToleranceSeconds: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_SETTINGS.frameTimestampToleranceSeconds
	};
}
async function readSettings() {
	try {
		const text = await fs.readFile(getSettingsFilePath(), "utf8");
		return normalizeSettings(JSON.parse(text));
	} catch {
		return normalizeSettings();
	}
}
async function writeSettings(settings) {
	const nextSettings = normalizeSettings(settings);
	await fs.writeFile(getSettingsFilePath(), `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
	return nextSettings;
}
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([
	".jpg",
	".jpeg",
	".png",
	".bmp",
	".gif",
	".webp"
]);
var VIDEO_EXTENSIONS = /* @__PURE__ */ new Set([
	".mp4",
	".webm",
	".mov",
	".m4v",
	".mkv"
]);
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".txt", ".md"]);
function sanitizeFileNamePart(value, fallback = "untitled") {
	return (String(value || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || fallback).slice(0, 80);
}
function createExportFileName(task) {
	return `${String((task.index || 0) + 1).padStart(3, "0")}_${sanitizeFileNamePart(task.role || "role", "role")}_${sanitizeFileNamePart(task.type || "a", "a")}_${sanitizeFileNamePart(task.annotationId || "unknown", "unknown")}.${task.type === "text" ? "txt" : "png"}`;
}
function clampCropToMetadata(crop, metadata) {
	const imageWidth = metadata.width || 1;
	const imageHeight = metadata.height || 1;
	const left = Math.max(0, Math.min(Math.floor(crop.left || 0), imageWidth - 1));
	const top = Math.max(0, Math.min(Math.floor(crop.top || 0), imageHeight - 1));
	return {
		left,
		top,
		width: Math.max(1, Math.min(Math.floor(crop.width || 1), imageWidth - left)),
		height: Math.max(1, Math.min(Math.floor(crop.height || 1), imageHeight - top))
	};
}
function getSourceFilePathFromAnnotation(annotationFilePath) {
	return annotationFilePath.endsWith(".annotation.json") ? annotationFilePath.slice(0, -16) : "";
}
function isCDocumentFilePath(filePath) {
	return String(filePath || "").toLowerCase().endsWith(".composite.json");
}
function getReferenceFileFilter(fileKind) {
	if (fileKind === "b-ref") return {
		name: "Annotation JSON",
		extensions: ["annotation.json"]
	};
	if (fileKind === "image-ref") return {
		name: "Images",
		extensions: [
			"jpg",
			"jpeg",
			"png",
			"bmp",
			"gif",
			"webp"
		]
	};
	if (fileKind === "text-ref") return {
		name: "Text",
		extensions: ["txt", "md"]
	};
	if (fileKind === "c-ref") return {
		name: "Composite Document",
		extensions: ["composite.json"]
	};
	if (fileKind === "video-ref") return {
		name: "Video",
		extensions: [
			"mp4",
			"webm",
			"mov",
			"m4v",
			"mkv"
		]
	};
	return null;
}
function isReferenceFilePath(filePath, fileKind) {
	const fileName = path.basename(filePath).toLowerCase();
	const ext = path.extname(fileName);
	if (fileKind === "b-ref") return fileName.endsWith(".annotation.json");
	if (fileKind === "c-ref") return fileName.endsWith(".composite.json");
	if (fileKind === "image-ref") return IMAGE_EXTENSIONS.has(ext);
	if (fileKind === "text-ref") return TEXT_EXTENSIONS.has(ext);
	if (fileKind === "video-ref") return VIDEO_EXTENSIONS.has(ext);
	return true;
}
async function collectReferenceFiles(folderPath, fileKind) {
	const entries = await fs.readdir(folderPath, { withFileTypes: true });
	const files = [];
	await Promise.all(entries.map(async (entry) => {
		const entryPath = path.join(folderPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectReferenceFiles(entryPath, fileKind));
			return;
		}
		if (entry.isFile() && isReferenceFilePath(entryPath, fileKind)) files.push(entryPath);
	}));
	return files.sort((left, right) => left.localeCompare(right, void 0, {
		numeric: true,
		sensitivity: "base"
	}));
}
function toCompositeDocumentFilePath(filePath) {
	const text = String(filePath || "");
	if (isCDocumentFilePath(text)) return text;
	if (text.toLowerCase().endsWith(".json")) return `${text.slice(0, -5)}.composite.json`;
	return `${text}.composite.json`;
}
async function listImagesInFolder(folderPath) {
	return (await fs.readdir(folderPath, { withFileTypes: true })).filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).map((entry) => ({
		filePath: path.join(folderPath, entry.name),
		fileName: entry.name
	})).sort((left, right) => left.fileName.localeCompare(right.fileName, void 0, {
		numeric: true,
		sensitivity: "base"
	}));
}
async function getImagePayload(filePath) {
	const stat = await fs.stat(filePath);
	const folderPath = path.dirname(filePath);
	let width = null;
	let height = null;
	try {
		const metadata = await require("sharp")(filePath).metadata();
		width = metadata.width || null;
		height = metadata.height || null;
	} catch {}
	return {
		ok: true,
		filePath,
		fileName: path.basename(filePath),
		folderPath,
		folderImages: await listImagesInFolder(folderPath),
		fileUrl: toLabFileUrl(filePath),
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		width,
		height
	};
}
async function getVideoPayload(filePath) {
	const stat = await fs.stat(filePath);
	const folderPath = path.dirname(filePath);
	return {
		ok: true,
		filePath,
		fileName: path.basename(filePath),
		folderPath,
		fileUrl: pathToFileURL(filePath).toString(),
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		duration: null,
		width: null,
		height: null
	};
}
async function loadAnnotationFile(annotationFilePath) {
	const text = await fs.readFile(annotationFilePath, "utf8");
	const data = JSON.parse(text);
	const rawSourceFilePath = data.sources?.[0]?.filePath || getSourceFilePathFromAnnotation(annotationFilePath);
	if (!rawSourceFilePath) return {
		ok: false,
		annotationFilePath,
		reason: "source-file-not-found-in-annotation"
	};
	const sourceFilePath = rawSourceFilePath && path.isAbsolute(rawSourceFilePath) ? rawSourceFilePath : path.resolve(path.dirname(annotationFilePath), rawSourceFilePath || "");
	const sourceKind = data.sources?.[0]?.kind || "";
	const sourceExt = path.extname(sourceFilePath).toLowerCase();
	const mediaPayload = sourceKind === "video" || VIDEO_EXTENSIONS.has(sourceExt) ? await getVideoPayload(sourceFilePath) : await getImagePayload(sourceFilePath);
	return {
		ok: true,
		annotationFilePath,
		sourceFilePath,
		image: mediaPayload,
		media: mediaPayload,
		data
	};
}
async function collectAnnotationFiles(folderPath) {
	const entries = await fs.readdir(folderPath, { withFileTypes: true });
	const files = [];
	await Promise.all(entries.map(async (entry) => {
		const entryPath = path.join(folderPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectAnnotationFiles(entryPath));
			return;
		}
		if (entry.isFile() && entry.name.endsWith(".annotation.json")) files.push(entryPath);
	}));
	return files;
}
async function readBEntityIndexItem(dataFilePath) {
	const text = await fs.readFile(dataFilePath, "utf8");
	const data = JSON.parse(text);
	const sourceFilePath = data.sources?.[0]?.filePath || getSourceFilePathFromAnnotation(dataFilePath);
	return (Array.isArray(data.entities) ? data.entities : []).map((entity) => {
		const refs = Array.isArray(entity.aObjectRefs) ? entity.aObjectRefs : (entity.aObjectIds || []).map((aObjectId) => ({
			aObjectId,
			role: entity.kind
		}));
		return {
			dataFilePath,
			sourceFilePath,
			entityId: entity.id,
			subject: entity.subject,
			kind: entity.kind,
			subKind: entity.subKind || "",
			label: entity.label,
			status: entity.status || "",
			featureValues: entity.featureValues || {},
			createdAt: entity.createdAt || "",
			updatedAt: entity.updatedAt || "",
			aObjectCount: refs.length,
			aObjectRefs: refs
		};
	});
}
async function readBEntityIndexItemsFromFiles(filePaths) {
	return (await Promise.all(filePaths.map(async (filePath) => {
		try {
			return await readBEntityIndexItem(filePath);
		} catch {
			return [];
		}
	}))).flat();
}
function fromLabFileUrl(url) {
	const parsedUrl = new URL(url);
	return decodeURIComponent(parsedUrl.pathname.slice(1));
}
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		backgroundColor: "#181818",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: false
		}
	});
	mainWindow.maximize();
	mainWindow.loadURL("http://localhost:5173");
}
function loadRendererWindow(window, hash = "") {
	window.loadURL(`http://localhost:5173${hash}`);
}
function createSchemaEditorWindow() {
	if (schemaEditorWindow && !schemaEditorWindow.isDestroyed()) {
		schemaEditorWindow.focus();
		return;
	}
	const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
	schemaEditorWindow = new BrowserWindow({
		parent: parentWindow || void 0,
		modal: Boolean(parentWindow),
		width: 1180,
		height: 760,
		minWidth: 960,
		minHeight: 620,
		backgroundColor: "#181818",
		title: "Subject Schema Editor",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: false
		}
	});
	schemaEditorWindow.on("closed", () => {
		schemaEditorWindow = null;
	});
	loadRendererWindow(schemaEditorWindow, "#/schema-editor");
}
function getSchemaFolderPath() {
	return path.join(process.cwd(), "schemas");
}
function isSubjectSchemaFilePath(filePath) {
	return String(filePath || "").toLowerCase().endsWith(".subject-schema.json");
}
function toSubjectSchemaFilePath(filePath) {
	const text = String(filePath || "");
	if (isSubjectSchemaFilePath(text)) return text;
	if (text.toLowerCase().endsWith(".json")) return `${text.slice(0, -5)}.subject-schema.json`;
	return `${text}.subject-schema.json`;
}
function buildAppMenu() {
	Menu.setApplicationMenu(Menu.buildFromTemplate([
		{
			label: "File",
			submenu: [{ role: "quit" }]
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" }
			]
		},
		{
			label: "Tools",
			submenu: [
				{
					label: "Settings...",
					click: () => mainWindow?.webContents.send("settings:open")
				},
				{ type: "separator" },
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{
					label: "Subject Schema Editor...",
					click: () => createSchemaEditorWindow()
				}
			]
		}
	]));
}
app.whenReady().then(() => {
	protocol.handle("lab-file", (request) => {
		const filePath = fromLabFileUrl(request.url);
		return net.fetch(pathToFileURL(filePath).toString());
	});
	ipcMain.handle("settings:read", async () => ({
		ok: true,
		settings: await readSettings(),
		filePath: getSettingsFilePath()
	}));
	ipcMain.handle("settings:save", async (_event, settings) => ({
		ok: true,
		settings: await writeSettings(settings),
		filePath: getSettingsFilePath()
	}));
	ipcMain.handle("file:openImage", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Open image",
			properties: ["openFile"],
			filters: [{
				name: "Images",
				extensions: [
					"jpg",
					"jpeg",
					"png",
					"bmp",
					"gif",
					"webp"
				]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		return getImagePayload(result.filePaths[0]);
	});
	ipcMain.handle("file:openVideo", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Open video",
			properties: ["openFile"],
			filters: [{
				name: "Videos",
				extensions: [
					"mp4",
					"webm",
					"mov",
					"m4v",
					"mkv"
				]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		return getVideoPayload(result.filePaths[0]);
	});
	ipcMain.handle("annotation:openFile", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Open Annotation JSON",
			properties: ["openFile"],
			filters: [{
				name: "Annotation JSON",
				extensions: ["json"]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		try {
			return await loadAnnotationFile(result.filePaths[0]);
		} catch (error) {
			return {
				ok: false,
				annotationFilePath: result.filePaths[0],
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("annotation:loadFileByPath", async (_event, annotationFilePath) => {
		if (!annotationFilePath) return {
			ok: false,
			reason: "annotation-file-empty"
		};
		try {
			return await loadAnnotationFile(annotationFilePath);
		} catch (error) {
			return {
				ok: false,
				annotationFilePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("file:loadImageByPath", async (_event, filePath) => {
		if (!filePath) return {
			ok: false,
			reason: "file-path-empty"
		};
		try {
			return await getImagePayload(filePath);
		} catch (error) {
			return {
				ok: false,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("annotation:load", async (_event, sourceFilePath) => {
		if (!sourceFilePath) return {
			ok: false,
			reason: "source-file-empty"
		};
		const annotationFilePath = getAnnotationFilePath(sourceFilePath);
		try {
			const text = await fs.readFile(annotationFilePath, "utf8");
			return {
				ok: true,
				annotationFilePath,
				data: JSON.parse(text)
			};
		} catch (error) {
			if (error.code === "ENOENT") return {
				ok: true,
				annotationFilePath,
				data: null,
				missing: true
			};
			return {
				ok: false,
				annotationFilePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("annotation:save", async (_event, payload) => {
		const sourceFilePath = payload?.sourceFilePath;
		const data = payload?.data;
		if (!sourceFilePath || !data) return {
			ok: false,
			reason: "invalid-payload"
		};
		const annotationFilePath = payload?.annotationFilePath || getAnnotationFilePath(sourceFilePath);
		await fs.writeFile(annotationFilePath, JSON.stringify(data, null, 2), "utf8");
		return {
			ok: true,
			annotationFilePath
		};
	});
	ipcMain.handle("annotation:readRawByPath", async (_event, annotationFilePath) => {
		if (!annotationFilePath) return {
			ok: false,
			reason: "annotation-file-path-empty"
		};
		try {
			const text = await fs.readFile(annotationFilePath, "utf8");
			return {
				ok: true,
				annotationFilePath,
				data: JSON.parse(text)
			};
		} catch (error) {
			return {
				ok: false,
				annotationFilePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("annotation:saveRawByPath", async (_event, payload) => {
		const annotationFilePath = payload?.annotationFilePath;
		const data = payload?.data;
		if (!annotationFilePath || !data) return {
			ok: false,
			reason: "invalid-payload"
		};
		await fs.writeFile(annotationFilePath, JSON.stringify(data, null, 2), "utf8");
		return {
			ok: true,
			annotationFilePath
		};
	});
	ipcMain.handle("export:chooseFolder", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose export folder",
			properties: ["openDirectory", "createDirectory"]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		return {
			ok: true,
			folderPath: result.filePaths[0]
		};
	});
	ipcMain.handle("export:annotationCrops", async (_event, payload) => {
		let targetFolder = "";
		try {
			const sourceFilePath = payload?.sourceFilePath;
			const outputFolder = payload?.outputFolder;
			const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
			if (!sourceFilePath || !outputFolder || tasks.length === 0) return {
				ok: false,
				reason: "invalid-payload"
			};
			const entity = payload?.entity || null;
			targetFolder = entity?.id ? path.join(outputFolder, `${sanitizeFileNamePart(entity.label, "entity")}_${sanitizeFileNamePart(entity.id, "id")}`) : outputFolder;
			await fs.mkdir(targetFolder, { recursive: true });
			const sharp = require("sharp");
			const metadata = await sharp(sourceFilePath).metadata();
			const exported = [];
			for (const task of tasks) {
				const fileName = createExportFileName(task);
				const outputPath = path.join(targetFolder, fileName);
				try {
					if (task.type === "text") await fs.writeFile(outputPath, task.text || "", "utf8");
					else {
						if (!task.crop) {
							exported.push({
								ok: false,
								annotationId: task.annotationId,
								reason: "missing-crop"
							});
							continue;
						}
						const crop = clampCropToMetadata(task.crop, metadata);
						await sharp(sourceFilePath).extract(crop).png().toFile(outputPath);
					}
					exported.push({
						ok: true,
						annotationId: task.annotationId,
						filePath: outputPath
					});
				} catch (error) {
					exported.push({
						ok: false,
						annotationId: task.annotationId,
						reason: error.message || String(error)
					});
				}
			}
			const failed = exported.filter((item) => !item.ok);
			if (failed.length) {
				const errorText = failed.map((item) => `${item.annotationId || "unknown"}: ${item.reason || "unknown error"}`).join("\n");
				await fs.writeFile(path.join(targetFolder, "_export_errors.txt"), errorText, "utf8");
			}
			await fs.writeFile(path.join(targetFolder, "_export_manifest.json"), JSON.stringify({
				schemaVersion: 1,
				sourceFilePath,
				entity: entity ? {
					id: entity.id || "",
					label: entity.label || ""
				} : null,
				exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
				items: exported.map((item, index) => ({
					index,
					annotationId: item.annotationId || "",
					role: tasks[index]?.role || "",
					type: tasks[index]?.type || "",
					ok: item.ok,
					filePath: item.filePath || "",
					reason: item.reason || ""
				}))
			}, null, 2), "utf8");
			return {
				ok: exported.some((item) => item.ok),
				folderPath: targetFolder,
				exported,
				reason: failed.length === exported.length ? "all-export-tasks-failed" : ""
			};
		} catch (error) {
			if (targetFolder) try {
				await fs.writeFile(path.join(targetFolder, "_export_errors.txt"), error.message || String(error), "utf8");
			} catch {}
			return {
				ok: false,
				folderPath: targetFolder,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("cDocument:newPath", async (_event, title) => {
		const result = await dialog.showSaveDialog(mainWindow, {
			title: "Save Composite Document",
			defaultPath: `${title || "Untitled"}.composite.json`,
			filters: [{
				name: "Composite Document",
				extensions: ["composite.json"]
			}, {
				name: "JSON",
				extensions: ["json"]
			}]
		});
		if (result.canceled || !result.filePath) return {
			ok: false,
			canceled: true
		};
		return {
			ok: true,
			filePath: toCompositeDocumentFilePath(result.filePath)
		};
	});
	ipcMain.handle("cDocument:open", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Open Composite Document",
			properties: ["openFile"],
			filters: [{
				name: "Composite Document",
				extensions: ["composite.json"]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		try {
			const filePath = result.filePaths[0];
			if (!isCDocumentFilePath(filePath)) return {
				ok: false,
				filePath,
				reason: "not-c-document-file"
			};
			const text = await fs.readFile(filePath, "utf8");
			return {
				ok: true,
				filePath,
				data: JSON.parse(text)
			};
		} catch (error) {
			return {
				ok: false,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("cDocument:readFileByPath", async (_event, filePath) => {
		if (!filePath || !isCDocumentFilePath(filePath)) return {
			ok: false,
			filePath,
			reason: "not-c-document-file"
		};
		try {
			const text = await fs.readFile(filePath, "utf8");
			return {
				ok: true,
				filePath,
				data: JSON.parse(text)
			};
		} catch (error) {
			return {
				ok: false,
				filePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("cDocument:save", async (_event, payload) => {
		const filePath = payload?.filePath;
		const data = payload?.data;
		if (!filePath || !data) return {
			ok: false,
			reason: "invalid-payload"
		};
		if (!isCDocumentFilePath(filePath)) return {
			ok: false,
			filePath,
			reason: "not-composite-document-file"
		};
		await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
		return {
			ok: true,
			filePath
		};
	});
	ipcMain.handle("file:existsMany", async (_event, filePaths) => {
		if (!Array.isArray(filePaths)) return {
			ok: false,
			reason: "invalid-file-path-list"
		};
		const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
		const entries = await Promise.all(uniquePaths.map(async (filePath) => {
			try {
				await fs.access(filePath);
				return [filePath, true];
			} catch {
				return [filePath, false];
			}
		}));
		return {
			ok: true,
			existsByPath: Object.fromEntries(entries)
		};
	});
	ipcMain.handle("file:selectFolder", async (_event, title) => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: title || "Choose folder",
			properties: ["openDirectory"]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		return {
			ok: true,
			folderPath: result.filePaths[0]
		};
	});
	ipcMain.handle("file:selectFileForReference", async (_event, payload) => {
		const fileKind = payload?.fileKind || "all";
		const filters = [];
		const filter = getReferenceFileFilter(fileKind);
		if (filter) filters.push(filter);
		filters.push({
			name: "All Files",
			extensions: ["*"]
		});
		const result = await dialog.showOpenDialog(mainWindow, {
			title: payload?.title || "Choose replacement file",
			properties: payload?.multiSelections ? ["openFile", "multiSelections"] : ["openFile"],
			filters
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		const files = result.filePaths.map((filePath) => ({
			filePath,
			fileName: path.basename(filePath)
		}));
		return {
			ok: true,
			filePath: files[0].filePath,
			fileName: files[0].fileName,
			files
		};
	});
	ipcMain.handle("file:selectReferenceFolder", async (_event, payload) => {
		const fileKind = payload?.fileKind || "all";
		const result = await dialog.showOpenDialog(mainWindow, {
			title: payload?.title || "Choose source folder",
			properties: ["openDirectory", "multiSelections"]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		try {
			const files = (await Promise.all(result.filePaths.map((folderPath) => collectReferenceFiles(folderPath, fileKind)))).flat().map((filePath) => ({
				filePath,
				fileName: path.basename(filePath)
			}));
			return {
				ok: true,
				folderPath: result.filePaths[0],
				folderPaths: result.filePaths,
				files
			};
		} catch (error) {
			return {
				ok: false,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("index:scanFolder", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Scan folder for annotation data",
			properties: ["openDirectory", "multiSelections"]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		const folderPaths = result.filePaths;
		try {
			const annotationFiles = (await Promise.all(folderPaths.map((folderPath) => collectAnnotationFiles(folderPath)))).flat();
			return {
				ok: true,
				folderPath: folderPaths[0],
				folderPaths,
				annotationFiles,
				items: await readBEntityIndexItemsFromFiles(annotationFiles)
			};
		} catch (error) {
			return {
				ok: false,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("index:scanAnnotationFiles", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose annotation data files",
			properties: ["openFile", "multiSelections"],
			filters: [{
				name: "Annotation JSON",
				extensions: ["annotation.json"]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		try {
			return {
				ok: true,
				annotationFiles: result.filePaths,
				items: await readBEntityIndexItemsFromFiles(result.filePaths)
			};
		} catch (error) {
			return {
				ok: false,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("file:openExternalRef", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Add external file",
			properties: ["openFile"],
			filters: [{
				name: "Text or Images",
				extensions: [
					"txt",
					"md",
					"jpg",
					"jpeg",
					"png",
					"bmp",
					"gif",
					"webp"
				]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		const filePath = result.filePaths[0];
		const ext = path.extname(filePath).toLowerCase();
		const imageExts = /* @__PURE__ */ new Set([
			".jpg",
			".jpeg",
			".png",
			".bmp",
			".gif",
			".webp"
		]);
		return {
			ok: true,
			filePath,
			fileName: path.basename(filePath),
			fileKind: imageExts.has(ext) ? "image" : "text"
		};
	});
	ipcMain.handle("file:readTextByPath", async (_event, filePath) => {
		if (!filePath) return {
			ok: false,
			reason: "file-path-empty"
		};
		try {
			return {
				ok: true,
				filePath,
				text: await fs.readFile(filePath, "utf8")
			};
		} catch (error) {
			return {
				ok: false,
				filePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("file:openCRef", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Add Composite Document",
			properties: ["openFile"],
			filters: [{
				name: "Composite Document",
				extensions: ["composite.json"]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		const filePath = result.filePaths[0];
		if (!isCDocumentFilePath(filePath)) return {
			ok: false,
			filePath,
			reason: "not-c-document-file"
		};
		return {
			ok: true,
			filePath,
			fileName: path.basename(filePath)
		};
	});
	ipcMain.handle("schema:list", async () => {
		const folderPath = getSchemaFolderPath();
		try {
			await fs.mkdir(folderPath, { recursive: true });
			return {
				ok: true,
				folderPath,
				files: (await fs.readdir(folderPath, { withFileTypes: true })).filter((entry) => entry.isFile() && isSubjectSchemaFilePath(entry.name)).map((entry) => ({
					filePath: path.join(folderPath, entry.name),
					fileName: entry.name
				})).sort((left, right) => left.fileName.localeCompare(right.fileName, void 0, {
					numeric: true,
					sensitivity: "base"
				}))
			};
		} catch (error) {
			return {
				ok: false,
				folderPath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("schema:open", async () => {
		const result = await dialog.showOpenDialog(schemaEditorWindow || mainWindow, {
			title: "Open Subject Schema",
			properties: ["openFile"],
			filters: [{
				name: "Subject Schema",
				extensions: ["subject-schema.json"]
			}, {
				name: "JSON",
				extensions: ["json"]
			}]
		});
		if (result.canceled || result.filePaths.length === 0) return {
			ok: false,
			canceled: true
		};
		return readSubjectSchemaFile(result.filePaths[0]);
	});
	async function readSubjectSchemaFile(filePath) {
		try {
			const text = await fs.readFile(filePath, "utf8");
			return {
				ok: true,
				filePath,
				fileName: path.basename(filePath),
				data: JSON.parse(text)
			};
		} catch (error) {
			return {
				ok: false,
				filePath,
				reason: error.message || String(error)
			};
		}
	}
	ipcMain.handle("schema:readFile", async (_event, filePath) => readSubjectSchemaFile(filePath));
	async function getUniqueSubjectSchemaCopyTarget(subjectId) {
		const folderPath = getSchemaFolderPath();
		const baseName = sanitizeFileNamePart(subjectId || "subject-copy", "subject-copy");
		let index = 0;
		while (index < 1e3) {
			const suffix = index === 0 ? "" : String(index + 1);
			const nextSubjectId = `${subjectId}${suffix}`;
			const filePath = path.join(folderPath, `${baseName}${suffix}.subject-schema.json`);
			try {
				await fs.access(filePath);
				index += 1;
			} catch {
				return {
					subjectId: nextSubjectId,
					filePath
				};
			}
		}
		const timestamp = Date.now();
		return {
			subjectId: `${subjectId}_${timestamp}`,
			filePath: path.join(folderPath, `${baseName}-${timestamp}.subject-schema.json`)
		};
	}
	ipcMain.handle("schema:copy", async (_event, sourceFilePath) => {
		if (!sourceFilePath || !isSubjectSchemaFilePath(sourceFilePath)) return {
			ok: false,
			reason: "schema-source-file-invalid"
		};
		const readResult = await readSubjectSchemaFile(sourceFilePath);
		if (!readResult.ok) return readResult;
		const sourceData = readResult.data || {};
		const sourceSubjectId = sourceData.subjectId || sourceData.id || path.basename(sourceFilePath, ".subject-schema.json");
		const copyTarget = await getUniqueSubjectSchemaCopyTarget(`${sourceSubjectId}_copy`);
		const copiedData = {
			...sourceData,
			subjectId: copyTarget.subjectId,
			label: `${sourceData.label || sourceSubjectId} Copy`,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		try {
			await fs.mkdir(getSchemaFolderPath(), { recursive: true });
			const filePath = copyTarget.filePath;
			await fs.writeFile(filePath, JSON.stringify(copiedData, null, 2), "utf8");
			return {
				ok: true,
				filePath,
				fileName: path.basename(filePath),
				data: copiedData
			};
		} catch (error) {
			return {
				ok: false,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("schema:delete", async (_event, filePath) => {
		if (!filePath || !isSubjectSchemaFilePath(filePath)) return {
			ok: false,
			reason: "schema-file-path-invalid"
		};
		try {
			await fs.unlink(filePath);
			return {
				ok: true,
				filePath,
				fileName: path.basename(filePath)
			};
		} catch (error) {
			return {
				ok: false,
				filePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("schema:save", async (_event, payload) => {
		const filePath = payload?.filePath;
		const data = payload?.data;
		if (!filePath) return {
			ok: false,
			reason: "schema-file-path-empty"
		};
		if (!data || typeof data !== "object") return {
			ok: false,
			reason: "schema-data-invalid"
		};
		try {
			await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
			return {
				ok: true,
				filePath,
				fileName: path.basename(filePath)
			};
		} catch (error) {
			return {
				ok: false,
				filePath,
				reason: error.message || String(error)
			};
		}
	});
	ipcMain.handle("schema:saveAs", async (_event, payload) => {
		const data = payload?.data;
		if (!data || typeof data !== "object") return {
			ok: false,
			reason: "schema-data-invalid"
		};
		const suggestedName = sanitizeFileNamePart(payload?.suggestedName || data.subjectId || "subject", "subject");
		const result = await dialog.showSaveDialog(schemaEditorWindow || mainWindow, {
			title: "Save Subject Schema",
			defaultPath: path.join(getSchemaFolderPath(), `${suggestedName}.subject-schema.json`),
			filters: [{
				name: "Subject Schema",
				extensions: ["subject-schema.json"]
			}, {
				name: "JSON",
				extensions: ["json"]
			}]
		});
		if (result.canceled || !result.filePath) return {
			ok: false,
			canceled: true
		};
		const filePath = toSubjectSchemaFilePath(result.filePath);
		try {
			await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
			return {
				ok: true,
				filePath,
				fileName: path.basename(filePath)
			};
		} catch (error) {
			return {
				ok: false,
				filePath,
				reason: error.message || String(error)
			};
		}
	});
	buildAppMenu();
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
