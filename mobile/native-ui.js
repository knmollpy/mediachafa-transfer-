let nativeShell = null;
let nativeActiveView = 'files';
let nativeSearch = '';
let nativePs4Folder = 'all';

function initializeNativeUI() {
  if (!isNativeApp) return;
  document.documentElement.classList.add('native-app');
  document.body.classList.add('native-app');
  nativeShell = document.createElement('section');
  nativeShell.id = 'native-shell';
  nativeShell.hidden = true;
  nativeShell.innerHTML = `
    <header class="native-head">
      <div class="native-brand-row">
        <img class="native-brand-icon" src="/icons/app.svg" alt="">
        <div class="native-brand-copy"><div class="native-kicker">Tu universo digital</div><div class="native-brand-name">MediaChafa</div></div>
        <div class="native-sync" id="native-sync-status">Conectando…</div>
        <button class="native-logout" id="native-logout" type="button">Cerrar sesión</button>
      </div>
      <div class="native-hero">
        <div class="native-hero-title"><div class="native-eyebrow">Biblioteca cósmica</div><h1 class="native-title" id="native-title">Tus archivos</h1><p class="native-subtitle" id="native-subtitle">Todo tu contenido, en un solo lugar.</p></div>
        <button class="native-add" id="native-add-button" type="button" aria-label="Agregar">＋</button>
      </div>
      <div class="native-search-wrap"><input class="native-search" id="native-search" type="search" placeholder="Buscar en tu biblioteca…" autocomplete="off"></div>
      <div class="native-count" id="native-count"></div>
      <div class="native-load-error" id="native-load-error" hidden></div>
    </header>
    <main class="native-content" id="native-content">
      <section id="native-files-view"><div class="native-list" id="native-files-list"></div></section>
      <section id="native-folders-view" hidden><div class="native-list" id="native-folders-list"></div></section>
      <section id="native-storage-view" hidden><div class="native-storage-list" id="native-storage-list"></div></section>
      <section id="native-links-view" hidden><div class="native-list" id="native-links-list"></div></section>
      <section id="native-ps4-view" hidden><button class="native-report-button" data-native-action="report-game" type="button">⚠ Reportar enlace de juego caído</button><div class="native-game-folders" id="native-ps4-folders"></div><div class="native-game-grid" id="native-ps4-list"></div></section><section id="native-dm-view" hidden><div class="native-list" id="native-dm-list"></div></section>
      <section id="native-ftp-view" hidden>
        <article class="native-ftp-card">
          <div class="native-ftp-heading"><span>📡</span><div><strong>Servidor de este teléfono</strong><small>Compartí una carpeta con tu PS4 en la misma red Wi-Fi.</small></div></div>
          <label class="native-ftp-label">IP de este dispositivo</label><div class="native-ftp-address" id="ftp-local-address">Buscando IP…</div>
          <div class="native-ftp-fields"><label>Puerto<input id="ftp-server-port" inputmode="numeric" type="number" min="1024" max="65535" value="2121"></label><label class="native-ftp-check"><input id="ftp-server-writable" type="checkbox"> Permitir subir, mover y borrar desde clientes FTP</label></div>
          <div class="native-ftp-actions"><button class="native-action primary-action" id="ftp-server-start" type="button">▶ Iniciar servidor FTP</button><button class="native-action danger-action" id="ftp-server-stop" type="button" hidden>■ Detener</button><button class="native-action" id="ftp-refresh-ip" type="button">↻ Actualizar IP</button></div>
          <div class="native-ftp-warning">FTP anónimo no cifra la conexión. Al iniciar, otros dispositivos de tu red podrán ver los archivos de la carpeta indicada. La escritura está desactivada hasta que la habilites.</div>
          <div class="native-ftp-root">Carpeta compartida: <code>MediaChafaFTP</code> · almacenamiento privado de la app</div>
          <div class="native-ftp-toolbar"><strong>Archivos del servidor</strong><span id="ftp-local-path">/</span><button class="native-action" id="ftp-create-folder" type="button">＋ Carpeta</button><button class="native-action" id="ftp-pick-files" type="button">↑ Agregar archivos</button></div>
          <div id="ftp-drop-zone" class="native-ftp-drop">Arrastrá archivos aquí o elegí “Agregar archivos”</div><input id="ftp-file-input" type="file" multiple hidden>
          <div id="ftp-local-list" class="native-ftp-list"></div>
        </article>
        <article class="native-ftp-card">
          <div class="native-ftp-heading"><span>🎮</span><div><strong>Conectar con PS4</strong><small>Explorá los archivos del servidor FTP que corre en tu consola.</small></div></div>
          <div class="native-ftp-fields"><label>IP de tu PS4<input id="ftp-ps4-host" inputmode="decimal" placeholder="192.168.1.25" autocomplete="off"></label><label>Puerto<input id="ftp-ps4-port" inputmode="numeric" type="number" min="1" max="65535" value="2121"></label></div>
          <div class="native-ftp-fields"><label>Protocolo<select id="ftp-ps4-protocol"><option value="ftp">FTP</option><option value="ftps">FTPS explícito</option></select></label><label class="native-ftp-check"><input id="ftp-ps4-anonymous" type="checkbox" checked> Entrar como anónimo</label></div>
          <div id="ftp-ps4-credentials" class="native-ftp-fields" hidden><label>Usuario<input id="ftp-ps4-user" autocomplete="username"></label><label>Contraseña<input id="ftp-ps4-password" type="password" autocomplete="current-password"></label></div>
          <div class="native-ftp-actions"><button class="native-action primary-action" id="ftp-ps4-connect" type="button">↔ Conectar y ver archivos</button><button class="native-action danger-action" id="ftp-ps4-disconnect" type="button" hidden>Desconectar</button></div>
          <div id="ftp-ps4-status" class="native-ftp-status">Ingresá la IP local de tu PS4 y el puerto de su servidor FTP.</div>
          <div class="native-ftp-toolbar"><strong>Archivos de PS4</strong><button class="native-action" id="ftp-ps4-parent" type="button" hidden>↑ Carpeta anterior</button><button class="native-action" id="ftp-ps4-refresh" type="button" hidden>↻ Actualizar</button></div>
          <div id="ftp-ps4-list" class="native-ftp-list"></div>
        </article>
      </section>
    </main>
    <nav class="native-tabs" aria-label="Secciones">
      <button class="native-tab active" data-native-view="files" type="button"><span class="native-tab-icon">▤</span><span>Archivos</span></button>
      <button class="native-tab" data-native-view="folders" type="button"><span class="native-tab-icon">▰</span><span>Carpetas</span></button>
      <button class="native-tab" data-native-view="storage" type="button"><span class="native-tab-icon">◉</span><span>Espacio</span></button>
      <button class="native-tab" data-native-view="links" type="button"><span class="native-tab-icon">↗</span><span>Enlaces</span></button>
      <button class="native-tab" data-native-view="ps4" type="button"><span class="native-tab-icon">🎮</span><span>Juegos PS4</span></button>
      <button class="native-tab" data-native-view="dm" type="button"><span class="native-tab-icon">✉</span><span>DM</span></button>
      <button class="native-tab" data-native-view="ftp" type="button"><span class="native-tab-icon">⇄</span><span>FTP</span></button>
    </nav>`;
  $('#app').append(nativeShell);
  nativeShell.querySelector('#native-logout').addEventListener('click',()=>$('#logout').click());
  nativeShell.querySelector('#native-search').addEventListener('input',event=>{nativeSearch=event.target.value.trim().toLowerCase();renderNativeUI();});
  initializeNativeFtpUI();
  nativeShell.addEventListener('click',event=>{
    const tab=event.target.closest('[data-native-view]');
    if(tab){switchNativeView(tab.dataset.nativeView);if(tab.dataset.nativeView==='dm')void loadGameReports();return;}
    if(event.target.closest('#native-add-button')){if(nativeActiveView==='links')openLinkEditor();else if(nativeActiveView==='folders')$('#new-folder').click();else if(nativeActiveView==='ps4')void openPs4GameEditor();else if(nativeActiveView==='files')openUploadModal();return;}
    const action=event.target.closest('[data-native-action]');
    if(!action)return;
    if(action.dataset.nativeAction==='edit-folder'){configureFolder(action.dataset.folder);return;}
    if(action.dataset.nativeAction==='delete-link'){const link=links.find(item=>item.id===action.dataset.id);if(link&&confirm(`¿Eliminar el enlace “${link.title}”?`))void client.from('media_links').delete().eq('id',link.id).then(({error})=>error?toast('No se pudo eliminar: '+error.message):loadLinks());return;}
    if(action.dataset.nativeAction==='share-file'){const file=files.find(item=>item.id===action.dataset.id);if(file)void shareFile(file);return;}
    if(action.dataset.nativeAction==='report-game'){void reportBrokenGame();return;}
    if(action.dataset.nativeAction==='ps4-details'){showPs4GameDetails(action.dataset.id);return;}
    if(action.dataset.nativeAction==='ps4-open'){void openPs4Download(action.dataset.id);return;}
    if(action.dataset.nativeAction==='ps4-share'){const game=ps4Games.find(item=>item.id===action.dataset.id);if(game)void sharePs4Game(game);return;}
    if(action.dataset.nativeAction==='ps4-edit'){const game=ps4Games.find(item=>item.id===action.dataset.id);if(game)void openPs4GameEditor(game);return;}
    if(action.dataset.nativeAction==='ps4-delete'){void deletePs4Game(action.dataset.id);return;}
    if(action.dataset.nativeAction==='ps4-folder'){nativePs4Folder=action.dataset.folder||'all';renderNativeUI();return;}
    if(action.dataset.nativeAction==='select-folder'){
      currentFolder=action.dataset.folder||'Todos los archivos';
      switchNativeView('files');
      return;
    }
    const itemId=action.dataset.id;
    if(action.dataset.nativeAction==='open-link'){const link=links.find(item=>item.id===itemId);if(link)window.open(link.url,'_blank','noopener,noreferrer');return;}
    const file=files.find(item=>item.id===itemId);if(!file)return;
    if(action.dataset.nativeAction==='download')void downloadFile(file);
    else if(action.dataset.nativeAction==='preview')void previewFile(file);
    else if(action.dataset.nativeAction==='edit')editDescription(file.id);
    else if(action.dataset.nativeAction==='delete')void deleteFile(file.id);
  });
  initializeNativeState();
}

