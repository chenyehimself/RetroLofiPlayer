// --- Retro Audio Player (p5.js + p5.sound) ---
// 老功放怀旧版 + 算法混响（p5.Reverb）
// 圆盘小幅呼吸；Amplitude 监听 master；可折叠面板；复古拨杆开关

/* ======= 黑胶/光环 & 可视化参数 ======= */
let discAngle = 0, discVel = 0;
const BASE_RPM = 26;
const BASE_VEL = BASE_RPM * Math.PI * 2 / 60;
const VEL_GAIN = 0.6;
const VEL_SMOOTH = 0.12;

let recordGfx;
const RECORD_TEX_SIZE = 1024;
const LABEL_RATIO = 0.40;
const HOLE_RATIO  = 0.022;
const GROOVE_STEP = 3;
const DUST_COUNT  = 120;

/* ======= 播放/声音状态 ======= */
let uploadedSound = null;
let isFilePlaying = false;
let isPaused = false;
let seekTime = 0;

let amp;
let lofiFilter;

/* ======= 水波纹 ======= */
let ripples = [];
let lastEmitMs = 0;
const EMIT_HZ = 2;
const RIPPLE_SPEED = 40;
const RIPPLE_LIFE = 1.8;
const RIPPLE_STROKE = 4;

/* ======= 可视化尺寸（随音量） ======= */
let displayLevel = 0;
const LEVEL_SMOOTH = 0.25;
const DISC_R_MIN = 90;
const DISC_R_MAX = 440;

/* ======= 算法混响（p5.Reverb） ======= */
let reverb;
const rvb = { enabled:false, mix:0.18, room:2.2, decay:2.5 };

/* ======= 折叠面板：开合工具 ======= */
function initDrawerToggle(){
  const panel = document.getElementById('upper-controls');
  const toggleBtn = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');

  const open = ()=>{
    panel.classList.add('open');
    backdrop.classList.add('open');
    toggleBtn.setAttribute('aria-expanded','true');
  };
  const close = ()=>{
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    toggleBtn.setAttribute('aria-expanded','false');
  };
  const toggle = ()=> panel.classList.contains('open') ? close() : open();

  toggleBtn.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);

  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') close();
    if (e.key && e.key.toLowerCase() === 'h'){
      e.preventDefault();
      toggle();
    }
  });

  window.__closeDrawer__ = close;
}
function closeControlsDrawer(){
  if (window.__closeDrawer__) window.__closeDrawer__();
}

