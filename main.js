// Habit Tracker — original UI, STORAGE REWORKED: adapter.read/write + recursive dirs + immediate writes
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, normalizePath } = require('obsidian');

/* ====== Consts ====== */
const VIEW_TYPE = "habit-tracker-view";
const DEFAULT_DIR = "HabitTracker";
const MODE_MONTH = "month";
const MODE_WEEK  = "week";

/* ====== Helpers ====== */
function pad2(n){ return (n<10?"0":"")+n; }
function monthIdFromDate(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1); }
function weekIdFromDate(d){
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const firstDay = new Date(year, d.getMonth(), 1);
  const firstDayWeek = firstDay.getDay() || 7;
  const offset = firstDayWeek - 1;
  const weekNum = Math.ceil((d.getDate() + offset) / 7);
  return `${year}-${month}-W${weekNum}`;
}
function monthNameRu(idx){
  const ru = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  return ru[idx];
}
function getWeekDates(year, month, weekNumber) {
  const firstDayOfMonth = new Date(year, month, 1);
  const firstDayOfWeek = firstDayOfMonth.getDay() || 7;
  let startDate = new Date(year, month, 1 + (weekNumber - 1) * 7 - (firstDayOfWeek - 1));
  if (startDate.getMonth() !== month) startDate = new Date(year, month, 1);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  if (endDate.getMonth() !== month) endDate.setDate(new Date(year, month + 1, 0).getDate());
  return { start: startDate, end: endDate };
}
function getWeeksInMonth(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const firstDayWeek = firstDay.getDay() || 7;
  return Math.ceil((daysInMonth + firstDayWeek - 1) / 7);
}
function emptyPeriodData(habits){
  return { habits: habits ? habits.slice() : [], states: {}, order: habits ? habits.slice() : [], version: 1 };
}
function stateToChar(s){ return s===1 ? "●" : s===2 ? "×" : "○"; }

/* ====== Modals ====== */
class HabitEditModal extends Modal {
  constructor(app, oldName, onSubmit){ super(app); this.oldName=oldName; this.onSubmit=onSubmit; }
  onOpen(){
    const c=this.contentEl; c.createEl('h2',{text:'Редактировать дело'});
    const inp=c.createDiv({cls:'modal-input-container'}).createEl('input',{type:'text',value:this.oldName,cls:'modal-input'});
    this.inputEl=inp; inp.focus(); inp.select();
    const bx=this.contentEl.createDiv({cls:'modal-button-container'});
    const ok=bx.createEl('button',{cls:'mod-cta',text:'Сохранить'});
    const cancel=bx.createEl('button',{text:'Отмена'});
    ok.onclick=()=>this.submit(); cancel.onclick=()=>this.close();
    inp.onkeydown=(e)=>{ if(e.key==='Enter')this.submit(); if(e.key==='Escape')this.close(); };
  }
  submit(){ const v=this.inputEl.value.trim(); if(v && v!==this.oldName) this.onSubmit(v); this.close(); }
  onClose(){ this.contentEl.empty(); }
}
class HabitDeleteModal extends Modal {
  constructor(app, habitName, onSubmit){ super(app); this.habitName=habitName; this.onSubmit=onSubmit; }
  onOpen(){
    const c=this.contentEl; c.createEl('h2',{text:'Удалить дело'});
    c.createEl('p',{text:`Вы уверены, что хотите удалить дело "${this.habitName}"?`});
    const bx=c.createDiv({cls:'modal-button-container'});
    const del=bx.createEl('button',{cls:'mod-warning',text:'Удалить'});
    const cancel=bx.createEl('button',{text:'Отмена'});
    del.onclick=()=>{ this.onSubmit(); this.close(); }; cancel.onclick=()=>this.close();
  }
  onClose(){ this.contentEl.empty(); }
}
class DateSelectionModal extends Modal {
  constructor(app, currentDate, mode, onSubmit){ super(app); this.currentDate=new Date(currentDate); this.mode=mode; this.onSubmit=onSubmit; }
  onOpen(){
    const c=this.contentEl; c.createEl('h2',{text:'Выберите дату'});
    const cal=c.createDiv({cls:'htrk-calendar'});
    const header=cal.createDiv({cls:'htrk-calendar-header'});
    const prev=header.createEl('button',{cls:'htrk-calendar-nav',text:'←'});
    const title=header.createDiv({cls:'htrk-calendar-month'});
    const next=header.createEl('button',{cls:'htrk-calendar-nav',text:'→'});
    const wd=cal.createDiv({cls:'htrk-calendar-weekdays'});
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d=>wd.createDiv({cls:'htrk-calendar-weekday',text:d}));
    this.daysGrid=cal.createDiv({cls:'htrk-calendar-days'});
    const render=()=>this._renderMonth(title);
    prev.onclick=()=>{ this.currentDate.setMonth(this.currentDate.getMonth()-1); render(); };
    next.onclick=()=>{ this.currentDate.setMonth(this.currentDate.getMonth()+1); render(); };
    render();
    const bx=c.createDiv({cls:'modal-button-container'});
    bx.createEl('button',{text:'Отмена'}).onclick=()=>this.close();
  }
  _renderMonth(monthYear){
    const y=this.currentDate.getFullYear(), m=this.currentDate.getMonth();
    monthYear.setText(`${monthNameRu(m)} ${y}`); this.daysGrid.empty();
    const first=new Date(y,m,1), last=new Date(y,m+1,0), days=last.getDate();
    let start=first.getDay(); if(start===0) start=7; start-=1;
    for(let i=0;i<start;i++) this.daysGrid.createDiv({cls:'htrk-calendar-day empty'});
    for(let d=1; d<=days; d++){
      const cell=this.daysGrid.createDiv({cls:'htrk-calendar-day'}); cell.setText(d);
      const t=new Date(); if(y===t.getFullYear() && m===t.getMonth() && d===t.getDate()) cell.addClass('today');
      cell.onclick=()=>{ const sel=new Date(y,m,d); this.onSubmit(this.mode===MODE_MONTH?monthIdFromDate(sel):weekIdFromDate(sel)); this.close(); };
    }
  }
  onClose(){ this.contentEl.empty(); }
}

