/****************************************************************************\
 * Copyright (C) 2019 Scandy
 *
 * THIS CODE AND INFORMATION ARE PROVIDED "AS IS" WITHOUT WARRANTY OF ANY
 * KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A
 * PARTICULAR PURPOSE.
 *
 \****************************************************************************/

import _ from "lodash"
import draco3d from "draco3d"

const downloadBin = (url, responseType, timeout = 9e3) => {
  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest()
    /* NOTE: you want to do this, but you can't.. its forbidden
       https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
       xhr.setRequestHeaders('accept-encoding','gzip')
    */
    xhr.open("GET", url, true)

    xhr.async = true
    xhr.timeout = timeout
    xhr.withCredentials = false
    xhr.responseType = responseType

    xhr.onreadystatechange = function() {
      if (xhr.readyState === 2) {
        // do something
      }
    }

    xhr.onload = function(e) {
      !!xhr.response ? resolve(xhr.response) : reject(`No buffer`)
    }
    xhr.onerror = () => {
      return reject("error loading frame asset")
    }
    xhr.ontimeout = () => {
      return reject("Connection timeout")
    }
    xhr.send(null)
  })
}

const getFrameUid = frame => {
  if (frame.uid) {
    return frame.uid
  }
  const segments = frame.texture_path.split(".")
  if (segments.length > 2) {
    return segments[1]
  }
  return segments[0]
}

let scvvJSON = {}
const decoderModules = []
const unbufferedFrames = {}
const bufferedFrames = {}
const decodedFrames = {}
const MAX_CONCURRENT_BUFFER = 50
const MAX_CONCURRENT_DECODE = 150

const verbosity = 0
const nativeAttributeMap = {
  position: "POSITION",
  normal: "NORMAL",
  color: "COLOR",
  uv: "TEX_COORD"
}

var BASE64_MARKER = ";base64,"

function convertDataURIToBinary(dataURI) {
  var base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length
  var base64 = dataURI.substring(base64Index)
  var raw = atob(base64)
  var rawLength = raw.length
  var array = new Uint8Array(new ArrayBuffer(rawLength))

  for (var i = 0; i < rawLength; i++) {
    array[i] = raw.charCodeAt(i)
  }
  return array
}

/**
 * Get the Draco Decoder module from
 */
const getDecoderModule = () => {
  if (decoderModules.length == 0) {
    const decoderModule = draco3d.createDecoderModule({})
    decoderModules.push(decoderModule)
  }
  return decoderModules[0]
}

const addAttributeToGeometry = (
  dracoDecoder,
  decoder,
  dracoGeometry,
  attributeName,
  attributeType,
  attribute,
  geometryBuffer
) => {
  if (attribute.ptr === 0) {
    var errorMsg = "LoadSCVVWorker.DRACOLoader: No attribute " + attributeName
    console.error(errorMsg)
    throw new Error(errorMsg)
  }

  var numComponents = attribute.num_components()
  var numPoints = dracoGeometry.num_points()
  var numValues = numPoints * numComponents
  var attributeData
  var TypedBufferAttribute

  let array = []

  switch (attributeType) {
    case Float32Array:
      attributeData = new dracoDecoder.DracoFloat32Array()
      decoder.GetAttributeFloatForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Float32Array(numValues)
      break

    case Int8Array:
      attributeData = new dracoDecoder.DracoInt8Array()
      decoder.GetAttributeInt8ForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Int8Array(numValues)
      break

    case Int16Array:
      attributeData = new dracoDecoder.DracoInt16Array()
      decoder.GetAttributeInt16ForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Int16Array(numValues)
      break

    case Int32Array:
      attributeData = new dracoDecoder.DracoInt32Array()
      decoder.GetAttributeInt32ForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Int32Array(numValues)
      break

    case Uint8Array:
      attributeData = new dracoDecoder.DracoUInt8Array()
      decoder.GetAttributeUInt8ForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Uint8Array(numValues)
      break

    case Uint16Array:
      attributeData = new dracoDecoder.DracoUInt16Array()
      decoder.GetAttributeUInt16ForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Uint16Array(numValues)
      break

    case Uint32Array:
      attributeData = new dracoDecoder.DracoUInt32Array()
      decoder.GetAttributeUInt32ForAllPoints(
        dracoGeometry,
        attribute,
        attributeData
      )
      array = new Uint32Array(numValues)
      break

    default:
      var errorMsg = "LoadSCVVWorker.DRACOLoader: Unexpected attribute type."
      console.error(errorMsg)
      throw new Error(errorMsg)
  }

  // Copy data from decoder.
  // TODO: isn't there a faster way to do this?
  for (var i = 0; i < numValues; i++) {
    array[i] = attributeData.GetValue(i)
  }

  geometryBuffer[attributeName] = {
    numPoints,
    numValues,
    numComponents,
    array
  }

  dracoDecoder.destroy(attributeData)
}

