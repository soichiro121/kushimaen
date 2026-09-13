/**
 * STAGE 1 - 遅刻回避.
 *
 * The player auto-runs up a narrow private road toward the school gate, steering with
 * a relative horizontal drag. The scoring twist: simply avoiding students is nearly
 * worthless. Points come from NEAR MISSES - squeezing past someone - and near misses
 * chain into a combo. Safe play is easy and low-scoring; a high score requires risk.
 *
 * All tuning lives in `src/config/stages/late.ts`; all score constants live in the
 * shared rule set. This file contains the behaviour, not the numbers.
 */
import Phaser from 'phaser';
import { BaseStageScene } from '@/game/core/BaseStageScene';
import { DragController } from '@/game/core/DragController';
import { playAsset, textureKey } from '@/game/core/AssetLoader';
import { comboUnitsForHit } from '@/game/core/scoring';
import * as fx from '@/game/core/fx';
import { Countdown } from '@/game/core/GameClock';
import { RULES } from '@/config/rules';
import { lateConfig, type ObstacleKind } from '@/config/stages/late';
import { HAPTIC_PATTERNS } from '@/services/haptics/haptics';
import type { AssetId } from '@/assets/assetRegistry';
import type { StageContext, StageEndReason, StageSceneFactory } from '@/game/core/stageTypes';

const SCORING = RULES.stages.late.scoring;

interface Obstacle {
  sprite: Phaser.GameObjects.Sprite;
  kind: ObstacleKind;
  baseX: number;
  hitHalfWidth: number;
  elapsedMs: number;
  /** Set once the obstacle has passed the player's line, so it scores only once. */
  resolved: boolean;
  /** Set when it collided, so it cannot also award a near miss. */
  collided: boolean;
  swerveTriggered: boolean;
  active: boolean;
}

export class LateScene extends BaseStageScene {
  private road!: Phaser.GameObjects.TileSprite;
  private player!: Phaser.GameObjects.Sprite;
  private drag!: DragController;
  private gate: Phaser.GameObjects.Image | null = null;
  private dragHint!: Phaser.GameObjects.Container;

  private readonly obstacles: Obstacle[] = [];
  private readonly pool: Obstacle[] = [];
  private readonly props: Phaser.GameObjects.Image[] = [];

  private readonly spawnTimer = new Countdown(lateConfig.spawn.startMs);

  private distance = 0;
  private distanceSinceSpawn = 0;
  private distanceSinceProp = 0;
  private slowdownRemainingMs = 0;
  private invulnerableRemainingMs = 0;
  private goalReached = false;

  private roadLeft = 0;
  private roadRight = 0;
  private playerY = 0;

  constructor(context: StageContext) {
    super(context, {
      bundles: ['common', 'late'],
      timeLimitMs: lateConfig.timeLimitMs,
      bgm: 'late.bgm.main',
      hud: { title: '遅刻回避', timeLimitMs: lateConfig.timeLimitMs, showCombo: true },
    });
  }

  // -- setup ---------------------------------------------------------------

