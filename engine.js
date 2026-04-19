// ════════════════════════════════════════════════════════
//  PROCESS LIFECYCLE VISUALIZATION TOOL
//  Frontend Engine — Communicates with C Backend via HTTP
// ════════════════════════════════════════════════════════

const API = '';  // same origin (served by C backend)

// ════════════════════════════════════════════════════════
//  TRANSITION INFO (kept in frontend for instant modals)
// ════════════════════════════════════════════════════════
const TINFO = {
  'new-ready':{icon:'🆕',title:'New → Ready (Process Admission)',desc:'The OS allocates memory for this process and fully initializes its PCB (Process Control Block) — assigning a unique PID, recording arrival time, burst time, and priority. The process joins the tail of the Ready Queue and waits for its first CPU time slice.'},
  'ready-running':{icon:'⚡',title:'Ready → Running (CPU Dispatch)',desc:'The CPU scheduler selects this process from the Ready Queue using the active algorithm:\n• FCFS — oldest arrival time wins\n• Round Robin — next in circular order\n• Priority — lowest priority number wins\n• SJF — shortest remaining burst wins\nThe OS performs a context load: it restores CPU registers and the program counter from the PCB.'},
  'running-waiting':{icon:'💾',title:'Running → Waiting (I/O Block)',desc:'The process issued a system call requesting I/O (disk read, network socket, etc.). The OS immediately saves this process context to its PCB and moves it to the Blocked/Waiting Queue. An interrupt will wake it when I/O finishes.'},
  'running-ready':{icon:'🔄',title:'Running → Ready (Preemption)',desc:'In Round Robin: the time quantum expired. In Priority/SRTF: a higher-priority or shorter-burst process arrived. The OS saves the full running context (registers, PC, stack) to the PCB — this is a context switch. The process rejoins the Ready Queue.'},
  'waiting-ready':{icon:'✅',title:'Waiting → Ready (I/O Complete)',desc:'The I/O device issued a hardware interrupt confirming completion. The OS interrupt handler wakes the blocked process: it is moved from the Waiting Queue back to the Ready Queue.'},
  'running-terminated':{icon:'☑️',title:'Running → Terminated (Process Exit)',desc:'The process executed its final instruction and made an exit() system call. The OS reclaims all resources: memory pages are freed, file handles closed. The PCB is finalized with completion time. Turnaround time = finish_time − arrival_time.'},
};

// ════════════════════════════════════════════════════════
//  CACHED STATE — populated from C backend
// ════════════════════════════════════════════════════════
let S = null;  // full state from backend
let playing = false, tickTimer = null, speed = 5;
let currentAlgorithm = 'RR';
let backendOnline = false;

// ════════════════════════════════════════════════════════
//  API COMMUNICATION
// ════════════════════════════════════════════════════════
async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const opts = { method };
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + endpoint, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setBackendStatus(true);
    return data;
  } catch (e) {
    setBackendStatus(false);
    console.error(`API ${endpoint} failed:`, e);
    return null;
  }
}

function setBackendStatus(online) {
  backendOnline = online;
  const badge = document.getElementById('backend-status');
  if (online) {
    badge.classList.remove('offline');
    badge.querySelector('span').textContent = 'C Backend';
  } else {
    badge.classList.add('offline');
    badge.querySelector('span').textContent = 'Offline';
  }
}

// ════════════════════════════════════════════════════════
//  CONTROLS
// ════════════════════════════════════════════════════════
function getInterval() { return Math.max(40, 1060 - speed * 100); }
function togglePlay() { playing ? pauseSim() : playSim(); }

function playSim() {
  playing = true;
  document.getElementById('btn-play').textContent = '⏸ PAUSE';
  document.getElementById('btn-play').classList.add('on');
  doTick();
}

function pauseSim() {
  playing = false;
  clearTimeout(tickTimer);
  document.getElementById('btn-play').textContent = '▶ PLAY';
  document.getElementById('btn-play').classList.remove('on');
}

async function doTick() {
  if (!playing) return;
  const data = await apiCall('/tick', 'POST');
  if (data) {
    S = data;
    render(data.tickEvents || []);
  }
  tickTimer = setTimeout(doTick, getInterval());
}

async function stepForward() {
  pauseSim();
  const data = await apiCall('/tick', 'POST');
  if (data) {
    S = data;
    render(data.tickEvents || []);
  }
}

async function resetSim() {
  pauseSim();
  const data = await apiCall('/reset', 'POST');
  if (data) {
    S = data;
    document.getElementById('gantt-wrap').innerHTML = '';
    render([]);
    setNarrator('idle', 'System Idle — Waiting for processes', 'Click PLAY or create processes to begin.', null);
  }
}