/* ======= p5 基础 ======= */
function setup() {
  createCanvas(windowWidth, windowHeight);

  initDrawerToggle();

  amp = new p5.Amplitude();
  lofiFilter = new p5.LowPass();
  reverb = new p5.Reverb();
  reverb.drywet(0);
  amp.setInput(); // 监听 p5.master

  // 预渲染黑胶纹理
  recordGfx = createGraphics(RECORD_TEX_SIZE, RECORD_TEX_SIZE);
  recordGfx.pixelDensity(1);
  prerenderRecordTexture(recordGfx);

  /* ---------- 绑定 UI ---------- */
  select('#speed').input(() => {
    const v = Number(select('#speed').value());
    if (uploadedSound && uploadedSound.isLoaded()) uploadedSound.rate(v);
    select('#speedDisplay').html(v.toFixed(1) + 'x');
  });

  select('#volume').input(() => {
    const v = Number(select('#volume').value());
    if (uploadedSound && uploadedSound.isLoaded()) uploadedSound.setVolume(v);
    select('#volumeDisplay').html(v.toFixed(1));
  });

  // Lo-Fi 开关/参数
  select('#lofi-enable').changed(() => {
    if (uploadedSound && uploadedSound.isLoaded()) {
      if (select('#lofi-enable').elt.checked) {
        const cutoff = getCutoffFromSlider();
        lofiFilter.freq(cutoff);
        lofiFilter.res(Number(select('#lofi-reso').value()));
      } else {
        lofiFilter.freq(22050);
        lofiFilter.res(0.001);
      }
      refreshAudioRouting();
    }
  });
  select('#lofi-cutoff').input(() => {
    const cutoff = getCutoffFromSlider();
    select('#lofi-cutoff-display').html(cutoff.toFixed(0) + ' Hz');
    if (uploadedSound && uploadedSound.isLoaded() && select('#lofi-enable').elt.checked) {
      lofiFilter.freq(cutoff);
    }
  });
  select('#lofi-reso').input(() => {
    const r = Number(select('#lofi-reso').value());
    select('#lofi-reso-display').html(r.toFixed(1) + ' Q');
    if (uploadedSound && uploadedSound.isLoaded() && select('#lofi-enable').elt.checked) {
      lofiFilter.res(r);
    }
  });

  select('#fileInput').changed(() => {
    const file = select('#fileInput').elt.files[0];
    if (file && file.type.startsWith('audio/')) {
      handleUploadedAudio(file);
      closeControlsDrawer();
    } else {
      alert('Please upload an audio file (MP3 or WAV)');
    }
  });

  select('#pause-play').mousePressed(() => {
    closeControlsDrawer();

    if (!uploadedSound || !uploadedSound.isLoaded()) {
      alert('Please upload an audio file first');
      return;
    }
    const btn = select('#pause-play').elt;
    if (!isPaused) {
      seekTime = uploadedSound.currentTime();
      uploadedSound.pause();
      isPaused = true;
      btn.classList.remove('playing');
      btn.setAttribute('aria-label', 'Play');
    } else {
      getAudioContext().resume();
      uploadedSound.play();
      uploadedSound.jump(seekTime);
      isPaused = false;
      isFilePlaying = true;
      btn.classList.add('playing');
      btn.setAttribute('aria-label', 'Pause');
    }
  });

  select('#progress').input(() => {
    if (uploadedSound && uploadedSound.isLoaded()) {
      const progressVal = Number(select('#progress').value());
      const duration = uploadedSound.duration();
      seekTime = progressVal * duration;

      if (!isPaused) {
        uploadedSound.jump(seekTime);
      } else {
        select('#progressDisplay').html(
          formatTime(seekTime) + ' / ' + formatTime(duration)
        );
      }
      ripples.push({ r: 70, a0: 160, age: 0, life: 0.9 });
    }
  });

  // Reverb 拨杆
  select('#rvb-enable').changed(() => {
    rvb.enabled = select('#rvb-enable').elt.checked;
    refreshAudioRouting();
  });
  select('#rvb-mix').input(() => {
    rvb.mix = Number(select('#rvb-mix').value());
    select('#rvb-mix-display').html(rvb.mix.toFixed(2));
    if (reverb) reverb.drywet(rvb.enabled ? rvb.mix : 0);
  });
  select('#rvb-room').input(() => {
    rvb.room = Number(select('#rvb-room').value());
    select('#rvb-room-display').html(rvb.room.toFixed(1) + ' s');
    if (rvb.enabled) applyReverbParams();
  });
  select('#rvb-decay').input(() => {
    rvb.decay = Number(select('#rvb-decay').value());
    select('#rvb-decay-display').html(rvb.decay.toFixed(1));
    if (rvb.enabled) applyReverbParams();
  });
}