/* ====== Settings ====== */
class HabitTrackerSettingTab extends PluginSettingTab {
  constructor(app, plugin){ super(app, plugin); this.plugin=plugin; }
  display(){
    const c=this.containerEl; c.empty();
    new Setting(c)
      .setName('Папка для данных')
      .setDesc('Внутри появятся папки months/ и weeks/')
      .addText(t=>t.setPlaceholder(DEFAULT_DIR).setValue(this.plugin.settings.dataFolder)
        .onChange(async v=>{ this.plugin.settings.dataFolder=v||DEFAULT_DIR; await this.plugin.saveSettings(); }));
  }
}

/* ====== STORAGE (reworked) ====== */
class Storage {
  constructor(plugin){ this.plugin=plugin; }

  _path(id, mode){
    const base = normalizePath(this.plugin.settings.dataFolder || DEFAULT_DIR);
    const sub  = mode===MODE_MONTH ? 'months' : 'weeks';
    return normalizePath(`${base}/${sub}/${id}.json`);
  }

  async _ensureDirs(mode){
    const base = normalizePath(this.plugin.settings.dataFolder || DEFAULT_DIR);
    const sub  = mode===MODE_MONTH ? 'months' : 'weeks';
    // создаём базовую папку и подпапку, если их нет
    const ensure = async (p) => { if(!(await this.plugin.app.vault.adapter.exists(p))) await this.plugin.app.vault.adapter.mkdir(p); };
    await ensure(base);
    await ensure(`${base}/${sub}`);
  }

  async read(id, mode){
    try{
      await this._ensureDirs(mode);
      const path = this._path(id, mode);
      if (!(await this.plugin.app.vault.adapter.exists(path))){
        const init = emptyPeriodData([]);
        await this.plugin.app.vault.adapter.write(path, JSON.stringify(init, null, 2));
        return init;
      }
      const raw = await this.plugin.app.vault.adapter.read(path);
      const data = JSON.parse(raw || "{}");
      // sane defaults
      if (!data.habits) data.habits=[];
      if (!data.states) data.states={};
      if (!data.order)  data.order=data.habits.slice();
      // order = только существующие + хвост новых
      const valid = data.order.filter(h=>data.habits.includes(h));
      const tail  = data.habits.filter(h=>!valid.includes(h));
      data.order = [...valid, ...tail];
      return data;
    }catch(e){
      console.error("Storage.read error", e);
      new Notice("Ошибка чтения данных трекера");
      return emptyPeriodData([]);
    }
  }