function updateSpeed(v) { speed = +v; document.getElementById('spd-v').textContent = v + '×'; }

async function createProc() {
  const data = await apiCall('/create', 'POST');
  if (data) { S = data; render([]); }
}

async function batchProc() {
  const data = await apiCall('/batch', 'POST');
  if (data) { S = data; render([]); }
}

async function changeAlgo(algo) {
  currentAlgorithm = algo;
  const data = await apiCall('/config', 'POST', { algorithm: algo });
  if (data) { S = data; updateNarrator(); }
}

async function changeQuantum(val) {
  const q = parseInt(val) || 3;
  const data = await apiCall('/config', 'POST', { quantum: q });
  if (data) { S = data; }
}

function updateNarrator() {
  const names = { FCFS:'First Come First Served', RR:'Round Robin', Priority:'Priority Scheduling', SJF:'Shortest Job First', SRTF:'SRTF (Preemptive SJF)', PriorityP:'Priority (Preemptive)' };
  const algo = S ? S.algorithm : currentAlgorithm;
  document.getElementById('narr-algo-val').textContent = names[algo] || algo;
}

// ════════════════════════════════════════════════════════
//  NARRATOR
// ════════════════════════════════════════════════════════
function setNarrator(type, main, sub, icon) {
  const nb = document.getElementById('narrator');
  const nm = document.getElementById('narr-main');
  const ns = document.getElementById('narr-sub');
  const ni = document.getElementById('narr-icon');
  nb.className = 'narrator ' + ({idle:'', new:'nn', ready:'nr', running:'nu', waiting:'nw', terminated:'nt'}[type] || '');
  nm.textContent = main;
  ns.textContent = sub;
  if (icon) ni.textContent = icon;
  nm.classList.remove('animate');
  void nm.offsetWidth;
  nm.classList.add('animate');
}

// ════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════
function procsByState(state) {
  if (!S || !S.processes) return [];
  return S.processes.filter(p => p.state === state);
}

function procByPid(pid) {
  if (!S || !S.processes) return null;
  return S.processes.find(p => p.pid === pid) || null;
}

// ════════════════════════════════════════════════════════
//  PROCESS ORBS
// ════════════════════════════════════════════════════════
function spawnOrb(proc, fromNodeId, toNodeId) {
  const layer = document.getElementById('orb-layer');
  const diag = document.getElementById('diagram');
  const dr = diag.getBoundingClientRect();
  const fn = document.getElementById(fromNodeId);
  const tn = document.getElementById(toNodeId);
  if (!fn || !tn) return;
  const fr = fn.getBoundingClientRect();
  const tr = tn.getBoundingClientRect();
  const sx = (fr.left - dr.left) + fr.width / 2;
  const sy = (fr.top - dr.top) + fr.height / 2;
  const ex = (tr.left - dr.left) + tr.width / 2;
  const ey = (tr.top - dr.top) + tr.height / 2;

  const color = proc.color || '#22d3ee';
  const orb = document.createElement('div');
  orb.className = 'porb';
  orb.textContent = `P${proc.pid}`;
  orb.style.cssText = `left:${sx}px;top:${sy}px;background:radial-gradient(circle,${color}cc,${color}66);box-shadow:0 0 14px ${color},0 0 28px ${color}88;color:${color};border-color:${color}88;`;
  layer.appendChild(orb);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      orb.style.left = ex + 'px';
      orb.style.top = ey + 'px';
    });
  });
  setTimeout(() => {
    orb.style.opacity = '0';
    setTimeout(() => orb.remove(), 350);
  }, 480);
}

// ════════════════════════════════════════════════════════
//  CONTEXT SWITCH FLASH
// ════════════════════════════════════════════════════════
function showCtxFlash(msg) {
  const f = document.getElementById('ctx-flash');
  const l = document.getElementById('ctx-label');
  l.textContent = msg;
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 900);
}