function initializeNativeState() {
  if(!isNativeApp||!nativeShell)return;
  nativeShell.hidden=false;
  $('#native-add-button').classList.toggle('hidden',!ownerMode&&!uploaderMode&&!canUploadMode);
  nativeShell.querySelector('[data-native-view=dm]').classList.toggle('hidden',!ownerMode);
  nativeShell.querySelector('[data-native-view=ftp]').classList.toggle('hidden',guestPs4Mode);
  nativeShell.querySelector('[data-native-view=ps4]').classList.toggle('hidden',!guestPs4Mode&&memberMode&&!accountPermissions.can_view_ps4_games);
  if(guestPs4Mode){for(const name of ['files','folders','storage','links'])nativeShell.querySelector('[data-native-view='+name+']').classList.add('hidden');}
  const firstView=guestPs4Mode?'ps4':(!memberMode||accountPermissions.can_view_public_files||accountPermissions.can_create_folders||canUploadMode?'files':accountPermissions.can_view_links?'links':accountPermissions.can_view_ps4_games?'ps4':'files');switchNativeView(firstView);
  renderNativeUI();
}

function switchNativeView(view) {
  if(!isNativeApp||!nativeShell)return;
  if(view==='uploads')view='files';
  if(guestPs4Mode)view='ps4';
  if(view==='dm'&&!ownerMode)view='ps4';
  if(view==='ftp'&&guestPs4Mode)view='ps4';
  if(view==='ps4'&&!guestPs4Mode&&memberMode&&!accountPermissions.can_view_ps4_games)view=accountPermissions.can_view_public_files||accountPermissions.can_create_folders||canUploadMode?'files':accountPermissions.can_view_links?'links':'files';
  if(memberMode&&!accountPermissions.can_view_public_files&&!accountPermissions.can_create_folders&&!canUploadMode&&['files','folders','storage'].includes(view))view='ps4';
  if(memberMode&&view==='links'&&!accountPermissions.can_view_links)view='ps4';
  nativeActiveView=view; currentView=view;
  for(const name of ['files','folders','storage','links','ps4','dm','ftp']) {
    const section=nativeShell.querySelector('#native-'+name+'-view');
    if(section)section.hidden=name!==view;
    nativeShell.querySelector('[data-native-view="'+name+'"]').classList.toggle('active',name===view);
  }
  const titles={dm:['DM · Reportes','Reportes privados de enlaces caídos.',''],files:[currentFolder==='Todos los archivos'?'Tus archivos':currentFolder,'Tu universo de archivos está a un toque.','Buscar archivos…'],folders:['Tus carpetas','Organizá y encontrá tus archivos.','Buscar carpetas…'],storage:['Espacio disponible','Revisá el uso de cada servicio.',''],links:['Enlaces guardados','Tus accesos favoritos, listos para abrir.','Buscar enlaces…'],ps4:['Juegos PS4','Portadas, detalles y descargas.','Buscar juegos…'],ftp:['FTP · Red local','Compartí archivos con tu PS4 y explorá su servidor FTP.','']};
  for(const name of ['files','folders','storage','links'])nativeShell.querySelector('[data-native-view='+name+']').classList.toggle('hidden',guestPs4Mode || (memberMode&&['files','folders','storage'].includes(name)&&!accountPermissions.can_view_public_files&&!accountPermissions.can_create_folders&&!canUploadMode) || (memberMode&&name==='links'&&!accountPermissions.can_view_links));
  const copy=titles[view];$('#native-title').textContent=copy[0];$('#native-subtitle').textContent=copy[1];$('#native-search').placeholder=copy[2];
  $('#native-search').parentElement.classList.toggle('hidden',!copy[2]);
  const canAdd=ownerMode||uploaderMode||canUploadMode||(memberMode&&accountPermissions.can_create_folders&&view==='folders');
  $('#native-add-button').classList.toggle('hidden',!canAdd||view==='storage'||view==='dm'||guestPs4Mode);
  nativeShell.querySelector('[data-native-view=dm]').classList.toggle('hidden',!ownerMode);
  nativeShell.querySelector('[data-native-view=ftp]').classList.toggle('hidden',guestPs4Mode);
  nativeShell.querySelector('[data-native-view=ps4]').classList.toggle('hidden',!guestPs4Mode&&memberMode&&!accountPermissions.can_view_ps4_games);
  nativeShell.querySelector('[data-native-action=report-game]').classList.toggle('hidden',view!=='ps4');
  $('#native-add-button').setAttribute('aria-label',view==='links'?'Guardar enlace':view==='folders'?'Crear carpeta':view==='ps4'?'Agregar juego':'Subir archivo');
  $('#native-add-button').textContent=view==='links'||view==='folders'||view==='ps4'?'＋':'↑';
  renderNativeUI();
  if(view==='ftp')void refreshNativeFtp();
}

