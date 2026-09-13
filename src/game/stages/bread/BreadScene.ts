/**
 * STAGE 2 - 羽沢パン購入RTA.
 *
 * An order appears; the player taps the matching product as fast as possible. The
 * shelf grows and fills with same-family look-alikes as the run progresses, so the
 * order has to actually be read, not pattern-matched.
 *
 * Scoring: base + speed bonus + combo bonus - mistake penalty. Speed is converted to
 * integer "speed units" at the moment of the answer so the backend can recompute the
 * exact same score from the metrics alone.
 */
import Phaser from 'phaser';
import { BaseStageScene } from '@/game/core/BaseStageScene';
import { textureKey } from '@/game/core/AssetLoader';
import { comboUnitsForHit, speedUnitsForReaction } from '@/game/core/scoring';
import * as fx from '@/game/core/fx';
import { FONT_STACK, TEXT_RESOLUTION } from '@/game/core/render';
import { RULES } from '@/config/rules';
import { breadConfig } from '@/config/stages/bread';
import { hudInsets } from '@/utils/safeArea';
import { HAPTIC_PATTERNS } from '@/services/haptics/haptics';
import type { AssetId } from '@/assets/assetRegistry';
import type { StageContext, StageEndReason, StageSceneFactory } from '@/game/core/stageTypes';
import { generateBreadProblems, type BreadProblem } from './problemGenerator';

const SCORING = RULES.stages.bread.scoring;

interface ShelfCell {
  container: Phaser.GameObjects.Container;
  itemId: string;
  locked: boolean;
}

export class BreadScene extends BaseStageScene {
  private problems: BreadProblem[] = [];
  private problemIndex = 0;
  private cells: ShelfCell[] = [];

  private orderLabel!: Phaser.GameObjects.Text;
  private orderCounter!: Phaser.GameObjects.Text;
  private orderPanel!: Phaser.GameObjects.Container;

  /** Set when the shelf becomes tappable; the reaction time is measured from here. */
  private questionShownAtMs = 0;
  private acceptingInput = false;
  private totalReactionMs = 0;

  constructor(context: StageContext) {
    super(context, {
      bundles: ['common', 'bread'],
      timeLimitMs: breadConfig.timeLimitMs,
      bgm: 'bread.bgm.main',
      hud: { title: '羽沢パン購入RTA', timeLimitMs: breadConfig.timeLimitMs, showCombo: true },
    });
  }

  protected createStage(): void {
    this.problems = generateBreadProblems(this.context.rng);

    this.addBackground();
    this.buildOrderPanel();

    this.score.setMetric('questionCount', this.problems.length);
    this.score.setMetric('correctCount', 0);
    this.score.setMetric('mistakeCount', 0);
    this.score.setMetric('speedUnits', 0);
    this.score.setMetric('comboUnits', 0);
  }

  protected onPlayStart(): void {
    this.showProblem(0);
  }

  private addBackground(): void {
    const { width, height } = this.scale;
    const key = textureKey('bread.background.shop' as AssetId);
    const background = this.add.image(width / 2, height / 2, key).setDepth(0);
    // Cover-fit: fill the viewport on both axes whatever the aspect ratio.
    const source = this.textures.get(key).getSourceImage();
    const scale = Math.max(width / (source.width || width), height / (source.height || height));
    background.setScale(scale);
  }