// ════════════════════════════════════════════════════════
//  RENDER — uses state from C backend
// ════════════════════════════════════════════════════════
function render(evs) {
  if (!S) return;

  document.getElementById('clk').textContent = String(S.clock).padStart(4, '0');

  const newProcs = procsByState('new');
  const readyProcs = S.readyQ ? S.readyQ.map(pid => procByPid(pid)).filter(Boolean) : [];
  const waitProcs = S.waitQ ? S.waitQ.map(pid => procByPid(pid)).filter(Boolean) : [];
  const runningProc = S.runningPid >= 0 ? procByPid(S.runningPid) : null;

  const nn = S.newQLen || 0;
  const nr = S.readyQLen || 0;
  const nw = S.waitQLen || 0;
  const nd = S.doneCount || 0;

  document.getElementById('ns-new').textContent = `${nn} proc${nn !== 1 ? 's' : ''}`;
  document.getElementById('nc-new').textContent = nn;
  document.getElementById('ns-ready').textContent = `${nr} waiting`;
  document.getElementById('nc-ready').textContent = nr;
  document.getElementById('ns-run').textContent = runningProc ? `P${runningProc.pid} running` : 'IDLE';
  document.getElementById('ns-wait').textContent = `${nw} blocked`;
  document.getElementById('nc-wait').textContent = nw;
  document.getElementById('ns-term').textContent = `${nd} done`;
  document.getElementById('nc-term').textContent = nd;

  const rrbadge = document.getElementById('nc-rr');
  const algo = S.algorithm || 'RR';
  const Q = S.quantum || 3;
  const qc = S.quantumCounter || 0;
  if (algo === 'RR' && runningProc) {
    rrbadge.style.display = 'block';
    rrbadge.textContent = `${Q - qc}/${Q}`;
  } else { rrbadge.style.display = 'none'; }

  _lit('nd-new', nn > 0);
  _lit('nd-ready', nr > 0);
  _litRun('nd-run', !!runningProc);
  _lit('nd-wait', nw > 0);

  renderToks('tk-new', newProcs);
  renderToks('tk-ready', readyProcs);
  renderToks('tk-run', runningProc ? [runningProc] : []);
  renderToks('tk-wait', waitProcs);

  const cu = S.cpuUtil || 0;
  setG('g-cpu', 'v-cpu', cu, cu + '%');
  const rm = S.ramUsed || 0;
  const rp = Math.min(100, Math.round(rm / 2048 * 100));
  setG('g-ram', 'v-ram', rp, rm + ' MB');
  setG('g-rq', 'v-rq', Math.min(100, nr * 14), nr);
  setG('g-wq', 'v-wq', Math.min(100, nw * 18), nw);
  renderQDots('qd-r', readyProcs);
  renderQDots('qd-w', waitProcs);
  document.getElementById('tput').textContent = S.clock > 0 ? ((nd / S.clock) * 100).toFixed(1) : '0.0';
  document.getElementById('ctx-count').textContent = S.ctxSwitches || 0;

  document.getElementById('s-w').textContent = S.avgWait != null ? S.avgWait.toFixed(1) + ' t' : '—';
  document.getElementById('s-t').textContent = S.avgTAT != null ? S.avgTAT.toFixed(1) + ' t' : '—';
  document.getElementById('s-u').textContent = cu + '%';
  document.getElementById('s-d').textContent = nd;

  renderPCBs();
  renderLog();
  renderGantt();
  drawArrows(evs);
  processEvents(evs);
  updateNarrator();
}

function _lit(id, on) { document.getElementById(id).classList.toggle('lit', on); }
function _litRun(id, on) {
  const n = document.getElementById(id);
  n.classList.toggle('lit', on);
  n.classList.toggle('cpu-spin', on);
}

function setG(fid, vid, pct, lbl) {
  document.getElementById(fid).style.width = pct + '%';
  document.getElementById(vid).textContent = lbl;
}

function renderToks(id, procs) {
  const el = document.getElementById(id); el.innerHTML = '';
  for (const p of procs.slice(0, 6)) {
    const d = document.createElement('div');
    d.className = 'ntok';
    d.textContent = `P${p.pid}`;
    d.style.cssText = `border-color:${p.color};color:${p.color};background:${p.color}18;`;
    el.appendChild(d);
  }
  if (procs.length > 6) { const x = document.createElement('div'); x.className = 'ntok'; x.textContent = `+${procs.length - 6}`; x.style.cssText = 'border-color:var(--dim);color:var(--dim);'; el.appendChild(x); }
}

function renderQDots(id, q) {
  const el = document.getElementById(id); el.innerHTML = '';
  for (const p of q.slice(0, 8)) {
    const d = document.createElement('div');
    d.className = 'qdot';
    d.textContent = p.pid % 100;
    d.style.cssText = `border-color:${p.color};color:${p.color};background:${p.color}12;`;
    el.appendChild(d);
  }
}