function setNativeSyncStatus(label) {
  if(isNativeApp&&nativeShell){const status=nativeShell.querySelector('#native-sync-status');if(status)status.textContent=label;}
}

const nativeLoadErrors = {};
function setNativeLoadError(source,message) {
  if(message)nativeLoadErrors[source]=message;else delete nativeLoadErrors[source];
  if(!isNativeApp||!nativeShell)return;
  const banner=nativeShell.querySelector('#native-load-error');if(!banner)return;
  const messages=Object.values(nativeLoadErrors);banner.hidden=!messages.length;banner.textContent=messages.join(' · ');
}

function nativeEmpty(title,description,icon='✦') {
  return '<div class="native-empty"><div class="native-empty-icon">'+icon+'</div><strong>'+esc(title)+'</strong><span>'+esc(description)+'</span></div>';
}

function renderNativeUI() {
  if(!isNativeApp||!nativeShell)return;
  if(nativeActiveView==='dm') { $('#native-count').textContent=''; }
  else if(nativeActiveView==='files') {
    const shown=files.filter(file=>{
      const inFolder=currentFolder==='Todos los archivos'||(currentFolder==='Sin carpeta'?(!file.folder||file.folder==='Sin carpeta'):file.folder===currentFolder||file.folder.startsWith(currentFolder+'/'));
      return inFolder&&(file.name+' '+file.description+' '+file.folder).toLowerCase().includes(nativeSearch);
    });
    $('#native-count').textContent=shown.length+' archivo'+(shown.length===1?'':'s')+' en tu biblioteca';
    const list=$('#native-files-list');
    list.innerHTML=shown.length?shown.map(file=>{
      const canManage=ownerMode||(uploaderMode&&file.createdBy===currentUser?.id),canEditOwn=canManage||(memberMode&&canUploadMode&&file.createdBy===currentUser?.id),type=(file.type||'file').toLowerCase();
      const iconClass=['zip','rar','apk','pdf'].includes(type)?type:(file.mimeType||'').startsWith('image/')?'image':'';
      const actions='<button class="native-action primary-action" data-native-action="download" data-id="'+esc(file.id)+'" type="button">↓ Descargar</button>'+
        (!isPrivateFile(file)?'<button class="native-action" data-native-action="share-file" data-id="'+esc(file.id)+'" type="button">↗ Compartir enlace</button>':'')+
        (isPreviewable(file.mimeType)?'<button class="native-action" data-native-action="preview" data-id="'+esc(file.id)+'" type="button">◉ Vista previa</button>':'')+
        (canEditOwn?'<button class="native-action" data-native-action="edit" data-id="'+esc(file.id)+'" type="button">✎ Editar detalles</button>':'')+(canManage?'<button class="native-action danger-action" data-native-action="delete" data-id="'+esc(file.id)+'" type="button">× Eliminar</button>':'');
      return '<article class="native-card"><div class="native-file-icon '+iconClass+'">'+esc(type.slice(0,5))+'</div><div class="native-card-main"><h2 class="native-card-title">'+esc(file.name)+'</h2><div class="native-card-meta"><span>'+esc(formatBytes(file.size))+'</span><span>·</span><span>'+esc(file.folder||'Sin carpeta')+'</span><span>·</span><span>'+esc(file.date||'')+'</span>'+(file.isPrivate?'<span class="native-private">· 🔒 Privado</span>':'')+'</div></div><div class="native-card-actions">'+actions+'</div></article>';
    }).join(''):nativeEmpty(files.length?'No hay coincidencias':'Todavía no hay archivos',files.length?'Probá con otro nombre o carpeta.':'Los archivos nuevos aparecerán aquí automáticamente.');
  } else if(nativeActiveView==='folders') {
    const visible=folders.filter(folder=>folder.toLowerCase().includes(nativeSearch));
    $('#native-count').textContent=folders.length+' carpetas disponibles';
    $('#native-folders-list').innerHTML=visible.map(folder=>{
      const record=folderRecords.find(item=>item.name===folder);
      const contained=folder==='Todos los archivos'?files:files.filter(file=>folder==='Sin carpeta'?(!file.folder||file.folder==='Sin carpeta'):(file.folder===folder||file.folder.startsWith(folder+'/')));
      const bytes=contained.reduce((sum,file)=>sum+file.size,0);
      const privateLabel=record?.isPrivate?'<span class="native-private">· 🔒 Privada</span>':'';
      const canEditFolder=(ownerMode||uploaderMode)&&folder!=='Todos los archivos'&&folder!=='Sin carpeta';
      return '<div class="native-folder-row"><button class="native-folder-card" data-native-action="select-folder" data-folder="'+esc(folder)+'" type="button"><span class="native-folder-icon">'+(record?.isPrivate?'🔒':'▰')+'</span><span class="native-folder-main"><strong>'+esc(folder)+'</strong><small>'+contained.length+' archivo'+(contained.length===1?'':'s')+' · '+formatBytes(bytes)+' '+privateLabel+'</small></span><span class="native-folder-arrow">›</span></button>'+(canEditFolder?'<button class="native-folder-edit" data-native-action="edit-folder" data-folder="'+esc(folder)+'" type="button" aria-label="Editar carpeta '+esc(folder)+'">✎</button>':'')+'</div>';
    }).join('')||nativeEmpty('No hay carpetas coincidentes','Probá con otro nombre.','▰');
  } else if(nativeActiveView==='storage') {
    renderNativeStorage();
  } else if(nativeActiveView==='links') {
    const shown=links.filter(link=>(link.title+' '+link.url).toLowerCase().includes(nativeSearch));
    $('#native-count').textContent=shown.length+' enlace'+(shown.length===1?'':'s')+' guardado'+(shown.length===1?'':'s');
    $('#native-links-list').innerHTML=shown.length?shown.map(link=>'<article class="native-card"><div class="native-file-icon">↗</div><div class="native-card-main"><h2 class="native-card-title">'+esc(link.title)+'</h2><a class="native-link-url" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+esc(link.url)+'</a><div class="native-card-meta">'+(link.is_private?'<span class="native-private">🔒 Solo vos</span>':'<span>🌐 Público</span>')+'</div></div><div class="native-card-actions"><button class="native-action primary-action" data-native-action="open-link" data-id="'+esc(link.id)+'" type="button">Abrir enlace</button>'+((ownerMode||(uploaderMode&&link.created_by===currentUser?.id))?'<button class="native-action danger-action" data-native-action="delete-link" data-id="'+esc(link.id)+'" type="button">× Eliminar</button>':'')+'</div></article>').join(''):nativeEmpty('Todavía no hay enlaces','Guardá uno y lo vas a encontrar aquí.','↗');
  } else if(nativeActiveView==='ps4') {
    const visibleFolders=ps4GameFolders.filter(folder=>!folder.is_private||ownerMode||folder.created_by===currentUser?.id||folder.allowed_user_ids?.includes(currentUser?.id));
    $('#native-ps4-folders').innerHTML='<button class="native-game-folder '+(nativePs4Folder==='all'?'active':'')+'" data-native-action="ps4-folder" data-folder="all" type="button">Todos</button>'+visibleFolders.map(folder=>'<button class="native-game-folder '+(nativePs4Folder===folder.id?'active':'')+'" data-native-action="ps4-folder" data-folder="'+esc(folder.id)+'" type="button">'+(folder.is_private?'🔒 ':'')+esc(folder.name)+'</button>').join('');
    const shown=ps4Games.filter(game=>(nativePs4Folder==='all'||game.folder_id===nativePs4Folder)&&(!game.is_private||ownerMode||game.created_by===currentUser?.id||game.allowed_user_ids?.includes(currentUser?.id))&&(game.title+' '+game.description+' '+game.features).toLowerCase().includes(nativeSearch));
    $('#native-count').textContent=shown.length+' juego'+(shown.length===1?'':'s');
    $('#native-ps4-list').innerHTML=shown.length?shown.map(game=>'<article class="native-game-card"><button class="native-game-cover" data-native-action="ps4-details" data-id="'+esc(game.id)+'" type="button">'+(game.cover_image?'<img src="'+esc(game.cover_image)+'" alt="Portada de '+esc(game.title)+'">':'<span>PS4</span>')+'</button><h2>'+esc(game.title)+'</h2><div class="native-game-actions"><button class="native-action primary-action" data-native-action="ps4-open" data-id="'+esc(game.id)+'" type="button">↗ Ir a la descarga</button><button class="native-action" data-native-action="ps4-share" data-id="'+esc(game.id)+'" type="button">↗ Compartir</button>'+((ownerMode||game.created_by===currentUser?.id)?'<button class="native-action" data-native-action="ps4-edit" data-id="'+esc(game.id)+'" type="button">Editar</button><button class="native-action danger-action" data-native-action="ps4-delete" data-id="'+esc(game.id)+'" type="button">Eliminar</button>':'')+'</div></article>').join(''):nativeEmpty('Todavía no hay juegos','Los juegos que agregues aparecerán aquí.','🎮');
  } else if(nativeActiveView==='ftp') {
    $('#native-count').textContent='FTP · Red local';
  }
}

let nativeFtpLocalPath='';
let nativeFtpRemotePath='/';
let nativeFtpRemoteConnected=false;

function nativeFtpPlugin(){return window.Capacitor?.Plugins?.MediaFtp||null;}
function nativeFtpPath(path){return String(path||'').replace(/^\/+|\/+$/g,'').split('/').filter(part=>part&&part!=='.'&&part!=='..').join('/');}
function nativeFtpFileName(path){return String(path||'').split('/').filter(Boolean).pop()||'archivo';}
function nativeFtpByteBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}

