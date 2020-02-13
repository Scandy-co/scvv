/* global AFRAME, THREE */
const _ = require("lodash")

const { downloadBin, downloadAudioBuffer } = require("./utils")

let LoadSCVVWorker = null

const production = process.env.NODE_ENV == "production"
if (production) {
  // TODO: make this part of webpack!
} else {
  LoadSCVVWorker = require("worker-loader!./lib/workers/LoadSCVVWorker")
}

/**
 * Gets a Web Worker with LoadSCVVWorker ready to run.
 * Abstracts the production vs development concerns
 */
const createLoadSCVVWorker = () => {
  if (production) {
    if (LoadSCVVWorker) {
      return new Worker(LoadSCVVWorker)
    } else {
      // TODO: make this part of webpack!
      return downloadBin(
        "https://s3.amazonaws.com/hoxel-streamed-001/LoadSCVVWorker.js",
        "blob"
      ).then(blob => {
        LoadSCVVWorker = window.URL.createObjectURL(blob)
        return new Worker(LoadSCVVWorker)
      })
    }
  } else {
    return new LoadSCVVWorker()
  }
}

let isMobile = false
const isMobileDevice = () => {
  if (isMobile) {
    return true
  } else {
    isMobile =
      navigator.userAgent.match(/Android/i) ||
      navigator.userAgent.match(/webOS/i) ||
      navigator.userAgent.match(/iPhone/i) ||
      navigator.userAgent.match(/iPad/i) ||
      navigator.userAgent.match(/iPod/i) ||
      navigator.userAgent.match(/BlackBerry/i) ||
      navigator.userAgent.match(/Windows Phone/i)
  }
  return isMobile
}

