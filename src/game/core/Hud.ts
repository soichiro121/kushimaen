/**
 * In-game HUD, drawn inside Phaser.
 *
 * The HUD updates every frame, so it must NOT live in React - re-rendering React at
 * 60fps is the single easiest way to lose frames on a phone. React owns the screens
 * around the game; Phaser owns everything inside it.
 *
 * All positions are derived from the safe-area insets so nothing hides behind the
 * Dynamic Island or the home indicator.
 *
 * Everything the HUD creates lives in one `Layer`, exposed as `displayLayer`. A
 * stage that uses a zoomed, scrolling camera (stage 3) renders its HUD on a separate
 * unzoomed UI camera and tells the world camera to ignore that one layer. A `Layer`
 * applies no transform of its own, so this is invisible to every other stage.
 */
import Phaser from 'phaser';
import { hudInsets } from '@/utils/safeArea';
import { FONT_STACK, TEXT_RESOLUTION } from './render';

const FONT = FONT_STACK;

export interface HudOptions {
  /** Shown at the top centre, e.g. the stage name. */
  readonly title?: string;
  /** When set, a countdown bar is drawn. */
  readonly timeLimitMs?: number;
  readonly showCombo?: boolean;
}

export class Hud {
  private readonly scene: Phaser.Scene;
  private readonly options: HudOptions;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly container: Phaser.GameObjects.Container;

  private readonly scoreLabel: Phaser.GameObjects.Text;
  private readonly titleLabel?: Phaser.GameObjects.Text;
  private readonly comboLabel: Phaser.GameObjects.Text;
  private readonly timeBarBg?: Phaser.GameObjects.Rectangle;
  private readonly timeBar?: Phaser.GameObjects.Rectangle;
  private readonly timeText?: Phaser.GameObjects.Text;

  private displayedScore = 0;
  private lastComboShown = 0;

  constructor(scene: Phaser.Scene, options: HudOptions = {}) {
    this.scene = scene;
    this.options = options;

    const insets = hudInsets();
    const width = scene.scale.width;

    this.layer = scene.add.layer().setDepth(1000);
    this.container = scene.add.container(0, 0).setScrollFactor(0);
    this.layer.add(this.container);

    // Readability shield behind the top HUD so it stays legible over any artwork.
    const shieldHeight = insets.top + 74;
    const shield = scene.add
      .rectangle(0, 0, width, shieldHeight, 0x11151d, 0.34)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(shield);

    this.scoreLabel = scene.add
      .text(insets.left, insets.top, '0', {
        fontFamily: FONT,
        resolution: TEXT_RESOLUTION,
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#151a22',
        strokeThickness: 5,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(this.scoreLabel);

    if (options.title) {
      this.titleLabel = scene.add
        .text(width / 2, insets.top + 4, options.title, {
          fontFamily: FONT,
          resolution: TEXT_RESOLUTION,
          fontSize: '19px',
          color: '#dfe6f2',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0);
      this.container.add(this.titleLabel);
    }

    if (options.timeLimitMs !== undefined) {
      const barWidth = width - insets.left - insets.right - 96;
      const barY = insets.top + 50;
      this.timeBarBg = scene.add
        .rectangle(insets.left, barY, barWidth, 10, 0x000000, 0.35)
        .setOrigin(0, 0.5)
        .setScrollFactor(0);
      this.timeBar = scene.add
        .rectangle(insets.left, barY, barWidth, 10, 0x64d38a, 1)
        .setOrigin(0, 0.5)
        .setScrollFactor(0);
      this.timeText = scene.add
        .text(width - insets.right, barY, '00.0', {
          fontFamily: FONT,
          resolution: TEXT_RESOLUTION,
          fontSize: '22px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#151a22',
          strokeThickness: 4,
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0);
      this.container.add([this.timeBarBg, this.timeBar, this.timeText]);
    }

    this.comboLabel = scene.add
      .text(width / 2, insets.top + 84, '', {
        fontFamily: FONT,
        resolution: TEXT_RESOLUTION,
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#7be0a4',
        stroke: '#151a22',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0)
      .setScrollFactor(0);
    this.container.add(this.comboLabel);
  }

  /** Cheap per-frame update: only touches text when the rendered value changes. */
  update(state: { score: number; elapsedMs: number; combo: number }): void {
    if (state.score !== this.displayedScore) {
      this.displayedScore = state.score;
      this.scoreLabel.setText(state.score.toLocaleString('en-US'));
    }

    const limit = this.options.timeLimitMs;
    if (limit !== undefined && this.timeBar && this.timeText && this.timeBarBg) {
      const remaining = Math.max(0, limit - state.elapsedMs);
      const ratio = limit > 0 ? remaining / limit : 0;
      this.timeBar.width = this.timeBarBg.width * ratio;
      this.timeBar.fillColor = ratio > 0.5 ? 0x64d38a : ratio > 0.22 ? 0xf2c14e : 0xf2685e;
      const seconds = (remaining / 1000).toFixed(1);
      if (this.timeText.text !== seconds) this.timeText.setText(seconds);
    }

    if (this.options.showCombo !== false && state.combo !== this.lastComboShown) {
      this.lastComboShown = state.combo;
      if (state.combo >= 2) {
        this.comboLabel.setText(`${state.combo} COMBO`);
        this.comboLabel.setAlpha(1).setScale(1.25);
        this.scene.tweens.add({
          targets: this.comboLabel,
          scale: 1,
          duration: 180,
          ease: 'Back.easeOut',
        });
      } else {
        this.scene.tweens.add({
          targets: this.comboLabel,
          alpha: 0,
          duration: 160,
        });
      }
    }
  }

  /** Large centred banner (`READY`, `GO!`, `CLEAR!`). */
  banner(text: string, options: { color?: string; durationMs?: number } = {}): void {
    const label = this.scene.add
      .text(this.scene.scale.width / 2, this.scene.scale.height * 0.42, text, {
        fontFamily: FONT,
        resolution: TEXT_RESOLUTION,
        fontSize: '64px',
        fontStyle: 'bold',
        color: options.color ?? '#ffffff',
        stroke: '#151a22',
        strokeThickness: 9,
      })
      .setOrigin(0.5)
      .setDepth(1100)
      .setScrollFactor(0)
      .setScale(0.6);
    this.layer.add(label);

    this.scene.tweens.add({
      targets: label,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
    this.scene.tweens.add({
      targets: label,
      alpha: 0,
      delay: options.durationMs ?? 620,
      duration: 240,
      onComplete: () => label.destroy(),
    });
  }

  /** For a stage that needs to route the HUD to its own camera. */
  get displayLayer(): Phaser.GameObjects.Layer {
    return this.layer;
  }

  destroy(): void {
    this.layer.destroy(true);
  }
}