function initializeNativeFtpUI(){
  if(!isNativeApp||!nativeShell)return;
  const saved=JSON.parse(localStorage.getItem('mediachafa-ftp-connection')||'{}');
  if(saved.host)$('#ftp-ps4-host').value=saved.host;
  if(saved.port)$('#ftp-ps4-port').value=String(saved.port);
  if(saved.protocol)$('#ftp-ps4-protocol').value=saved.protocol;
  if(typeof saved.anonymous==='boolean')$('#ftp-ps4-anonymous').checked=saved.anonymous;
  $('#ftp-ps4-credentials').hidden=$('#ftp-ps4-anonymous').checked;
  $('#ftp-ps4-anonymous').onchange=()=>$('#ftp-ps4-credentials').hidden=$('#ftp-ps4-anonymous').checked;
  $('#ftp-refresh-ip').onclick=()=>void refreshNativeFtpIp();
  $('#ftp-server-start').onclick=()=>void startNativeFtpServer();
  $('#ftp-server-stop').onclick=()=>void stopNativeFtpServer();
  $('#ftp-create-folder').onclick=()=>void createNativeFtpFolder();
  $('#ftp-pick-files').onclick=()=>$('#ftp-file-input').click();
  $('#ftp-file-input').onchange=event=>{void importNativeFtpFiles(Array.from(event.target.files||[]));event.target.value='';};
  const drop=$('#ftp-drop-zone');
  drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
  drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragging');void importNativeFtpFiles(Array.from(event.dataTransfer?.files||[]));});
  $('#ftp-ps4-connect').onclick=()=>void connectNativePs4Ftp();
  $('#ftp-ps4-disconnect').onclick=()=>void disconnectNativePs4Ftp();
  $('#ftp-ps4-refresh').onclick=()=>void loadNativePs4FtpPath(nativeFtpRemotePath);
  $('#ftp-ps4-parent').onclick=()=>{const parts=nativeFtpRemotePath.split('/').filter(Boolean);parts.pop();void loadNativePs4FtpPath('/'+parts.join('/'));};
  $('#ftp-local-list').addEventListener('click',event=>void handleLocalFtpAction(event));
  $('#ftp-ps4-list').addEventListener('click',event=>void handlePs4FtpAction(event));
}

