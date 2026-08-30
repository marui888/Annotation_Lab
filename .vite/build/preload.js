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
	selectReferenceFolder: (payload) => electron.ipcRenderer.invoke("file:selectReferenceFolder", payload),
	scanAnnotationFolder: () => electron.ipcRenderer.invoke("index:scanFolder"),
	scanAnnotationFiles: () => electron.ipcRenderer.invoke("index:scanAnnotationFiles"),
	openExternalRef: () => electron.ipcRenderer.invoke("file:openExternalRef"),
	readTextFile: (filePath) => electron.ipcRenderer.invoke("file:readTextByPath", filePath),
	openCRef: () => electron.ipcRenderer.invoke("file:openCRef"),
	chooseExportFolder: () => electron.ipcRenderer.invoke("export:chooseFolder"),
	exportAnnotationCrops: (payload) => electron.ipcRenderer.invoke("export:annotationCrops", payload),
	listSubjectSchemas: () => electron.ipcRenderer.invoke("schema:list"),
	openSubjectSchema: () => electron.ipcRenderer.invoke("schema:open"),
	readSubjectSchemaFile: (filePath) => electron.ipcRenderer.invoke("schema:readFile", filePath),
	copySubjectSchema: (filePath) => electron.ipcRenderer.invoke("schema:copy", filePath),
	deleteSubjectSchema: (filePath) => electron.ipcRenderer.invoke("schema:delete", filePath),
	saveSubjectSchema: (payload) => electron.ipcRenderer.invoke("schema:save", payload),
	saveSubjectSchemaAs: (payload) => electron.ipcRenderer.invoke("schema:saveAs", payload),
	readSettings: () => electron.ipcRenderer.invoke("settings:read"),
	saveSettings: (settings) => electron.ipcRenderer.invoke("settings:save", settings),
	onOpenSettings: (callback) => {
		const listener = () => callback?.();
		electron.ipcRenderer.on("settings:open", listener);
		return () => electron.ipcRenderer.removeListener("settings:open", listener);
	}
});
//#endregion
