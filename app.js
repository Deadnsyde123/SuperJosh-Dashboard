/* ============================================================
   Prodash — personal daily productivity dashboard (MVP)
   Vanilla JS, localStorage persistence, no backend.
   Modules: areas (Work/Personal), manual drag ordering, notes.
   Structure is modular so AI suggestions & automation can be
   layered on later (see // EXTENSION hooks).
   ============================================================ */

(() => {
  'use strict';

  const STORE_KEY = 'prodash.tasks.v1';
  const ORDER_KEY = 'prodash.order.v1';
  const NOTE_KEY  = 'prodash.notes.v1';
  const SEED_KEY  = 'prodash.seeded.v1';

  /* ---------- helpers ---------- */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const todayKey = () => dateKey(new Date());
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseKey(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
  function addDays(k,n){ const d=parseKey(k); d.setDate(d.getDate()+n); return dateKey(d); }
  // advance a due date by the recurrence interval
  function nextDue(repeat, fromKey){
    const d=parseKey(fromKey);
    if(repeat==='daily') d.setDate(d.getDate()+1);
    else if(repeat==='weekly') d.setDate(d.getDate()+7);
    else if(repeat==='monthly'){
      const day=d.getDate();
      d.setDate(1); d.setMonth(d.getMonth()+1);
      const dim=new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); // days in target month
      d.setDate(Math.min(day, dim));
    }
    return dateKey(d);
  }
  function prettyDate(k){
    if(!k) return '';
    const d=parseKey(k); const t=parseKey(todayKey());
    const diff=Math.round((d-t)/86400000);
    if(diff===0) return 'Today';
    if(diff===1) return 'Tomorrow';
    if(diff===-1) return 'Yesterday';
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  const PRIORITY_RANK = {high:0, medium:1, low:2};
  const REPEAT_LABEL = {daily:'Daily', weekly:'Weekly', monthly:'Monthly'};
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  /* ---------- state ---------- */
  let tasks = [];
  let order = [];      // manual drag order (array of task ids)
  let notes = [];
  let currentView = 'dashboard';
  let filter = 'active';
  let areaFilter = 'all';
  let query = '';
  let calYear, calMonth, selectedDay = todayKey();
  let editingId = null;
  let dragId = null;

  /* ---------- persistence ---------- */
  function load(){
    try { tasks = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { tasks = []; }
  }
  function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); }
  function loadOrder(){
    try { order = JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch { order = []; }
    if(!order.length) order = tasks.map(t=>t.id);
  }
  function saveOrder(){ localStorage.setItem(ORDER_KEY, JSON.stringify(order)); }
  function loadNotes(){
    try { notes = JSON.parse(localStorage.getItem(NOTE_KEY)) || []; } catch { notes = []; }
  }
  function saveNotes(){ localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); }

  function orderIndex(id){ const i=order.indexOf(id); return i===-1 ? 1e9 : i; }
  function byOrder(a,b){
    const o = orderIndex(a.id) - orderIndex(b.id);
    if(o) return o;
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if(p) return p;
    return (a.due||'9999').localeCompare(b.due||'9999');
  }
  function moveTask(dId, targetId, place){
    order = order.filter(id=>id!==dId);
    const idx = order.indexOf(targetId);
    if(idx===-1) order.push(dId);
    else order.splice(place==='after' ? idx+1 : idx, 0, dId);
    saveOrder();
  }

  /* ---------- seed demo data (first run only) ---------- */
  function seedIfFirst(){
    if(localStorage.getItem(SEED_KEY)) return;
    const t = todayKey();
    const sample = [
      {title:'Review project roadmap',  priority:'high',   area:'work',     category:'Planning', due:t,            status:'todo', notes:'', repeat:'none'},
      {title:'Reply to customer emails',priority:'medium', area:'work',     category:'Comms',    due:t,            status:'todo', notes:'', repeat:'daily'},
      {title:'30 min workout',          priority:'low',    area:'personal', category:'Health',   due:t,            status:'todo', notes:'', repeat:'daily'},
      {title:'Read 20 pages',           priority:'low',    area:'personal', category:'Learning', due:addDays(t,1), status:'todo', notes:'', repeat:'none'},
      {title:'Prepare weekly report',   priority:'high',   area:'work',     category:'Planning', due:addDays(t,2), status:'todo', notes:'', repeat:'weekly'},
      {title:'Pay credit card',         priority:'medium', area:'personal', category:'Finance',  due:addDays(t,4), status:'todo', notes:'', repeat:'monthly'},
      {title:'Grocery shopping',        priority:'medium', area:'personal', category:'Errands',  due:addDays(t,-1),status:'todo', notes:'', repeat:'weekly'},
    ];
    const now = Date.now();
    tasks = sample.map((s,i)=>({id:uid(), createdAt:now+i, completedAt: s.status==='done'?now:null, ...s}));
    order = tasks.map(t=>t.id);
    save(); saveOrder();
    localStorage.setItem(SEED_KEY,'1');
    notes = [
      {id:uid(), text:'Small steps every day beat occasional sprints.', editing:false},
      {id:uid(), text:'Deep work block: 9–11am, no notifications.', editing:false},
    ];
    saveNotes();
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg){
    const el=$('#toast'); el.textContent=msg; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.add('hidden'),1900);
  }

  /* ---------- view router ---------- */
  function navigate(view){
    currentView=view;
    $$('.view').forEach(v=>v.classList.add('hidden'));
    $('#view-'+view).classList.remove('hidden');
    $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===view && !b.disabled));
    $$('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
    if(view==='dashboard') renderDashboard();
    if(view==='tasks') renderTasks();
    if(view==='timeline') renderTimeline();
  }

  /* ---------- dashboard ---------- */
  function renderDashboard(){
    const t = todayKey();
    const active = tasks.filter(x=>x.status!=='done');
    const done = tasks.filter(x=>x.status==='done');
    const overdue = active.filter(x=>x.due && x.due < t);
    const dueToday = tasks.filter(x=>x.due===t);
    const doneToday = tasks.filter(x=>x.completedAt && dateKey(new Date(x.completedAt))===t);

    $('#greet').textContent = greeting();
    $('#todayDate').textContent = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});

    const stats=[
      {cls:'s-total',ico:'◴',num:active.length,label:'Active tasks'},
      {cls:'s-done', ico:'✓',num:done.length, label:'Completed'},
      {cls:'s-prog', ico:'◔',num:dueToday.length, label:'Due today'},
      {cls:'s-over', ico:'!',num:overdue.length, label:'Overdue'},
    ];
    $('#statGrid').innerHTML = stats.map(s=>`
      <div class="stat ${s.cls}">
        <div class="ico">${s.ico}</div>
        <div class="num">${s.num}</div>
        <div class="lbl">${s.label}</div>
      </div>`).join('');

    // today ring
    const total = dueToday.length;
    const pct = total ? Math.round(doneToday.length/total*100) : 100;
    $('#ringWrap').innerHTML = ring(pct);
    $('#ringCaption').textContent = total
      ? `${doneToday.length} of ${total} done today`
      : 'Nothing scheduled today 🎉';

    // weekly chart
    const days=[]; let max=0;
    for(let i=6;i>=0;i--){
      const k=addDays(t,-i);
      const c=tasks.filter(x=>x.completedAt && dateKey(new Date(x.completedAt))===k).length;
      max=Math.max(max,c);
      days.push({k,label:parseKey(k).toLocaleDateString(undefined,{weekday:'short'}).slice(0,2),c});
    }
    $('#weekChart').innerHTML = days.map(d=>`
      <div class="bar-col">
        <span class="bar-val">${d.c||''}</span>
        <div class="bar ${d.c?'':'empty'}" style="height:${d.c?Math.max(12,d.c/max*100):4}%"></div>
        <span class="bar-label">${d.label}</span>
      </div>`).join('');

    // upcoming (next 7 days)
    const up = active
      .filter(x=>x.due && x.due>=t && x.due<=addDays(t,7))
      .sort((a,b)=> (a.due).localeCompare(b.due) || PRIORITY_RANK[a.priority]-PRIORITY_RANK[b.priority])
      .slice(0,6);
    $('#upcomingList').innerHTML = up.length
      ? up.map(x=>taskRow(x)).join('')
      : `<div class="empty-state">No upcoming tasks. Nice and calm.</div>`;

    renderAreaBars();
    renderNotes();
  }

  function renderAreaBars(){
    const areas=['work','personal'];
    $('#areaBars').innerHTML = areas.map(a=>{
      const all=tasks.filter(x=>x.area===a);
      const done=all.filter(x=>x.status==='done');
      const pct=all.length?Math.round(done.length/all.length*100):0;
      return `<div class="cat-bar">
        <div class="cat-top"><b>${a==='work'?'Work':'Personal'}</b><span class="muted">${done.length}/${all.length}</span></div>
        <div class="cat-track"><div class="cat-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  function greeting(){
    const h=new Date().getHours();
    if(h<12) return 'Good morning';
    if(h<18) return 'Good afternoon';
    return 'Good evening';
  }

  function ring(pct){
    const r=52, c=2*Math.PI*r, off=c*(1-pct/100);
    return `<svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="#eceef5" stroke-width="12"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="url(#g)" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 70 70)"/>
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/>
      </linearGradient></defs>
      <text x="70" y="68" text-anchor="middle" font-size="28" font-weight="800" fill="#1d2333">${pct}%</text>
      <text x="70" y="90" text-anchor="middle" font-size="12" fill="#8b91a7">today</text>
    </svg>`;
  }

  /* ---------- tasks view ---------- */
  function renderTasks(){
    const t=todayKey();
    let list = tasks.slice();
    if(filter==='active')   list=list.filter(x=>x.status!=='done');
    if(filter==='done')     list=list.filter(x=>x.status==='done');
    if(filter==='today')    list=list.filter(x=>x.due===t);
    if(filter==='upcoming') list=list.filter(x=>x.status!=='done' && x.due && x.due>t);
    if(areaFilter!=='all')  list=list.filter(x=>x.area===areaFilter);
    if(query) list=list.filter(x=>(x.title+' '+(x.category||'')+' '+(x.notes||'')).toLowerCase().includes(query.toLowerCase()));

    list.sort(byOrder);

    const mount=$('#taskList');
    mount.innerHTML = list.length
      ? list.map(x=>taskRow(x,{drag:true})).join('')
      : `<div class="empty-state">No tasks here yet.</div>`;

    renderCategoryBars();
    refreshCatList();
  }

  function renderCategoryBars(){
    const cats={};
    tasks.forEach(x=>{
      const c=x.category||'Other';
      cats[c]=cats[c]||{total:0,done:0};
      cats[c].total++; if(x.status==='done') cats[c].done++;
    });
    const keys=Object.keys(cats).sort((a,b)=>cats[b].total-cats[a].total).slice(0,6);
    $('#catBars').innerHTML = keys.length ? keys.map(k=>{
      const {total,done}=cats[k]; const pct=total?Math.round(done/total*100):0;
      return `<div class="cat-bar">
        <div class="cat-top"><b>${escapeHtml(k)}</b><span class="muted">${done}/${total}</span></div>
        <div class="cat-track"><div class="cat-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('') : `<div class="empty-state">No categories yet.</div>`;
  }

  function taskRow(x, opts={}){
    const drag = opts.drag ? 'draggable="true"' : '';
    const grip = opts.drag ? '<span class="grip" title="Drag to reorder">⠿</span>' : '';
    const t=todayKey();
    let dueCls='', dueTxt='';
    if(x.due){
      dueTxt=prettyDate(x.due);
      if(x.status!=='done'){ if(x.due<t) dueCls='over'; else if(x.due===t) dueCls='today'; }
    }
    return `<div class="task ${x.status==='done'?'done':''}" data-id="${x.id}" ${drag}>
      ${grip}
      <button class="check" data-act="toggle" title="Toggle done">${x.status==='done'?'✓':''}</button>
      <div class="t-main">
        <div class="t-title">${escapeHtml(x.title)}</div>
        <div class="t-meta">
          <span class="tag p-${x.priority}">${x.priority}</span>
          <span class="tag area ${x.area}">${x.area==='work'?'Work':'Personal'}</span>
          ${x.category?`<span class="tag cat">${escapeHtml(x.category)}</span>`:''}
          ${x.repeat && x.repeat!=='none'?`<span class="tag repeat" title="Repeats ${REPEAT_LABEL[x.repeat]}">🔁 ${REPEAT_LABEL[x.repeat]}</span>`:''}
          ${dueTxt?`<span class="tag due ${dueCls}">${dueTxt}</span>`:''}
        </div>
      </div>
      <div class="t-actions">
        <button data-act="edit" title="Edit">✎</button>
        <button data-act="del" title="Delete">🗑</button>
      </div>
    </div>`;
  }

  /* ---------- timeline view ---------- */
  function renderTimeline(){
    const d=selectedDay?parseKey(selectedDay):new Date();
    if(calYear===undefined){ calYear=d.getFullYear(); calMonth=d.getMonth(); }
    const first=new Date(calYear,calMonth,1);
    const startDow=first.getDay();
    const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
    const prevDays=new Date(calYear,calMonth,0).getDate();
    $('#calLabel').textContent = first.toLocaleDateString(undefined,{month:'long',year:'numeric'});

    const cells=[];
    for(let i=0;i<startDow;i++) cells.push({muted:true,num:prevDays-startDow+1+i});
    for(let d=1;d<=daysInMonth;d++) cells.push({muted:false,num:d,key:dateKey(new Date(calYear,calMonth,d))});
    const tail=(7-(cells.length%7))%7;
    for(let i=1;i<=tail;i++) cells.push({muted:true,num:i});

    const dows=['S','M','T','W','T','F','S'];
    $('#calendar').innerHTML =
      dows.map(w=>`<div class="cal-dow">${w}</div>`).join('') +
      cells.map(c=>{
        if(c.muted) return `<div class="cal-cell muted-cell"><span class="cal-num">${c.num}</span></div>`;
        const dayTasks=tasks.filter(x=>x.due===c.key);
        const dots=dayTasks.slice(0,4).map(x=>`<span class="cal-dot p-${x.priority}"></span>`).join('');
        const cls=[c.key===todayKey()?'today':'', c.key===selectedDay?'selected':''].join(' ').trim();
        return `<div class="cal-cell ${cls}" data-day="${c.key}">
          <span class="cal-num">${c.num}</span>
          <div class="cal-dots">${dots}</div>
        </div>`;
      }).join('');

    renderAgenda();
  }

  function renderAgenda(){
    $('#agendaTitle').textContent = selectedDay===todayKey()
      ? 'Today'
      : (selectedDay?prettyDate(selectedDay):'—');
    const list=tasks.filter(x=>x.due===selectedDay).sort(byOrder);
    $('#agenda').innerHTML = list.length
      ? list.map(x=>taskRow(x,{drag:true})).join('')
      : `<div class="empty-state">No tasks this day.</div>`;
  }

  /* ---------- modal (add/edit) ---------- */
  function openModal(task){
    editingId = task? task.id : null;
    $('#modalTitle').textContent = task? 'Edit task':'New task';
    $('#fTitle').value   = task? task.title:'';
    $('#fPriority').value= task? task.priority:'medium';
    $('#fArea').value    = task? (task.area||'personal'):'personal';
    $('#fCategory').value= task? task.category:'';
    $('#fDue').value     = task? task.due:'';
    $('#fRepeat').value  = task? (task.repeat||'none'):'none';
    $('#fStatus').value  = task? task.status:'todo';
    $('#fNotes').value   = task? task.notes:'';
    $('#modalDelete').hidden = !task;
    $('#taskModal').classList.remove('hidden');
    setTimeout(()=>$('#fTitle').focus(),50);
  }
  function closeModal(){ $('#taskModal').classList.add('hidden'); editingId=null; }

  function submitTask(e){
    e.preventDefault();
    const data={
      title:$('#fTitle').value.trim(),
      priority:$('#fPriority').value,
      area:$('#fArea').value,
      category:$('#fCategory').value.trim(),
      due:$('#fDue').value||'',
      repeat:$('#fRepeat').value||'none',
      status:$('#fStatus').value,
      notes:$('#fNotes').value.trim(),
    };
    if(!data.title) return;
    if(editingId){
      const x=tasks.find(t=>t.id===editingId);
      Object.assign(x,data);
      x.completedAt = data.status==='done' ? (x.completedAt||Date.now()) : null;
      toast('Task updated');
    }else{
      const id=uid();
      tasks.push({id, createdAt:Date.now(), completedAt: data.status==='done'?Date.now():null, ...data});
      order.push(id); saveOrder();
      toast('Task added');
    }
    save(); closeModal(); refresh();
  }

  function refresh(){
    if(currentView==='dashboard') renderDashboard();
    if(currentView==='tasks') renderTasks();
    if(currentView==='timeline') renderTimeline();
  }

  /* ---------- notes ---------- */
  function renderNotes(){
    const mount=$('#noteList');
    if(!notes.length){ mount.innerHTML=`<div class="empty-state">No notes yet. Add a quote or reminder.</div>`; return; }
    mount.innerHTML = notes.map(n=>`
      <div class="note" data-id="${n.id}">
        <span class="note-q">“</span>
        <div class="note-body">
          ${n.editing
            ? `<input class="note-edit" data-id="${n.id}" value="${escapeHtml(n.text)}" maxlength="200" />`
            : `<span class="note-text">${escapeHtml(n.text)}</span>`}
        </div>
        <div class="t-actions">
          <button data-nact="edit" title="Edit">✎</button>
          <button data-nact="del" title="Delete">🗑</button>
        </div>
      </div>`).join('');
  }
  function addNote(){
    const v=$('#noteInput').value.trim(); if(!v) return;
    notes.unshift({id:uid(), text:v, editing:false});
    saveNotes(); $('#noteInput').value=''; renderNotes();
  }

  /* ---------- drag & drop ---------- */
  function getDragAfterElement(container,y){
    const rows=[...container.querySelectorAll('.task:not(.dragging)')];
    let closest={dist:Number.NEGATIVE_INFINITY, el:null};
    for(const r of rows){
      const box=r.getBoundingClientRect();
      const offset=y-(box.top+box.height/2);
      if(offset<0 && offset>closest.dist) closest={dist:offset, el:r};
    }
    return closest.el;
  }
  function lastVisibleId(container){
    const rows=[...container.querySelectorAll('.task')];
    return rows.length ? rows[rows.length-1].dataset.id : null;
  }
  function makeDraggable(container){
    if(!container) return;
    container.addEventListener('dragstart', e=>{
      const row=e.target.closest('.task'); if(!row) return;
      dragId=row.dataset.id; row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      try{ e.dataTransfer.setData('text/plain',dragId); }catch(_){}
    });
    container.addEventListener('dragend', e=>{
      const row=e.target.closest('.task'); if(row) row.classList.remove('dragging');
      container.querySelectorAll('.task').forEach(r=>r.classList.remove('drag-over'));
      dragId=null;
    });
    container.addEventListener('dragover', e=>{
      e.preventDefault();
      const after=getDragAfterElement(container,e.clientY);
      container.querySelectorAll('.task').forEach(r=>r.classList.remove('drag-over'));
      if(after) after.classList.add('drag-over');
    });
    container.addEventListener('drop', e=>{
      e.preventDefault();
      if(!dragId) return;
      const after=getDragAfterElement(container,e.clientY);
      const targetId = after ? after.dataset.id : lastVisibleId(container);
      if(targetId && targetId!==dragId){
        moveTask(dragId, targetId, after?'before':'after');
        save(); refresh();
      }
      container.querySelectorAll('.task').forEach(r=>r.classList.remove('drag-over'));
    });
  }

  /* ---------- utils ---------- */
  function refreshCatList(){
    const cats=[...new Set(tasks.map(x=>x.category).filter(Boolean))];
    $('#catList').innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">`).join('');
  }

  /* ---------- events ---------- */
  function bindEvents(){
    $$('[data-view]').forEach(b=>{
      if(b.disabled) return;
      b.addEventListener('click',()=>navigate(b.dataset.view));
    });

    $('#quickAddBtn').addEventListener('click',()=>openModal(null));
    $$('[data-open-add]').forEach(b=>b.addEventListener('click',()=>openModal(null)));

    // delegated clicks (tasks + notes)
    document.addEventListener('click',(e)=>{
      const nAct=e.target.closest('[data-nact]');
      if(nAct){
        const noteEl=e.target.closest('.note'); const id=noteEl.dataset.id;
        const n=notes.find(x=>x.id===id); if(!n) return;
        if(nAct.dataset.nact==='del'){ notes=notes.filter(x=>x.id!==id); saveNotes(); renderNotes(); }
        else if(nAct.dataset.nact==='edit'){ notes.forEach(x=>x.editing=false); n.editing=true; renderNotes();
          setTimeout(()=>{ const inp=$('.note-edit'); if(inp){inp.focus(); inp.select();} },30); }
        return;
      }
      const actBtn=e.target.closest('[data-act]');
      if(actBtn){
        const row=e.target.closest('.task'); const id=row.dataset.id;
        const x=tasks.find(t=>t.id===id); if(!x) return;
        const act=actBtn.dataset.act;
        if(act==='toggle'){
          if(x.status==='done'){
            x.status='todo'; x.completedAt=null;
          }else if(x.repeat && x.repeat!=='none'){
            x.status='done'; x.completedAt=Date.now();
            const nid=uid();
            const due2 = x.due ? nextDue(x.repeat, x.due) : nextDue(x.repeat, todayKey());
            tasks.push({id:nid, createdAt:Date.now(), completedAt:null,
              title:x.title, priority:x.priority, area:x.area, category:x.category,
              due:due2, status:'todo', notes:x.notes, repeat:x.repeat});
            order.push(nid); saveOrder();
            toast('Repeated → '+prettyDate(due2));
          }else{
            x.status='done'; x.completedAt=Date.now();
          }
          save(); refresh();
        }else if(act==='edit'){ openModal(x); }
        else if(act==='del'){ tasks=tasks.filter(t=>t.id!==id); order=order.filter(o=>o!==id); saveOrder(); save(); refresh(); toast('Task deleted'); }
        return;
      }
      const cell=e.target.closest('.cal-cell[data-day]');
      if(cell){ selectedDay=cell.dataset.day; renderTimeline(); }
    });

    // filters + area
    $('#filterChips').addEventListener('click',(e)=>{
      const c=e.target.closest('.chip'); if(!c) return;
      $$('#filterChips .chip').forEach(x=>x.classList.remove('active'));
      c.classList.add('active'); filter=c.dataset.filter; renderTasks();
    });
    $('#areaChips').addEventListener('click',(e)=>{
      const c=e.target.closest('.chip'); if(!c) return;
      $$('#areaChips .chip').forEach(x=>x.classList.remove('active'));
      c.classList.add('active'); areaFilter=c.dataset.area; renderTasks();
    });
    $('#searchInput').addEventListener('input',(e)=>{ query=e.target.value; renderTasks(); });

    // calendar nav
    $('#calPrev').addEventListener('click',()=>{ calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderTimeline(); });
    $('#calNext').addEventListener('click',()=>{ calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderTimeline(); });

    // modal
    $('#modalClose').addEventListener('click',closeModal);
    $('#modalCancel').addEventListener('click',closeModal);
    $('#taskForm').addEventListener('submit',submitTask);
    $('#modalDelete').addEventListener('click',()=>{
      if(editingId){ tasks=tasks.filter(t=>t.id!==editingId); order=order.filter(o=>o!==editingId); saveOrder(); save(); closeModal(); refresh(); toast('Task deleted'); }
    });
    $('#taskModal').addEventListener('click',(e)=>{ if(e.target.id==='taskModal') closeModal(); });

    // notes
    $('#noteAdd').addEventListener('click',addNote);
    $('#noteInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addNote(); }});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape') closeModal();
      if(e.key==='Enter' && e.target.classList && e.target.classList.contains('note-edit')){ e.preventDefault(); e.target.blur(); }
      if(e.key==='Escape' && e.target.classList && e.target.classList.contains('note-edit')){
        const n=notes.find(x=>x.id===e.target.dataset.id); if(n){ n.editing=false; renderNotes(); }
      }
    });
    document.addEventListener('blur',e=>{
      if(e.target.classList && e.target.classList.contains('note-edit')){
        const n=notes.find(x=>x.id===e.target.dataset.id);
        if(n){ n.text=e.target.value.trim()||n.text; n.editing=false; saveNotes(); renderNotes(); }
      }
    },true);

    // drag & drop on the two re-orderable lists
    makeDraggable($('#taskList'));
    makeDraggable($('#agenda'));

    $('#clearData').addEventListener('click',()=>{
      if(confirm('Clear all tasks, notes and order? This cannot be undone.')){
        tasks=[]; order=[]; notes=[];
        save(); saveOrder(); saveNotes();
        localStorage.removeItem(SEED_KEY);
        refresh(); toast('All data cleared');
      }
    });
  }

  /* ---------- boot ---------- */
  load();
  loadOrder();
  loadNotes();
  seedIfFirst();
  bindEvents();
  navigate('dashboard');
})();