async function refreshNativeFtpIp(){
  const plugin=nativeFtpPlugin();if(!plugin){$('#ftp-local-address').textContent='FTP solo está disponible en la app Android.';return;}
  try{const info=await plugin.getNetworkInfo();$('#ftp-local-address').textContent=info.ip?`${info.ip}:${$('#ftp-server-port').value||2121}`:'Conectate a la misma red Wi-Fi que tu PS4.';$('#ftp-server-start').disabled=!info.ip;await updateNativeFtpServerStatus(info);}catch(error){$('#ftp-local-address').textContent='No se pudo obtener la IP: '+(error.message||error);}
}

async function updateNativeFtpServerStatus(info=null){
  const plugin=nativeFtpPlugin();if(!plugin)return;
  try{const state=await plugin.getServerStatus();const running=Boolean(state.running);$('#ftp-server-start').hidden=running;$('#ftp-server-stop').hidden=!running;$('#ftp-server-port').disabled=running;$('#ftp-server-writable').disabled=running;$('#ftp-local-address').textContent=running?`${state.ip||info?.ip||'IP local'}:${state.port}`:(info?.ip?`${info.ip}:${$('#ftp-server-port').value||2121}`:'Conectate a una red Wi-Fi.');if(running)$('#ftp-server-start').disabled=false;}catch{}
}

