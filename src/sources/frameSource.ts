import assert from 'assert';
import pMap from 'p-map';

import customFabricFrameSource, { rgbaToFabricImage, createFabricCanvas, renderFabricCanvas } from './fabric.js';
import canvasFrameSource from './canvas.js';
import fillColorFrameSource from './fill-color.js';
import glFrameSource from './gl.js';
import imageFrameSource from './image.js';
import imageOverlayFrameSource from './image-overlay.js';
import linearGradientFrameSource from './linear-gradient.js';
import newsTitleFrameSource from './news-title.js';
import radialGradientFrameSource from './radial-gradient.js';
import slideInTextFrameSource from './slide-in-text.js';
import subtitleFrameSource from './subtitle.js';
import titleFrameSource from './title.js';
import videoFrameSource from './video.js';

import type { CreateFrameSource, DebugOptions } from '../types.js';
import type { ProcessedClip } from '../parseConfig.js';

// FIXME[ts]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const frameSources: Record<string, CreateFrameSource<any>> = {
  'canvas': canvasFrameSource,
  'fabric': customFabricFrameSource,
  'fill-color': fillColorFrameSource,
  'gl': glFrameSource,
  'image-overlay': imageOverlayFrameSource,
  'image': imageFrameSource,
  'linear-gradient': linearGradientFrameSource,
  'news-title': newsTitleFrameSource,
  'radial-gradient': radialGradientFrameSource,
  'slide-in-text': slideInTextFrameSource,
  'subtitle': subtitleFrameSource,
  'title': titleFrameSource,
  'video': videoFrameSource,
};

type FrameSourceOptions = DebugOptions & {
  clip: ProcessedClip;
  clipIndex: number;
  width: number,
  height: number,
  channels: number,
  framerateStr: string,
}

export async function createFrameSource({ clip, clipIndex, width, height, channels, verbose, logTimes, framerateStr }: FrameSourceOptions) {
  const { layers, duration } = clip;

  const visualLayers = layers.filter((layer) => layer.type !== 'audio');

  const layerFrameSources = await pMap(visualLayers, async (layer, layerIndex) => {
    const { type, ...params } = layer;
    if (verbose) console.log('createFrameSource', type, 'clip', clipIndex, 'layer', layerIndex);

    const createFrameSourceFunc: CreateFrameSource<typeof layer> = frameSources[type];
    assert(createFrameSourceFunc, `Invalid type ${type}`);
    const frameSource = await createFrameSourceFunc({ width, height, duration, channels, verbose, logTimes, framerateStr, params });
    return { layer, frameSource };
  }, { concurrency: 1 });

  async function readNextFrame({ time }: { time: number }) {
    const canvas = createFabricCanvas({ width, height });

    for (const { frameSource, layer } of layerFrameSources) {
      // console.log({ start: layer.start, stop: layer.stop, layerDuration: layer.layerDuration, time });
      const offsetTime = time - (layer?.start ?? 0);
      const offsetProgress = offsetTime / layer.layerDuration!;
      // console.log({ offsetProgress });
      const shouldDrawLayer = offsetProgress >= 0 && offsetProgress <= 1;

      if (shouldDrawLayer) {
        if (logTimes) console.time('frameSource.readNextFrame');
        const rgba = await frameSource.readNextFrame(offsetProgress, canvas, offsetTime);
        if (logTimes) console.timeEnd('frameSource.readNextFrame');

        // Frame sources can either render to the provided canvas and return nothing
        // OR return an raw RGBA blob which will be drawn onto the canvas
        if (rgba) {
          // Optimization: Don't need to draw to canvas if there's only one layer
          if (layerFrameSources.length === 1) return rgba;

          if (logTimes) console.time('rgbaToFabricImage');
          const img = await rgbaToFabricImage({ width, height, rgba });
          if (logTimes) console.timeEnd('rgbaToFabricImage');
          canvas.add(img);
        } else {
          // Assume this frame source has drawn its content to the canvas
        }
      }
    }
    // if (verbose) console.time('Merge frames');

    if (logTimes) console.time('renderFabricCanvas');
    const rgba = await renderFabricCanvas(canvas);
    if (logTimes) console.timeEnd('renderFabricCanvas');
    return rgba;
  }

  async function close() {
    await pMap(layerFrameSources, async ({ frameSource }) => frameSource.close?.());
  }

  return {
    readNextFrame,
    close,
  };
}

export default {
  createFrameSource,
};
