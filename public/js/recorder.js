// Nahrávanie videa priamo v appke: náhľad kamery, 5 s odpočet s pípaním,
// automatické zastavenie po max. dĺžke. Vráti File (MP4 alebo WebM).

const MIME_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function recorderSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

export class Recorder {
  constructor(videoEl, { onState = () => {}, onTick = () => {} } = {}) {
    this.video = videoEl; this.onState = onState; this.onTick = onTick;
    this.facing = 'environment'; this.stream = null; this.rec = null; this.timers = []; this.audio = null;
    // rozlíšenie a dátový tok nahrávky (Súboj: menšie video, aby sa dalo rýchlo poslať súperovi)
    this.size = { w: 1280, h: 720 }; this.bps = 4_000_000;
  }

  async open() {
    this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: this.facing }, width: { ideal: this.size.w }, height: { ideal: this.size.h }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirror', this.facing === 'user');
    await this.video.play().catch(() => {});
    this.onState('ready');
  }

  async flip() {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    await this.open();
  }

  beep(freq = 880, dur = 0.12) {
    try {
      if (!this.audio) this.audio = new (window.AudioContext || window.webkitAudioContext)();
      const o = this.audio.createOscillator(), g = this.audio.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(this.audio.destination);
      const t = this.audio.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch { /* bez zvuku */ }
    try { navigator.vibrate && navigator.vibrate(dur > 0.2 ? 250 : 60); } catch { /* nič */ }
  }

  // odpočet → nahrávanie; vráti Promise<File> po zastavení
  start({ countdown = 5, maxSeconds = 30 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.stream) return reject(new Error('Kamera nie je zapnutá.'));
      if (this.audio && this.audio.state === 'suspended') this.audio.resume();
      this.beep(0, 0.001); // odomkne zvuk na iOS v rámci kliknutia
      let left = countdown;
      this.onState('countdown', left); this.beep();
      const cd = setInterval(() => {
        left -= 1;
        if (left > 0) { this.onState('countdown', left); this.beep(); return; }
        clearInterval(cd);
        this.beep(1320, 0.35);
        this.record(maxSeconds).then(resolve, reject);
      }, 1000);
      this.timers.push(cd);
    });
  }

  record(maxSeconds) {
    return new Promise((resolve, reject) => {
      const mime = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || '';
      let rec;
      try { rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, videoBitsPerSecond: this.bps } : undefined); }
      catch (e) { reject(new Error('Nahrávanie videa tento prehliadač nepodporuje.')); return; }
      this.rec = rec;
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        this.clearTimers();
        const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size) { reject(new Error('Video je prázdne, skús to znova.')); return; }
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        resolve(new File([blob], `nahravka-${Date.now()}.${ext}`, { type }));
      };
      rec.start(250);
      const t0 = Date.now();
      this.onState('recording', 0);
      const tick = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        this.onTick(s, maxSeconds);
        if (s >= maxSeconds) this.stop();
      }, 200);
      this.timers.push(tick);
    });
  }

  stop() {
    if (this.rec && this.rec.state !== 'inactive') { this.beep(660, 0.2); this.rec.stop(); }
  }

  cancel() {
    this.clearTimers();
    if (this.rec && this.rec.state !== 'inactive') { this.rec.onstop = null; this.rec.stop(); }
    this.rec = null;
    this.onState('ready');
  }

  clearTimers() { this.timers.forEach(clearInterval); this.timers = []; }

  close() {
    this.clearTimers();
    if (this.rec && this.rec.state !== 'inactive') { this.rec.onstop = null; try { this.rec.stop(); } catch { /* nič */ } }
    this.rec = null;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