async function refreshNativeFtp(){
  await refreshNativeFtpIp();
  await loadNativeFtpLocalFiles();
}

async function startNativeFtpServer(){
  const plugin=nativeFtpPlugin();if(!plugin)return;
  const allowWrite=$('#ftp-server-writable').checked;
  if(allowWrite&&!confirm('El FTP anónimo no cifra la conexión. Cualquier dispositivo conectado a tu red Wi-Fi podrá subir, mover y borrar archivos de MediaChafaFTP. ¿Querés habilitarlo?')){ $('#ftp-server-writable').checked=false;return; }
  try{const result=await plugin.startServer({port:Number($('#ftp-server-port').value||2121),allowWrite});toast(`Servidor FTP iniciado en ${result.ip}:${result.port}. Usá usuario anonymous y contraseña vacía.`);await updateNativeFtpServerStatus(result);}
  catch(error){toast('No se pudo iniciar el servidor FTP: '+(error.message||error));await refreshNativeFtpIp();}
}

async function stopNativeFtpServer(){try{await nativeFtpPlugin().stopServer();toast('Servidor FTP detenido.');await updateNativeFtpServerStatus();}catch(error){toast('No se pudo detener el servidor: '+(error.message||error));}}

async function loadNativeFtpLocalFiles(){
  const plugin=nativeFtpPlugin();if(!plugin)return;
  try{const result=await plugin.listLocalFiles({path:nativeFtpLocalPath});const entries=result.entries||[];$('#ftp-local-path').textContent='/'+nativeFtpLocalPath;$('#ftp-local-list').innerHTML=(nativeFtpLocalPath?'<button class="native-ftp-row folder" data-ftp-local-open="'+esc(nativeFtpLocalPath.split('/').slice(0,-1).join('/'))+'" type="button"><span>↰</span><strong>Carpeta anterior</strong></button>':'')+(entries.length?entries.map(entry=>'<article class="native-ftp-row"><button class="ftp-entry-open '+(entry.directory?'folder':'')+'" '+(entry.directory?'data-ftp-local-open="'+esc(entry.relativePath)+'"':'')+' type="button"><span>'+(entry.directory?'📁':'📄')+'</span><strong>'+esc(entry.name)+'</strong><small>'+ (entry.directory?'Carpeta':formatBytes(Number(entry.size||0)))+'</small></button><button class="native-action" data-ftp-move="'+esc(entry.relativePath)+'" type="button">Mover</button><button class="native-action danger-action" data-ftp-delete="'+esc(entry.relativePath)+'" type="button">Borrar</button></article>').join(''):nativeEmpty('Carpeta vacía','Agregá archivos o creá una carpeta.','📂'));}
  catch(error){$('#ftp-local-list').innerHTML=nativeEmpty('No se pudo leer la carpeta',error.message||String(error),'⚠');}
}