  private buildOrderPanel(): void {
    const insets = hudInsets();
    const { width } = this.scale;
    const panelY = insets.top + 74 + 62;

    this.orderPanel = this.add.container(width / 2, panelY).setDepth(30);

    const panelWidth = Math.min(width - insets.left - insets.right, 560);
    const background = this.add.image(0, 0, textureKey('bread.ui.tag' as AssetId));
    background.setDisplaySize(panelWidth, 116);

    const heading = this.add
      .text(-panelWidth / 2 + 26, -34, 'TARGET', {
        fontFamily: FONT_STACK,
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#c0703a',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0, 0.5);

    this.orderLabel = this.add
      .text(0, 12, '', {
        fontFamily: FONT_STACK,
        fontSize: '38px',
        fontStyle: 'bold',
        color: '#2d2117',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5, 0.5);

    this.orderCounter = this.add
      .text(panelWidth / 2 - 26, -34, '', {
        fontFamily: FONT_STACK,
        fontSize: '16px',
        color: '#6c5844',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(1, 0.5);

    this.orderPanel.add([background, heading, this.orderLabel, this.orderCounter]);
  }

  // -- questions -----------------------------------------------------------

  private showProblem(index: number): void {
    const problem = this.problems[index];
    if (!problem) {
      this.finish('cleared');
      return;
    }

    this.problemIndex = index;
    this.acceptingInput = false;
    this.clearShelf();

    this.orderLabel.setText(problem.target.name);
    fitTextWidth(this.orderLabel, Math.min(this.scale.width - 80, 520), 38);
    this.orderCounter.setText(`${index + 1} / ${this.problems.length}`);

    fx.pop(this, this.orderPanel, 0.1, 220);
    this.context.services.playSe('bread.se.order');

    this.buildShelf(problem);

    // Input opens only once the shelf is actually on screen, so the measured
    // reaction time is the player's, not the animation's.
    this.time.delayedCall(breadConfig.feedback.inputOpenDelayMs, () => {
      this.acceptingInput = true;
      this.questionShownAtMs = this.clock.elapsedMs;
    });
  }

  private clearShelf(): void {
    for (const cell of this.cells) cell.container.destroy(true);
    this.cells = [];
  }

  private buildShelf(problem: BreadProblem): void {
    const insets = hudInsets();
    const { width, height } = this.scale;
    const columns = problem.columns;
    const rows = Math.ceil(problem.choices.length / columns);

    const areaTop = this.orderPanel.y + 74;
    const areaBottom = height - insets.bottom - 8;
    const areaWidth = width - insets.left - insets.right - 16;
    const areaHeight = areaBottom - areaTop;

    const gap = breadConfig.layout.gap;
    const cellWidth = Phaser.Math.Clamp(
      (areaWidth - gap * (columns - 1)) / columns,
      breadConfig.layout.minCellWidth,
      breadConfig.layout.maxCellWidth,
    );
    // Height is capped by the available area so a 12-item shelf still fits a small phone.
    const cellHeight = Math.min(cellWidth * 1.16, (areaHeight - gap * (rows - 1)) / rows);

    const gridWidth = cellWidth * columns + gap * (columns - 1);
    const gridHeight = cellHeight * rows + gap * (rows - 1);
    const originX = width / 2 - gridWidth / 2 + cellWidth / 2;
    const originY = areaTop + Math.max(0, (areaHeight - gridHeight) / 2) + cellHeight / 2;

    problem.choices.forEach((item, i) => {
      const column = i % columns;
      const row = Math.floor(i / columns);
      const x = originX + column * (cellWidth + gap);
      const y = originY + row * (cellHeight + gap);
      this.cells.push(
        this.createCell(item.id, item.name, item.assetId, x, y, cellWidth, cellHeight, i),
      );
    });
  }

  private createCell(
    itemId: string,
    name: string,
    assetId: AssetId,
    x: number,
    y: number,
    cellWidth: number,
    cellHeight: number,
    order: number,
  ): ShelfCell {
    const container = this.add.container(x, y).setDepth(20);

    const plate = this.add
      .rectangle(0, 0, cellWidth, cellHeight, 0xfffaf0, 0.94)
      .setStrokeStyle(2, 0xd8bb92);
    const labelHeight = 22;
    const image = this.add.image(0, -labelHeight / 2, textureKey(assetId));
    const imageBox = Math.min(cellWidth - 12, cellHeight - labelHeight - 10);
    image.setDisplaySize(imageBox, imageBox);

    const label = this.add
      .text(0, cellHeight / 2 - labelHeight / 2 - 4, name, {
        fontFamily: FONT_STACK,
        fontSize: '15px',
        color: '#3a2c1e',
        resolution: TEXT_RESOLUTION,
        align: 'center',
      })
      .setOrigin(0.5);
    fitTextWidth(label, cellWidth - 8, 15);

    container.add([plate, image, label]);

    /*
     * Hit area: `setSize` + a bare `setInteractive()`.
     *
     * Do NOT pass a hand-built `Rectangle(-w/2, -h/2, w, h)` here. Phaser adds the
     * object's `displayOrigin` to the local point before testing the hit area, and a
     * Container's displayOrigin is (width/2, height/2) - so a centre-origin rectangle
     * ends up covering only the top-left quarter of the cell, and taps on the middle
     * or the right of a product silently do nothing.
     *
     * With no shape argument Phaser derives `Rectangle(0, 0, width, height)` from the
     * size we just set, which is the convention `pointWithinHitArea` expects.
     */
    container.setSize(cellWidth, cellHeight);
    container.setInteractive();

    const cell: ShelfCell = { container, itemId, locked: false };
    // pointerdown, not pointerup: this is a speed-run, latency is the whole game.
    container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.onCellTapped(cell));

    container.setScale(0.82).setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: breadConfig.feedback.entryDurationMs,
      delay: Math.min(order * breadConfig.feedback.entryStaggerMs, 90),
      ease: 'Back.easeOut',
    });

    return cell;
  }

  private onCellTapped(cell: ShelfCell): void {
    if (!this.acceptingInput || cell.locked || this.phase !== 'playing') return;

    const problem = this.problems[this.problemIndex];
    if (!problem) return;

    if (cell.itemId === problem.target.id) {
      this.onCorrect(cell);
    } else {
      this.onMistake(cell);
    }
  }

  private onCorrect(cell: ShelfCell): void {
    this.acceptingInput = false;

    const reactionMs = Math.max(0, this.clock.elapsedMs - this.questionShownAtMs);
    this.totalReactionMs += reactionMs;
    const speedUnits = speedUnitsForReaction(reactionMs);

    const event = this.score.award(
      'correct',
      (mutate) => {
        mutate.add('correctCount');
        mutate.add('speedUnits', speedUnits);
        mutate.add('comboUnits', comboUnitsForHit(mutate.combo, SCORING.maxComboUnitsPerHit));
      },
      { combo: 'extend' },
    );

    const { x, y } = cell.container;
    fx.pop(this, cell.container, 0.22, 220);
    fx.ring(this, x, y, { tint: 0x7be0a4, scale: 1.4 });
    fx.burst(this, x, y, { count: 10, tint: 0xffd45e });
    fx.scorePopup(this, x, y - 34, `+${event.delta}`, {
      color: event.combo >= 3 ? fx.FX_COLORS.combo : fx.FX_COLORS.gain,
      size: 30,
    });
    if (speedUnits >= RULES.stages.bread.maxSpeedUnitsPerQuestion - 1) {
      fx.scorePopup(this, x, y - 70, 'FAST!', { color: '#ffe89a', size: 22, rise: 46 });
    }

    this.context.services.playSe('bread.se.correct');
    if (event.combo >= 3) {
      this.context.services.playSe('bread.se.combo', {
        rate: 1 + Math.min(event.combo, 10) * 0.04,
      });
    }
    this.context.services.vibrate(HAPTIC_PATTERNS.success);

    this.time.delayedCall(breadConfig.feedback.advanceDelayMs, () => {
      if (this.phase === 'playing') this.showProblem(this.problemIndex + 1);
    });
  }

  private onMistake(cell: ShelfCell): void {
    cell.locked = true;
    const event = this.score.award('mistake', (mutate) => mutate.add('mistakeCount'), {
      combo: 'break',
    });

    const { x, y } = cell.container;
    fx.shakeObject(this, cell.container);
    fx.scorePopup(this, x, y - 30, `${event.delta}`, { color: fx.FX_COLORS.loss, size: 28 });
    fx.flash(this, 0xff5b4a, 110);
    this.context.services.playSe('bread.se.wrong');
    this.context.services.vibrate(HAPTIC_PATTERNS.mistake);

    const plate = cell.container.getAt(0) as Phaser.GameObjects.Rectangle;
    plate.setFillStyle(0xf3c9c2, 0.95);

    this.time.delayedCall(breadConfig.feedback.lockoutMs, () => {
      if (!cell.container.active) return;
      cell.locked = false;
      plate.setFillStyle(0xfffaf0, 0.94);
    });
  }

  protected updateStage(_deltaMs: number): void {
    // Fully event-driven: nothing to advance per frame. The base class still ticks
    // the clock and the HUD, which is what the time bar and reaction times use.
  }

  protected finalizeMetrics(_reason: StageEndReason): void {
    this.score.setMetric('maxCombo', this.score.maxCombo);
    this.score.setMetric('totalReactionMs', Math.round(this.totalReactionMs));
    this.acceptingInput = false;
  }

  protected debugState(): { state?: string; extra?: Record<string, string | number> } {
    const problem = this.problems[this.problemIndex];
    return {
      state: `Q${this.problemIndex + 1}/${this.problems.length}`,
      extra: {
        target: problem?.target.name ?? '-',
        choices: problem?.choices.length ?? 0,
        avgReaction:
          this.score.getMetric('correctCount') > 0
            ? Math.round(this.totalReactionMs / this.score.getMetric('correctCount'))
            : 0,
      },
    };
  }
}

/** Shrinks a text object until it fits `maxWidth`, so long product names never clip. */
function fitTextWidth(text: Phaser.GameObjects.Text, maxWidth: number, baseSize: number): void {
  let size = baseSize;
  text.setFontSize(size);
  while (text.width > maxWidth && size > 10) {
    size -= 1;
    text.setFontSize(size);
  }
}

export const createBreadScene: StageSceneFactory = (context) => new BreadScene(context);
