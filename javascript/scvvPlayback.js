/****************************************************************************\
 * Copyright (C) 2019 Scandy
 *
 * THIS CODE AND INFORMATION ARE PROVIDED "AS IS" WITHOUT WARRANTY OF ANY
 * KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A
 * PARTICULAR PURPOSE.
 *
 \*************************************************************************** */


/* You should bring your own THREEJS with you.
  Or you can uncomment this line to require it here */
// const THREE = require('three')

const { downloadAudioBuffer } = require('./utils')

// Array to keep buffered frames in
let bufferedFrames = []

// Audio context and source global vars
const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
if (!audioCtx) {
  console.log('No AudioContext available')
}
let audioSource = null
let audioBuffer = null
let audioSwitch = false

// Minimum delay between frames. This is will change based on your client
const min_delay_ms = 5

// Should we loop the scvv or just keep playing the last frame
const loopSCVV = true

// Keep track of our scvv current time
let vv_frame_ms = 0

// Keep track of the timestamp of the last render
let lastRenderMS = Date.now()

// THREEJS objects to playback the SCVV frames
const scvvTextureImage = new Image()
const scvvTexture = new THREE.Texture(scvvTextureImage)
// Bind the onload of the image to always update the texture
scvvTextureImage.onload = () => {
  scvvTexture.needsUpdate = true
}
const scvvMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  opacity: 0.92,
  transparent: true,
  side: THREE.DoubleSide
})
const scvvBufferGeometry = new THREE.BufferGeometry()
const scvvMesh = new THREE.Mesh(scvvBufferGeometry, scvvMaterial)

// three.js objects
let scene = THREE.Object3D
let renderer = THREE.Object3D
let camera = THREE.Object3D
let needsAdding = true

/**
 *
 * @param {*} width the width of the THREEJS renderer
 * @param {*} height the height of the THREEJS renderer
 * @param {*} container the div container to put the THREEJS renderer in
 */
const initTHREEScene = (width, height, container) => {
  // sets up the renderer for the browser
  renderer = new THREE.WebGLRenderer({
    precision: 'lowp',
    powerPreference: 'high-performance',
    alpha: true
  })

  // sets the color of "clear", uncolored pixels
  renderer.setClearColor(0xeeeeee)
  // sets the pixel ratio to the device's pixel ratio
  renderer.setPixelRatio(window.devicePixelRatio)
  // set the renderer size to the passed in params
  renderer.setSize(width, height)

  // Add the renderer to the container
  container.appendChild(renderer.domElement)

  // creates a new Scene, the base world for which
  scene = new THREE.Scene()

  // CAMERA ==========
  camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 200)
  scene.add(camera) // adds the camera to the scene

  const ambient = new THREE.AmbientLight(0xeeeeee, 1.1)
  scene.add(ambient)
}

/**
 * Store the audio buffer for reuse
 */
const getAudioBuffer = hoxelJSON =>
  new Promise((resolve, reject) => {
    if (audioBuffer) {
      resolve(audioBuffer)
    } else {
      let src = `${hoxelJSON.HOXEL_URL}/${hoxelJSON.audio}`
      downloadAudioBuffer(audioCtx, src)
        .then(buffer => {
          audioBuffer = buffer
          resolve(audioBuffer)
        })
        .catch(reject)
    }
  })

/**
 * Starts playing audio given a scvv json file
 * @param {*} scvvJSON the scvvJSON object with SCVV info
 */
const playbackAudio = scvvJSON => {
  // Download the audio buffer
  getAudioBuffer(scvvJSON).then(buffer => {
    audioSource = audioCtx.createBufferSource()
    audioSource.buffer = buffer
    audioSource.loop = false
    audioSource.connect(audioCtx.destination)
    const start_sec = vv_frame_ms * 1e-3
    const offset_msec = scvvJSON.audio_us_offset * 1e-3
    if (offset_msec > 0) {
      setTimeout(() => {
        audioSource.start(0, start_sec)
      }, offset_msec)
    } else {
      audioSource.start(0, start_sec + offset_msec * -1e-3)
    }
  })
}

/**
 * Displays a scvv frame into the THREEJS scene
 * @param {*} frame The frame to load into scvvMesh
 */
const displaySCVVFrame = frame => {
  // check to make sure this is a good frame
  if (!frame || !frame.texture_blob || !frame.mesh_geometry) {
    console.log(`tried to display a bad frame: ${JSON.stringify(frame)}`)
    return null
  }

  // Set the mesh texture and geometry to the buffered ones
  scvvTextureImage.src = frame.texture_blob
  scvvMesh.geometry = frame.mesh_geometry

  // Only add to the scene once
  if (needsAdding) {
    needsAdding = false
    // since
    scvvMesh.material.map = scvvTexture
    // This works for a hoxel recorded at medium size
    scvvMesh.position.set(0, 1.7, -2.0)
    // only add it once
    // scene.add(scvvMesh)
  }
}

/**
 * Master playback loop for scvv frames
 * @param {*} frameIdx The frame index to start playing from
 */
const playbackFrames = frameIdx => {
  // Some default reasonable in delay_ms
  let delay_ms = 33

  let nextIdx = frameIdx + 1

  // Check to make sure the requested frameIdx is in the buffer
  if (frameIdx < bufferedFrames.length - 1) {
    // Get the frame to play from the buffered frames
    const frame = bufferedFrames[frameIdx]

    // Edge case for first frame
    if (frameIdx == 0) {
      // Reset the vv_frame_ms to 0
      vv_frame_ms = 0

      // Check if we have audio setup
      if (audioCtx && audioSource) {
        if (audioSwitch.checked) {
          try {
            // playbackAudio(scvvJSON)
          } catch (e) {
            console.log('error playing audio:', e)
          }
        }
      }
    }

    displaySCVVFrame(frame)
    delay_ms = Math.ceil(frame.delay_us * 1e-3)
    nextIdx = frameIdx + 1
  } else {
    // Should we loop the scvv or just keep playing the last frame
    nextIdx = loopSCVV ? 0 : nextIdx - 1
  }

  // Just make sure we didn't something wonky with our nextIdx
  if (nextIdx < 0) {
    nextIdx = 0
  }

  // Calculate the ms delay from how long it took us to load the frame
  const load_ms = Date.now() - lastRenderMS

  // Check to see if the load took longer than the needed delay
  // NOTE: this is a bad sign and means you cannot maintain playback
  if (load_ms > delay_ms) {
    delay_ms = min_delay_ms
    // console.log('loosing playback')
  } else {
    // Remove the load time from the delay
    delay_ms -= load_ms
  }

  // If the delay_ms ends up to small JavaScript can choke itself
  delay_ms = delay_ms < min_delay_ms ? min_delay_ms : delay_ms
  // console.log(`nextIdx: ${nextIdx}\n\tdelay_ms: ${delay_ms}`)

  // Update our last render timestamp
  lastRenderMS = Date.now()

  // Request the frame to rendered in delay_ms from now
  setTimeout(() => {
    // Advance the overall scvv time keeper
    vv_frame_ms += delay_ms

    // Recursively load the next frame
    playbackFrames(nextIdx)
  }, delay_ms)
}

module.exports.playbackFrames = playbackFrames
module.exports.setBufferedFrames = newBuffer => {
  bufferedFrames = newBuffer
}
module.exports.setThreeScene = _scene => {
  scene = _scene
}
module.exports.scvvMesh = scvvMesh
