## dir structure

Currently the files are stored in a directory with a structure like so:

```
hoxelCardHelloWorld/
  -> scvv_animation.json
  -> scvv_audio.wav
  -> scvv_preview.png
  -> 000191_scandycore_raw_frame.draco
  -> 000191_scandycore_raw_frame.jpg
  .....
  -> 000292_scandycore_raw_frame.draco
  -> 000292_scandycore_raw_frame.jpg

```

## scvv_animation.json
The scvv_animation.json (Scandy Core Volumetric Video) file is structured like so:

```
{
  "preview_img": "scvv_preview.png",
  "audio": "scvv_audio.wav",
  "frames": [
    {
      "texture_path": "000031_scandycore_raw_frame.jpg",
      "mesh_path": "000031_scandycore_raw_frame.draco",
      "delay_us": 0
    },
    {
      "texture_path": "000032_scandycore_raw_frame.jpg",
      "mesh_path": "000032_scandycore_raw_frame.draco",
      "delay_us": 66128
    },
    {
      "texture_path": "000033_scandycore_raw_frame.jpg",
      "mesh_path": "000033_scandycore_raw_frame.draco",
      "delay_us": 64962
    },
    ...
  ],
  "average_fps": "15",
  "audio_us_offset": 203628
}
```

### preview_img
The preview image is a preview image for the recording.

### audio
The audio is the .wav file to playback with the mesh

### frames
The frames are the mesh + texture + delay_us. The frames array provides relative paths to the files required for playing back a volumetric video recording.

#### texture_path
The texture associated with the frame.

The texture should preferably be a jpg with a size of `width * height % 1024 == 0`. This is ideal for playing back in many environments like THREE.JS which will change the image during loading if its not.

#### mesh_path
The mesh associated with the frame.

The mesh can be of many formats, but Scandy recommends using [Draco encoded](https://github.com/google/draco) meshes as they compress well and are supported fairly broadly. Some GLTF viewers support this natively as an encoding option.

#### delay_us
The delay_us is how many microseconds you should wait before playing back this frame.

Important to note, when counting how long you should delay to play this frame you should also take into account how long it took you to load this frame. We have an example of this in the JavaScript THREE.JS player.

### average_fps
The average_fps is just a helper to let you know what the average fps of the entire recording is
The audio_µs_offset tells you how much offset the audio is from the first frame