function draw() {
  clear();

  if (uploadedSound && uploadedSound.isLoaded() && isFilePlaying) {
    const duration = uploadedSound.duration();
    const playingTime = uploadedSound.currentTime();
    const usedTime = isPaused ? seekTime : playingTime;

    const progressVal = duration > 0 ? usedTime / duration : 0;
    select('#progress').value(progressVal);
    select('#progressDisplay').html(
      formatTime(usedTime) + ' / ' + formatTime(duration)
    );

    const raw = isPaused ? 0 : amp.getLevel();
    displayLevel = lerp(displayLevel, raw, LEVEL_SMOOTH);

    const targetVel = isPaused ? 0 : (BASE_VEL + VEL_GAIN * displayLevel);
    discVel = lerp(discVel, targetVel, VEL_SMOOTH);
    discAngle += discVel * (deltaTime / 1000);

    if (!isPaused) {
      const now = millis();
      const intervalMs = 1000 / EMIT_HZ;
      if (now - lastEmitMs >= intervalMs) {
        const r0 = map(displayLevel, 0, 1, 40, 110);
        const a0 = map(displayLevel, 0, 1, 90, 220);
        ripples.push({ r: r0, a0: a0, age: 0, life: RIPPLE_LIFE });
        lastEmitMs = now;
      }
    }
  } else {
    displayLevel = lerp(displayLevel, 0, LEVEL_SMOOTH);
    discVel = lerp(discVel, 0, VEL_SMOOTH);
  }

  drawVinylAndNeon(displayLevel);
  drawRipples();

  /* ===== 小挂钩：根据电平给 <body> 加类，驱动极光提亮/加速 ===== */
  document.body.classList.toggle('has-level', (displayLevel || 0) > 0.02);
}

/* ------------------- 黑胶 + 克制光环 ------------------- */
function drawVinylAndNeon(level){
  const cx = width/2, cy = height/2;

  // 基准 + 小幅呼吸（保留当前基准比例 0.12）
  const base = lerp(DISC_R_MIN, DISC_R_MAX, 0.12);
  const pulsePct = 0.18;
  const pulse = (DISC_R_MAX - DISC_R_MIN) * pulsePct;
  const eased = 1 - Math.pow(1 - constrain(level, 0, 1), 1.8);
  const r = base + pulse * eased;

  push();
  translate(cx, cy);
  rotate(discAngle);
  imageMode(CENTER);
  image(recordGfx, 0, 0, r*2, r*2);
  pop();

  const NEON_A_MIN = 70, NEON_A_MAX = 140;
  const neonA = map(level, 0, 1, NEON_A_MIN, NEON_A_MAX);
  noFill();

  stroke(255, 184, 92, neonA * 0.25);
  strokeWeight(26);
  ellipse(cx, cy, (r*2) + 26, (r*2) + 26);

  stroke(255, 184, 92, neonA * 0.35);
  strokeWeight(16);
  ellipse(cx, cy, (r*2) + 16, (r*2) + 16);

  stroke(255, 234, 208, neonA);
  strokeWeight(8);
  ellipse(cx, cy, r*2, r*2);
}

/* ------------------- 预渲染黑胶 ------------------- */
function prerenderRecordTexture(gfx){
  const s = gfx.width;
  const cx = s/2, cy = s/2;
  gfx.clear();

  gfx.noStroke();
  const baseInner = color(16,19,26);
  const baseOuter = color(10,12,18);
  for(let i=s/2;i>0;i-=2){
    const t = 1 - (i/(s/2));
    gfx.fill( lerpColor(baseOuter, baseInner, 0.2 + 0.8*(1-t)) );
    gfx.ellipse(cx, cy, i*2, i*2);
  }

  gfx.noFill();
  gfx.stroke(160,162,179, 22);
  gfx.strokeWeight(1);
  const outer = s*0.49;
  const inner = s*0.49 * (1 - LABEL_RATIO) * 0.55;
  for(let rad=inner; rad<=outer; rad+=GROOVE_STEP){
    gfx.ellipse(cx, cy, rad*2, rad*2);
  }

  const labelR = (s*0.98) * LABEL_RATIO * 0.5;
  gfx.noStroke();
  gfx.fill(214,167,122, 235);
  gfx.ellipse(cx, cy, labelR*2, labelR*2);

  gfx.noFill();
  gfx.stroke(140,102,64, 120);
  gfx.strokeWeight(2);
  gfx.ellipse(cx, cy, labelR*1.6, labelR*1.6);
  gfx.stroke(140,102,64, 90);
  gfx.ellipse(cx, cy, labelR*1.2, labelR*1.2);

  const holeR = (s*0.98) * HOLE_RATIO * 0.5;
  gfx.noStroke();
  gfx.fill(0,0,0,220);
  gfx.ellipse(cx, cy, holeR*2, holeR*2);

  gfx.noStroke();
  for(let i=0;i<DUST_COUNT;i++){
    const angle = random(TWO_PI);
    const radius = random(s*0.1, s*0.48);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const a = random(16,36);
    gfx.fill(230,230,230, a);
    gfx.ellipse(x, y, random(1,2.2), random(1,2.2));
  }
}

