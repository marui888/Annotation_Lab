let electron = require("electron");
//#region src/preload/preload.js
electron.contextBridge.exposeInMainWorld("labApi", {
	openImage: () => electron.ipcRenderer.invoke("file:openImage"),
	openVideo: () => electron.ipcRenderer.invoke("file:openVideo"),
	loadImageByPath: (filePath) => electron.ipcRenderer.invoke("file:loadImageByPath", filePath),
	openAnnotationFile: () => electron.ipcRenderer.invoke("annotation:openFile"),
	readAnnotationFileRaw: (annotationFilePath) => electron.ipcRenderer.invoke("annotation:readRawByPath", annotationFilePath),
	loadAnnotationFileByPath: (annotationFilePath) => electron.ipcRenderer.invoke("annotation:loadFileByPath", annotationFilePath),
	saveAnnotationFileRaw: (payload) => electron.ipcRenderer.invoke("annotation:saveRawByPath", payload),
	loadAnnotations: (sourceFilePath) => electron.ipcRenderer.invoke("annotation:load", sourceFilePath),
	saveAnnotations: (payload) => electron.ipcRenderer.invoke("annotation:save", payload),
	chooseCDocumentPath: (title) => electron.ipcRenderer.invoke("cDocument:newPath", title),
	openCDocument: () => electron.ipcRenderer.invoke("cDocument:open"),
	readCDocumentFile: (filePath) => electron.ipcRenderer.invoke("cDocument:readFileByPath", filePath),
	saveCDocument: (payload) => electron.ipcRenderer.invoke("cDocument:save", payload),
	existsMany: (filePaths) => electron.ipcRenderer.invoke("file:existsMany", filePaths),
	selectFolder: (title) => electron.ipcRenderer.invoke("file:selectFolder", title),
	selectFileForReference: (payload) => electron.ipcRenderer.invoke("file:selectFileForReference", payload),
	scanAnnotationFolder: () => electron.ipcRenderer.invoke("index:scanFolder"),
	scanAnnotationFiles: () => electron.ipcRenderer.invoke("index:scanAnnotationFiles"),
	openExternalRef: () => electron.ipcRenderer.invoke("file:openExternalRef"),
	readTextFile: (filePath) => electron.ipcRenderer.invoke("file:readTextByPath", filePath),
	openCRef: () => electron.ipcRenderer.invoke("file:openCRef"),
	chooseExportFolder: () => electron.ipcRenderer.invoke("export:chooseFolder"),
	exportAnnotationCrops: (payload) => electron.ipcRenderer.invoke("export:annotationCrops", payload)
});
//#endregion