async function createNativeFtpFolder(){
  modal('Crear carpeta FTP','<label class="field-label">Nombre de la carpeta</label><input class="field" id="ftp-folder-name" maxlength="80" placeholder="PS4" autocomplete="off">','Crear',async root=>{const name=root.querySelector('#ftp-folder-name').value.trim();if(!name)return;try{await nativeFtpPlugin().createLocalFolder({parent:nativeFtpLocalPath,name});toast('Carpeta creada.');await loadNativeFtpLocalFiles();root.replaceChildren();}catch(error){toast('No se pudo crear: '+(error.message||error));}});
}

async function importNativeFtpFiles(selected){
  const plugin=nativeFtpPlugin();if(!plugin||!selected.length)return;
  const drop=$('#ftp-drop-zone');drop.textContent=`Preparando ${selected.length} archivo${selected.length===1?'':'s'}…`;
  for(const file of selected){let upload=null;try{upload=await plugin.beginLocalUpload({name:file.name,path:nativeFtpLocalPath});const chunkSize=256*1024;for(let start=0;start<file.size;start+=chunkSize){const bytes=new Uint8Array(await file.slice(start,Math.min(file.size,start+chunkSize)).arrayBuffer());await plugin.appendLocalUploadChunk({uploadId:upload.uploadId,base64:nativeFtpByteBase64(bytes)});drop.textContent=`Copiando ${file.name} · ${Math.min(100,Math.round((start+bytes.length)*100/file.size))}%`;}await plugin.finishLocalUpload({uploadId:upload.uploadId});}catch(error){if(upload?.uploadId)await plugin.cancelLocalUpload({uploadId:upload.uploadId}).catch(()=>{});toast(`No se pudo agregar ${file.name}: ${error.message||error}`);}}
  drop.textContent='Arrastrá archivos aquí o elegí “Agregar archivos”';await loadNativeFtpLocalFiles();
}

async function handleLocalFtpAction(event){
  const open=event.target.closest('[data-ftp-local-open]');if(open){nativeFtpLocalPath=nativeFtpPath(open.dataset.ftpLocalOpen);await loadNativeFtpLocalFiles();return;}
  const remove=event.target.closest('[data-ftp-delete]');if(remove){if(!confirm(`¿Borrar ${nativeFtpFileName(remove.dataset.ftpDelete)} del servidor FTP?`))return;try{await nativeFtpPlugin().deleteLocalItem({path:remove.dataset.ftpDelete});await loadNativeFtpLocalFiles();}catch(error){toast('No se pudo borrar: '+(error.message||error));}return;}
  const move=event.target.closest('[data-ftp-move]');if(move){const item=move.dataset.ftpMove;modal('Mover elemento FTP','<p class="sub">Destino relativo dentro de MediaChafaFTP. Usá / para moverlo a la carpeta principal.</p><label class="field-label">Carpeta destino</label><input class="field" id="ftp-move-destination" value="'+esc(nativeFtpLocalPath)+'" placeholder="/">','Mover',async root=>{try{await nativeFtpPlugin().moveLocalItem({path:item,destination:root.querySelector('#ftp-move-destination').value.trim()});toast('Elemento movido.');await loadNativeFtpLocalFiles();root.replaceChildren();}catch(error){toast('No se pudo mover: '+(error.message||error));}});}
}

function rememberNativePs4Ftp(){localStorage.setItem('mediachafa-ftp-connection',JSON.stringify({host:$('#ftp-ps4-host').value.trim(),port:Number($('#ftp-ps4-port').value||2121),protocol:$('#ftp-ps4-protocol').value,anonymous:$('#ftp-ps4-anonymous').checked}));}