function renderPCBs() {
  const el = document.getElementById('pcb-list');
  if (!S || !S.processes || !S.processes.length) {
    el.innerHTML = '<div style="color:var(--dim);font-size:11px;text-align:center;padding:20px;line-height:1.8;">No processes.<br>Create some to begin.</div>';
    return;
  }
  el.innerHTML = '';
  const sm = { new:'sn', ready:'sr', running:'su', waiting:'sw', terminated:'st' };
  const sl = { new:'NEW', ready:'RDY', running:'RUN', waiting:'I/O', terminated:'DONE' };
  const all = [...S.processes].reverse();
  for (const p of all.slice(0, 16)) {
    const s = sm[p.state] || 'st';
    const mp = Math.min(100, Math.round(p.memUsage / 280 * 100));
    const tat = (p.finishTime >= 0 && p.arrivalTime >= 0) ? (p.finishTime - p.arrivalTime) : null;
    const c = document.createElement('div');
    c.className = `pcb ${s}`;
    c.innerHTML = `
      <div class="pcb-top">
        <div class="pcb-pid" style="color:${p.color};font-size:13px;">P${p.pid}</div>
        <div class="pcb-badge ${s}">${sl[p.state] || p.state}</div>
      </div>
      <div class="pcb-grid">
        <div class="pcb-row"><span>Priority</span><span class="v">${p.priority}</span></div>
        <div class="pcb-row"><span>Burst</span><span class="v">${p.remainingTime}/${p.burstTime}</span></div>
        <div class="pcb-row"><span>CPU time</span><span class="v">${p.cpuTime}</span></div>
        <div class="pcb-row"><span>Wait</span><span class="v">${p.waitTime}</span></div>
        <div class="pcb-row"><span>Memory</span><span class="v">${p.memUsage}MB</span></div>
        ${tat != null ? `<div class="pcb-row"><span>TAT</span><span class="v">${tat}</span></div>` : ''}
      </div>
      <div class="pcb-mem"><div class="pcb-mf" style="width:${mp}%;background:${p.color};"></div></div>`;
    el.appendChild(c);
  }
}

function renderLog() {
  const el = document.getElementById('evlog');
  if (!S || !S.events) { el.innerHTML = ''; return; }
  el.innerHTML = S.events.slice(0, 30).map(e => `
    <div class="ev ${e.cls}">
      <span class="tk">[${String(e.t).padStart(4, '0')}]</span>
      <span class="p"> P${e.pid} </span>${e.msg}
    </div>`).join('');
}

// ════════════════════════════════════════════════════════
//  GANTT CHART
// ════════════════════════════════════════════════════════
function renderGantt() {
  if (!S || !S.gantt) return;
  const wrap = document.getElementById('gantt-wrap');
  wrap.innerHTML = '';
  for (const entry of S.gantt) {
    const bar = document.createElement('div');
    bar.className = 'gantt-bar';
    const block = document.createElement('div');
    block.className = 'gb-block';
    if (entry.pid !== null) {
      block.textContent = `P${entry.pid}`;
      block.style.background = entry.color + 'cc';
      block.style.boxShadow = `inset 0 0 8px ${entry.color}44`;
    } else {
      block.classList.add('gantt-idle');
      block.textContent = '—';
      block.style.color = 'var(--dim)';
    }
    const tick = document.createElement('div');
    tick.className = 'gb-tick';
    tick.textContent = entry.t;
    bar.appendChild(block);
    bar.appendChild(tick);
    wrap.appendChild(bar);
  }
  wrap.scrollLeft = wrap.scrollWidth;
}

// ════════════════════════════════════════════════════════
//  PROCESS EVENTS → ORBS + NARRATOR
// ════════════════════════════════════════════════════════
const NODE_MAP = {
  'new-ready':['nd-new','nd-ready'],
  'ready-running':['nd-ready','nd-run'],
  'running-waiting':['nd-run','nd-wait'],
  'running-terminated':['nd-run','nd-term'],
  'waiting-ready':['nd-wait','nd-ready'],
  'running-ready':['nd-run','nd-ready'],
};

