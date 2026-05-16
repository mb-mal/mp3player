const THEMES = [
  { id: 'dark', name: 'Deep Purple', icon: '💜' },
  { id: 'winamp', name: 'WinAMP Classic', icon: '💚' },
  { id: 'ocean', name: 'Ocean Blue', icon: '💙' },
  { id: 'amber', name: 'Amber Glow', icon: '🧡' },
]

class AudioPlayer {
  constructor() {
    this.audio = new Audio()
    this.audioCtx = null
    this.analyser = null
    this.source = null
    this.playlist = []
    this.currentIndex = -1
    this.isPlaying = false
    this.isShuffled = false
    this.repeatMode = 0
    this.shuffleOrder = []
    this.shuffleIndex = 0
    this.visMode = 0
    this.visModes = ['BARS', 'WAVE', 'CIRCLE']
    this.visAnimId = null
    this.plDragIndex = null
    this.prevVolume = 0.8
    this.themeIndex = 0
    this.volAccel = { active: false, startVal: 0, startTime: 0, dir: 0, rafId: null }
    this._savedPaths = null
    this._savedIndex = -1
    this._savedTime = 0

    this.audio.volume = 0.8
    this.audio.preload = 'metadata'

    this.loadSyncState()
    this.applyTheme(this.themeIndex)
    this.initUI()
    this.initKeyboard()
    this.initMediaSession()
    this.bindEvents()
    this.initDebugger()
    this.log('App initialized', 'info')
  }

  async initAsync() {
    if (this._savedPaths && this._savedPaths.length > 0) {
      await this.restorePlaylist(this._savedPaths, this._savedIndex)
      this.setStatus(`Loaded ${this.playlist.length} tracks from last session`)
    }
  }

  /* ── Logging ── */
  log(msg, type = 'info') {
    const el = document.getElementById('debug-log')
    if (!el) return
    const line = document.createElement('div')
    const t = new Date().toLocaleTimeString('ru-RU', { hour12: false })
    line.className = `dbg-${type}`
    line.textContent = `[${t}] ${msg}`
    el.appendChild(line)
    el.scrollTop = el.scrollHeight
  }

  initDebugger() {
    document.getElementById('btn-debug').addEventListener('click', () => {
      const p = document.getElementById('debug-panel')
      p.style.display = p.style.display === 'none' ? 'block' : 'none'
    })
    this.log('App initialized', 'info')
  }

  /* ── Theme System ── */
  applyTheme(index) {
    this.themeIndex = index
    const theme = THEMES[index]
    document.body.className = ''
    if (theme.id !== 'dark') document.body.classList.add(`theme-${theme.id}`)
    this.saveState()
    this.log(`Theme: ${theme.name}`, 'info')
  }

  cycleTheme() {
    this.applyTheme((this.themeIndex + 1) % THEMES.length)
    this.setStatus(`Theme: ${THEMES[this.themeIndex].name}`)
  }

  /* ── Init ── */
  initUI() {
    this.renderPlaylist()
    this.updateUI()
    this.updateVolumeUI()
    this.setVisMode(0)
  }

  /* ── State Persistence ── */
  saveState() {
    const data = {
      playlist: this.playlist.map(t => t.path),
      currentIndex: this.currentIndex,
      volume: this.audio.volume,
      isShuffled: this.isShuffled,
      repeatMode: this.repeatMode,
      visMode: this.visMode,
      themeIndex: this.themeIndex,
      currentTime: this.audio.currentTime || 0,
    }
    try { localStorage.setItem('mp3player-state', JSON.stringify(data)) } catch (_) {}
  }

