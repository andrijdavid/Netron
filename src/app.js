/*jshint esversion: 6 */

const electron = require('electron');
const updater = require('electron-updater');
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const url = require('url');

class Application {

    constructor() {
        this._views = new ViewCollection();
        this._openFileQueue = [];
        this._configuration = null;

        electron.app.setAppUserModelId('com.lutzroeder.netron');

        if (this.makeSingleInstance()) {
            electron.app.quit();
        }

        electron.ipcMain.on('open-file-dialog', (e, data) => {
            this.openFileDialog();
        });

        electron.ipcMain.on('drop-files', (e, data) => {
            this.dropFiles(e.sender, data.files);
        });

        electron.app.on('will-finish-launching', () => {
            electron.app.on('open-file', (e, path) => {
                this.openFile(path);
            });
        });

        electron.app.on('ready', () => {
            this.ready();
        });

        electron.app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                electron.app.quit();
            }
        });

        electron.app.on('will-quit', () => {
            this.saveConfiguration();
        });

        this._views.on('active-view-changed', (e) => {
            this.resetMenu();
        });

        this.parseCommandLine(process.argv);

        this.update();
    }

    makeSingleInstance() {
        return electron.app.makeSingleInstance((argv, workingDirectory) => { 
            var currentDirectory = process.cwd();
            process.chdir(workingDirectory);
            var open = this.parseCommandLine(argv);
            process.chdir(currentDirectory);
            if (!open) {
                if (this._views.count > 0) {
                    var view = this._views.item(0);
                    if (view) {
                        view.restore();
                    }
                }
            }
        });
    }

    parseCommandLine(argv) {
        var open = false;
        if (process.platform == 'win32' && argv.length > 1) {
            argv.slice(1).forEach((arg) => {
                if (!arg.startsWith('-')) {
                    var extension = arg.split('.').pop();
                    if (extension != '' && extension != 'js' && fs.existsSync(arg) && fs.statSync(arg).isFile()) {
                        this.openFile(arg);
                        open = true;
                    }
                }
            });
        }
        return open;
    }

    ready() {
        this.loadConfiguration();
        this.resetMenu();
        if (this._openFileQueue) {
            var openFileQueue = this._openFileQueue;
            this._openFileQueue = null;
            while (openFileQueue.length > 0) {
                var file = openFileQueue.shift();
                this.openFile(file);
            }
        }
        if (this._views.count == 0) {
            this._views.openView();
        }
    }

    openFileDialog() {
        var showOpenDialogOptions = { 
            properties: [ 'openFile' ], 
            filters: [
                { name: 'ONNX Model', extensions: [ 'onnx', 'pb' ] },
                { name: 'Keras Model', extension: [ 'json', 'keras', 'h5' ] },
                { name: 'CoreML Model', extension: [ 'mlmodel' ] },
                { name: 'Caffe Model', extension: [ 'caffemodel' ] },
                { name: 'Caffe2 Model', extension: [ 'pb' ] },
                { name: 'MXNet Model', extension: [ 'json' ] },
                { name: 'TensorFlow Graph', extensions: [ 'pb', 'meta' ] },
                { name: 'TensorFlow Saved Model', extensions: [ 'saved_model.pb' ] },
                { name: 'TensorFlow Lite Model', extensions: [ 'tflite' ] }
            ]
        };
        electron.dialog.showOpenDialog(showOpenDialogOptions, (selectedFiles) => {
            if (selectedFiles) {
                selectedFiles.forEach((selectedFile) => {
                    this.openFile(selectedFile);
                });
            }
        });
    }

    openFile(file) {
        if (this._openFileQueue) {
            this._openFileQueue.push(file);
            return;
        }
        if (file && file.length > 0 && fs.existsSync(file))
        {
            // find existing view for this file
            var view = this._views.find(file);
            // find empty welcome window
            if (view == null) {
                view = this._views.find(null);
            }
            // create new window
            if (view == null) {
                view = this._views.openView();
            }
            this.loadFile(file, view);
        }
    }

    loadFile(file, view) {
        this._configuration.recents = this._configuration.recents.filter(recent => file != recent.path);
        view.open(file);
        this._configuration.recents.unshift({ path: file });
        if (this._configuration.recents.length > 9) {
            this._configuration.recents.splice(9);
        }
        this.resetMenu();
    }

    dropFiles(sender, files) {
        var view = this._views.from(sender);
        files.forEach((file) => {
            if (view) {
                this.loadFile(file, view);
                view = null;
            }
            else {
                this.openFile(file);
            }
        });
    }

    copy() {
        var view = this._views.activeView;
        if (view) {
            view.send('copy', {});
        }
    }

    reload() {
        var view = this._views.activeView;
        if (view && view.path) {
            this.loadFile(view.path, view);
        }
    }

    find() {
        var view = this._views.activeView;
        if (view) {
            view.send('find', {});
        }
    }

    resetZoom() {
        var view = this._views.activeView;
        if (view) {
            view.send('reset-zoom', {});
        }
    }

    zoomIn() {
        var view = this._views.activeView;
        if (view) {
            view.send('zoom-in', {});
        }
    }

    zoomOut() {
        var view = this._views.activeView;
        if (view) {
            view.send('zoom-out', {});
        }
    }

    toggleDevTools() {
        if (this.isDev()) {
            var window = electron.BrowserWindow.getFocusedWindow();
            if (window) {
                window.toggleDevTools();
            }
        }
    }

    update() {
        if (!this.isDev()) {
            updater.autoUpdater.checkForUpdatesAndNotify();
        }
    }

    get package() { 
        if (!this._package) {
            var appPath = electron.app.getAppPath();
            var file = appPath + '/package.json'; 
            var data = fs.readFileSync(file);
            this._package = JSON.parse(data);
            this._package.date = new Date(fs.statSync(file).mtime);
        }
        return this._package;
    }

    about() {
        var owner = electron.BrowserWindow.getFocusedWindow();
        var author = this.package.author;
        var date = this.package.date;
        var details = [];
        details.push('Version ' + electron.app.getVersion());
        if (author && author.name && date) {
            details.push('');
            details.push('Copyright \u00A9 ' + date.getFullYear().toString() + ' ' + author.name);
        }
        var aboutDialogOptions = {
            icon: path.join(__dirname, 'icon.png'),
            title: ' ',
            message: electron.app.getName(),
            detail: details.join('\n')
        };
        electron.dialog.showMessageBox(owner, aboutDialogOptions);
    }

    isDev() {
        return ('ELECTRON_IS_DEV' in process.env) ?
            (parseInt(process.env.ELECTRON_IS_DEV, 10) === 1) :
            (process.defaultApp || /node_modules[\\/]electron[\\/]/.test(process.execPath));
    }

    loadConfiguration() {
        var dir = electron.app.getPath('userData');
        if (dir && dir.length > 0) {
            var file = path.join(dir, 'configuration.json'); 
            if (fs.existsSync(file)) {
                var data = fs.readFileSync(file);
                if (data) {
                    this._configuration = JSON.parse(data);
                }
            }
        }
        if (!this._configuration) {
            this._configuration = {
                'recents': []
            };
        }
    }

    saveConfiguration() {
        if (this._configuration) {
            var data = JSON.stringify(this._configuration);
            if (data) {
                var dir = electron.app.getPath('userData');
                if (dir && dir.length > 0) {
                    var file = path.join(dir, 'configuration.json'); 
                    fs.writeFileSync(file, data);          
                }
            }
        }
    }

    resetMenu() {

        var view = this._views.activeView;

        var menuRecentsTemplate = [];
        if (this._configuration && this._configuration.recents) {
            this._configuration.recents = this._configuration.recents.filter(recent => fs.existsSync(recent.path) && fs.statSync(recent.path).isFile());
            if (this._configuration.recents.length > 9) {
                this._configuration.recents.splice(9);
            }
            this._configuration.recents.forEach((recent, index) => {
                var file = recent.path;
                menuRecentsTemplate.push({
                    label: Application.minimizePath(recent.path),
                    accelerator: ((process.platform === 'darwin') ? 'Cmd+' : 'Ctrl+') + (index + 1).toString(),
                    click: () => { this.openFile(file); }
                });
            });
        }

        var menuTemplate = [];
        
        if (process.platform === 'darwin') {
            menuTemplate.unshift({
                label: electron.app.getName(),
                submenu: [
                    { role: "about" },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideothers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: "quit" }
                ]
            });
        }
        
        menuTemplate.push({
            label: '&File',
            submenu: [
                {
                    label: '&Open...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => { this.openFileDialog(); }
                },
                {
                    label: 'Open &Recent',
                    submenu: menuRecentsTemplate
                },
                { type: 'separator' },
                { role: 'close' },
            ]
        });
        
        if (process.platform !== 'darwin') {
            menuTemplate.slice(-1)[0].submenu.push(
                { type: 'separator' },
                { role: 'quit' }
            );
        }
        
        if (process.platform == 'darwin') {
            electron.systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
            electron.systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
        }

        menuTemplate.push({
            label: '&Edit',
            submenu: [
                { 
                    label: '&Copy',
                    accelerator: (process.platform === 'darwin') ? 'Cmd+C' : 'Ctrl+C',
                    click: () => this.copy(),
                    enabled: view && view.path ? true : false
                },
                { type: 'separator' },
                {
                    label: '&Find...',
                    accelerator: (process.platform === 'darwin') ? 'Cmd+F' : 'Ctrl+F',
                    click: () => this.find(),
                    enabled: view && view.path ? true : false
                }
            ]
        });
    
        var viewTemplate = {
            label: '&View',
            submenu: []
        };

        viewTemplate.submenu.push({
            label: '&Reload',
            accelerator: (process.platform === 'darwin') ? 'Cmd+R' : 'F5',
            click: () => this.reload(),
            enabled: view && view.path ? true : false
        });

        viewTemplate.submenu.push({ type: 'separator' });
        viewTemplate.submenu.push({
            label: 'Actual &Size',
            accelerator: (process.platform === 'darwin') ? '0' : '0',
            click: () => this.resetZoom(),
            enabled: view && view.path ? true : false
        });
        viewTemplate.submenu.push({
            label: 'Zoom &In',
            accelerator: (process.platform === 'darwin') ? '=' : '=',
            click: () => this.zoomIn(),
            enabled: view && view.path ? true : false
        });
        viewTemplate.submenu.push({
            label: 'Zoom &Out',
            accelerator: (process.platform === 'darwin') ? '-' : '-',
            click: () => this.zoomOut(),
            enabled: view && view.path ? true : false
        });

        if (this.isDev()) {
            viewTemplate.submenu.push({ type: 'separator' });
            viewTemplate.submenu.push({ role: 'toggledevtools' });
        }

        menuTemplate.push(viewTemplate);

        if (process.platform === 'darwin') {
            menuTemplate.push({
                role: 'window',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front'}
                ]
            });
        }    

        var helpSubmenu = [
            {
                label: '&Search Feature Requests',
                click: () => { electron.shell.openExternal('https://www.github.com/' + this.package.repository + '/issues'); }
            },
            {
                label: 'Report &Issues',
                click: () => { electron.shell.openExternal('https://www.github.com/' + this.package.repository + '/issues/new'); }
            }
        ];

        if (process.platform != 'darwin') {
            helpSubmenu.push({ type: 'separator' });
            helpSubmenu.push({
                role: 'about',
                click: () => this.about()
            });
        }

        menuTemplate.push({
            role: 'help',
            submenu: helpSubmenu
        });

        var menu = electron.Menu.buildFromTemplate(menuTemplate);
        electron.Menu.setApplicationMenu(menu);
    }

    static minimizePath(file) {
        if (process.platform != 'win32') {
            var home = os.homedir();
            if (file.startsWith(home))
            {
                return '~' + file.substring(home.length);
            }
        }
        return file;
    }

}