const NARR_MAP = {
  'new-ready': (e) => {
    const p = procByPid(e.pid);
    return {
      type:'new', icon:'🆕',
      main:`P${e.pid} created → entering Ready Queue`,
      sub: p ? `Process admitted with burst=${p.burstTime} ticks, priority=${p.priority}. PCB initialized and queued.` : 'PCB initialized.'
    };
  },
  'ready-running': (e) => {
    const p = procByPid(e.pid);
    const algo = S ? S.algorithm : 'RR';
    const algos = {
      FCFS:`FCFS selected P${e.pid} — it arrived first at T=${p ? p.arrivalTime : '?'}`,
      RR:`Round Robin dispatched P${e.pid} — next in circular queue`,
      Priority:`Priority scheduler chose P${e.pid} — highest priority (${p ? p.priority : '?'}) in queue`,
      PriorityP:`Preemptive Priority chose P${e.pid} — priority ${p ? p.priority : '?'} is highest`,
      SJF:`SJF chose P${e.pid} — shortest remaining burst: ${p ? p.remainingTime : '?'} ticks`,
      SRTF:`SRTF chose P${e.pid} — shortest remaining time: ${p ? p.remainingTime : '?'} ticks`,
    };
    return {
      type:'running', icon:'⚡',
      main:`P${e.pid} dispatched → now running on CPU`,
      sub: algos[algo] || `Algorithm: ${algo}`
    };
  },
  'running-waiting': (e) => {
    const p = procByPid(e.pid);
    return {
      type:'waiting', icon:'💾',
      main:`P${e.pid} issued I/O request → moved to Waiting`,
      sub:`CPU is free. P${e.pid} blocked for ${p ? p.ioCountdown : '?'} ticks awaiting I/O completion.`
    };
  },
  'running-ready': (e) => {
    const algo = S ? S.algorithm : 'RR';
    const Q = S ? S.quantum : 3;
    return {
      type:'ready', icon:'🔄',
      main:`P${e.pid} preempted → back to Ready Queue`,
      sub: algo === 'RR' ? `Time quantum expired (${Q} ticks used). Context saved to PCB.`
        : algo === 'SRTF' ? `A shorter job arrived. Context switch performed.`
        : algo === 'PriorityP' ? `A higher priority process arrived. Context switch performed.`
        : `Context saved to PCB. CPU is now free.`
    };
  },
  'waiting-ready': (e) => ({
    type:'ready', icon:'✅',
    main:`P${e.pid} I/O complete → returning to Ready Queue`,
    sub:`Hardware interrupt received. I/O done. P${e.pid} is ready to resume execution.`
  }),
  'running-terminated': (e) => {
    const p = procByPid(e.pid);
    const tat = (p && p.finishTime >= 0) ? (p.finishTime - p.arrivalTime) : '?';
    return {
      type:'terminated', icon:'☑️',
      main:`P${e.pid} finished — process terminated`,
      sub:`All ${p ? p.burstTime : '?'} CPU ticks used. Resources freed. Turnaround: ${tat} ticks.`
    };
  },
};

function processEvents(evs) {
  if (!evs || !evs.length) {
    const runningProc = S && S.runningPid >= 0 ? procByPid(S.runningPid) : null;
    if (runningProc) {
      const algo = S.algorithm || 'RR';
      const Q = S.quantum || 3;
      const qc = S.quantumCounter || 0;
      const sub = algo === 'RR'
        ? `Round Robin — ${Q - qc}/${Q} ticks remaining in quantum for P${runningProc.pid}`
        : `P${runningProc.pid} executing — ${runningProc.remainingTime} ticks of burst remaining`;
      document.getElementById('narr-icon').textContent = '⚡';
      document.getElementById('narr-main').textContent = `P${runningProc.pid} running on CPU`;
      document.getElementById('narr-sub').textContent = sub;
      document.getElementById('narrator').className = 'narrator nu';
    } else if (S && S.readyQLen === 0 && S.waitQLen === 0 && S.newQLen === 0) {
      document.getElementById('narr-main').textContent = 'System Idle — No processes queued';
      document.getElementById('narr-sub').textContent = 'Create new processes or run a batch to continue.';
      document.getElementById('narr-icon').textContent = '💤';
      document.getElementById('narrator').className = 'narrator';
    }
    updateAlgoInsight();
    return;
  }

  const priority = ['running-terminated','running-waiting','running-ready','ready-running','waiting-ready','new-ready'];
  let chosen = null;
  for (const t of priority) {
    const e = evs.find(x => x.type === t);
    if (e) { chosen = e; break; }
  }
  if (!chosen) chosen = evs[evs.length - 1];

  for (const ev of evs) {
    const nm = NODE_MAP[ev.type];
    if (nm) {
      const proc = procByPid(ev.pid);
      if (proc) setTimeout(() => spawnOrb(proc, nm[0], nm[1]), 20);
    }
  }

  const ctxEvs = evs.filter(e => ['running-terminated','running-waiting','running-ready'].includes(e.type));
  if (ctxEvs.length) {
    const ce = ctxEvs[0];
    const nextEv = evs.find(e => e.type === 'ready-running');
    const nextPid = nextEv ? ` → dispatching P${nextEv.pid}` : '';
    showCtxFlash(`Context Switch: saving P${ce.pid}${nextPid}`);
  }

  if (chosen) {
    const narr = NARR_MAP[chosen.type];
    if (narr) {
      const n = narr(chosen);
      document.getElementById('narr-icon').textContent = n.icon;
      document.getElementById('narr-main').textContent = n.main;
      document.getElementById('narr-sub').textContent = n.sub;
      document.getElementById('narrator').className = 'narrator ' + ({new:'nn', ready:'nr', running:'nu', waiting:'nw', terminated:'nt'}[n.type] || '');
      document.getElementById('narr-main').classList.remove('animate');
      void document.getElementById('narr-main').offsetWidth;
      document.getElementById('narr-main').classList.add('animate');
    }
  }
  updateAlgoInsight();
}

