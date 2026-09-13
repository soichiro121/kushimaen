/**
 * Game feel helpers: score popups, shake, squash, particles, flashes.
 *
 * Kept in one place so every stage has the same tactile vocabulary and so the
 * "juice" can be tuned globally. Effects are intentionally short and cheap - this
 * targets 60fps on a mid-range phone, so nothing here allocates per frame.
 */
import Phaser from 'phaser';
import { textureKey } from './AssetLoader';
import type { AssetId } from '@/assets/assetRegistry';
import { FONT_STACK, TEXT_RESOLUTION } from './render';

export const FX_COLORS = {
  gain: '#ffd45e',
  loss: '#ff6b5e',
  combo: '#7be0a4',
  neutral: '#ffffff',
} as const;

const POPUP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_STACK,
  fontStyle: 'bold',
  resolution: TEXT_RESOLUTION,
  stroke: '#1c2028',
  strokeThickness: 6,
};

/**
 * Floating score popup. Text objects are destroyed on completion; at the volumes
 * these stages produce (a few per second) that is cheaper than pooling and keeps
 * the call site trivial.
 */
export function scorePopup(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options: { color?: string; size?: number; rise?: number } = {},
): void {
  const label = scene.add
    .text(x, y, text, {
      ...POPUP_STYLE,
      fontSize: `${options.size ?? 30}px`,
      color: options.color ?? FX_COLORS.gain,
    })
    .setOrigin(0.5)
    .setDepth(900);

  scene.tweens.add({
    targets: label,
    y: y - (options.rise ?? 70),
    alpha: { from: 1, to: 0 },
    scale: { from: 0.7, to: 1.12 },
    ease: 'Cubic.easeOut',
    duration: 720,
    onComplete: () => label.destroy(),
  });
}

/** Short, directional camera shake. Intensity is a fraction of the viewport. */
export function shake(scene: Phaser.Scene, intensity = 0.008, durationMs = 180): void {
  scene.cameras.main.shake(durationMs, intensity, true);
}

/** Full-screen colour flash, used sparingly for collisions and being caught. */
export function flash(scene: Phaser.Scene, color = 0xff5b4a, durationMs = 160): void {
  const rgb = Phaser.Display.Color.IntegerToRGB(color);
  scene.cameras.main.flash(durationMs, rgb.r, rgb.g, rgb.b, true);
}

/** Squash-and-stretch pop, for taps and correct answers. */
export function pop(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject & { scaleX: number; scaleY: number },
  amount = 0.18,
  durationMs = 180,
): void {
  const baseX = target.scaleX;
  const baseY = target.scaleY;
  scene.tweens.add({
    targets: target,
    scaleX: baseX * (1 + amount),
    scaleY: baseY * (1 - amount * 0.5),
    duration: durationMs * 0.35,
    yoyo: true,
    ease: 'Quad.easeOut',
    onComplete: () => {
      target.scaleX = baseX;
      target.scaleY = baseY;
    },
  });
}

/** Left-right shake for a wrong answer. */
export function shakeObject(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject & { x: number },
  amount = 10,
  durationMs = 240,
): void {
  const baseX = target.x;
  scene.tweens.add({
    targets: target,
    x: baseX + amount,
    duration: durationMs / 6,
    yoyo: true,
    repeat: 2,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      target.x = baseX;
    },
  });
}

/**
 * One-shot particle burst. The emitter destroys itself, so callers do not have to
 * track lifetimes.
 */
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: { assetId?: AssetId; count?: number; tint?: number; speed?: number } = {},
): void {
  const key = textureKey(options.assetId ?? ('common.fx.spark' as AssetId));
  if (!scene.textures.exists(key)) return;

  const emitter = scene.add.particles(x, y, key, {
    lifespan: 520,
    speed: { min: 60, max: options.speed ?? 220 },
    angle: { min: 0, max: 360 },
    scale: { start: 1, end: 0 },
    alpha: { start: 1, end: 0 },
    gravityY: 240,
    quantity: options.count ?? 10,
    tint: options.tint,
    emitting: false,
  });
  emitter.setDepth(880);
  emitter.explode(options.count ?? 10);
  scene.time.delayedCall(700, () => emitter.destroy());
}

/** Expanding ring, used for near misses and correct answers. */
export function ring(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: { tint?: number; scale?: number; durationMs?: number } = {},
): void {
  const key = textureKey('common.fx.ring' as AssetId);
  if (!scene.textures.exists(key)) return;

  const sprite = scene.add.image(x, y, key).setDepth(870).setScale(0.3);
  if (options.tint !== undefined) sprite.setTint(options.tint);
  scene.tweens.add({
    targets: sprite,
    scale: options.scale ?? 1.6,
    alpha: { from: 0.9, to: 0 },
    duration: options.durationMs ?? 420,
    ease: 'Cubic.easeOut',
    onComplete: () => sprite.destroy(),
  });
}

/** Count-up tween for result screens rendered inside Phaser. */
export function countUp(
  scene: Phaser.Scene,
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
): Phaser.Tweens.Tween {
  const holder = { value: from };
  return scene.tweens.add({
    targets: holder,
    value: to,
    duration: durationMs,
    ease: 'Cubic.easeOut',
    onUpdate: () => onUpdate(Math.round(holder.value)),
    onComplete: () => onUpdate(to),
  });
}