  async write(id, mode, data){
    try{
      await this._ensureDirs(mode);
      const path = this._path(id, mode);
      await this.plugin.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    }catch(e){
      console.error("Storage.write error", e);
      new Notice("Ошибка сохранения данных трекера");
    }
  }
}

/* ====== Plugin ====== */
class HabitTrackerPlugin extends Plugin {
  async onload(){
    // глобальные настройки + state (через saveData)
    const saved = await this.loadData() || {};
    this.settings = Object.assign({ dataFolder: DEFAULT_DIR }, saved.settings || {});
    this.state    = Object.assign({
      currentMonth: monthIdFromDate(new Date()),
      currentWeek : weekIdFromDate(new Date()),
      mode        : MODE_MONTH
    }, saved.state || {});

    this.storage = new Storage(this);

    // view + команды
    this.registerView(VIEW_TYPE, leaf => new HabitTrackerView(leaf, this));
    this.addRibbonIcon("check-circle", "Open Habit Tracker", () => this.activateView());
    this.addCommand({ id:"open-habit-tracker", name:"Open Habit Tracker", callback:()=>this.activateView() });
    this.addSettingTab(new HabitTrackerSettingTab(this.app, this));
  }

  async onunload(){
    await this.savePluginData(); // сохранить settings/state
  }

  async activateView(){
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) return this.app.workspace.revealLeaf(leaves[0]);
    const right = this.app.workspace.getRightLeaf(false);
    await right.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(right);
  }

  /* settings/state */
  async savePluginData(){ await this.saveData({ settings:this.settings, state:this.state }); }
  async saveSettings(){ await this.savePluginData(); }
  async saveState(){ await this.savePluginData(); }

  /* API для view */
  async loadDataById(id, mode){ return await this.storage.read(id, mode); }
  async saveDataById(id, data, mode){ await this.storage.write(id, mode, data); }
}

/* ====== View (оригинальный UI как был) ====== */
class HabitTrackerView extends ItemView {
  constructor(leaf, plugin){
    super(leaf);
    this.plugin = plugin;
    this.mode = plugin.state.mode || MODE_MONTH;
    this.currentId = this.mode===MODE_MONTH ? (plugin.state.currentMonth || monthIdFromDate(new Date()))
                                            : (plugin.state.currentWeek  || weekIdFromDate(new Date()));
    this.cachedData = new Map();
    this.inputElement = null;
    this.draggedRow = null;
  }
  getViewType(){ return VIEW_TYPE; }
  getDisplayText(){ return "Трекер задач"; }