const prepareDracoGeometryFor3JS = (
  dracoDecoder,
  decoder,
  geometryType,
  buffer,
  attributeUniqueIdMap,
  attributeTypeMap
) => {
  // decoder.SkipAttributeTransform(dracoDecoder.POSITION)
  var dracoGeometry
  var decodingStatus
  const start_time = performance.now()
  if (geometryType === dracoDecoder.TRIANGULAR_MESH) {
    dracoGeometry = new dracoDecoder.Mesh()
    decodingStatus = decoder.DecodeBufferToMesh(buffer, dracoGeometry)
  } else {
    dracoGeometry = new dracoDecoder.PointCloud()
    decodingStatus = decoder.DecodeBufferToPointCloud(buffer, dracoGeometry)
  }
  if (!decodingStatus.ok() || dracoGeometry.ptr == 0) {
    var errorMsg = "LoadSCVVWorker.DRACOLoader: Decoding failed: "
    errorMsg += decodingStatus.error_msg()
    console.error(errorMsg)
    dracoDecoder.destroy(decoder)
    dracoDecoder.destroy(dracoGeometry)
    throw new Error(errorMsg)
  }

  var decode_end = performance.now()
  dracoDecoder.destroy(buffer)
  /*
   * Example on how to retrieve mesh and attributes.
   */
  var numFaces
  if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
    numFaces = dracoGeometry.num_faces()
    if (verbosity > 0) {
      console.log("Number of faces loaded: " + numFaces.toString())
    }
  } else {
    numFaces = 0
  }

  var numPoints = dracoGeometry.num_points()
  var numAttributes = dracoGeometry.num_attributes()
  if (verbosity > 0) {
    console.log("Number of points loaded: " + numPoints.toString())
    console.log("Number of attributes loaded: " + numAttributes.toString())
  }

  // Verify if there is position attribute.
  var posAttId = decoder.GetAttributeId(dracoGeometry, dracoDecoder.POSITION)
  if (posAttId == -1) {
    var errorMsg = "LoadSCVVWorker.DRACOLoader: No position attribute found."
    console.error(errorMsg)
    dracoDecoder.destroy(decoder)
    dracoDecoder.destroy(dracoGeometry)
    throw new Error(errorMsg)
  }
  var posAttribute = decoder.GetAttribute(dracoGeometry, posAttId)

  // Structure for converting to THREEJS geometry later.
  var geometryBuffer = {}

  // Add native Draco attribute type to geometry.
  for (var attributeName in nativeAttributeMap) {
    // The native attribute type is only used when no unique Id is
    // provided. For example, loading .drc files.
    if (attributeUniqueIdMap[attributeName] === undefined) {
      var attId = decoder.GetAttributeId(
        dracoGeometry,
        dracoDecoder[nativeAttributeMap[attributeName]]
      )
      if (attId !== -1) {
        if (verbosity > 0) {
          console.log("Loaded " + attributeName + " attribute.")
        }
        var attribute = decoder.GetAttribute(dracoGeometry, attId)
        addAttributeToGeometry(
          dracoDecoder,
          decoder,
          dracoGeometry,
          attributeName,
          Float32Array,
          attribute,
          geometryBuffer
        )
      }
    }
  }

  // Add attributes of user specified unique id. E.g. GLTF models.
  for (var attributeName in attributeUniqueIdMap) {
    var attributeType = attributeTypeMap[attributeName] || Float32Array
    var attributeId = attributeUniqueIdMap[attributeName]
    var attribute = decoder.GetAttributeByUniqueId(dracoGeometry, attributeId)
    addAttributeToGeometry(
      dracoDecoder,
      decoder,
      dracoGeometry,
      attributeName,
      attributeType,
      attribute,
      geometryBuffer
    )
  }

  // For mesh, we need to generate the faces.
  if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
    var numIndices = numFaces * 3
    geometryBuffer.indices = new Uint32Array(numIndices)
    var ia = new dracoDecoder.DracoInt32Array()
    for (var i = 0; i < numFaces; ++i) {
      decoder.GetFaceFromMesh(dracoGeometry, i, ia)
      var index = i * 3
      geometryBuffer.indices[index] = ia.GetValue(0)
      geometryBuffer.indices[index + 1] = ia.GetValue(1)
      geometryBuffer.indices[index + 2] = ia.GetValue(2)
    }
    dracoDecoder.destroy(ia)
  }

  var posTransform = new dracoDecoder.AttributeQuantizationTransform()
  dracoDecoder.destroy(posTransform)
  dracoDecoder.destroy(decoder)
  dracoDecoder.destroy(dracoGeometry)

  return geometryBuffer
}