function updateAlgoInsight() {
  if (!S) return;
  const lbl = document.getElementById('ai-lbl');
  const body = document.getElementById('ai-body');
  const Q = S.quantum || 3;
  const algo = S.algorithm || 'RR';
  const qc = S.quantumCounter || 0;
  const runningProc = S.runningPid >= 0 ? procByPid(S.runningPid) : null;
  const readyProcs = S.readyQ ? S.readyQ.map(pid => procByPid(pid)).filter(Boolean) : [];

  lbl.textContent = algo + ' Scheduler';
  if (algo === 'RR') {
    if (runningProc) body.textContent = `P${runningProc.pid} on CPU. Quantum: ${Q - qc}/${Q} ticks left. ${readyProcs.length} processes queued.`;
    else if (readyProcs.length) body.textContent = `Ready queue has ${readyProcs.length} processes. Next: P${readyProcs[0].pid} will get ${Q}-tick quantum.`;
    else body.textContent = 'No processes in Ready Queue.';
  } else if (algo === 'FCFS') {
    if (readyProcs.length) body.textContent = `Next: P${readyProcs[0].pid} — arrived at T=${readyProcs[0].arrivalTime} (earliest). Non-preemptive.`;
    else body.textContent = 'Ready queue empty. Waiting for processes.';
  } else if (algo === 'Priority' || algo === 'PriorityP') {
    const sorted = [...readyProcs].sort((a, b) => a.priority - b.priority);
    if (sorted.length) body.textContent = `Highest priority: P${sorted[0].pid} (pri=${sorted[0].priority}). ${algo === 'PriorityP' ? 'Preemptive — will preempt if higher arrives.' : 'Non-preemptive.'}`;
    else body.textContent = 'Ready queue empty.';
  } else if (algo === 'SJF' || algo === 'SRTF') {
    const sorted = [...readyProcs].sort((a, b) => a.remainingTime - b.remainingTime);
    if (sorted.length) body.textContent = `Shortest: P${sorted[0].pid} (${sorted[0].remainingTime}t). ${algo === 'SRTF' ? 'Preemptive — will preempt if shorter arrives.' : 'Non-preemptive.'}`;
    else body.textContent = 'Ready queue empty.';
  }
}

// ════════════════════════════════════════════════════════
//  SVG ARROWS
// ════════════════════════════════════════════════════════
let activeArrowType = null;
function drawArrows(evs) {
  if (evs && evs.length) activeArrowType = evs[evs.length - 1]?.type || null;
  else if (S && S.runningPid >= 0) activeArrowType = null;

  const svg = document.getElementById('dsvg');
  const diag = document.getElementById('diagram');
  const dr = diag.getBoundingClientRect();

  function nc(id) {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x:r.left-dr.left+r.width/2, y:r.top-dr.top+r.height/2, top:r.top-dr.top, bot:r.top-dr.top+r.height, left:r.left-dr.left, right:r.left-dr.left+r.width, w:r.width, h:r.height };
  }

  try {
    const N=nc('nd-new'), R=nc('nd-ready'), RN=nc('nd-run'), W=nc('nd-wait'), T=nc('nd-term');
    const at = activeArrowType;

    const paths = {
      'new-ready':{ d:`M ${N.x} ${N.bot+2} L ${R.x} ${R.top-2}`, color:'#38bdf8' },
      'ready-running':{ d:`M ${R.x} ${R.bot+2} L ${RN.x} ${RN.top-2}`, color:'#fbbf24' },
      'running-waiting':{ d:`M ${RN.left-2} ${RN.y} C ${(RN.left+W.right)/2} ${RN.y} ${(RN.left+W.right)/2} ${W.y} ${W.right+2} ${W.y}`, color:'#fb923c' },
      'running-terminated':{ d:`M ${RN.right+2} ${RN.y} C ${(RN.right+T.left)/2} ${RN.y} ${(RN.right+T.left)/2} ${T.y} ${T.left-2} ${T.y}`, color:'#64748b' },
      'waiting-ready':{ d:`M ${W.x} ${W.top-2} C ${W.x} ${W.top-55} ${R.left-35} ${R.y} ${R.left-2} ${R.y}`, color:'#34d399' },
      'running-ready':{ d:`M ${RN.right+2} ${RN.y} C ${RN.right+65} ${RN.y} ${R.right+65} ${R.y} ${R.right+2} ${R.y}`, color:'#f43f5e' },
    };

    let defs = `<defs>`;
    for (const [k,p] of Object.entries(paths)) {
      const c = at===k?p.color:'#1e3352';
      defs += `<marker id="m-${k}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="${c}"/></marker>`;
    }
    defs += `</defs>`;

    const ALBL = {'new-ready':'admit','ready-running':'dispatch','running-waiting':'I/O req','running-terminated':'exit','waiting-ready':'I/O done','running-ready':'preempt'};

    let arrs = '';
    for (const [k,p] of Object.entries(paths)) {
      const isActive = at===k;
      const stroke = isActive?p.color:'#1e3352';
      const sw = isActive?2.5:1.5;
      const dash = isActive?'stroke-dasharray="10 5"':'';
      const glow = isActive?`<path d="${p.d}" stroke="${p.color}" stroke-width="8" fill="none" opacity="0.12"/>`:'';
      arrs += `${glow}<path d="${p.d}" stroke="${stroke}" stroke-width="${sw}" fill="none" marker-end="url(#m-${k})" ${dash}></path>
        <path d="${p.d}" stroke="transparent" stroke-width="16" fill="none" style="cursor:pointer" onclick="showTransModal('${k}')"/>`;
    }
    svg.innerHTML = defs + arrs;
  } catch(e) { /* DOM not ready */ }
}