class View {

    constructor(owner) {
        this._owner = owner;
        this._ready = false;
        this._path = null;

        const size = electron.screen.getPrimaryDisplay().workAreaSize;
        var options = {};
        options.title = electron.app.getName(); 
        options.backgroundColor = '#eeeeee';
        options.icon = electron.nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
        options.minWidth = 600;
        options.minHeight = 400;
        options.width = size.width;
        options.height = size.height;
        if (options.width > 1024) {
            options.width = 1024;
        }
        if (options.height > 768) {
            options.height = 768;
        }
        if (this._owner.count > 0 && View._position && View._position.length == 2) {
            options.x = View._position[0] + 30;
            options.y = View._position[1] + 30;
            if (options.x + options.width > size.width) {
                options.x = 0;
            }
            if (options.y + options.height > size.height) {
                options.y = 0;
            }
        }
        this._window = new electron.BrowserWindow(options);
        View._position = this._window.getPosition();
        this._updateCallback = (e, data) => { 
            this.update(e, data); 
            this.raise('activated');
        };
        electron.ipcMain.on('update', this._updateCallback);
        this._window.on('closed', () => {
            electron.ipcMain.removeListener('update', this._updateCallback);
            this._owner.closeView(this);
        });
        this._window.on('focus', (e) => {
            this.raise('activated');
        });
        this._window.on('blur', (e) => {
            this.raise('deactivated');
        });
        this._window.webContents.on('dom-ready', () => {
            this._ready = true;
        });
        var location = url.format({
            pathname: path.join(__dirname, 'view-electron.html'),
            protocol: 'file:',
            slashes: true
        });
        this._window.loadURL(location);
    }