AFRAME.registerComponent("scvv", {
  schema: {
    autoplay: { default: true },
    loop: { default: true },
    maxDistance: { default: 10 },
    distanceModel: {
      default: "inverse",
      oneOf: ["linear", "inverse", "exponential"]
    },
    refDistance: { default: 1 },
    rolloffFactor: { default: 5 },
    volume: { default: 1 },
    src: {
      type: "string"
    }
  },

  multiple: true,
  numWorkers: 1,
  scandyToThreeMat: new THREE.Matrix4(),
  maxBufferedCount: 2000,
  minBuffered: 3,
  delay_ms: 35,
  /**
   * shouldPlay controls whether the SCVV animation should play.
   * This needs to be controlled separately from isPlaying since that is owned by the AFRAME component level logic.
   */
  shouldPlay: false,

  init() {
    this.listener = null
    this.readyToPlay = false

    this.setupBuffers()
    this.setupMesh()

    // Trying to fix audio on iOS being a jerk
    const fixAudioContext = () => {
      this.setAudioContext()
      if (this.audioCtx.state == "suspended") {
        this.audioCtx.resume()
        // document.addEventListener('touchend', fixAudioContext);
      }
      this.setupAudio()
      document.removeEventListener("touchend", fixAudioContext)

      // Pre-fetch the audio now as well
      this.getAudioBuffer()
        .then(() => {})
        .catch(err => {})
    }

    if (isMobileDevice()) {
      document.addEventListener("touchend", fixAudioContext)
    } else {
      this.setAudioContext()
      this.setupAudio()
    }
  },

  setAudioContext() {
    var AudioContext = window.AudioContext || window.webkitAudioContext
    this.audioCtx = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 44100
    })
  },

  update(oldData) {
    var data = this.data
    const HOXEL_URL = data.src
    console.log(`updating scvv: ${HOXEL_URL}`)

    var srcChanged = data.src !== oldData.src

    // Reset all the things
    if (srcChanged && HOXEL_URL && HOXEL_URL.length > 5) {
      this.setupBuffers()
      this.setupMesh()
      this.setupAudio()

      this.downloadSCVVJSON()
    }
  },

  stopAudio() {
    if (this.positionalAudio && this.positionalAudio.isPlaying) {
      console.log("this.positionalAudio.stop()", this.scvvJSON.HOXEL_URL)
      this.positionalAudio.stop()
    }
    this.audioPlaying = false
  },

  /**
   * Starts playing back the scvv if its not already
   */
  startPlayback() {
    if (!this.shouldPlay) {
      this.shouldPlay = true
      console.log("startPlayback()", this.scvvJSON.HOXEL_URL)
    }
  },

  stopPlayback() {
    if (this.shouldPlay) {
      this.shouldPlay = false
      this.stopAudio()
      console.log("stopPlayback()", this.scvvJSON.HOXEL_URL)
    }
  },

  downloadSCVVJSON() {
    var data = this.data
    const HOXEL_URL = data.src
    // Download the scvv json to get this party started
    downloadBin(`${HOXEL_URL}/scvv.json`, "json")
      .then(json => {
        this.scvvJSON = {
          HOXEL_URL,
          ...json
        }
        if (!this.scvvJSON.version) {
          // Fix perspective for pre-versioning
          this.scandyToThreeMat.set(
            -0.0,
            -1.0,
            0.0,
            0.0,
            -1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1
          )
        } else if (this.scvvJSON.version == "0.1.0") {
          // Fix perspective for 0.1.0
          this.scandyToThreeMat.set(
            -0.0,
            -1.0,
            0.0,
            0.0,
            -1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            -1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1
          )
        }
        // console.log('got json', HOXEL_URL)
        if (this.scvvJSON) {
          if (this.scvvJSON.isStreaming && !this.audioPlaying) {
            this.streamAudio()
          } else if (this.scvvJSON.audio) {
            this.getAudioBuffer()
              .then(() => {})
              .catch(err => {})
          }
        }
        this.callHoxelWorkers()

        if (this.scvvJSON.isStreaming) {
          setTimeout(this.downloadSCVVJSON(), 900)
          this.maxBufferedCount = 50
        } else {
          this.minBuffered = this.scvvJSON.frames.length * 0.6
          this.maxBufferedCount = 5000
        }
      })
      .catch(err => {
        console.log("error downloading json", err)
        setTimeout(this.downloadSCVVJSON(), 700)
      })
  },

  remove() {
    var el = this.el
    if (this.jsonDownloader) {
      clearInterval(this.jsonDownloader)
    }
    // console.log('removing')
    this.el.removeObject3D("mesh")
    this.mesh = null
    this.material = null
    if (this.positionalAudio.isPlaying) this.positionalAudio.stop()
    this.audioPlaying = false
    // this.positionalAudio = null
    this.group = null
    this.setupBuffers()
  },

  setupBuffers() {
    // console.log("setupBuffers()")
    this.ddFrameWorkers = []
    this.newFrames = []
    this.bufferedFrames = []
    this.badFrames = {}
    this.seenFrames = {}
    this.readyToPlay = false
    this.frameIdx = 0
    this.deltas = 0
    this.vv_frame_ms = 0

    this.audioBuffer = null
    this.downloadingAudioBuffer = false
    this.lastAudioTimestamp = 0
  },

  setupMesh() {
    var el = this.el

    this.el.removeAttribute("body")
    this.el.removeAttribute("shape__handle")

    // THREEJS objects to playback the SCVV frames
    this.scvvTextureImage = new Image()
    this.scvvTexture = new THREE.Texture(this.scvvTextureImage)
    // Bind the onload of the image to always update the texture
    this.scvvTextureImage.onload = () => {
      // console.log('text')
      this.scvvTexture.needsUpdate = true
    }
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      // color: 0x00ff00,
      // opacity: 0.92,
      // transparent: true,
      side: THREE.DoubleSide
    })
    this.loadingMaterial = new THREE.MeshPhongMaterial({
      color: 0x25c83e,
      opacity: 0.7,
      transparent: true
    })
    let geometry = new THREE.SphereGeometry(0.3, 100, 100)
    this.mesh = new THREE.Mesh(geometry, this.loadingMaterial)

    this.group = new THREE.Group()
    this.group.add(this.mesh)

    el.setObject3D("mesh", this.group)
  },

  setupAudio() {
    const { el, data } = this
    const { sceneEl } = el
    const listener = (this.listener =
      sceneEl.audioListener || new THREE.AudioListener())
    sceneEl.audioListener = listener
    // Add the listener to the camera!
    if (sceneEl.camera) {
      sceneEl.camera.add(listener)
    }
    // Wait for camera if necessary.
    sceneEl.addEventListener("camera-set-active", evt => {
      evt.detail.cameraEl.getObject3D("camera").add(listener)
    })
    this.positionalAudio =
      this.positionalAudio || new THREE.PositionalAudio(listener)
    this.positionalAudio.setDistanceModel(data.distanceModel)
    this.positionalAudio.setMaxDistance(data.maxDistance)
    this.positionalAudio.setRefDistance(data.refDistance)
    this.positionalAudio.setRolloffFactor(data.rolloffFactor)
    this.positionalAudio.setLoop(data.loop)
    this.positionalAudio.setVolume(data.volume)
    // Should we add it the group ?
    // this.group.add(this.positionalAudio)
    // Or should we add it as an element?
    el.setObject3D("sound", this.positionalAudio)
  },

  /**
   * Calls the hoxel workers with the passed in JSON.
   * @param {*} scvvJSON
   */
  async callHoxelWorkers() {
    this.newFrames = []
    _.forEach(this.scvvJSON.frames, frame => {
      // Check to see if we've already got this frame
      if (this.seenFrames[frame.mesh_path] || this.badFrames[frame.mesh_path]) {
        // We don't need to get this frame, we've already seen it
      } else {
        // We need this frame, it hasn't been seen yet
        this.newFrames.push(frame)
      }
    })
    // Only have workers fetch newFrames
    this.scvvJSON.frames = this.newFrames

    _.forEach(this.newFrames, f => (this.seenFrames[f.mesh_path] = true))
    // console.log(`seenFrames: ${Object.keys(this.seenFrames).length}`)

    const loadSCVVWorkerMessage = msg => {
      const { error, dict } = msg.data
      // console.log("gotMessage", error)
      if (error) {
        console.log("error with ddFrameWorker", error)
        if (dict && dict.frame) {
          this.badFrames[dict.frame.mesh_path] = dict.frame
        }
        // this.callHoxelWorkers()
      } else if (dict && dict.frame) {
        this.addFrameBuffer(dict.frame)
      }
    }

    // Check if we have our worker
    if (!this.loadSCVVWorker) {
      this.loadSCVVWorker = await createLoadSCVVWorker()
    }
    this.loadSCVVWorker.onmessage = loadSCVVWorkerMessage

    if (this.newFrames.length > 0) {
      this.loadSCVVWorker.postMessage({
        scvvJSON: this.scvvJSON
      })
    }
  },

  /**
   * Adds the provided frame to the bufferedFrame array
   * @param {*} frame
   */
  addFrameBuffer(frame) {
    // console.log("addFrameBuffer", frame.mesh_path)
    // NOTE: this is a really annoying side of the Worker, it loses the BufferGeometry object
    let geometry = new THREE.BufferGeometry()
    // copy over all the attributes
    for (var prop in frame.mesh_geometry) {
      if (prop == "indices") {
        continue
      }

      geometry.setAttribute(
        prop,
        new THREE.Float32BufferAttribute(
          frame.mesh_geometry[prop].array,
          frame.mesh_geometry[prop].numComponents
        )
      )
    }
    // And the indices
    geometry.setIndex(new THREE.BufferAttribute(frame.mesh_geometry.indices, 1))
    // Fix the orientation for THREE from ScandyCore
    geometry.applyMatrix(this.scandyToThreeMat)
    geometry.computeBoundingSphere()
    // Fix the orientation for THREE from ScandyCore
    frame.mesh_geometry = geometry

    // Merge all the mesh frames together keeping them in order
    const bufferedFrames = {}
    _.forEach(this.bufferedFrames.slice(), f => {
      bufferedFrames[f["uid"]] = f
    })
    bufferedFrames[frame["uid"]] = frame

    let bufferCount = Object.keys(bufferedFrames).length
    let start = 0
    if (bufferCount > this.maxBufferedCount) {
      start = bufferCount - this.maxBufferedCount
    }
    // Only keep the most recent ones
    this.bufferedFrames = _.sortBy(Object.values(bufferedFrames), [
      "uid"
    ]).slice(start)
    this.frameIdx = this.frameIdx >= start ? this.frameIdx - start : 0
    // console.log(`bufferedFrames ${this.bufferedFrames.length}`)
    // console.log(`frameIdx ${this.frameIdx}`)

    if (this.bufferedFrames.length > this.minBuffered) {
      if (this.data.autoplay) {
        this.startPlayback()
      }
    }
  },

  /**
   * Store the audio buffer for reuse
   */
  getAudioBuffer() {
    const { scvvJSON } = this

    // Audio context and source global vars
    this.audioCtx =
      this.audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const { audioCtx } = this
    if (!audioCtx) {
      console.log("No AudioContext available")
    }

    return new Promise((resolve, reject) => {
      if (!scvvJSON) {
        // Nothing to do with nothing here
        reject()
      }
      if (this.audioBuffer) {
        resolve(this.audioBuffer)
      } else if (!this.downloadingAudioBuffer) {
        if (scvvJSON.audio) {
          let src = `${scvvJSON.HOXEL_URL}/${scvvJSON.audio}`
          this.downloadingAudioBuffer = true
          downloadAudioBuffer(audioCtx, src)
            .then(buffer => {
              this.audioBuffer = buffer
              resolve(this.audioBuffer)
            })
            .catch(reject)
            .finally(() => {
              this.downloadingAudioBuffer = false
            })
        } else {
          reject()
        }
      }
    })
  },

  /**
   * Stream audio from the live streaming server
   */
  streamAudio() {
    const { scvvJSON } = this
    const { HOXEL_URL } = scvvJSON

    if (scvvJSON.isStreaming && !this.audioPlaying) {
      this.audioPlaying = true
    } else {
      throw "Cannot streamAudio when scvvJSON is not streaming"
    }

    // Audio context and source global vars
    let audioCtx = this.audioCtx
    let bufferedAudio = []

    /**
     * Fetch all the latest audio binary files from the server
     */
    const fetchLatestAudio = () => {
      const audioURL = `${HOXEL_URL}/audio.json?${Date.now()}`
      // console.log('download latest audio', audioURL)
      return downloadBin(audioURL, "json").then(json => {
        const { timestamp, scvv_audio } = json
        // Only playback new timestamps
        if (this.lastAudioTimestamp >= timestamp) {
          // throw 'audio timestamp not new enough'
          return
        }
        this.lastAudioTimestamp = timestamp
        const downloadPromises = []
        downloadPromises.push(
          downloadBin(`${HOXEL_URL}/${scvv_audio}`, "arraybuffer")
        )
        return Promise.all(downloadPromises)
      })
    }

    /**
     * Buffer the array of raw audio data
     * @param {*} arr
     */
    const bufferAudioFrame = arr => {
      _.forEach(arr, audioData => {
        if (audioData) {
          let floatAudio = new Float32Array(audioData)
          // Create an empty mono channel buffer at the sample rate of the AudioContext
          const numChannels = 1
          let sampleRate = audioCtx.sampleRate
          // sampleRate = 44100
          var audioBuffer = audioCtx.createBuffer(
            numChannels,
            floatAudio.length,
            sampleRate
          )

          audioBuffer.getChannelData(numChannels - 1).set(floatAudio)
          bufferedAudio.push(audioBuffer)
        }
      })
      return
    }

    let audioBuffersPlayed = 0
    const bufferThresh = 1

    /**
     * Playback the buffered audio buffers
     */
    const playbackBufferedAudio = () => {
      if (bufferedAudio.length < audioBuffersPlayed + bufferThresh) {
        // We don't have any buffered audio, check back soon
        // console.log('dont have enough buffer audio, check back')
        return setTimeout(playbackBufferedAudio, 100)
      }
      const buffer = bufferedAudio[audioBuffersPlayed++]
      // Set the buffer on the positional audio
      this.positionalAudio.setBuffer(buffer)
      this.positionalAudio.setLoop(false)
      this.positionalAudio.setVolume(this.data.volume)

      // start the playing audio, after this buffer's duration
      setTimeout(() => {
        setTimeout(playbackBufferedAudio, 0)
        this.positionalAudio.play()
      }, buffer.duration * 1e3)
    }

    /**
     * Master stream loop that constantly fetches latest raw audio binaries then
     *  buffers that into ready to play audio buffers
     */
    const streamLoop = () => {
      fetchLatestAudio()
        .then(bufferAudioFrame)
        .catch(err => {
          console.log("Error with streamingAudio", err)
        })
        .finally(() => {
          setTimeout(streamLoop, 15)
          // console.log('finally did the recursive bit')
        })
    }
    // Kickoff the stream loop in the background
    setTimeout(streamLoop, 1)
    // Delay some then playback the buffered audio
    setTimeout(playbackBufferedAudio, 200)
  },

  /**
   * Starts playing audio given a scvv json file, not for live streaming.
   * @param {*} scvvJSON the scvvJSON object with SCVV info
   */
  playbackAudio() {
    const { scvvJSON } = this

    if (scvvJSON.isStreaming) {
      // I'm not supposed to be here...
    } else {
      const doPlay = () => {
        this.audioPlaying = true
        const start_sec = this.vv_frame_ms * 1e-3
        const offset_msec = scvvJSON.audio_us_offset * 1e-3
        if (offset_msec > 0) {
          setTimeout(() => {
            this.positionalAudio.play()
          }, offset_msec)
        } else {
          this.positionalAudio.play()
        }
      }

      // Download the audio buffer
      this.getAudioBuffer(scvvJSON)
        .then(buffer => {
          this.positionalAudio.setBuffer(buffer)
          doPlay()
        })
        .catch(err => {
          // pass
        })
    }
  },

  /**
   * Displays a single scvv frame
   * @param {*} frame
   */
  displaySCVVFrame(frame) {
    if (!!frame && !!frame.mesh_geometry && !!frame.texture_blob) {
      this.scvvTextureImage.src = frame.texture_blob
      // Account for rendering overhead
      let renderDelayMs = 7
      let renderMs = Date.now()
      if (this.lastRenderMs) {
        renderMs = renderMs - this.lastRenderMs
      }
      this.lastRenderMs = renderMs
      if (this.scvvJSON.isStreaming) {
        this.delay_ms = 35
      } else {
        this.delay_ms = Math.floor(frame.delay_us * 1e-3) - renderDelayMs
      }
      this.mesh.geometry = frame.mesh_geometry
      if (!this.mesh.material.map) {
        this.mesh.material = this.material
        this.mesh.material.map = this.scvvTexture
        this.mesh.material.needsUpdate = true
        this.scvvTexture.needsUpdate = true
      }
    }
  },

  /**
   * Part of the aframe component lifecycle. Gets called at ~60fps
   * @param {*} time total ms of time
   * @param {*} timeDelta ms since last tick()
   */
  tick(time, timeDelta) {
    this.deltas += timeDelta
    if (
      this.isPlaying &&
      this.shouldPlay &&
      this.audioCtx &&
      !!this.bufferedFrames &&
      this.bufferedFrames.length > this.minBuffered
    ) {
      // Start the audio on the first frame
      if (
        !this.scvvJSON.isStreaming &&
        this.audioBuffer &&
        this.frameIdx == 0 &&
        !this.audioPlaying
      ) {
        this.playbackAudio()
      }
      if (this.deltas >= this.delay_ms) {
        this.displaySCVVFrame(this.bufferedFrames[this.frameIdx])
        this.vv_frame_ms += this.deltas
        this.deltas = 0

        // Check to make sure the requested frameIdx is in the buffer
        const lastIdx = this.bufferedFrames.length - 1
        this.frameIdx = this.frameIdx + 1
        if (this.frameIdx >= lastIdx) {
          if (this.data.loop) {
            // Check to see if we need to stop the audio
            if (this.positionalAudio.isPlaying) {
              this.positionalAudio.stop()
              this.audioPlaying = false
            }
            this.frameIdx = 0
          } else {
            this.frameIdx = lastIdx
          }
        }
      }
    }
  }
})