// ════════════════════════════════════════════════════════
//  MODALS
// ════════════════════════════════════════════════════════
function showTransModal(key) {
  const t = TINFO[key]; if (!t) return;
  document.getElementById('mt-t').textContent = t.icon + ' ' + t.title;
  document.getElementById('mt-b').textContent = t.desc;
  document.getElementById('m-tr').classList.add('show');
}

function showSummary() {
  if (!S) return;
  const doneProcs = S.donePids ? S.donePids.map(pid => procByPid(pid)).filter(Boolean) : [];
  const cu = S.cpuUtil || 0;
  const algo = S.algorithm || 'RR';

  const s = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">Algorithm</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--ready);font-weight:700;">${algo}</div></div>
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">CPU Util</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--run);font-weight:700;">${cu}%</div></div>
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">Avg Wait</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--ready);font-weight:700;">${S.avgWait != null ? S.avgWait.toFixed(1) : '—'} t</div></div>
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">Avg TAT</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--cyan);font-weight:700;">${S.avgTAT != null ? S.avgTAT.toFixed(1) : '—'} t</div></div>
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">Avg Response</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--new);font-weight:700;">${S.avgResponse != null ? S.avgResponse.toFixed(1) : '—'} t</div></div>
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">Ctx Switches</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--wait);font-weight:700;">${S.ctxSwitches || 0}</div></div>
    <div><div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:bold;">Completed</div>
         <div style="font-family:var(--fn);font-size:15px;color:var(--text2);font-weight:700;">${doneProcs.length}</div></div>
  </div>`;
  const rows = doneProcs.slice(-12).reverse().map(p => {
    const tat = (p.finishTime >= 0) ? (p.finishTime - p.arrivalTime) : '—';
    const resp = (p.startTime >= 0) ? (p.startTime - p.arrivalTime) : '—';
    return `<tr>
      <td style="color:${p.color};font-family:var(--fn);">P${p.pid}</td>
      <td>${p.priority}</td><td>${p.burstTime}</td>
      <td>${p.cpuTime}</td><td>${p.waitTime}</td>
      <td style="color:var(--cyan)">${tat}</td>
      <td>${resp}</td>
    </tr>`;
  }).join('');
  document.getElementById('ms-b').innerHTML = s + (doneProcs.length
    ? `<table class="stbl"><thead><tr><th>PID</th><th>Pri</th><th>Burst</th><th>CPU</th><th>Wait</th><th>TAT</th><th>Resp</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div style="color:var(--dim);font-size:12px;margin-top:8px;">No completed processes yet. Run the simulation first.</div>');
  document.getElementById('m-sum').classList.add('show');
}

