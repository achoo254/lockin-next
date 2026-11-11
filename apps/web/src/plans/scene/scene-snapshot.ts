/** A fixed-camera picture of the scene with everyone in place, for the story image. */
import { SceneController, type SceneConfig } from './scene-controller';

/**
 * Draws the scene on its own off-screen renderer (the live scene and what the user has done with its camera are not
 * involved) and returns the picture as a canvas, the sitters already seated.
 */
export async function renderSceneSnapshot(config: Omit<SceneConfig, 'enter' | 'reducedMotion' | 'interactive'>, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const controller = await SceneController.create(canvas, { ...config, enter: false, reducedMotion: true, interactive: false });
  try {
    controller.renderStill(width, height);
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const ctx = copy.getContext('2d');
    if (!ctx) throw new Error('scene: no 2d context');
    // The drawing buffer is not kept after the frame, so it is copied in the same task as the render.
    ctx.drawImage(controller.domElement, 0, 0, width, height);
    return copy;
  } finally {
    controller.dispose();
  }
}