    open(file) {
        this._openPath = file;
        if (this._ready) {
            this._window.webContents.send("open", { file: file });
        }
        else {
            this._window.webContents.on('dom-ready', () => {
                this._window.webContents.send("open", { file: file });
            });
            var location = url.format({
                pathname: path.join(__dirname, 'view-electron.html'),
                protocol: 'file:',
                slashes: true
            });
            this._window.loadURL(location);
        }
    }

    restore() {
        if (this._window) { 
            if (this._window.isMinimized()) {
                this._window.restore();
            }
            this._window.show();
        }
    }

    update(e, data) {
        if (e.sender == this._window.webContents) {
            if (data && data.file) {
                this._path = data.file;
                var title = Application.minimizePath(this._path);
                if (process.platform !== 'darwin') {
                    title = title + ' - ' + electron.app.getName();
                }
                this._window.setTitle(title);
                this._window.focus();
            }
            this._openPath = null;
        } 
    }

    match(path) {
        if (this._openPath) {
            if (path == null) {
                return false;
            }
            if (path == this._openPath) {
                return true;
            }
        }
        return (this._path == path);
    }

    get path() {
        return this._path;
    }

    get window() {
        return this._window;
    }

    send(channel, data) {
        this._window.webContents.send(channel, data);
    }

    on(event, callback) {
        this._events = this._events || {};
        this._events[event] = this._events[event] || [];
        this._events[event].push(callback);
    }