// ════════════════════════════════════════════════════════
//  ALGORITHM COMPARISON (runs in-browser with same data)
// ════════════════════════════════════════════════════════
function showComparison() {
  if (!S || !S.donePids || S.donePids.length < 2) {
    document.getElementById('mc-b').innerHTML = '<div style="color:var(--dim);font-size:12px;padding:10px;">Complete at least 2 processes first to generate comparison data.</div>';
    document.getElementById('m-cmp').classList.add('show');
    return;
  }
  const doneProcs = S.donePids.map(pid => procByPid(pid)).filter(Boolean);
  const procs = doneProcs.map(p => ({ pid:p.pid, burst:p.burstTime, priority:p.priority, arrival:p.arrivalTime, color:p.color }));
  const algos = ['FCFS','SJF','RR','Priority'];
  const results = {};
  for (const algo of algos) results[algo] = simulateAlgo(procs, algo, S.quantum||3);

  let best = { wait:Infinity, tat:Infinity, algoW:'', algoT:'' };
  for (const [a,r] of Object.entries(results)) {
    if (r.avgWait < best.wait) { best.wait=r.avgWait; best.algoW=a; }
    if (r.avgTAT < best.tat) { best.tat=r.avgTAT; best.algoT=a; }
  }

  let html = '<div class="cmp-grid">';
  for (const [a,r] of Object.entries(results)) {
    const isBestW = a===best.algoW, isBestT = a===best.algoT;
    html += `<div class="cmp-card ${isBestW||isBestT?'cmp-best':''}">
      <div class="cname">${a}</div>
      <div class="cval" style="color:var(--ready);">${r.avgWait.toFixed(1)}</div><div class="csub">Avg Wait${isBestW?' ★':''}</div>
      <div class="cval" style="color:var(--cyan);">${r.avgTAT.toFixed(1)}</div><div class="csub">Avg TAT${isBestT?' ★':''}</div>
      <div class="cval" style="color:var(--run);font-size:13px;">${r.cpu}%</div><div class="csub">CPU Util</div>
    </div>`;
  }
  html += '</div>';
  html += `<div style="margin-top:14px;font-size:10px;color:var(--text);line-height:1.6;">
    <strong style="color:var(--cyan);">★ Best Avg Wait:</strong> ${best.algoW} (${best.wait.toFixed(1)} ticks)<br>
    <strong style="color:var(--cyan);">★ Best Avg TAT:</strong> ${best.algoT} (${best.tat.toFixed(1)} ticks)<br>
    <span style="color:var(--dim);">Comparison uses the same process set without I/O interrupts for fair results.</span>
  </div>`;

  document.getElementById('mc-b').innerHTML = html;
  document.getElementById('m-cmp').classList.add('show');
}

function simulateAlgo(procs, algo, quantum) {
  const ps = procs.map(p => ({...p, remaining:p.burst, wait:0, finish:0, started:false})).sort((a,b) => a.arrival-b.arrival);
  let clock=0, done=0, busy=0, qc=0;
  let ready=[], running=null;

  while (done < ps.length) {
    for (const p of ps) {
      if (!p.started && p.arrival<=clock && !ready.includes(p) && p!==running && p.remaining>0) {
        ready.push(p); p.started=true;
      }
    }
    if (!running && ready.length) {
      if (algo==='FCFS'){running=ready.shift();}
      else if (algo==='SJF'){ready.sort((a,b)=>a.remaining-b.remaining);running=ready.shift();}
      else if (algo==='RR'){running=ready.shift();}
      else if (algo==='Priority'){ready.sort((a,b)=>a.priority-b.priority);running=ready.shift();}
      qc=0;
    }
    if (running) {
      running.remaining--; busy++; qc++;
      if (running.remaining<=0) {
        running.finish=clock+1; running.wait=running.finish-running.arrival-running.burst;
        done++; running=null;
      } else if (algo==='RR' && qc>=quantum) {
        ready.push(running); running=null;
      }
    }
    clock++;
    if (clock>5000) break;
  }
  const totalWait = ps.reduce((s,p) => s+Math.max(0,p.wait), 0);
  const totalTAT = ps.reduce((s,p) => s+(p.finish-p.arrival), 0);
  return { avgWait:totalWait/ps.length, avgTAT:totalTAT/ps.length, cpu:clock>0?Math.round(busy/clock*100):0 };
}

function closeM(id) { document.getElementById(id).classList.remove('show'); }

// ════════════════════════════════════════════════════════
//  INIT — Connect to C backend
// ════════════════════════════════════════════════════════
async function init() {
  // Get initial state
  const data = await apiCall('/state');
  if (data) {
    S = data;
    render([]);
    updateNarrator();
    // Auto-create a batch to start with
    await batchProc();
  } else {
    setNarrator('idle', 'Backend Offline — Cannot connect', 'Make sure process_server.exe is running on port 8080.', '❌');
  }
  setTimeout(drawArrows, 50);
  window.addEventListener('resize', () => drawArrows([]));
}

document.getElementById('algo').value = 'RR';
init();