async function connectNativePs4Ftp(){
  const plugin=nativeFtpPlugin();if(!plugin)return;
  const host=$('#ftp-ps4-host').value.trim(),port=Number($('#ftp-ps4-port').value||2121),anonymous=$('#ftp-ps4-anonymous').checked;
  rememberNativePs4Ftp();$('#ftp-ps4-status').textContent='Conectando con la PS4…';$('#ftp-ps4-connect').disabled=true;
  try{const result=await plugin.connectPs4({host,port,ftps:$('#ftp-ps4-protocol').value==='ftps',anonymous,username:$('#ftp-ps4-user').value.trim(),password:$('#ftp-ps4-password').value});nativeFtpRemoteConnected=true;nativeFtpRemotePath=result.path||'/';$('#ftp-ps4-status').textContent='Conectado a '+host+':'+port+' · '+(result.system||'FTP');$('#ftp-ps4-disconnect').hidden=false;$('#ftp-ps4-refresh').hidden=false;$('#ftp-ps4-parent').hidden=nativeFtpRemotePath==='/';renderNativePs4FtpEntries(result.entries||[]);}
  catch(error){nativeFtpRemoteConnected=false;$('#ftp-ps4-status').textContent='No se pudo conectar: '+(error.message||error);$('#ftp-ps4-list').innerHTML=nativeEmpty('Conexión fallida','Revisá que el servidor FTP de tu PS4 esté activo y en la misma red.','⚠');}
  finally{$('#ftp-ps4-connect').disabled=false;}
}

async function disconnectNativePs4Ftp(){try{await nativeFtpPlugin().disconnectPs4();}catch{}nativeFtpRemoteConnected=false;nativeFtpRemotePath='/';$('#ftp-ps4-status').textContent='Desconectado.';$('#ftp-ps4-connect').hidden=false;$('#ftp-ps4-disconnect').hidden=true;$('#ftp-ps4-refresh').hidden=true;$('#ftp-ps4-parent').hidden=true;$('#ftp-ps4-list').innerHTML='';}

async function loadNativePs4FtpPath(path){
  if(!nativeFtpRemoteConnected)return;
  try{const result=await nativeFtpPlugin().listPs4Files({path});nativeFtpRemotePath=result.path||path||'/';$('#ftp-ps4-status').textContent='Conectado · '+nativeFtpRemotePath;$('#ftp-ps4-parent').hidden=nativeFtpRemotePath==='/';renderNativePs4FtpEntries(result.entries||[]);}
  catch(error){$('#ftp-ps4-status').textContent='No se pudo leer esta carpeta: '+(error.message||error);}
}

function renderNativePs4FtpEntries(entries){
  $('#ftp-ps4-list').innerHTML=entries.length?entries.map(entry=>'<article class="native-ftp-row"><button class="ftp-remote-open '+(entry.directory?'folder':'')+'" data-ftp-remote-name="'+esc(entry.name)+'" data-ftp-remote-dir="'+(entry.directory?'1':'0')+'" type="button"><span>'+(entry.directory?'📁':'📄')+'</span><strong>'+esc(entry.name)+'</strong><small>'+(entry.directory?'Carpeta':formatBytes(Number(entry.size||0)))+'</small></button>'+(!entry.directory?'<button class="native-action" data-ftp-remote-download="'+esc(entry.name)+'" type="button">↓ Guardar</button>':'')+'</article>').join(''):nativeEmpty('No hay elementos','La carpeta está vacía.','📂');
}

async function handlePs4FtpAction(event){
  const folder=event.target.closest('[data-ftp-remote-dir="1"]');if(folder){const next=nativeFtpRemotePath==='/'?'/'+folder.dataset.ftpRemoteName:nativeFtpRemotePath.replace(/\/$/,'')+'/'+folder.dataset.ftpRemoteName;await loadNativePs4FtpPath(next);return;}
  const download=event.target.closest('[data-ftp-remote-download]');if(download){try{await nativeFtpPlugin().downloadPs4File({path:nativeFtpRemotePath.replace(/\/$/,'')+'/'+download.dataset.ftpRemoteDownload,fileName:download.dataset.ftpRemoteDownload});toast('Descarga de PS4 completada.');}catch(error){toast('No se pudo guardar el archivo: '+(error.message||error));}}
}

function renderNativeStorage() {
  if(!isNativeApp||!nativeShell)return;
  const items=[
    {name:'Google Drive',icon:'◉',used:'#drive-used-label',capacity:'#drive-capacity-label',remaining:'#drive-remaining-label',bar:'#drive-bar-fill',tone:'drive'},
    {name:'Cloudflare R2',icon:'◉',used:'#used-label',capacity:'#r2-capacity-label',remaining:'#remaining-label',bar:'#bar-fill',tone:'cloud'}
  ];
  $('#native-storage-list').innerHTML=items.map(item=>'<article class="native-storage-card '+item.tone+'"><div class="native-storage-heading"><span class="native-storage-icon">'+item.icon+'</span><strong>'+item.name+'</strong><span class="native-storage-amount">'+esc($(item.used)?.textContent||'—')+' <i>/</i> '+esc($(item.capacity)?.textContent||'—')+'</span></div><div class="native-storage-track"><span style="width:'+($(item.bar)?.style.width||'0%')+'"></span></div><p>'+esc($(item.remaining)?.textContent||'Espacio disponible')+'</p></article>').join('');
}

initializeNativeUI();
