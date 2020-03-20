/* global AFRAME, THREE */
const _ = require("lodash")

const {
  downloadBin,
  downloadAudioBuffer,
  getSCVVTransform
} = require("./utils")

let LoadSCVVWorker = null

const production = process.env.NODE_ENV == "production"
const PACKAGE_VERSION = process.env.PACKAGE_VERSION || "latest"
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
      const HOXEL_JS_CDN_URL =
        process.env.HOXEL_JS_CDN_URL ||
        "https://hoxel-js-cdn.s3.us-east-2.amazonaws.com/releases"
      // TODO: make this part of webpack!
      return downloadBin(
        `${HOXEL_JS_CDN_URL}/${PACKAGE_VERSION}/LoadSCVVWorker.js`,
        "blob"
      )
        .then(blob => {
          LoadSCVVWorker = window.URL.createObjectURL(blob)
          return new Worker(LoadSCVVWorker)
        })
        .catch(() => {
          // If it fails, try again
          setTimeout(createLoadSCVVWorker, 300)
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
    imageTarget: {
      type: "string",
      default: ""
    },
    imageTargetLostThresh: { default: 2000 },
    src: {
      type: "string",
      default: ""
    }
  },

  // tell AFrame that there can be multiple SCVV components
  multiple: true,

  hoxelUrl: `${window.location.href}/streamed`,
  use8thWall: false,
  finishedLoading8thWall: true,

  meshGroup: new THREE.Group(),
  scandyToThreeMat: null,
  // Allow for a 10 minute recording at 40 fps
  maxBufferedCount: 40 * 60 * 10,
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

    this.setup8thWall()

    // Trying to fix audio on iOS being a jerk
    const fixAudioContext = () => {
      this.setAudioContext()
      if (this.audioCtx.state == "suspended") {
        this.audioCtx.resume()
      }
      this.setupAudio()
      document.removeEventListener("touchstart", fixAudioContext)

      // Pre-fetch the audio now as well
      this.getAudioBuffer()
        .then(() => {})
        .catch(err => {})
    }

    // Fix the audio context when not using 8th wall on mobile
    if (!this.use8thWall && isMobileDevice()) {
      document.addEventListener("touchstart", fixAudioContext)
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

  setup8thWall() {
    const { object3D, sceneEl } = this.el
    const { imageTarget } = this.data

    let lastImageUpdate = false

    const showImage = event => {
      const { detail, type } = event
      if (imageTarget != detail.name) {
        return
      }

      lastImageUpdate = Date.now()
      // console.log(event)
      // Always update the position and rotation
      this.meshGroup.position.copy(detail.position)
      this.meshGroup.quaternion.copy(detail.rotation)

      // Only update the scale on image found
      if (type == "xrimagefound") {
        // console.log("found it")
        const newScale = this.el.getAttribute("scale")
        newScale.x *= detail.scale
        newScale.y *= detail.scale
        newScale.z *= detail.scale
        // console.log(newScale)
        this.meshGroup.scale.set(newScale.x, newScale.y, newScale.z)
        object3D.visible = true
        this.startPlayback()
      }
    }

    const hideImage = ({ detail }) => {
      if (imageTarget != detail.name) {
        return
      }
      // Debounce the image being lost briefly
      setTimeout(() => {
        if (
          Math.abs(Date.now() - lastImageUpdate) >
          this.data.imageTargetLostThresh
        ) {
          // console.log("lost it for real")
          object3D.visible = false
          this.stopPlayback()
        }
      }, this.data.imageTargetLostThresh)
    }

    if (!!sceneEl.getAttribute("xrweb")) {
      this.finishedLoading8thWall = false
      this.use8thWall = true
      object3D.visible = false

      // Bind the 8thWall finished loading callback
      sceneEl.addEventListener("realityready", () => {
        this.finishedLoading8thWall = true
      })

      // Check if we are using image targets
      if (imageTarget.length > 0) {
        // Don't autoplay if we're using image targets
        this.data.autoplay = false

        sceneEl.addEventListener("xrimagefound", showImage)
        sceneEl.addEventListener("xrimageupdated", showImage)
        sceneEl.addEventListener("xrimagelost", hideImage)
      }
    } else {
      // Update our component to not be using 8thWall
      this.finishedLoading8thWall = true
      this.use8thWall = false
    }
  },

  update(oldData) {
    var data = this.data
    var srcChanged = data.src !== oldData.src

    // Update if we got a valid src
    if (data.src && data.src.length > 5) {
      this.hoxelUrl = data.src
    }

    // Reset all the things
    if (srcChanged) {
      console.log(`updating scvv: ${this.hoxelUrl}`)
      this.setupBuffers()
      this.setupMesh()

      this.downloadSCVVJSON()
    }
  },

  stopAudio() {
    if (!!this.positionalAudio && this.positionalAudio.isPlaying) {
      console.log("this.positionalAudio.stop()", this.hoxelUrl)
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
      console.log("startPlayback()", this.hoxelUrl)
    }
  },

  stopPlayback() {
    if (this.shouldPlay) {
      this.shouldPlay = false
      this.stopAudio()
      console.log("stopPlayback()", this.hoxelUrl)
    }
  },

  remove() {
    if (this.jsonDownloader) {
      clearInterval(this.jsonDownloader)
    }
    // console.log('removing')
    this.el.removeObject3D("mesh")
    this.mesh = null
    this.material = null
    if (!!this.positionalAudio && this.positionalAudio.isPlaying)
      this.positionalAudio.stop()
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
    this.meshGroup = new THREE.Group()
    this.meshGroup.add(this.mesh)

    this.group = new THREE.Group()
    this.group.add(this.meshGroup)

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

  downloadSCVVJSON() {
    // Download the scvv json to get this party started
    // console.log("downloadSCVVJSON")
    downloadBin(`${this.hoxelUrl}/scvv.json`, "json")
      .then(json => {
        this.scvvJSON = {
          hoxelUrl: this.hoxelUrl,
          ...json
        }

        // Fix perspective for pre-versioning
        if (!this.scandyToThreeMat) {
          this.scandyToThreeMat = new THREE.Matrix4()
          this.scandyToThreeMat.fromArray(
            getSCVVTransform(this.scvvJSON.version)
          )
        }

        if (this.scvvJSON.isStreaming) {
          const downloadDelay = this.newFrames.length > 4 ? 700 : 300
          setTimeout(() => {
            this.downloadSCVVJSON()
          }, downloadDelay)
          this.maxBufferedCount = 500
          this.minBuffered = 5
        } else {
          this.minBuffered = this.scvvJSON.frames.length * 0.6
        }

        if (this.scvvJSON) {
          if (this.scvvJSON.isStreaming && !this.audioPlaying) {
            this.streamAudio()
          } else if (this.scvvJSON.audio) {
            this.getAudioBuffer()
              .then(() => {})
              .catch(err => {})
          }
        }

        // We've got scvvJSON data, send it to the worker
        this.callHoxelWorkers()
      })
      .catch(err => {
        console.log("error downloading json", err)
        setTimeout(() => {
          this.downloadSCVVJSON()
        }, 2000)
      })
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

    // console.log(`newFrames: ${this.newFrames.length}`)
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
    frame.mesh_geometry = geometry

    // Get the previously buffered frames to append to
    const previousBuffered = this.bufferedFrames.slice()
    previousBuffered.push(frame)

    const bufferCount = previousBuffered.length
    let start = 0
    if (bufferCount > this.maxBufferedCount) {
      // Offset our start by the amount we are over the max buffer count
      start = bufferCount - this.maxBufferedCount
      // Update the current frame idx.
      // Checking to make sure we don't make frameIdx negative
      this.frameIdx = this.frameIdx >= start ? this.frameIdx - start : 0
    }

    // After n frames check apply the matrix offset and compute the z offset
    if (bufferCount == 1) {
      geometry.computeBoundingSphere()
      const offset = geometry.boundingSphere.radius / -2
      this.mesh.position.set(0, 0, offset)
      this.mesh.applyMatrix(this.scandyToThreeMat)
    }

    // Sort by uid (timestamp) and only keep the most recent ones
    this.bufferedFrames = _.sortBy(previousBuffered, ["uid"]).slice(start)

    if (!this.shouldPlay && this.data.autoplay) {
      if (this.bufferedFrames.length > this.minBuffered) {
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
    const { audioCtx } = this

    return new Promise((resolve, reject) => {
      if (!audioCtx) {
        // console.log("No AudioContext available")
        reject("no audioCtx")
        return
      }
      if (!scvvJSON) {
        // Nothing to do with nothing here
        reject("no scvvJSON")
        return
      }
      if (this.audioBuffer) {
        resolve(this.audioBuffer)
      } else if (!this.downloadingAudioBuffer) {
        if (scvvJSON.audio) {
          let src = `${scvvJSON.hoxelUrl}/${scvvJSON.audio}`
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
          reject("no audio")
        }
      }
    })
  },

  /**
   * Stream audio from the live streaming server
   */
  streamAudio() {
    const { scvvJSON, hoxelUrl } = this

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
      const audioURL = `${hoxelUrl}/audio.json?${Date.now()}`
      // console.log('download latest audio', audioURL)
      return downloadBin(audioURL, "json")
        .then(json => {
          const { timestamp, scvv_audio } = json
          // Only playback new timestamps
          if (this.lastAudioTimestamp >= timestamp) {
            // throw 'audio timestamp not new enough'
            return
          }
          this.lastAudioTimestamp = timestamp
          const downloadPromises = []
          downloadPromises.push(
            downloadBin(`${hoxelUrl}/${scvv_audio}`, "arraybuffer")
          )
          return Promise.all(downloadPromises)
        })
        .catch(e => {
          console.log("failed downloading latest audio")
        })
    }

    /**
     * Buffer the array of raw audio data
     * @param {*} arr
     */
    const bufferAudioFrame = arr => {
      _.forEach(arr, audioData => {
        if (!!audioData) {
          let floatAudio = new Float32Array(audioData)
          if (floatAudio.length < 10) {
            return
          }
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
        if (!this.positionalAudio.isPlaying) {
          this.positionalAudio.play()
        }
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
          // console.log("Error with streamingAudio", err)
        })
        .finally(() => {
          setTimeout(streamLoop, 35)
          // console.log('finally did the recursive bit')
        })
    }
    // Kickoff the stream loop in the background
    setTimeout(streamLoop, 1)
    // Delay some then playback the buffered audio
    setTimeout(playbackBufferedAudio, this.minBuffered * 40 + 3000)
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
      this.getAudioBuffer()
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
      // console.log(`total: ${Date.now() - frame.seen}`)
      this.scvvTextureImage.src = frame.texture_blob
      // Account for rendering overhead
      let renderDelayMs = 7
      let renderMs = Date.now()
      if (this.lastRenderMs) {
        renderMs = renderMs - this.lastRenderMs
      }
      this.lastRenderMs = renderMs

      this.mesh.geometry = frame.mesh_geometry
      if (!this.mesh.material.map) {
        this.mesh.material = this.material
        this.mesh.material.map = this.scvvTexture
        this.mesh.material.needsUpdate = true
        this.scvvTexture.needsUpdate = true
      }

      if (this.scvvJSON.isStreaming) {
        // TODO: figure out better algorithmic way to throttle this
        const mult = 19
        const min = 45
        if (this.framesLeft >= mult) {
          this.delay_ms = min
        } else {
          const max = 180
          this.delay_ms = max - mult * this.framesLeft
          if (this.delay_ms < min) {
            this.delay_ms = min
          }
        }
      } else {
        this.delay_ms = Math.floor(frame.delay_us * 1e-3) - renderDelayMs
      }

      // console.log(
      //   `delay: ${this.delay_ms}\tframesLeft: ${this.framesLeft}\tnewFrames: ${this.newFrames.length}`
      // )
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
      this.finishedLoading8thWall &&
      !!this.bufferedFrames &&
      this.bufferedFrames.length > this.minBuffered
    ) {
      // Start the audio on the first frame
      if (
        this.audioCtx &&
        !this.scvvJSON.isStreaming &&
        this.audioBuffer &&
        this.frameIdx == 0 &&
        !this.audioPlaying
      ) {
        this.playbackAudio()
      }
      if (this.deltas >= this.delay_ms) {
        // Check to make sure the requested frameIdx is in the buffer
        const lastIdx = this.bufferedFrames.length - 1
        const nextIdx = this.frameIdx + 1
        this.framesLeft = lastIdx - this.frameIdx

        this.displaySCVVFrame(this.bufferedFrames[this.frameIdx])
        this.vv_frame_ms += this.deltas
        this.deltas = 0

        if (nextIdx >= lastIdx) {
          if (this.data.loop) {
            // Check to see if we need to stop the audio
            if (!!this.positionalAudio && this.positionalAudio.isPlaying) {
              this.positionalAudio.stop()
              this.audioPlaying = false
            }
            this.frameIdx = 0
          } else {
            this.frameIdx = lastIdx
          }
          // console.log(`over: ${nextIdx} >= ${lastIdx}`)
        } else {
          this.frameIdx = nextIdx
        }
      }
    }
  }
})