const decodeDracoFrame = frame => {
  return new Promise((resolve, reject) => {
    const rawBuffer = frame.mesh_bin

    const dracoDecoder = getDecoderModule()
    if (!dracoDecoder) {
      console.log("no dracoDecoder")
    }

    /*
     * Here is how to use Draco Javascript decoder and get the geometry.
     */
    var buffer = new dracoDecoder.DecoderBuffer()
    buffer.Init(new Int8Array(rawBuffer), rawBuffer.byteLength)
    var decoder = new dracoDecoder.Decoder()

    /*
     * Determine what type is this file: mesh or point cloud.
     */
    var geometryType = decoder.GetEncodedGeometryType(buffer)
    if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
      if (verbosity > 0) {
        console.log("Loaded a mesh.")
      }
    } else if (geometryType == dracoDecoder.POINT_CLOUD) {
      if (verbosity > 0) {
        console.log("Loaded a point cloud.")
      }
    } else {
      var errorMsg = "LoadSCVVWorker.DRACOLoader: Unknown geometry type."
      console.error(errorMsg)
      throw new Error(errorMsg)
    }

    const attributeUniqueIdMap = {}
    const attributeTypeMap = {}

    try {
      resolve(
        prepareDracoGeometryFor3JS(
          dracoDecoder,
          decoder,
          geometryType,
          buffer,
          attributeUniqueIdMap,
          attributeTypeMap
        )
      )
    } catch (e) {
      console.log("caught e:", e)
      reject(e)
    }
  })
}

const processDracoFrame = frame => {
  return decodeDracoFrame(frame)
    .then(mesh_geometry => {
      const uid = getFrameUid(frame)
      decodedFrames[frame.uid] = true
      delete bufferedFrames[frame.uid]
      postMessage({
        error: null,
        dict: {
          frame: {
            mesh_geometry,
            ...frame
          }
        }
      })
    })
    .catch(err => {
      console.log(
        `error decoding frame ${getFrameUid(frame)} ${
          frame.idx
        }, got error: ${err}`
      )
      postMessage({
        error: err.message,
        dict: {
          frame
        }
      })
    })
}

const decodeDracoFrames = (frames, idx, numWorkers) => {
  const _frame = frames[idx]
  if (_frame) {
    // console.log("decode: ", idx)
    processDracoFrame(frame, idx).finally(() => {
      if (idx < frames.length - numWorkers) {
        decodeDracoFrames(frames, idx + numWorkers, numWorkers)
      }
    })
  }
}

const decodeSCMFFrames = (frames, sdf, adsf) => {
  // Iterate over all the frames and prepare the mesh geometry
  _.forEach(frames, frame => {
    var meshPoints = new Float32Array(frame.points_bin)
    /**
     *  NOTE, this doesn't make sense but it works
     * It should be 10 with uv(2), vert(4), normal(4)
     * But 12 means with uv(4), vert(4), normal(4)
     */
    const meshPointStride = 12
    // var interleavedBuffer = new THREE.InterleavedBuffer(
    //   meshPoints,
    //   meshPointStride
    // )

    frame.mesh_geometry = {
      uv: {
        array: meshPoints,
        numComponents: 2
      },
      position: {
        array: meshPoints,
        numComponents: 3
      },
      normal: {
        array: meshPoints,
        numComponents: 3
      },
      indices: frame.faces_bin
    }

    postMessage({
      error: null,
      dict: {
        frame
      }
    })
  })
}