  throttledSave() {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this.saveState()
    }, 2000)
  }

  loadSyncState() {
    try {
      const raw = localStorage.getItem('mp3player-state')
      if (!raw) return
      const data = JSON.parse(raw)
      if (data.volume !== undefined) this.audio.volume = data.volume
      if (data.isShuffled !== undefined) this.isShuffled = data.isShuffled
      if (data.repeatMode !== undefined) this.repeatMode = data.repeatMode
      if (data.visMode !== undefined) this.visMode = data.visMode
      if (data.themeIndex !== undefined) this.themeIndex = data.themeIndex
      this._savedTime = data.currentTime || 0
      this._savedPaths = data.playlist || null
      this._savedIndex = data.currentIndex ?? -1
    } catch (_) {}
  }

  async restorePlaylist(paths, targetIndex) {
    const tracks = []
    for (const filePath of paths) {
      try {
        const exists = await window.electronAPI.fileExists(filePath)
        if (!exists) { this.log(`Skipped (not found): ${filePath}`, 'warn'); continue }
        const [meta, duration, fileUrl] = await Promise.all([
          window.electronAPI.getMetadata(filePath),
          this.getDuration(filePath),
          window.electronAPI.pathToFileURL(filePath),
        ])
        tracks.push({ path: filePath, fileUrl, name: meta.name, duration: duration || 0 })
      } catch (err) {
        this.log(`Error loading ${filePath}: ${err.message}`, 'error')
      }
    }
    this.playlist = tracks
    if (this.playlist.length > 0) {
      this.currentIndex = Math.min(targetIndex, this.playlist.length - 1)
      if (this.currentIndex < 0) this.currentIndex = 0
      this.loadTrack(this.currentIndex, true, false, this._savedTime)
    }
    this.renderPlaylist()
    this.updateUI()
    this.setStatus(`Restored ${this.playlist.length} tracks from last session`)
  }

  /* ── Playlist Catalog ── */
  getSavedPlaylists() {
    try {
      const raw = localStorage.getItem('mp3player-playlists')
      return raw ? JSON.parse(raw) : {}
    } catch (_) { return {} }
  }

  savePlaylistList(data) {
    try { localStorage.setItem('mp3player-playlists', JSON.stringify(data)) } catch (_) {}
  }

  async showSavePlaylistDialog() {
    const { value, confirmed } = await this.modalPrompt('Save Playlist', 'Enter playlist name:', 'My Playlist')
    if (!confirmed || !value.trim()) return
    const name = value.trim()
    const all = this.getSavedPlaylists()
    all[name] = this.playlist.map(t => t.path)
    this.savePlaylistList(all)
    this.setStatus(`Playlist saved: "${name}"`)
    this.log(`Playlist saved: "${name}" (${this.playlist.length} tracks)`, 'info')
  }

  async showLoadPlaylistDialog() {
    const all = this.getSavedPlaylists()
    const names = Object.keys(all)
    if (names.length === 0) { this.setStatus('No saved playlists'); return }

    const name = await this.modalList('Load Playlist', 'Choose a playlist to load:', names)
    if (!name) return

    const paths = all[name]
    this.clearPlaylist()
    await this.addTracks(paths)
    this.setStatus(`Playlist loaded: "${name}"`)
    this.log(`Playlist loaded: "${name}" (${paths.length} tracks)`, 'info')
  }

  async modalPrompt(title, label, defaultValue) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal-overlay')
      const box = document.getElementById('modal-box')
      document.getElementById('modal-title').textContent = title
      document.getElementById('modal-body').innerHTML = `
        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">${label}</label>
        <input class="modal-input" id="modal-input" value="${this.escapeHtml(defaultValue || '')}" autofocus />
      `
      document.getElementById('modal-actions').innerHTML = `
        <button class="modal-btn" data-action="cancel">Cancel</button>
        <button class="modal-btn primary" data-action="ok">OK</button>
      `
      overlay.style.display = 'flex'

      const close = (confirmed) => {
        const input = document.getElementById('modal-input')
        const value = input ? input.value : ''
        overlay.style.display = 'none'
        resolve({ confirmed, value })
      }

      box.querySelector('[data-action="ok"]').onclick = () => close(true)
      box.querySelector('[data-action="cancel"]').onclick = () => close(false)
      document.getElementById('modal-input').onkeydown = (e) => {
        if (e.key === 'Enter') close(true)
        if (e.key === 'Escape') close(false)
      }
    })
  }

  async modalList(title, label, items) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal-overlay')
      document.getElementById('modal-title').textContent = title
      document.getElementById('modal-body').innerHTML = `
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${label}</div>
        <div class="modal-list" id="modal-list">
          ${items.map(n => `
            <div class="modal-list-item" data-name="${this.escapeHtml(n)}">
              <span>${this.escapeHtml(n)}</span>
              <button class="del-btn" data-del="${this.escapeHtml(n)}">✕</button>
            </div>
          `).join('')}
        </div>
      `
      document.getElementById('modal-actions').innerHTML = `<button class="modal-btn" data-action="close">Close</button>`
      overlay.style.display = 'flex'

      const close = () => { overlay.style.display = 'none'; resolve(null) }

      const box2 = document.getElementById('modal-box')
      box2.querySelector('[data-action="close"]').onclick = close

      document.getElementById('modal-list').addEventListener('click', (e) => {
        const item = e.target.closest('.modal-list-item')
        const delBtn = e.target.closest('.del-btn')
        if (delBtn) {
          e.stopPropagation()
          const name = delBtn.dataset.del
          const all = this.getSavedPlaylists()
          delete all[name]
          this.savePlaylistList(all)
          this.modalList(title, label, Object.keys(all))
          return
        }
        if (item) {
          const name = item.dataset.name
          overlay.style.display = 'none'
          resolve(name)
        }
      })
    })
  }

  /* ── Playlist Management ── */
  async addFiles() {
    const files = await window.electronAPI.openFiles()
    if (!files.length) return
    await this.addTracks(files)
  }

  async addFolder() {
    const files = await window.electronAPI.openFolder()
    if (!files.length) return
    await this.addTracks(files)
  }

  async addTracks(paths) {
    const tracks = []
    for (const filePath of paths) {
      const [meta, duration, fileUrl] = await Promise.all([
        window.electronAPI.getMetadata(filePath),
        this.getDuration(filePath),
        window.electronAPI.pathToFileURL(filePath),
      ])
      tracks.push({ path: filePath, fileUrl, name: meta.name, duration: duration || 0 })
    }
    this.playlist.push(...tracks)
    this.renderPlaylist()
    this.updateUI()
    this.saveState()
    this.setStatus(`Added ${tracks.length} track${tracks.length > 1 ? 's' : ''}`)
    if (!this.isPlaying && this.currentIndex < 0 && this.playlist.length > 0) {
      this.loadTrack(0)
    }
  }

  async removeTrack(index) {
    const wasActive = index === this.currentIndex
    this.playlist.splice(index, 1)
    if (this.isShuffled) {
      this.shuffleOrder = this.shuffleOrder
        .filter(i => i !== index)
        .map(i => i > index ? i - 1 : i)
    }
    if (wasActive) {
      this.stop()
      if (this.playlist.length > 0) {
        this.loadTrack(Math.min(index, this.playlist.length - 1), false, this.isPlaying)
      } else {
        this.currentIndex = -1
        this.updateUI()
      }
    } else if (this.currentIndex > index) {
      this.currentIndex--
    }
    this.renderPlaylist()
    this.saveState()
  }

  clearPlaylist() {
    this.stop()
    this.playlist = []
    this.currentIndex = -1
    this.shuffleOrder = []
    this.shuffleIndex = 0
    this.renderPlaylist()
    this.updateUI()
    this.saveState()
    this.setStatus('Playlist cleared')
  }

  moveTrack(from, to) {
    if (from === to) return
    const [track] = this.playlist.splice(from, 1)
    this.playlist.splice(to, 0, track)
    if (this.currentIndex === from) {
      this.currentIndex = to
    } else {
      if (from < this.currentIndex && to >= this.currentIndex) this.currentIndex--
      else if (from > this.currentIndex && to <= this.currentIndex) this.currentIndex++
    }
    this.renderPlaylist()
    this.saveState()
  }

  /* ── Track Loading / Playback ── */
  async getDuration(filePath) {
    const url = await window.electronAPI.pathToFileURL(filePath)
    return new Promise((resolve) => {
      const temp = new Audio()
      temp.preload = 'metadata'
      temp.src = url
      temp.onloadedmetadata = () => { resolve(temp.duration); temp.remove() }
      temp.onerror = () => { resolve(0); temp.remove() }
      setTimeout(() => { resolve(0); temp.remove() }, 2000)
    })
  }

  recreateAudio() {
    const vol = this.audio.volume
    if (this.source) { this.source.disconnect(); this.source = null }
    if (this.audioCtx) { this.audioCtx.close(); this.audioCtx = null; this.analyser = null }
    const old = this.audio
    this.audio = new Audio()
    this.audio.volume = vol
    this.audio.preload = 'metadata'
    this.audio.addEventListener('timeupdate', () => { this.updateProgress(); this.throttledSave() })
    this.audio.addEventListener('ended', () => this.handleEnded())
    this.audio.addEventListener('volumechange', () => this.updateVolumeUI())
    old.remove()
  }

  loadTrack(index, silent = false, autoPlay = false, startTime = 0) {
    if (index < 0 || index >= this.playlist.length) return
    this.currentIndex = index
    const track = this.playlist[index]

    this.recreateAudio()
    this.isPlaying = false

    if (autoPlay) this.setupAudioContext()

    this.audio.src = track.fileUrl

    this.audio.onloadedmetadata = () => {
      document.getElementById('time-total').textContent = this.formatTime(this.audio.duration)
      this.updateProgress()
      if (!silent) this.setStatus(`Now playing: ${track.name}`)
      if (startTime > 0 && startTime < this.audio.duration) {
        this.audio.currentTime = startTime
      }
    }

    this.audio.onloadeddata = () => {
      if (autoPlay && !this.isPlaying) {
        this.audio.play().then(() => {
          this.isPlaying = true
          this.updateUI()
          this.renderPlaylist()
        }).catch(() => { this.setStatus('Playback failed — try clicking Play') })
      }
    }

    this.audio.onerror = () => {
      this.setStatus(`Error: cannot load "${track.name}"`)
    }

    this.audio.load()

    this.updateUI()
    this.renderPlaylist()
    this.resetVisualizer()
    this.saveState()
    this.updateMediaSession(track)
  }

  togglePlay() {
    if (this.playlist.length === 0) return
    if (this.currentIndex < 0) { this.loadTrack(0, false, true); this.saveState(); return }
    if (this.isPlaying) {
      this.audio.pause()
      this.isPlaying = false
      this.updateUI()
      this.setStatus('Paused')
    } else {
      this.setupAudioContext()
      this.audio.play().then(() => {
        this.isPlaying = true
        this.updateUI()
        this.renderPlaylist()
      }).catch(() => {
        if (this.audio.readyState < 3) {
          this.audio.oncanplay = () => {
            this.audio.play().then(() => {
              this.isPlaying = true
              this.updateUI()
              this.renderPlaylist()
            }).catch(() => {})
            this.audio.oncanplay = null
          }
        }
      })
    }
    this.saveState()
  }

  stop() {
    this.audio.pause()
    this.audio.currentTime = 0
    this.isPlaying = false
    this.updateUI()
    this.updateProgress()
    this.resetVisualizer()
    this.setStatus('Stopped')
  }

  next() {
    if (this.playlist.length === 0) return
    if (this.repeatMode === 2) {
      this.audio.currentTime = 0; return
    }
    const idx = this.getNextIndex()
    this.loadTrack(idx, false, this.isPlaying)
  }

  prev() {
    if (this.playlist.length === 0) return
    if (this.audio.currentTime > 2) { this.audio.currentTime = 0; return }
    const idx = this.getPrevIndex()
    this.loadTrack(idx, false, this.isPlaying)
  }

  getNextIndex() {
    if (this.isShuffled) {
      this.shuffleIndex = (this.shuffleIndex + 1) % this.shuffleOrder.length
      return this.shuffleOrder[this.shuffleIndex]
    }
    return (this.currentIndex + 1) % this.playlist.length
  }

  getPrevIndex() {
    if (this.isShuffled) {
      this.shuffleIndex = (this.shuffleIndex - 1 + this.shuffleOrder.length) % this.shuffleOrder.length
      return this.shuffleOrder[this.shuffleIndex]
    }
    return (this.currentIndex - 1 + this.playlist.length) % this.playlist.length
  }

  handleEnded() {
    if (this.repeatMode === 2) {
      this.audio.currentTime = 0
      this.audio.play().catch(() => {})
      return
    }
    const next = this.getNextIndex()
    if (next === this.currentIndex && this.repeatMode === 0) { this.stop(); return }
    this.loadTrack(next, false, true)
  }

  /* ── Repeat / Shuffle ── */
  toggleRepeat() {
    this.repeatMode = (this.repeatMode + 1) % 3
    this.updateUI()
    this.saveState()
    this.setStatus(['Repeat: Off', 'Repeat: All', 'Repeat: One'][this.repeatMode])
  }

  toggleShuffle() {
    this.isShuffled = !this.isShuffled
    if (this.isShuffled) {
      this.shuffleOrder = this.playlist.map((_, i) => i)
      for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]]
      }
      const idx = this.shuffleOrder.indexOf(this.currentIndex)
      this.shuffleIndex = idx >= 0 ? idx : 0
    }
    this.updateUI()
    this.saveState()
    this.setStatus(this.isShuffled ? 'Shuffle: On' : 'Shuffle: Off')
  }

  /* ── Seek / Volume ── */
  seek(percent) {
    if (!this.audio.duration) return
    this.audio.currentTime = (percent / 100) * this.audio.duration
  }

  setVolume(value) {
    this.audio.volume = value / 100
    if (this.audio.volume > 0) this.prevVolume = this.audio.volume
    this.updateVolumeUI()
    this.saveState()
  }

  toggleMute() {
    if (this.audio.volume > 0) {
      this.prevVolume = this.audio.volume
      this.audio.volume = 0
    } else {
      this.audio.volume = this.prevVolume || 0.8
    }
    this.updateVolumeUI()
    this.saveState()
  }

  startVolumeAccel(dir) {
    this.stopVolumeAccel()
    const acc = this.volAccel

    const pct = Math.round(this.audio.volume * 100)
    const first = Math.max(0, Math.min(100, pct + dir))
    this.setVolume(first)
    if (first === pct) return

    acc.active = true
    acc.startVal = pct
    acc.startTime = performance.now()
    acc.dir = dir

    const tick = () => {
      if (!acc.active) return
      const elapsed = (performance.now() - acc.startTime) / 1000
      const n = Math.floor(elapsed)
      const frac = elapsed - n
      let totalStep = n * (n + 1) / 2
      totalStep += (n + 1) * frac
      const val = Math.max(0, Math.min(100, acc.startVal + dir * (1 + totalStep)))
      this.setVolume(val)
      acc.rafId = requestAnimationFrame(tick)
    }
    tick()
  }

  stopVolumeAccel() {
    const acc = this.volAccel
    if (!acc.active) return
    acc.active = false
    if (acc.rafId) { cancelAnimationFrame(acc.rafId); acc.rafId = null }
  }

  /* ── Visualizer ── */
  cycleVisMode() {
    this.setVisMode((this.visMode + 1) % this.visModes.length)
  }

  setVisMode(mode) {
    this.visMode = mode
    document.getElementById('vis-mode-label').textContent = this.visModes[mode]
    if (this.isPlaying && this.analyser) { this.resetVisualizer(); this.startVisualizer() }
    else { this.resetVisualizer() }
    this.saveState()
  }

  setupAudioContext() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume()
      return
    }
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume()
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 256
      this.source = this.audioCtx.createMediaElementSource(this.audio)
      this.source.connect(this.analyser)
      this.analyser.connect(this.audioCtx.destination)
      this.startVisualizer()
    } catch (err) {
      this.log(`AudioContext error: ${err.message}`, 'error')
    }
  }

  startVisualizer() {
    const canvas = document.getElementById('vis-canvas')
    const ctx = canvas.getContext('2d')
    const bufferLength = this.analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    const timeData = new Uint8Array(bufferLength)
    const root = getComputedStyle(document.documentElement)

    const resizeCanvas = () => {
      const w = canvas.offsetWidth; const h = canvas.offsetHeight
      if (canvas.width !== w * window.devicePixelRatio || canvas.height !== h * window.devicePixelRatio) {
        canvas.width = w * window.devicePixelRatio; canvas.height = h * window.devicePixelRatio
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      }
    }

    const c0 = root.getPropertyValue('--vis-bar-0').trim() || '#6c63ff'
    const c1 = root.getPropertyValue('--vis-bar-1').trim() || '#7c6aff'
    const c2 = root.getPropertyValue('--vis-bar-2').trim() || '#b8a8ff'
    const waveColor = root.getPropertyValue('--vis-wave').trim() || '#7c6aff'

    const drawBars = () => {
      this.analyser.getByteFrequencyData(dataArray)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const w = canvas.offsetWidth; const h = canvas.offsetHeight
      const barCount = 48; const step = Math.floor(bufferLength / barCount)
      const bw = (w / barCount) - 1.5
      for (let i = 0; i < barCount; i++) {
        let s = 0; for (let j = 0; j < step; j++) s += dataArray[i * step + j] || 0
        const bh = (s / step / 255) * h * 0.85
        const x = i * (w / barCount)
        const g = ctx.createLinearGradient(x, h, x, h - bh)
        g.addColorStop(0, c0); g.addColorStop(0.5, c1); g.addColorStop(1, c2)
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, h - bh, bw, bh, [2, 2, 0, 0]); ctx.fill()
      }
    }

    const drawWave = () => {
      this.analyser.getByteTimeDomainData(timeData)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const w = canvas.offsetWidth; const h = canvas.offsetHeight
      ctx.strokeStyle = waveColor; ctx.lineWidth = 2
      ctx.shadowColor = waveColor + '66'; ctx.shadowBlur = 8
      ctx.beginPath(); const slice = w / bufferLength; let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const y = (timeData[i] / 128) * h / 2
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); x += slice
      }
      ctx.stroke(); ctx.shadowBlur = 0
    }

    const drawCircle = () => {
      this.analyser.getByteFrequencyData(dataArray)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const w = canvas.offsetWidth; const h = canvas.offsetHeight
      const cx = w / 2; const cy = h / 2; const r = Math.min(w, h) * 0.3
      const barCount = 48; const step = Math.floor(bufferLength / barCount)
      for (let i = 0; i < barCount; i++) {
        let s = 0; for (let j = 0; j < step; j++) s += dataArray[i * step + j] || 0
        const avg = s / step; const bl = (avg / 255) * r * 0.8
        const a = (i / barCount) * Math.PI * 2 - Math.PI / 2
        const x1 = cx + Math.cos(a) * r; const y1 = cy + Math.sin(a) * r
        const x2 = cx + Math.cos(a) * (r + bl); const y2 = cy + Math.sin(a) * (r + bl)
        ctx.strokeStyle = `hsl(${240 + (avg / 255) * 60}, 100%, ${60 + (avg / 255) * 20}%)`
        ctx.lineWidth = 3; ctx.shadowColor = waveColor + '44'; ctx.shadowBlur = 6
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      }
      ctx.shadowBlur = 0
    }

    const modes = [drawBars, drawWave, drawCircle]
    const draw = () => {
      this.visAnimId = requestAnimationFrame(draw); resizeCanvas(); modes[this.visMode]()
    }
    resizeCanvas(); draw()
  }

  resetVisualizer() {
    if (this.visAnimId) { cancelAnimationFrame(this.visAnimId); this.visAnimId = null }
    const canvas = document.getElementById('vis-canvas'); const ctx = canvas.getContext('2d')
    canvas.width = canvas.offsetWidth * window.devicePixelRatio; canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    ctx.fillStyle = '#0c0c18'; ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
  }

  /* ── UI Updates ── */
  updateUI() {
    const nameEl = document.getElementById('track-name')
    const track = this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null
    nameEl.textContent = track ? track.name : 'No track selected'
    nameEl.classList.toggle('marquee', track && track.name.length > 20)
    document.getElementById('track-details').textContent = track ? `Track ${this.currentIndex + 1} of ${this.playlist.length}` : ''
    const btn = document.getElementById('btn-play')
    btn.textContent = this.isPlaying ? '⏸' : '▶'
    btn.classList.toggle('playing', this.isPlaying)
    document.getElementById('btn-shuffle').classList.toggle('active', this.isShuffled)
    const rBtn = document.getElementById('btn-repeat')
    rBtn.classList.toggle('active', this.repeatMode > 0)
    rBtn.classList.toggle('repeat-one', this.repeatMode === 2)
    document.getElementById('pl-count').textContent = this.playlist.length ? `(${this.playlist.length})` : ''
  }

  updateProgress() {
    const current = this.audio.currentTime || 0
    const duration = this.audio.duration || 0
    document.getElementById('time-current').textContent = this.formatTime(current)
    document.getElementById('time-total').textContent = duration ? this.formatTime(duration) : '0:00'
    const slider = document.getElementById('seek-slider')
    if (!slider.dragging) {
      const pct = duration ? (current / duration) * 100 : 0
      slider.value = pct
      slider.style.background = `linear-gradient(to right, var(--progress-fill) ${pct}%, var(--progress-track) ${pct}%)`
    }
  }

  updateVolumeUI() {
    const pct = Math.round(this.audio.volume * 100)
    document.getElementById('vol-pct').textContent = pct + '%'
    const icon = document.getElementById('vol-icon')
    if (pct === 0) icon.textContent = '🔇'
    else if (pct < 30) icon.textContent = '🔈'
    else if (pct < 60) icon.textContent = '🔉'
    else icon.textContent = '🔊'
    document.getElementById('volume-slider').value = pct
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00'
    const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  setStatus(msg) { document.getElementById('status-text').textContent = msg }

  /* ── Playlist Render ── */
  renderPlaylist() {
    const container = document.getElementById('playlist')
    container.innerHTML = ''

    if (this.playlist.length === 0) {
      container.innerHTML = '<div class="pl-empty">Drop MP3 files here or click + to add tracks</div>'
      return
    }

    this.playlist.forEach((track, i) => {
      const item = document.createElement('div')
      item.className = 'pl-item'
      if (i === this.currentIndex) item.classList.add('active')
      if (i === this.currentIndex && this.isPlaying) item.classList.add('playing')
      item.draggable = true
      item.dataset.index = i

      item.innerHTML = `
        <span class="pl-index">${i + 1}</span>
        <span class="pl-name">${this.escapeHtml(track.name)}</span>
        <span class="pl-duration">${this.formatTime(track.duration)}</span>
        <button class="pl-remove" data-index="${i}">✕</button>
      `

      item.addEventListener('click', (e) => {
        if (e.target.closest('.pl-remove')) return
        if (i === this.currentIndex) { this.togglePlay() }
        else { this.loadTrack(i, false, true) }
      })

      item.addEventListener('dblclick', (e) => {
        if (e.target.closest('.pl-remove')) return
        this.loadTrack(i, false, true)
      })

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        this.showContextMenu(e.clientX, e.clientY, i)
      })

      const removeBtn = item.querySelector('.pl-remove')
      removeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.removeTrack(i) })

      item.addEventListener('dragstart', (e) => {
        this.plDragIndex = i; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'
      })
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging')
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))
      })
      item.addEventListener('dragover', (e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))
        item.classList.add('drag-over')
      })
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'))
      item.addEventListener('drop', (e) => {
        e.preventDefault()
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))
        if (this.plDragIndex !== null && this.plDragIndex !== i) this.moveTrack(this.plDragIndex, i)
        this.plDragIndex = null
      })

      container.appendChild(item)
    })
  }

  showContextMenu(x, y, trackIndex) {
    const menu = document.getElementById('context-menu')
    const track = this.playlist[trackIndex]

    menu.innerHTML = `
      <div class="ctx-menu-item" data-action="play">▶ Play</div>
      <div class="ctx-menu-item" data-action="remove">✕ Remove</div>
      <div class="ctx-menu-sep"></div>
      <div class="ctx-menu-item" data-action="info">ℹ ${this.escapeHtml(track.name)}</div>
    `
    menu.style.display = 'block'
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px'
    menu.style.top = Math.min(y, window.innerHeight - 120) + 'px'

    const close = () => { menu.style.display = 'none'; menu.innerHTML = '' }

    menu.querySelectorAll('.ctx-menu-item').forEach(el => {
      el.addEventListener('click', () => {
        const action = el.dataset.action
        if (action === 'play') this.loadTrack(trackIndex, false, true)
        else if (action === 'remove') this.removeTrack(trackIndex)
        close()
      })
    })

    document.addEventListener('click', close, { once: true })
  }

  escapeHtml(str) {
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML
  }

  /* ── Keyboard ── */
  initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return
      switch (e.code) {
        case 'Space': e.preventDefault(); this.togglePlay(); break
        case 'ArrowLeft': e.preventDefault(); this.seek(Math.max(0, ((this.audio.currentTime || 0) - 5) / (this.audio.duration || 1) * 100)); break
        case 'ArrowRight': e.preventDefault(); this.seek(Math.min(100, ((this.audio.currentTime || 0) + 5) / (this.audio.duration || 1) * 100)); break
        case 'ArrowUp': e.preventDefault(); if (e.repeat && this.volAccel.active) break; this.startVolumeAccel(1); break
        case 'ArrowDown': e.preventDefault(); if (e.repeat && this.volAccel.active) break; this.startVolumeAccel(-1); break
        case 'KeyN': this.next(); break
        case 'KeyP': this.prev(); break
        case 'KeyR': this.toggleRepeat(); break
        case 'KeyS': this.toggleShuffle(); break
        case 'KeyV': this.cycleVisMode(); break
        case 'KeyT': this.cycleTheme(); break
        case 'KeyO': if (e.metaKey || e.ctrlKey) { e.preventDefault(); this.addFiles() }; break
        case 'Delete': case 'Backspace': if (this.currentIndex >= 0) this.removeTrack(this.currentIndex); break
        case 'Escape': this.stop(); break
      }
    })
    document.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') this.stopVolumeAccel()
    })
  }

  /* ── MediaSession API ── */
  initMediaSession() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', () => this.togglePlay())
    navigator.mediaSession.setActionHandler('pause', () => this.togglePlay())
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev())
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next())
    navigator.mediaSession.setActionHandler('stop', () => this.stop())
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.name, artist: 'MP3 Player', album: '',
    })
  }

  /* ── Event Binding ── */
  bindEvents() {
    document.getElementById('btn-play').addEventListener('click', () => this.togglePlay())
    document.getElementById('btn-stop').addEventListener('click', () => this.stop())
    document.getElementById('btn-next').addEventListener('click', () => this.next())
    document.getElementById('btn-prev').addEventListener('click', () => this.prev())
    document.getElementById('btn-shuffle').addEventListener('click', () => this.toggleShuffle())
    document.getElementById('btn-repeat').addEventListener('click', () => this.toggleRepeat())
    document.getElementById('btn-theme').addEventListener('click', () => this.cycleTheme())
    document.getElementById('btn-add-files').addEventListener('click', () => this.addFiles())
    document.getElementById('btn-add-folder').addEventListener('click', () => this.addFolder())
    document.getElementById('btn-clear').addEventListener('click', () => this.clearPlaylist())
    document.getElementById('btn-vis-mode').addEventListener('click', () => this.cycleVisMode())
    document.getElementById('visualizer').addEventListener('click', () => this.cycleVisMode())
    document.getElementById('btn-pl-save').addEventListener('click', () => this.showSavePlaylistDialog())
    document.getElementById('btn-pl-load').addEventListener('click', () => this.showLoadPlaylistDialog())

    document.getElementById('btn-minimize').addEventListener('click', () => window.electronAPI.minimize())
    document.getElementById('btn-close').addEventListener('click', () => window.electronAPI.close())

    document.getElementById('vol-icon').addEventListener('click', () => this.toggleMute())

    document.getElementById('seek-slider').addEventListener('input', function () { this.dragging = true; player.seek(this.value) })
    document.getElementById('seek-slider').addEventListener('change', function () { this.dragging = false })
    document.getElementById('seek-slider').addEventListener('mouseup', function () { this.dragging = false })

    document.getElementById('volume-slider').addEventListener('input', function () { player.setVolume(this.value) })

    this.audio.addEventListener('ended', () => this.handleEnded())
    this.audio.addEventListener('volumechange', () => this.updateVolumeUI())

    document.addEventListener('dragover', (e) => e.preventDefault())
    document.addEventListener('drop', async (e) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      const audioFiles = files.filter(f => /\.(mp3|wav|ogg|flac|m4a)$/i.test(f.name))
      if (audioFiles.length === 0) return
      await this.addTracks(audioFiles.map(f => f.path))
    })

    window.addEventListener('beforeunload', () => this.saveState())
  }
}

const player = new AudioPlayer()
player.initAsync()