  async onOpen(){
    const container = this.containerEl.children[1];
    container.empty();
    this.root = container.createDiv({cls:"htrk-container"});

    this.currentTitle = this.root.createDiv({cls:"htrk-current-title"});

    const header = this.root.createDiv({cls:"htrk-header"});
    header.createDiv({cls:"htrk-title", text:"Трекер задач"});

    const nav = header.createDiv({cls:"htrk-nav-container"});
    const modeSw = nav.createDiv({cls:"htrk-mode-switcher"});
    const monthBtn = modeSw.createEl("button",{cls:`htrk-mode-btn ${this.mode===MODE_MONTH?'active':''}`,text:"Месяц"});
    const weekBtn  = modeSw.createEl("button",{cls:`htrk-mode-btn ${this.mode===MODE_WEEK?'active':''}`, text:"Неделя"});

    const navBtns = nav.createDiv({cls:"htrk-nav-buttons"});
    const prevBtn = navBtns.createEl("button",{cls:"htrk-nav-btn", text:"←"});
    const dateBtn = navBtns.createEl("button",{cls:"htrk-date-btn"});
    const nextBtn = navBtns.createEl("button",{cls:"htrk-nav-btn", text:"→"});
    const todayBtn= navBtns.createEl("button",{cls:"htrk-nav-btn today", text:"Сегодня", title:"Перейти к текущему периоду"});

    const updateDateBtn = ()=> {
      if (this.mode===MODE_MONTH) {
        const [y,m]=this.currentId.split('-'); dateBtn.setText(`${monthNameRu(parseInt(m)-1)} ${y}`);
      } else {
        const [y,m,wStr]=this.currentId.split('-'); const w=parseInt(wStr.slice(1));
        const range=getWeekDates(parseInt(y), parseInt(m)-1, w);
        dateBtn.setText(`Неделя ${w} (${range.start.getDate()}-${range.end.getDate()} ${monthNameRu(parseInt(m)-1)})`);
      }
    };
    updateDateBtn();

    monthBtn.onclick = async ()=>{ if(this.mode!==MODE_MONTH){ this.mode=MODE_MONTH; this.plugin.state.mode=MODE_MONTH; if(this.currentId.includes('W')){ const [y,m]=this.currentId.split('-'); this.currentId=`${y}-${m}`; this.plugin.state.currentMonth=this.currentId; } await this.plugin.saveState(); updateDateBtn(); await this.render(); } };
    weekBtn.onclick  = async ()=>{ if(this.mode!==MODE_WEEK ){ this.mode=MODE_WEEK ; this.plugin.state.mode=MODE_WEEK ; if(!this.currentId.includes('W')) this.currentId=weekIdFromDate(new Date()); this.plugin.state.currentWeek=this.currentId; await this.plugin.saveState(); updateDateBtn(); await this.render(); } };

    prevBtn.onclick = async ()=>{ await this.navigate(-1); updateDateBtn(); await this.render(); };
    nextBtn.onclick = async ()=>{ await this.navigate( 1); updateDateBtn(); await this.render(); };
    todayBtn.onclick= async ()=>{ if(this.mode===MODE_MONTH){ this.currentId=monthIdFromDate(new Date()); this.plugin.state.currentMonth=this.currentId; } else { this.currentId=weekIdFromDate(new Date()); this.plugin.state.currentWeek=this.currentId; } await this.plugin.saveState(); updateDateBtn(); await this.render(); };

    const toolbar = this.root.createDiv({cls:"htrk-toolbar"});
    this.inputElement = toolbar.createEl("input",{cls:"htrk-input", type:"text", placeholder:"Новая задача…"});
    const addBtn = toolbar.createEl("button",{cls:"htrk-btn", text:"Добавить"});
    const add = async ()=>{
      const name=(this.inputElement.value||"").trim();
      if(!name) return new Notice("Введите название дела");
      const data=await this.getData();
      if (data.habits.includes(name)) return new Notice("Такое дело уже есть");
      data.habits.push(name); data.order.push(name); data.states[name]={};
      await this.saveData(data); this.inputElement.value=""; await this.render(); this._focusInput();
    };
    addBtn.onclick=add; this.inputElement.onkeypress=(e)=>{ if(e.key==='Enter') add(); };

    this.root.createDiv({cls:"htrk-legend", text:"○ пусто • ● выполнено • × пропуск"});

    this.tableHost = this.root.createDiv({cls:"htrk-table-container"});
    this.graphHost = this.root.createDiv({cls:"htrk-graph"});

    await this.render(); this._focusInput();
  }

  getCacheKey(){ return `${this.mode}:${this.currentId}`; }

  async navigate(dir){
    if (this.mode===MODE_MONTH){
      const [y,m]=this.currentId.split('-').map(Number);
      this.currentId = monthIdFromDate(new Date(y, m-1+dir, 1));
      this.plugin.state.currentMonth=this.currentId;
    } else {
      const [y, m, wStr] = this.currentId.split('-'); let w=parseInt(wStr.slice(1));
      let mm=parseInt(m), yy=parseInt(y);
      w += dir; let weeks = getWeeksInMonth(yy, mm-1);
      if (w<1){ mm--; if(mm<1){ mm=12; yy--; } w = getWeeksInMonth(yy, mm-1); }
      else if (w>weeks){ mm++; if(mm>12){ mm=1; yy++; } w=1; }
      this.currentId = `${yy}-${pad2(mm)}-W${w}`;
      this.plugin.state.currentWeek=this.currentId;
    }
    await this.plugin.saveState();
  }

  async getData(){
    const key=this.getCacheKey();
    if (this.cachedData.has(key)) return this.cachedData.get(key);
    const d = await this.plugin.loadDataById(this.currentId, this.mode);
    if(!d.habits) d.habits=[]; if(!d.states) d.states={}; if(!d.order) d.order=d.habits.slice();
    const valid = d.order.filter(h=>d.habits.includes(h));
    const tail  = d.habits.filter(h=>!valid.includes(h));
    d.order=[...valid,...tail];
    this.cachedData.set(key, d);
    return d;
  }