    raise(event, data) {
        if (this._events && this._events[event]) {
            this._events[event].forEach((callback) => {
                callback(this, data);
            });
        }
    }
}

class ViewCollection {
    constructor() {
        this._views = [];
    }

    get count() {
        return this._views.length;
    }

    item(index) {
        return this._views[index];
    }

    openView() {
        var view = new View(this);
        view.on('activated', (sender) => {
            this._activeView = sender;
            this.raise('active-view-changed', { activeView: this._activeView });
        });
        view.on('deactivated', (sender) => {
            this._activeView = null;
            this.raise('active-view-changed', { activeView: this._activeView });
        });
        this._views.push(view);
        this.updateActiveView();
        return view;
    }

    closeView(view) {
        for (var i = this._views.length - 1; i >= 0; i--) {
            if (this._views[i] == view) {
                this._views.splice(i, 1);
            }
        }
        this.updateActiveView();
    }

    find(path) {
        return this._views.find(view => view.match(path));
    }

    from(contents) {
        return this._views.find(view => view && view.window && view.window.webContents && view.window.webContents == contents);
    }

    updateActiveView() {
        var window = electron.BrowserWindow.getFocusedWindow();
        var view = this._views.find(view => view.window == window) || null;
        if (view != this._activeView) {
            this._activeView = view;
            this.raise('active-view-changed', { activeView: this._activeView });        
        }
    }

    get activeView() {
        return this._activeView;
    }

    on(event, callback) {
        this._events = this._events || {};
        this._events[event] = this._events[event] || [];
        this._events[event].push(callback);
    }

    raise(event, data) {
        if (this._events && this._events[event]) {
            this._events[event].forEach((callback) => {
                callback(this, data);
            });
        }
    }
}

var application = new Application();