/* ------------------- 水波纹 ------------------- */
function drawRipples(){
  noFill();
  strokeWeight(RIPPLE_STROKE);

  const dt = deltaTime / 1000;
  for(let i=ripples.length-1;i>=0;i--){
    const rp = ripples[i];
    rp.age += dt;
    rp.r += RIPPLE_SPEED * dt;

    const t = rp.age / rp.life;
    if(t >= 1){ ripples.splice(i,1); continue; }

    const alpha = (1 - t) * rp.a0;
    stroke(255, alpha);
    ellipse(width/2, height/2, rp.r*2, rp.r*2);
  }
}

/* ------------------- 音频链路 ------------------- */
// 基础：Sound -> LoFi -> master
// 开启 Reverb：LoFi -> Reverb（dry/wet）-> master
function refreshAudioRouting(){
  if (!uploadedSound || !uploadedSound.isLoaded()) return;

  try { uploadedSound.disconnect(); } catch(e){}
  try { lofiFilter.disconnect(); } catch(e){}

  lofiFilter.process(uploadedSound);

  if (rvb.enabled){
    enableReverb();
  } else {
    disableReverb();
  }

  amp.setInput(); // 监听 master
}

function enableReverb(){
  try { lofiFilter.disconnect(); } catch(e){}
  reverb.connect(); // 确保 Reverb 输出连回 master
  reverb.process(lofiFilter, rvb.room, rvb.decay);
  reverb.drywet(rvb.mix);
}

function disableReverb(){
  try { lofiFilter.disconnect(); } catch(e){}
  lofiFilter.connect();  // 回接 p5.master
  reverb.drywet(0);      // 让 Reverb 静音即可
}

function applyReverbParams(){
  reverb.process(lofiFilter, rvb.room, rvb.decay);
  reverb.drywet(rvb.mix);
}

/* ------------------- 加载与控制 ------------------- */
function handleUploadedAudio(file){
  if (uploadedSound) {
    uploadedSound.stop();
    uploadedSound.disconnect();
  }

  uploadedSound = loadSound(
    file,
    () => {
      getAudioContext().resume();

      uploadedSound.disconnect();
      lofiFilter.process(uploadedSound);
      lofiFilter.freq(22050);
      lofiFilter.res(0.001);

      if (select('#rvb-enable').elt && select('#rvb-enable').elt.checked){
        rvb.enabled = true;
        enableReverb();
      } else {
        disableReverb();
      }

      amp.setInput(); // 监听 master

      uploadedSound.play();
      isFilePlaying = true;
      isPaused = false;
      seekTime = 0;

      const btn = select('#pause-play').elt;
      btn.classList.add('playing');
      btn.setAttribute('aria-label', 'Pause');

      lastEmitMs = millis();
      ripples = [];
      displayLevel = 0;
      discVel = 0;
    },
    (err) => alert('Failed to load audio: ' + err)
  );
}

/* ------------------- 工具 ------------------- */
function getCutoffFromSlider(){
  const raw = Number(select('#lofi-cutoff').value());
  return exp(map(raw, 20, 20000, log(20), log(20000)));
}
function formatTime(seconds){
  const minutes = floor(seconds / 60);
  const secs = floor(seconds % 60);
  return minutes + ':' + nf(secs, 2, 0);
}
function windowResized(){ resizeCanvas(windowWidth, windowHeight); }