  async saveData(d){
    this.cachedData.set(this.getCacheKey(), d);
    await this.plugin.saveDataById(this.currentId, d, this.mode); // СРАЗУ пишем файл (без очередей)
  }

  _focusInput(){ if(this.inputElement) setTimeout(()=>this.inputElement.focus(),100); }

  async render(){
    let titleText='', days=[];
    if (this.mode===MODE_MONTH){
      const [y,m]=this.currentId.split('-').map(x=>parseInt(x,10));
      titleText=`${monthNameRu(m-1)} ${y}`;
      const dInMonth=new Date(y, m, 0).getDate();
      days = Array.from({length:dInMonth}, (_,i)=>i+1);
    } else {
      const [y, m, wStr]=this.currentId.split('-'); const w=parseInt(wStr.slice(1));
      const range=getWeekDates(parseInt(y), parseInt(m)-1, w);
      titleText=`Неделя ${w} (${range.start.getDate()}-${range.end.getDate()} ${monthNameRu(parseInt(m)-1)})`;
      days = Array.from({length:7}, (_,i)=>{ const d=new Date(range.start); d.setDate(range.start.getDate()+i); return {dayOfMonth:d.getDate(), date:d}; });
    }
    this.currentTitle.setText(titleText);

    const host=this.tableHost; host.empty();
    const data=await this.getData();

    const table=host.createEl('table',{cls:'htrk-table'});
    const thead=table.createEl('thead'); const hr=thead.createEl('tr');
    const hHdr=hr.createEl('th',{cls:'htrk-habit-header', text:'Задачи'}); hHdr.style.width='200px';

    if (this.mode===MODE_MONTH){
      for (const d of days){ const th=hr.createEl('th',{text:String(d)}); th.style.minWidth='30px'; }
    } else {
      for (const d of days){
        const names=["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
        const th=hr.createEl('th',{cls:'htrk-week-header', text:`${d.dayOfMonth}\n${names[d.date.getDay()]}`});
        th.style.minWidth='30px'; th.title=`${d.dayOfMonth} ${monthNameRu(d.date.getMonth())}`;
      }
    }

    const tbody=table.createEl('tbody');
    const ordered = data.order.filter(h=>data.habits.includes(h));

    for (let i=0;i<ordered.length;i++){
      const habit=ordered[i];
      const tr=tbody.createEl('tr'); tr.setAttr('data-habit',habit); tr.setAttr('draggable','true');

      const nameTd=tr.createEl('td',{cls:'htrk-habit-cell'});
      nameTd.createSpan({cls:'htrk-drag-handle', text:'⋮⋮'});
      nameTd.createSpan({cls:'htrk-habit-name', text:habit});
      const actions=nameTd.createDiv({cls:'htrk-row-actions'});
      const edit=actions.createEl('button',{cls:'htrk-icon-btn', text:'✎'});
      const del =actions.createEl('button',{cls:'htrk-icon-btn', text:'🗑'});

      edit.onclick=()=> new HabitEditModal(this.app, habit, async (newName)=>{
        if (!newName.trim()) return new Notice("Название не может быть пустым");
        const d=await this.getData();
        if (d.habits.includes(newName)) return new Notice("Имя уже используется");
        const hi=d.habits.indexOf(habit); const oi=d.order.indexOf(habit);
        if (hi!==-1) d.habits[hi]=newName; if (oi!==-1) d.order[oi]=newName;
        d.states[newName]=d.states[habit]||{}; delete d.states[habit];
        await this.saveData(d); await this.render(); this._focusInput();
      }).open();

      del.onclick=()=> new HabitDeleteModal(this.app, habit, async ()=>{
        const d=await this.getData();
        const hi=d.habits.indexOf(habit); const oi=d.order.indexOf(habit);
        if (hi!==-1) d.habits.splice(hi,1); if (oi!==-1) d.order.splice(oi,1);
        delete d.states[habit];
        await this.saveData(d); await this.render(); this._focusInput();
      }).open();

      if (this.mode===MODE_MONTH){
        for (const day of days){
          const td=tr.createEl('td',{cls:'htrk-cell'}); const st = data.states[habit]?.[day] ?? 0;
          td.setText(stateToChar(st)); td.setAttr('data-day', day);
          td.onclick=async ()=>{ const d=await this.getData(); const cur=d.states[habit]?.[day]||0; const ns=(cur+1)%3; if(!d.states[habit]) d.states[habit]={}; d.states[habit][day]=ns; td.setText(stateToChar(ns)); await this.saveData(d); await this._drawGraph(d, days); };
        }
      } else {
        for (const d of days){
          const td=tr.createEl('td',{cls:'htrk-cell'}); const st = data.states[habit]?.[d.dayOfMonth] ?? 0;
          td.setText(stateToChar(st)); td.setAttr('data-day', d.dayOfMonth);
          td.onclick=async ()=>{ const dat=await this.getData(); const cur=dat.states[habit]?.[d.dayOfMonth]||0; const ns=(cur+1)%3; if(!dat.states[habit]) dat.states[habit]={}; dat.states[habit][d.dayOfMonth]=ns; td.setText(stateToChar(ns)); await this.saveData(dat); await this._drawGraph(dat, days); };
        }
      }

      // drag & drop reorder
      tr.addEventListener('dragstart',(e)=>{ this.draggedRow=tr; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', habit); tr.classList.add('dragging'); });
      tr.addEventListener('dragend',()=>{ tr.classList.remove('dragging'); this.draggedRow=null; });
      tr.addEventListener('dragover',(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; });
      tr.addEventListener('drop', async (e)=>{
        e.preventDefault();
        if (this.draggedRow && this.draggedRow!==tr){
          const dragged = this.draggedRow.getAttribute('data-habit');
          const target  = tr.getAttribute('data-habit');
          const d=await this.getData();
          const di=d.order.indexOf(dragged), ti=d.order.indexOf(target);
          if (di!==-1 && ti!==-1){ d.order.splice(di,1); d.order.splice(ti,0,dragged); await this.saveData(d); await this.render(); }
        }
      });
    }

    if (data.habits.length===0){
      const tr=tbody.createEl('tr'); const td=tr.createEl('td'); td.colSpan=1+days.length; td.setText("Добавьте первую задачу выше.");
    }

    await this._drawGraph(data, days);
  }

  async _drawGraph(data, days){
    const host=this.graphHost; host.empty(); if (data.habits.length===0) return;
    const canvas=host.createEl('canvas'); canvas.width=Math.max(host.clientWidth,400); canvas.height=180;
    const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
    const points=[];
    if (this.mode===MODE_MONTH){
      for(const day of days){ let done=0; for(const h of data.habits){ const st=data.states[h]?.[day]||0; if(st===1) done++; } points.push(data.habits.length? (done/data.habits.length)*100:0); }
    } else {
      for(const d of days){ let done=0; for(const h of data.habits){ const st=data.states[h]?.[d.dayOfMonth]||0; if(st===1) done++; } points.push(data.habits.length? (done/data.habits.length)*100:0); }
    }
    const W=canvas.width,H=canvas.height, L=40,R=20,T=20,B=30, iW=W-L-R, iH=H-T-B;
    const css=(v,def)=>getComputedStyle(document.body).getPropertyValue(v)||def;
    const textMuted=css('--text-muted','#999'), textNormal=css('--text-normal','#000');
    ctx.strokeStyle=textMuted; ctx.fillStyle=textMuted; ctx.lineWidth=1;
    const yTicks=[0,25,50,75,100];
    for(const v of yTicks){ const y=T+(iH-(v/100)*iH); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(L+iW,y); ctx.stroke(); ctx.fillText(`${v}%`,5,y+4); }
    if(points.length>0){ ctx.fillStyle=textMuted; ctx.font='10px sans-serif'; ctx.textAlign='center';
      for(let i=0;i<points.length;i++){ const x=L+(i/(points.length-1))*iW; const lbl=this.mode===MODE_MONTH?(i+1):days[i].dayOfMonth; ctx.fillText(lbl, x, H-10); }
    }
    const xScale=i=>L+(i/(points.length-1))*iW, yScale=v=>T+(iH-(v/100)*iH);
    if(points.length>1){ ctx.strokeStyle=textNormal; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(xScale(0), yScale(points[0]||0));
      for(let i=1;i<points.length;i++){ ctx.lineTo(xScale(i), yScale(points[i]||0)); } ctx.stroke(); }
  }

  async onClose(){ /* ничего — запись идёт сразу */ }
}

module.exports = HabitTrackerPlugin;