  protected createStage(): void {
    const { width, height } = this.scale;
    this.computeRoadBounds();
    this.playerY = height * lateConfig.player.yRatio;

    this.road = this.add
      .tileSprite(0, 0, width, height, textureKey('late.background.privateRoad' as AssetId))
      .setOrigin(0, 0)
      .setDepth(0);
    // Map the artwork's width onto the viewport so the painted road lines up with the
    // playable bounds regardless of the device's aspect ratio.
    const texture = this.textures.get(textureKey('late.background.privateRoad' as AssetId));
    const sourceWidth = texture.getSourceImage().width || width;
    const scale = width / sourceWidth;
    this.road.setTileScale(scale, scale);

    this.player = this.add
      .sprite(
        (this.roadLeft + this.roadRight) / 2,
        this.playerY,
        textureKey('late.player.run' as AssetId),
      )
      .setDepth(20);
    fitWidth(this.player, lateConfig.player.displayWidth);
    playAsset(this.player, 'late.player.run' as AssetId);

    this.drag = new DragController(this, {
      sensitivity: lateConfig.player.dragSensitivity,
      min: this.roadLeft,
      max: this.roadRight,
      initialValue: this.player.x,
    });

    this.dragHint = this.createDragHint();
    this.score.setMetric('goalReached', 0);
    this.score.setMetric('timeRemainingSec', 0);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });
  }

  protected onPlayStart(): void {
    this.tweens.add({
      targets: this.dragHint,
      alpha: 0,
      delay: 1800,
      duration: 600,
      onComplete: () => this.dragHint.destroy(),
    });
  }

  private computeRoadBounds(): void {
    const { width } = this.scale;
    const roadWidth = width * lateConfig.road.widthRatio;
    const half = roadWidth / 2;
    const padding = lateConfig.road.edgePadding + lateConfig.player.displayWidth / 2;
    this.roadLeft = width / 2 - half + padding;
    this.roadRight = width / 2 + half - padding;
  }

  private onResize(): void {
    this.computeRoadBounds();
    this.playerY = this.scale.height * lateConfig.player.yRatio;
    this.player.y = this.playerY;
    this.road.setSize(this.scale.width, this.scale.height);
  }

  private createDragHint(): Phaser.GameObjects.Container {
    const { width, height } = this.scale;
    const y = height - 96;
    const container = this.add.container(0, 0).setDepth(940);
    const band = this.add.rectangle(width / 2, y, width * 0.86, 76, 0x0f1420, 0.42).setOrigin(0.5);
    const label = this.add
      .text(width / 2, y, '← 指を左右にドラッグ →', {
        fontFamily: '"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    container.add([band, label]);
    return container;
  }

  // -- per-frame -----------------------------------------------------------

  protected updateStage(deltaMs: number): void {
    const seconds = deltaMs / 1000;

    this.invulnerableRemainingMs = Math.max(0, this.invulnerableRemainingMs - deltaMs);
    this.slowdownRemainingMs = Math.max(0, this.slowdownRemainingMs - deltaMs);

    const scrollDelta = this.currentScrollSpeed() * seconds;
    this.distance += scrollDelta;
    this.distanceSinceSpawn += scrollDelta;
    this.distanceSinceProp += scrollDelta;
    this.road.tilePositionY -= scrollDelta / this.road.tileScaleY;

    this.updatePlayer(deltaMs);
    this.updateProps(scrollDelta);
    this.updateObstacles(deltaMs, scrollDelta);
    this.updateSpawning(deltaMs);
    this.updateGate(scrollDelta);
  }

  private currentScrollSpeed(): number {
    const progress = Phaser.Math.Clamp(this.distance / lateConfig.courseDistancePx, 0, 1);
    const base = Phaser.Math.Linear(
      lateConfig.scroll.startSpeed,
      lateConfig.scroll.endSpeed,
      progress,
    );
    const difficulty = 1 + (this.context.difficultyScale - 1) * 0.5;
    const slow = this.slowdownRemainingMs > 0 ? lateConfig.collision.slowdownFactor : 1;
    return base * difficulty * slow;
  }

  private updatePlayer(deltaMs: number): void {
    this.player.x = DragController.ease(
      this.player.x,
      this.drag.value,
      lateConfig.player.smoothing,
      deltaMs,
    );
    // Lean into the movement - cheap, and it makes the steering feel responsive.
    const lean = Phaser.Math.Clamp((this.drag.value - this.player.x) / 40, -1, 1);
    this.player.setRotation(lean * 0.12);
    if (this.invulnerableRemainingMs > 0) {
      this.player.setAlpha(Math.sin(this.invulnerableRemainingMs / 40) > 0 ? 0.35 : 1);
    } else if (this.player.alpha !== 1) {
      this.player.setAlpha(1);
    }
  }

  private updateProps(scrollDelta: number): void {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const prop = this.props[i] as Phaser.GameObjects.Image;
      prop.y += scrollDelta;
      if (prop.y > this.scale.height + 200) {
        prop.destroy();
        this.props.splice(i, 1);
      }
    }

    if (this.distanceSinceProp < lateConfig.props.intervalPx) return;
    this.distanceSinceProp = 0;

    const { width } = this.scale;
    const inset = (width * (1 - lateConfig.road.widthRatio)) / 2;
    for (const x of [inset * 0.55, width - inset * 0.55]) {
      const prop = this.add.image(x, -140, textureKey(lateConfig.props.assetId)).setDepth(1);
      fitWidth(prop, lateConfig.props.displayWidth);
      this.props.push(prop);
    }
  }

  private updateObstacles(deltaMs: number, scrollDelta: number): void {
    const collideDy = lateConfig.hit.verticalTolerancePx;

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i] as Obstacle;
      const sprite = obstacle.sprite;
      const previousY = sprite.y;

      obstacle.elapsedMs += deltaMs;
      sprite.y += scrollDelta * obstacle.kind.speedFactor;

      this.applyBehavior(obstacle);

      const dx = Math.abs(sprite.x - this.player.x);
      const dy = Math.abs(sprite.y - this.playerY);

      // Collision first, so a hit can never also be scored as a near miss.
      if (
        !obstacle.collided &&
        this.invulnerableRemainingMs <= 0 &&
        dy < collideDy &&
        dx < lateConfig.player.hitboxRadius + obstacle.hitHalfWidth
      ) {
        obstacle.collided = true;
        obstacle.resolved = true;
        this.onCollision(sprite.x, sprite.y);
      } else if (!obstacle.resolved && previousY <= this.playerY && sprite.y > this.playerY) {
        obstacle.resolved = true;
        const gap = dx - obstacle.hitHalfWidth;
        if (gap <= lateConfig.nearMiss.distancePx) {
          this.onNearMiss(sprite.x, this.playerY);
        }
      }

      if (sprite.y > this.scale.height + 180) this.recycle(i);
    }
  }

  private applyBehavior(obstacle: Obstacle): void {
    const { kind, sprite } = obstacle;
    switch (kind.behavior) {
      case 'oscillate': {
        const period = kind.oscillatePeriodMs ?? 1600;
        const amplitude = kind.oscillateAmplitude ?? 40;
        const phase = (obstacle.elapsedMs / period) * Math.PI * 2;
        sprite.x = Phaser.Math.Clamp(
          obstacle.baseX + Math.sin(phase) * amplitude,
          this.roadLeft,
          this.roadRight,
        );
        break;
      }
      case 'swerve': {
        // Lurches sideways only once, and only when close enough that the player has
        // to react - that is what makes it a threat rather than noise.
        if (obstacle.swerveTriggered) break;
        const distanceToPlayer = this.playerY - sprite.y;
        if (distanceToPlayer > 0 && distanceToPlayer < 300) {
          obstacle.swerveTriggered = true;
          const toward = Math.sign(this.player.x - sprite.x) || 1;
          const target = Phaser.Math.Clamp(
            sprite.x + toward * (kind.swerveDistance ?? 80),
            this.roadLeft,
            this.roadRight,
          );
          this.tweens.add({
            targets: sprite,
            x: target,
            duration: kind.swerveDurationMs ?? 500,
            ease: 'Sine.easeInOut',
          });
        }
        break;
      }
      case 'straight':
      default:
        break;
    }
  }

  private updateSpawning(deltaMs: number): void {
    if (this.goalReached) return;

    const progress = Phaser.Math.Clamp(this.distance / lateConfig.courseDistancePx, 0, 1);
    const interval =
      Phaser.Math.Linear(lateConfig.spawn.startMs, lateConfig.spawn.endMs, progress) /
      this.context.difficultyScale;
    this.spawnTimer.setInterval(interval);

    if (this.spawnTimer.tick(deltaMs) === 0) return;
    if (this.distanceSinceSpawn < lateConfig.spawn.minGapPx) return;
    this.distanceSinceSpawn = 0;
    this.spawnObstacle();
  }

  private spawnObstacle(): void {
    const kind = this.context.rng.weighted(lateConfig.obstacles, (candidate) => candidate.weight);
    const obstacle = this.acquire(kind);
    const half = kind.displayWidth / 2;
    const x = this.context.rng.range(this.roadLeft - half * 0.4, this.roadRight + half * 0.4);

    obstacle.baseX = Phaser.Math.Clamp(x, this.roadLeft - half * 0.4, this.roadRight + half * 0.4);
    obstacle.sprite.setPosition(obstacle.baseX, -kind.displayWidth);
    obstacle.elapsedMs = 0;
    obstacle.resolved = false;
    obstacle.collided = false;
    obstacle.swerveTriggered = false;
    obstacle.active = true;
    obstacle.sprite.setVisible(true).setActive(true);
    this.obstacles.push(obstacle);
  }

  /** Obstacles are pooled: spawning must not allocate during play. */
  private acquire(kind: ObstacleKind): Obstacle {
    const reusable = this.pool.findIndex((candidate) => candidate.kind.id === kind.id);
    if (reusable >= 0) {
      const [obstacle] = this.pool.splice(reusable, 1);
      return obstacle as Obstacle;
    }

    const sprite = this.add.sprite(0, -400, textureKey(kind.assetId)).setDepth(10);
    fitWidth(sprite, kind.displayWidth);
    if (kind.animated) playAsset(sprite, kind.assetId);

    return {
      sprite,
      kind,
      baseX: 0,
      hitHalfWidth: (kind.displayWidth * kind.hitboxScale) / 2,
      elapsedMs: 0,
      resolved: false,
      collided: false,
      swerveTriggered: false,
      active: true,
    };
  }

  private recycle(index: number): void {
    const [obstacle] = this.obstacles.splice(index, 1);
    if (!obstacle) return;
    this.tweens.killTweensOf(obstacle.sprite);
    obstacle.active = false;
    obstacle.sprite.setVisible(false).setActive(false).setPosition(0, -400);
    this.pool.push(obstacle);
  }

  // -- scoring events ------------------------------------------------------

  private onNearMiss(x: number, y: number): void {
    const event = this.score.award(
      'nearMiss',
      (mutate) => {
        mutate.add('nearMissCount');
        mutate.add('comboUnits', comboUnitsForHit(mutate.combo, SCORING.maxComboUnitsPerHit));
      },
      { combo: 'extend', label: 'NEAR MISS' },
    );

    fx.scorePopup(this, x, y - 40, `NEAR MISS +${event.delta}`, {
      color: event.combo >= 3 ? fx.FX_COLORS.combo : fx.FX_COLORS.gain,
      size: event.combo >= 5 ? 32 : 26,
    });
    fx.ring(this, x, y, { tint: 0xffd45e, scale: 1.1, durationMs: 340 });
    this.context.services.playSe('late.se.nearMiss');
    if (event.combo >= 3 && event.combo % 3 === 0) {
      this.context.services.playSe('late.se.combo', { rate: 1 + Math.min(event.combo, 12) * 0.03 });
    }
    this.context.services.vibrate(HAPTIC_PATTERNS.nearMiss);
  }

  private onCollision(x: number, y: number): void {
    const event = this.score.award('collision', (mutate) => mutate.add('collisionCount'), {
      combo: 'break',
      label: 'HIT',
    });

    this.slowdownRemainingMs = lateConfig.collision.slowdownMs;
    this.invulnerableRemainingMs = lateConfig.collision.invulnerableMs;

    fx.scorePopup(this, x, y - 30, `${event.delta}`, { color: fx.FX_COLORS.loss, size: 34 });
    fx.shake(this, 0.012, 220);
    fx.flash(this, 0xff5b4a, 140);
    fx.burst(this, x, y, { count: 12, tint: 0xff8a7a });
    this.context.services.playSe('late.se.collision');
    this.context.services.vibrate(HAPTIC_PATTERNS.collision);

    playAsset(this.player, 'late.player.hit' as AssetId);
    this.time.delayedCall(420, () => {
      if (this.player.active) playAsset(this.player, 'late.player.run' as AssetId);
    });
  }

  // -- goal ----------------------------------------------------------------

  private updateGate(scrollDelta: number): void {
    if (!this.gate) {
      if (this.distance < lateConfig.courseDistancePx) return;
      this.gate = this.add
        .image(this.scale.width / 2, -260, textureKey(lateConfig.gate.assetId))
        .setDepth(12);
      fitWidth(this.gate, this.scale.width * lateConfig.gate.displayWidthRatio);
      return;
    }

    this.gate.y += scrollDelta;
    if (this.goalReached || this.gate.y < this.playerY) return;

    this.goalReached = true;
    this.drag.setEnabled(false);

    this.score.award(
      'goal',
      (mutate) => {
        mutate.set('goalReached', 1);
        mutate.set('timeRemainingSec', this.clock.remainingSec(lateConfig.timeLimitMs));
      },
      { combo: 'keep', label: 'GOAL' },
    );

    this.hud.banner('校門到着！', { color: '#ffd45e', durationMs: 900 });
    fx.burst(this, this.player.x, this.playerY, { count: 26, speed: 320 });
    this.context.services.playSe('late.se.goal');
    this.context.services.vibrate(HAPTIC_PATTERNS.success);
    this.finish('cleared');
  }

  protected finalizeMetrics(_reason: StageEndReason): void {
    this.score.setMetric('maxCombo', this.score.maxCombo);
    if (!this.goalReached) {
      this.score.setMetric('goalReached', 0);
      this.score.setMetric('timeRemainingSec', 0);
    }
    this.score.setMetric('distancePx', Math.round(this.distance));
  }

  protected debugState(): { state?: string; extra?: Record<string, string | number> } {
    return {
      state: this.goalReached ? 'goal' : 'running',
      extra: {
        distance: Math.round(this.distance),
        obstacles: this.obstacles.length,
        pooled: this.pool.length,
        scrollSpeed: Math.round(this.currentScrollSpeed()),
      },
    };
  }
}

/** Scales a game object to an exact on-screen width, preserving its aspect ratio. */
function fitWidth(
  object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
  width: number,
): void {
  const source = object.frame?.width || object.width || width;
  object.setScale(width / source);
}

export const createLateScene: StageSceneFactory = (context) => new LateScene(context);