const bufferFrame = (frame, idx) => {
  // Get all the mesh binaries
  const meshFrameBinSrc = `${scvvJSON.HOXEL_URL}/${frame.mesh_path}`
  let isDraco = false
  if (meshFrameBinSrc.match(".draco") || meshFrameBinSrc.match(".drc")) {
    isDraco = true
  }
  const dif = Date.now() - Math.floor(frame.uid * 1e-3)
  const staleThresh = scvvJSON.frameExpiration * 1e3 || 12e3
  if (scvvJSON.isStreaming && dif > staleThresh) {
    const msg = `Frame expired` // with dif of: ${dif}`
    // return new Promise((resolve, reject) => {
    //   reject(msg)
    // })
    delete unbufferedFrames[frame.uid]
    // console.log(msg)
    return null
  }

  return downloadBin(meshFrameBinSrc, "arraybuffer")
    .then(mesh_bin => {
      // console.log(`mesh ${idx} done`)
      return {
        idx,
        mesh_bin,
        isDraco,
        ...frame
      }
    })
    .then(new_frame => {
      return downloadBin(
        `${scvvJSON.HOXEL_URL}/${frame.texture_path}`,
        "blob"
      ).then(blob => {
        // console.log(`image ${idx} done`)
        var imageUrl = URL.createObjectURL(blob)
        new_frame.texture_blob = imageUrl
        bufferedFrames[frame.uid] = new_frame
        delete unbufferedFrames[frame.uid]
        return frame.uid
      })
    })
    .catch(err => {
      // throw new Error(`Error downloading ${idx}: ${err}`)
      console.log(
        `error buffering ${meshFrameBinSrc} ${idx} with uid: ${frame.uid}:
        ${JSON.stringify(err)}`
      )
      // debugger
      // postMessage({ error: `error buffering hoxel ${err}` })
      return false
    })
  /* TODO: add support for this kind too?
  if (frame.points_path) {
      let meshFrameBinSrc = `${scvvJSON.HOXEL_URL}/${frame.points_path}`
      // Get all the mesh binaries
      frame_promises.push(
        downloadBin(meshFrameBinSrc, "arraybuffer").then(points_bin => {
          return {
            idx,
            points_bin,
            ...frame
          }
        })
      )
      meshFrameBinSrc = `${scvvJSON.HOXEL_URL}/${frame.faces_path}`
      // Get all the mesh binaries
      frame_promises.push(
        downloadBin(meshFrameBinSrc, "arraybuffer").then(faces_bin => {
          return {
            idx,
            faces_bin,
            ...frame
          }
        })
      )
    }
    */
}

let lastProcessStart = 0
let lastProcessEnd = 0
let isProcessing = false
let lastProcess = 0
let timesProcessed = 0

const processSCVVJSON = async (offset, numWorkers) => {
  isProcessing = true
  // lastProcess = Date.now()
  // console.log(`processSCVVJSON`)
  // console.log(`processSCVVJSON ${timesProcessed++} started at ${lastProcess}`)
  _.forEach(scvvJSON.frames, async (frame, idx) => {
    const uid = getFrameUid(frame)
    if (decodedFrames[uid]) {
      // we've already decode this...
      // console.log(`decoded: ${uid}`)
    } else if (bufferedFrames[uid]) {
      // We've seen it and have it buffered but yet to be decoded
      // console.log(`bufferedFrames: ${uid}`)
    } else if (unbufferedFrames[uid]) {
      // We've seen it and we are in the process of buffering
      // console.log(`unbufferedFrames: ${uid}`)
    } else {
      // We've never seen this before...
      unbufferedFrames[uid] = {
        uid,
        idx,
        ...frame
      }
    }
  })

  // console.log(
  //   `Before all_promises
  // unbufferedFrames: ${Object.keys(unbufferedFrames).length}
  // bufferedFrames: ${Object.keys(bufferedFrames).length}
  // decodedFrames: ${Object.keys(decodedFrames).length}
  // `
  // )
  // Process all the unbuffered
  const all_promises = []
  let u_idx = 0
  const sortedUnBufferedFrames = _.sortBy(unbufferedFrames, ["uid"])
  _.forEach(sortedUnBufferedFrames, frame => {
    const uid = frame.uid
    if (u_idx < MAX_CONCURRENT_BUFFER) {
      // console.log(`buffering frame ${idx}:`)
      all_promises.push(bufferFrame(frame, u_idx))
    }
    u_idx++
  })

  // Process all the buffered frames
  let b_idx = 0
  _.forEach(_.sortBy(bufferedFrames, ["uid"]), frame => {
    if (b_idx < MAX_CONCURRENT_DECODE) {
      all_promises.push(processDracoFrame(frame))
    }
    b_idx++
  })

  // Recurse into ourself if there's unfinished business
  Promise.all(all_promises).finally(arr => {
    // isProcessing = false
    // console.log(
    //   `After all_promises
    // unbufferedFrames: ${Object.keys(unbufferedFrames).length}
    // bufferedFrames: ${Object.keys(bufferedFrames).length}
    // decodedFrames: ${Object.keys(decodedFrames).length}
    // `
    // )
    setTimeout(() => {
      processSCVVJSON(offset, numWorkers)
    }, 100)
  })
}

onmessage = async msg => {
  if (msg.data) {
    const { offset, numWorkers } = msg.data
    scvvJSON = msg.data.scvvJSON
    if (scvvJSON.HOXEL_URL.indexOf("http") == -1) {
      scvvJSON.HOXEL_URL = `https:${scvvJSON.HOXEL_URL}`
    }
    // Only queue a processing job if we aren't already processing
    if (!isProcessing) {
      processSCVVJSON(offset, numWorkers)
    }
  }
}
