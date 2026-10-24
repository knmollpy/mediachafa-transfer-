let nativeShell = null;
let nativeActiveView = 'files';
let nativeSearch = '';

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
      </div>
      <div class="native-hero">
        <div class="native-hero-title"><div class="native-eyebrow">Biblioteca cósmica</div><h1 class="native-title" id="native-title">Tus archivos</h1><p class="native-subtitle" id="native-subtitle">Todo tu contenido, en un solo lugar.</p></div>
        <button class="native-add" id="native-add-button" type="button" aria-label="Agregar">＋</button>
      </div>
      <div class="native-search-wrap"><input class="native-search" id="native-search" type="search" placeholder="Buscar en tu biblioteca…" autocomplete="off"></div>
      <div class="native-count" id="native-count"></div>
    </header>
    <main class="native-content" id="native-content">
      <section id="native-files-view"><div class="native-list" id="native-files-list"></div></section>
      <section id="native-folders-view" hidden><div class="native-list" id="native-folders-list"></div></section>
      <section id="native-storage-view" hidden><div class="native-storage-list" id="native-storage-list"></div></section>
      <section id="native-links-view" hidden><div class="native-list" id="native-links-list"></div></section>
    </main>
    <nav class="native-tabs" aria-label="Secciones">
      <button class="native-tab active" data-native-view="files" type="button"><span class="native-tab-icon">▤</span><span>Archivos</span></button>
      <button class="native-tab" data-native-view="folders" type="button"><span class="native-tab-icon">▰</span><span>Carpetas</span></button>
      <button class="native-tab" data-native-view="storage" type="button"><span class="native-tab-icon">◉</span><span>Espacio</span></button>
      <button class="native-tab" data-native-view="links" type="button"><span class="native-tab-icon">↗</span><span>Enlaces</span></button>
    </nav>`;
  $('#app').append(nativeShell);
  nativeShell.querySelector('#native-search').addEventListener('input',event=>{nativeSearch=event.target.value.trim().toLowerCase();renderNativeUI();});
  nativeShell.addEventListener('click',event=>{
    const tab=event.target.closest('[data-native-view]');
    if(tab){switchNativeView(tab.dataset.nativeView);return;}
    if(event.target.closest('#native-add-button')){if(nativeActiveView==='links')openLinkEditor();else if(nativeActiveView==='folders')$('#new-folder').click();else if(nativeActiveView==='files')openUploadModal();return;}
    const action=event.target.closest('[data-native-action]');
    if(!action)return;
    if(action.dataset.nativeAction==='edit-folder'){configureFolder(action.dataset.folder);return;}
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
  $('#native-add-button').classList.toggle('hidden',!ownerMode&&!uploaderMode);
  switchNativeView('files');
  renderNativeUI();
}

function switchNativeView(view) {
  if(!isNativeApp||!nativeShell)return;
  if(view==='uploads')view='files';
  nativeActiveView=view;
  for(const name of ['files','folders','storage','links']) {
    const section=nativeShell.querySelector('#native-'+name+'-view');
    if(section)section.hidden=name!==view;
    nativeShell.querySelector('[data-native-view="'+name+'"]').classList.toggle('active',name===view);
  }
  const titles={files:[currentFolder==='Todos los archivos'?'Tus archivos':currentFolder,'Tu universo de archivos está a un toque.','Buscar archivos…'],folders:['Tus carpetas','Organizá y encontrá tus archivos.','Buscar carpetas…'],storage:['Espacio disponible','Revisá el uso de cada servicio.',''],links:['Enlaces guardados','Tus accesos favoritos, listos para abrir.','Buscar enlaces…']};
  const copy=titles[view];$('#native-title').textContent=copy[0];$('#native-subtitle').textContent=copy[1];$('#native-search').placeholder=copy[2];
  $('#native-search').parentElement.classList.toggle('hidden',!copy[2]);
  $('#native-add-button').classList.toggle('hidden',(!ownerMode&&!uploaderMode)||view==='storage');
  $('#native-add-button').setAttribute('aria-label',view==='links'?'Guardar enlace':view==='folders'?'Crear carpeta':'Subir archivo');
  $('#native-add-button').textContent=view==='links'||view==='folders'?'＋':'↑';
  renderNativeUI();
}

function setNativeSyncStatus(label) {
  if(isNativeApp&&nativeShell){const status=nativeShell.querySelector('#native-sync-status');if(status)status.textContent=label;}
}

function nativeEmpty(title,description,icon='✦') {
  return '<div class="native-empty"><div class="native-empty-icon">'+icon+'</div><strong>'+esc(title)+'</strong><span>'+esc(description)+'</span></div>';
}

function renderNativeUI() {
  if(!isNativeApp||!nativeShell)return;
  if(nativeActiveView==='files') {
    const shown=files.filter(file=>{
      const inFolder=currentFolder==='Todos los archivos'||(currentFolder==='Sin carpeta'?(!file.folder||file.folder==='Sin carpeta'):file.folder===currentFolder||file.folder.startsWith(currentFolder+'/'));
      return inFolder&&(file.name+' '+file.description+' '+file.folder).toLowerCase().includes(nativeSearch);
    });
    $('#native-count').textContent=shown.length+' archivo'+(shown.length===1?'':'s')+' en tu biblioteca';
    const list=$('#native-files-list');
    list.innerHTML=shown.length?shown.map(file=>{
      const canManage=ownerMode||(uploaderMode&&file.createdBy===currentUser?.id),type=(file.type||'file').toLowerCase();
      const iconClass=['zip','rar','apk','pdf'].includes(type)?type:(file.mimeType||'').startsWith('image/')?'image':'';
      const actions='<button class="native-action primary-action" data-native-action="download" data-id="'+esc(file.id)+'" type="button">↓ Descargar</button>'+
        (isPreviewable(file.mimeType)?'<button class="native-action" data-native-action="preview" data-id="'+esc(file.id)+'" type="button">◉ Vista previa</button>':'')+
        (canManage?'<button class="native-action" data-native-action="edit" data-id="'+esc(file.id)+'" type="button">✎ Editar detalles</button><button class="native-action danger-action" data-native-action="delete" data-id="'+esc(file.id)+'" type="button">× Eliminar</button>':'');
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
    $('#native-links-list').innerHTML=shown.length?shown.map(link=>'<article class="native-card"><div class="native-file-icon">↗</div><div class="native-card-main"><h2 class="native-card-title">'+esc(link.title)+'</h2><a class="native-link-url" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+esc(link.url)+'</a><div class="native-card-meta">'+(link.is_private?'<span class="native-private">🔒 Solo vos</span>':'<span>🌐 Público</span>')+'</div></div><div class="native-card-actions"><button class="native-action primary-action" data-native-action="open-link" data-id="'+esc(link.id)+'" type="button">Abrir enlace</button></div></article>').join(''):nativeEmpty('Todavía no hay enlaces','Guardá uno y lo vas a encontrar aquí.','↗');
  }
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
