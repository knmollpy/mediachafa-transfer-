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
        <div class="native-brand-icon" aria-hidden="true">✦</div>
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
      <section id="native-links-view" hidden><div class="native-list" id="native-links-list"></div></section>
    </main>
    <nav class="native-tabs" aria-label="Secciones">
      <button class="native-tab active" data-native-view="files" type="button"><span class="native-tab-icon">▤</span><span>Archivos</span></button>
      <button class="native-tab" data-native-view="links" type="button"><span class="native-tab-icon">↗</span><span>Enlaces</span></button>
    </nav>`;
  $('#app').append(nativeShell);
  nativeShell.querySelector('#native-search').addEventListener('input',event=>{nativeSearch=event.target.value.trim().toLowerCase();renderNativeUI();});
  nativeShell.addEventListener('click',event=>{
    const tab=event.target.closest('[data-native-view]');
    if(tab){switchNativeView(tab.dataset.nativeView);return;}
    if(event.target.closest('#native-add-button')){if(nativeActiveView==='links')openLinkEditor();else if(nativeActiveView==='files')openUploadModal();return;}
    const action=event.target.closest('[data-native-action]');
    if(!action)return;
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
  for(const name of ['files','links']) {
    const section=nativeShell.querySelector('#native-'+name+'-view');
    if(section)section.hidden=name!==view;
    nativeShell.querySelector('[data-native-view="'+name+'"]').classList.toggle('active',name===view);
  }
  const titles={files:['Tus archivos','Tu universo de archivos está a un toque.','Buscar archivos…'],links:['Enlaces guardados','Tus accesos favoritos, listos para abrir.','Buscar enlaces…']};
  const copy=titles[view];$('#native-title').textContent=copy[0];$('#native-subtitle').textContent=copy[1];$('#native-search').placeholder=copy[2];
  $('#native-add-button').classList.toggle('hidden',!ownerMode&&!uploaderMode);
  $('#native-add-button').setAttribute('aria-label',view==='links'?'Guardar enlace':'Subir archivo');
  $('#native-add-button').textContent=view==='links'?'＋':'↑';
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
    const shown=files.filter(file=>(file.name+' '+file.description+' '+file.folder).toLowerCase().includes(nativeSearch));
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
  } else if(nativeActiveView==='links') {
    const shown=links.filter(link=>(link.title+' '+link.url).toLowerCase().includes(nativeSearch));
    $('#native-count').textContent=shown.length+' enlace'+(shown.length===1?'':'s')+' guardado'+(shown.length===1?'':'s');
    $('#native-links-list').innerHTML=shown.length?shown.map(link=>'<article class="native-card"><div class="native-file-icon">↗</div><div class="native-card-main"><h2 class="native-card-title">'+esc(link.title)+'</h2><a class="native-link-url" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+esc(link.url)+'</a><div class="native-card-meta">'+(link.is_private?'<span class="native-private">🔒 Solo vos</span>':'<span>🌐 Público</span>')+'</div></div><div class="native-card-actions"><button class="native-action primary-action" data-native-action="open-link" data-id="'+esc(link.id)+'" type="button">Abrir enlace</button></div></article>').join(''):nativeEmpty('Todavía no hay enlaces','Guardá uno y lo vas a encontrar aquí.','↗');
  } else {
    const active=uploadJobs.filter(job=>job.status==='uploading');
    const recent=files.filter(file=>file.createdBy===currentUser?.id).slice(0,20);
    const errors=uploadJobs.flatMap(job=>job.items.filter(item=>item.status==='error').map(item=>({name:item.name,error:item.error})));
    const activeHtml=active.map(job=>{
      const total=job.items.reduce((sum,item)=>sum+item.size,0),done=job.items.reduce((sum,item)=>sum+(item.status==='completed'?item.size:item.progressBytes||0),0),percent=total?Math.floor(done/total*100):0;
      return '<article class="native-job"><div class="native-job-head"><span>Subiendo '+job.items.length+' archivo'+(job.items.length===1?'':'s')+'</span><span>'+percent+'%</span></div><div class="native-job-info">'+esc(formatBytes(done))+' de '+esc(formatBytes(total))+' · '+esc(job.provider==='google'?'Google Drive':'Cloudflare R2')+'</div><div class="native-progress"><span style="width:'+percent+'%"></span></div>'+job.items.map(item=>'<div class="native-job-info">'+esc(item.name)+' · '+(item.status==='completed'?'Listo':item.status==='error'?'Error':'En curso')+'</div>').join('')+'</article>';
    }).join('');
    const doneHtml=recent.map(file=>'<article class="native-job"><div class="native-job-head"><span>✓ '+esc(file.name)+'</span><span>Listo</span></div><div class="native-job-info">'+esc(formatBytes(file.size))+' · '+esc(file.date||'')+'</div></article>').join('');
    const errorsHtml=errors.map(item=>'<article class="native-job"><div class="native-job-head"><span>'+esc(item.name)+'</span><span>Error</span></div><div class="native-job-info">'+esc(item.error)+'</div></article>').join('');
    $('#native-count').textContent=active.length+' subiendo · '+recent.length+' completado'+(recent.length===1?'':'s');
    $('#native-uploads-list').innerHTML=(activeHtml||nativeEmpty('Nada subiendo ahora','Cuando empieces una subida, su avance aparece aquí.','↑'))+
      (recent.length?'<div class="native-section-label">Recién llegados</div>'+doneHtml:'')+
      (errors.length?'<div class="native-section-label">Con errores</div>'+errorsHtml:'');
  }
}

initializeNativeUI();
