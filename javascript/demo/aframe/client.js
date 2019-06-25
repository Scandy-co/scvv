/* eslint-disable no-undef */
/* eslint-disable no-redeclare */
/* eslint-disable no-return-assign */
/* eslint-disable no-plusplus */
/* eslint-disable vars-on-top */
/* eslint-disable no-var */
/* eslint-disable block-scoped-var */
/* eslint-disable no-param-reassign */
const AFRAME = require('AFRAME')
const _ = require('lodash');

// eslint-disable-next-line import/no-unresolved, import/no-webpack-loader-syntax
const LoadHoxelWorker = require('worker-loader!../../loadHoxelWorker.min');
const { playbackFrames, setBufferedFrames, setThreeScene, scvvMesh } = require('../../scvvPlayback');
const {downloadBin} = require('../../utils');


const ddFrameWorkers = [];
let newFrames = [];
let bufferedFrames = [];
const badFrames = [];
const seenFrames = [];
const numWorkers = 1;
const maxBufferedCount = 500;

/**
 * Adds the provided frame to the bufferedFrame array
 * @param {*} frame
 */
const addFrameBuffer = (frame) => {
  // console.log("addFrameBuffer", frame.mesh_path)
  const geometry = new THREE.BufferGeometry();
  // copy over all the attributes
  for (var prop in frame.mesh_geometry.attributes) {
    geometry.addAttribute(
      prop,
      new THREE.Float32BufferAttribute(
        frame.mesh_geometry.attributes[prop].array,
        frame.mesh_geometry.attributes[prop].itemSize,
      ),
    );
  }
  // And the indicies
  geometry.setIndex(
    new THREE.BufferAttribute(frame.mesh_geometry.index.array, 1),
  );
  // Fix the orientation for THREE from ScandyCore
  frame.mesh_geometry = geometry;
  // Merge all the mesh frames together keeping them in order
  const newBuffered = bufferedFrames.slice();
  newBuffered.push(frame);

  // Sort by mesh_  path and only keep the most recent
  let start = 0;
  if (newBuffered.length > maxBufferedCount) {
    start = newBuffered.length - maxBufferedCount;
  }
  bufferedFrames = _.sortBy(newBuffered, ['mesh_path']).slice(start);
  setBufferedFrames(bufferedFrames)
};

/**
 * Calls the hoxel workers with the passed in JSON.
 * @param {*} scvvJSON
 */
const callHoxelWorkers = (scvvJSON) => {
  const gotMessage = (msg) => {
    const { error, dict } = msg.data;
    if (error) {
      console.log('error with ddFrameWorker', error);
      badFrames[dict.frame.mesh_path] = dict.frame;
      // throttledLoadHoxel();
      // alert(`error: ${error}`)
    } else if (dict && dict.frame) {
      // Copy over the data from the Object to a proper BufferGeometry
      // NOTE: this is a really annoying side of the Worker, it loses the BufferGeometry object
      addFrameBuffer(dict.frame);
    }
  };

  if (ddFrameWorkers.length < numWorkers) {
    for (var w = 0; w < numWorkers; w++) {
      // TODO: @hcwiley rename from LoadHoxelWorker to LoadSCVVWorker
      const worker = new LoadHoxelWorker();
      worker.onmessage = gotMessage;
      ddFrameWorkers.push(worker);
    }
  }

  newFrames = [];
  _.forEach(scvvJSON.frames, (frame) => {
    // Check to see if we've already got this frame
    if (seenFrames[frame.mesh_path] || badFrames[frame.mesh_path]) {
      // We don't need to get this frame, we've already seen it
    } else {
      // Delete the frame from the buffer since we don't need it anymore
      newFrames.push(frame);
    }
  });
  // Only ever keep the latest 200 buffered frames
  // Now we can get all the unbuffered frames
  scvvJSON.frames = newFrames;

  _.forEach(scvvJSON.frames, f => (seenFrames[f.mesh_path] = true));
  // console.log(`new frames to buffer: ${newFrames.length}`)

  // Use multiple download workers so we can download faster
  for (var w = 0; w < ddFrameWorkers.length; w++) {
    const worker = ddFrameWorkers[w];
    const offset = w;
    // TODO: @hcwiley change param from hoxelJSON to scvvJSON
    worker.postMessage({ hoxelJSON: scvvJSON, offset, numWorkers });
  }
};


AFRAME.registerComponent('scvv', {
  init() {
    console.log('init scvv')
    const scene = document.querySelector('a-entity').sceneEl.object3D;
    setThreeScene(scene)

    const group = document.querySelector('a-entity').object3D;
    group.add(scvvMesh)
    
    downloadBin('/hoxelCardHelloWorld/scvv_animation.json', 'json').then((json) => {
      const scvvJSON = {
        HOXEL_URL: 'http://0.0.0.0:3000//hoxelCardHelloWorld',
        ...json,
      };
      callHoxelWorkers(scvvJSON);

      playbackFrames(0)
    });
  },
});
