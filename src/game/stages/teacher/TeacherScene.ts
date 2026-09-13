/**
 * STAGE 3 - 放課後ステルス (top-down stealth speedrun).
 *
 * The player crosses a school after hours, collects a short list of objectives and
 * escapes through the entrance hall, without walking into a teacher's line of sight.
 *
 * THE CORE TENSION: the score is dominated by remaining time, so hiding until the
 * corridor is empty is always allowed and always expensive. The central corridor is
 * the fast way and carries two patrols; the perimeter loops are safe and slow. That
 * choice, repeated four times a run, is the whole game.
 *
 * This file is the *presentation and glue* layer. Everything that can be reasoned
 * about without a renderer lives next to it and is unit-tested:
 *
 *   map/SchoolMap.ts      collision, line of sight, the patrol graph
 *   sim/TeacherAgent.ts   patrol / wait / turn / investigate / return
 *   sim/vision.ts         distance + angle + occlusion
 *   sim/DetectionMeter.ts the 0..100% build-up and its decay
 *   sim/mission.ts        seeded objective list and progress
 *
 * Tuning lives in `src/config/stages/teacher/`; score constants in the shared rule
 * set. There are no magic numbers below.
 */
import Phaser from 'phaser';
import { BaseStageScene } from '@/game/core/BaseStageScene';
import { DragVector } from '@/game/core/DragVector';
import { DragController } from '@/game/core/DragController';
import { playAsset, textureKey } from '@/game/core/AssetLoader';
import * as fx from '@/game/core/fx';
import { FONT_STACK, TEXT_RESOLUTION } from '@/game/core/render';
import { hudInsets } from '@/utils/safeArea';
import { createRng } from '@/utils/rng';
import { HAPTIC_PATTERNS } from '@/services/haptics/haptics';
import { teacherOverrides } from '@/dev/stageOverrides';
import {
  DEFAULT_MAP_ID,
  getSchoolMap,
  teacherConfig,
  type MapArea,
  type MapCheckpoint,
  type Rect,
  type SchoolMapData,
  type TeacherTypeConfig,
} from '@/config/stages/teacher';
import type { AssetId } from '@/assets/assetRegistry';
import type { StageContext, StageEndReason, StageSceneFactory } from '@/game/core/stageTypes';
import { SchoolMap } from './map/SchoolMap';
import { angleDelta, degToRad, segmentHitT } from './map/geometry';
import { TeacherAgent, type TeacherState } from './sim/TeacherAgent';
import { DetectionMeter } from './sim/DetectionMeter';
import { canSee } from './sim/vision';
import { generateMission, MissionProgress, type Mission } from './sim/mission';

const DEPTH = {
  floor: 0,
  wall: 5,
  label: 6,
  marker: 8,
  cone: 9,
  teacher: 12,
  player: 14,
  overhead: 16,
  debug: 20,
} as const;

/** One patrolling teacher plus everything the scene needs to draw and hear them. */
interface TeacherRuntime {
  readonly agent: TeacherAgent;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly alertIcon: Phaser.GameObjects.Image;
  readonly meter: DetectionMeter;
  stepTimerMs: number;
  dangerCooldownMs: number;
  lastAreaKind: string;
  lastState: TeacherState;
}

export class TeacherScene extends BaseStageScene {
  // -- world ---------------------------------------------------------------
  private mapData!: SchoolMapData;
  private map!: SchoolMap;
  private mission!: Mission;
  private progress!: MissionProgress;
  private readonly teachers: TeacherRuntime[] = [];

  private player!: Phaser.GameObjects.Sprite;
  private playerFacing = -Math.PI / 2;
  private velocityX = 0;
  private velocityY = 0;

  private worldLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private coneGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;
  private objectiveMarker!: Phaser.GameObjects.Image;

  // -- input ---------------------------------------------------------------
  private readonly drag = new DragVector(teacherConfig.input);
  private activePointerId: number | null = null;

  // -- hud -----------------------------------------------------------------
  private missionText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private detectionBarBg!: Phaser.GameObjects.Rectangle;
  private detectionBar!: Phaser.GameObjects.Rectangle;
  private compass!: Phaser.GameObjects.Triangle;
  private offscreenMarkers: Phaser.GameObjects.Arc[] = [];
  private controlHint!: Phaser.GameObjects.Container;

  // -- run state -----------------------------------------------------------
  private showVisionCone: boolean = teacherConfig.vision.showVisionCone;
  private freezeRemainingMs = 0;
  private graceRemainingMs = 0;
  private pendingRespawn = false;
  private safeRespawn = { x: 0, y: 0 };
  private cleared = false;
  private routeDistancePx = 0;
  private idleTimeMs = 0;
  private detectionCount = 0;
  private dangerPassCount = 0;
  private playerStepTimerMs = 0;
  /** `${teacherId}:${objectiveIndex}` - one danger payout per teacher per leg. */
  private readonly dangerPaid = new Set<string>();

  constructor(context: StageContext) {
    super(context, {
      bundles: ['common', 'teacher'],
      timeLimitMs: teacherConfig.timeLimitMs,
      bgm: teacherConfig.assets.bgm,
      hud: {
        title: '放課後ステルス',
        timeLimitMs: teacherConfig.timeLimitMs,
        showCombo: false,
      },
    });
  }

  // -- setup ---------------------------------------------------------------

  protected createStage(): void {
    const overrides = teacherOverrides();
    this.showVisionCone = overrides.showVisionCone ?? teacherConfig.vision.showVisionCone;

    this.mapData = getSchoolMap(overrides.mapId ?? DEFAULT_MAP_ID);
    this.map = new SchoolMap(this.mapData);

    // A dev seed override replays an exact patrol timing; otherwise the run seed
    // (already derived per stage) is the only source of randomness.
    const rng = overrides.seed === undefined ? this.context.rng : createRng(overrides.seed);

    this.mission = generateMission(this.mapData, rng, overrides.missionId);
    this.progress = new MissionProgress(this.mission);

    this.worldLayer = this.add.layer().setDepth(0);
    this.uiLayer = this.add.layer().setDepth(900);

    this.drawMap();
    this.createMarker();
    this.createPlayer();
    this.createTeachers(rng, overrides.teacherCount);

    this.coneGraphics = this.add.graphics().setDepth(DEPTH.cone);
    this.worldLayer.add(this.coneGraphics);
    if (this.context.debug) {
      this.debugGraphics = this.add.graphics().setDepth(DEPTH.debug);
      this.worldLayer.add(this.debugGraphics);
    }

    this.setUpCameras();
    this.createHudExtras();
    this.bindInput();
    this.resetMetrics();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      this.unbindInput();
    });
  }

  protected onPlayStart(): void {
    // Requirement 52: the tutorial is one line, and it gets out of the way.
    this.tweens.add({
      targets: this.controlHint,
      alpha: 0,
      delay: 2600,
      duration: 700,
      onComplete: () => this.controlHint.destroy(),
    });
  }

  private drawMap(): void {
    for (const area of this.mapData.areas) {
      const asset = this.mapData.floorAssets[area.kind];
      this.worldLayer.add(this.tile(area.rect, asset, DEPTH.floor));
      this.worldLayer.add(this.areaLabel(area));
    }
    for (const wall of this.mapData.walls) {
      this.worldLayer.add(this.tile(wall.rect, this.mapData.wallAsset, DEPTH.wall));
    }
  }

  private tile(rect: Rect, assetId: AssetId, depth: number): Phaser.GameObjects.TileSprite {
    return this.add
      .tileSprite(rect.x, rect.y, rect.width, rect.height, textureKey(assetId))
      .setOrigin(0, 0)
      .setDepth(depth);
  }

  /** Faint room names. Cheap orientation on a phone screen that shows one corridor. */
  private areaLabel(area: MapArea): Phaser.GameObjects.Text {
    return this.add
      .text(area.rect.x + area.rect.width / 2, area.rect.y + area.rect.height / 2, area.name, {
        fontFamily: FONT_STACK,
        resolution: TEXT_RESOLUTION,
        fontSize: '30px',
        color: '#2a2f3a',
      })
      .setOrigin(0.5)
      .setAlpha(0.22)
      .setDepth(DEPTH.label);
  }

  private createMarker(): void {
    this.objectiveMarker = this.add
      .image(0, 0, textureKey(teacherConfig.assets.objectiveMarker))
      .setDepth(DEPTH.marker);
    this.worldLayer.add(this.objectiveMarker);
    this.tweens.add({
      targets: this.objectiveMarker,
      scale: { from: 0.85, to: 1.15 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.refreshMarker();
  }

  private createPlayer(): void {
    const { spawn } = this.mapData;
    this.safeRespawn = { ...spawn };
    this.player = this.add
      .sprite(spawn.x, spawn.y, textureKey(teacherConfig.assets.playerIdle))
      .setDepth(DEPTH.player);
    fitWidth(this.player, teacherConfig.player.displayWidth);
    playAsset(this.player, teacherConfig.assets.playerIdle);
    this.player.setRotation(this.playerFacing);
    this.worldLayer.add(this.player);
  }

  private createTeachers(rng: ReturnType<typeof createRng>, limit?: number): void {
    const patrols =
      limit === undefined
        ? this.mapData.patrols
        : this.mapData.patrols.slice(0, Math.max(0, limit));

    for (const patrol of patrols) {
      const type: TeacherTypeConfig = teacherConfig.teacherTypes[patrol.typeId];
      const agent = new TeacherAgent(this.map, patrol, type, rng, teacherConfig.investigate);

      const sprite = this.add
        .sprite(agent.x, agent.y, textureKey(teacherConfig.assets.npcWalk))
        .setDepth(DEPTH.teacher)
        .setTint(type.tint);
      fitWidth(sprite, teacherConfig.player.displayWidth * 1.22);
      playAsset(sprite, teacherConfig.assets.npcWalk);

      const alertIcon = this.add
        .image(agent.x, agent.y, textureKey(teacherConfig.assets.alertBubble))
        .setDepth(DEPTH.overhead)
        .setAlpha(0);

      this.worldLayer.add([sprite, alertIcon]);
      this.teachers.push({
        agent,
        sprite,
        alertIcon,
        meter: new DetectionMeter(teacherConfig.detection),
        stepTimerMs: 0,
        dangerCooldownMs: 0,
        lastAreaKind: this.map.areaAt(agent.x, agent.y)?.kind ?? 'corridor',
        lastState: agent.currentState,
      });
    }
  }

  /**
   * Two cameras: a zoomed one that follows the player around the school, and an
   * unzoomed one for the HUD. Without the split, every HUD element would be scaled
   * and offset by the world camera's zoom.
   */
  private setUpCameras(): void {
    const { bounds } = this.mapData;
    const main = this.cameras.main;
    main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    main.setZoom(teacherConfig.map.cameraZoom);
    main.startFollow(this.player, true, teacherConfig.map.followLerp, teacherConfig.map.followLerp);
    main.setBackgroundColor('#10141c');

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('ui');
    this.uiCamera.transparent = true;
    this.uiCamera.ignore(this.worldLayer);
    main.ignore([this.uiLayer, this.hud.displayLayer]);
  }

  private createHudExtras(): void {
    const insets = hudInsets();
    const width = this.scale.width;
    const top = insets.top + 78;

    this.missionText = this.add
      .text(width / 2, top, '', {
        fontFamily: FONT_STACK,
        resolution: TEXT_RESOLUTION,
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#ffe6a8',
        stroke: '#151a22',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 0);

    this.statusText = this.add
      .text(width / 2, top + 26, '', {
        fontFamily: FONT_STACK,
        resolution: TEXT_RESOLUTION,
        fontSize: '15px',
        color: '#cfd8e6',
        stroke: '#151a22',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0);

    const barWidth = 168;
    this.detectionBarBg = this.add
      .rectangle(width / 2, top + 52, barWidth, 6, 0x000000, 0.4)
      .setOrigin(0.5, 0);
    this.detectionBar = this.add
      .rectangle(width / 2 - barWidth / 2, top + 52, 0, 6, 0xf2c14e, 1)
      .setOrigin(0, 0);

    // Small arrow orbiting the player, shown only when the objective is off screen.
    this.compass = this.add
      .triangle(0, 0, 0, -13, 11, 9, -11, 9, 0xffd45e, 0.92)
      .setAlpha(0)
      .setStrokeStyle(2, 0x151a22, 0.9);

    this.controlHint = this.createControlHint();

    this.uiLayer.add([
      this.missionText,
      this.statusText,
      this.detectionBarBg,
      this.detectionBar,
      this.compass,
      this.controlHint,
    ]);

    this.refreshHudText();
  }

  /**
   * The bottom band is where the thumb naturally rests (requirement 8). It is not a
   * joystick and it does not restrict where you may touch - it just tells a first-time
   * player where to put their finger so it does not cover the corridor ahead.
   */
  private createControlHint(): Phaser.GameObjects.Container {
    const { width, height } = this.scale;
    const bandHeight = height * teacherConfig.input.controlBandRatio;
    const centreY = height - bandHeight / 2;

    const container = this.add.container(0, 0);
    const band = this.add.rectangle(width / 2, centreY, width, bandHeight, 0x0f1420, 0.16);
    const label = this.add
      .text(width / 2, centreY, 'ドラッグした方向へ移動\n先生に見つからず目的地を回れ！', {
        fontFamily: FONT_STACK,
        resolution: TEXT_RESOLUTION,
        fontSize: '18px',
        color: '#ffffff',
        align: 'center',
        stroke: '#151a22',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    container.add([band, label]);
    return container;
  }

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
  }

  private unbindInput(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId !== null) return; // a second finger never steals control
    this.activePointerId = pointer.id;
    this.drag.start(pointer.x, pointer.y);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId) return;
    this.drag.move(pointer.x, pointer.y);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId) return;
    this.activePointerId = null;
    this.drag.end();
  }

  private resetMetrics(): void {
    this.score.setMetric('cleared', 0);
    this.score.setMetric('checkpointsCompleted', 0);
    this.score.setMetric('timeRemainingSec', 0);
    this.score.setMetric('caughtCount', 0);
    this.score.setMetric('detectionCount', 0);
    this.score.setMetric('dangerPassCount', 0);
  }

  // -- per-frame -----------------------------------------------------------

  protected updateStage(deltaMs: number): void {
    this.graceRemainingMs = Math.max(0, this.graceRemainingMs - deltaMs);
    this.updateFreeze(deltaMs);

    this.updatePlayer(deltaMs);
    this.updateTeachers(deltaMs);
    this.updateDetection(deltaMs);
    this.updateDanger(deltaMs);
    this.updateCheckpoints();
    this.updateCamera(deltaMs);
    this.drawVisionCones();
    this.updateHud();
    this.drawDebug();
  }

  private updateFreeze(deltaMs: number): void {
    if (this.freezeRemainingMs <= 0) return;
    this.freezeRemainingMs -= deltaMs;
    if (this.freezeRemainingMs > 0 || !this.pendingRespawn) return;

    this.pendingRespawn = false;
    const respawn = this.respawnPoint();
    this.player.setPosition(respawn.x, respawn.y);
    this.velocityX = 0;
    this.velocityY = 0;
    this.drag.end();
    this.activePointerId = null;
    this.graceRemainingMs = teacherConfig.caught.graceMs;
    this.cameras.main.centerOn(respawn.x, respawn.y);
  }

  /**
   * Where a catch puts you: the furthest patrol node within `maxSetbackPx` that the
   * teacher who caught you cannot see. That is a real setback without undoing the
   * whole leg - see the note on `teacherConfig.caught.maxSetbackPx`.
   */
  private respawnPoint(): { x: number; y: number } {
    const candidates = this.mapData.waypoints
      .map((node) => ({
        node,
        distance: Math.hypot(node.x - this.player.x, node.y - this.player.y),
      }))
      .filter((entry) => entry.distance <= teacherConfig.caught.maxSetbackPx)
      .sort((a, b) => b.distance - a.distance);

    for (const { node } of candidates) {
      const seen = this.teachers.some(
        (teacher) =>
          canSee(teacher.agent.position, { x: node.x, y: node.y }, teacher.agent.cone, this.map)
            .visible,
      );
      if (!seen) return { x: node.x, y: node.y };
    }
    return this.safeRespawn;
  }

  private get isFrozen(): boolean {
    return this.freezeRemainingMs > 0;
  }

  private updatePlayer(deltaMs: number): void {
    const config = teacherConfig.player;
    const targetX = this.isFrozen ? 0 : this.drag.x * config.speedPxPerSec;
    const targetY = this.isFrozen ? 0 : this.drag.y * config.speedPxPerSec;

    this.velocityX = DragController.ease(this.velocityX, targetX, config.smoothing, deltaMs);
    this.velocityY = DragController.ease(this.velocityY, targetY, config.smoothing, deltaMs);

    const seconds = deltaMs / 1000;
    const before = { x: this.player.x, y: this.player.y };
    const moved = this.map.move(
      before.x,
      before.y,
      this.velocityX * seconds,
      this.velocityY * seconds,
      config.radiusPx,
    );
    this.player.setPosition(moved.x, moved.y);

    const travelled = Math.hypot(moved.x - before.x, moved.y - before.y);
    this.routeDistancePx += travelled;

    // "Idle" is measured from actual movement, not from input, so standing against a
    // wall with the finger down still counts as waiting.
    const movingNow = travelled > 0.4;
    if (!movingNow) this.idleTimeMs += deltaMs;

    if (movingNow) {
      this.playerFacing = Math.atan2(moved.y - before.y, moved.x - before.x);
      playAsset(this.player, teacherConfig.assets.playerWalk);
      this.playerStepTimerMs += deltaMs;
      if (this.playerStepTimerMs >= teacherConfig.audio.playerStepMs) {
        this.playerStepTimerMs = 0;
        this.context.services.playSe(teacherConfig.assets.se.playerStep, {
          volume: teacherConfig.audio.playerStepVolume,
        });
      }
    } else {
      playAsset(this.player, teacherConfig.assets.playerIdle);
    }
    this.player.setRotation(this.playerFacing);
    this.player.setAlpha(this.graceRemainingMs > 0 && !this.isFrozen ? 0.55 : 1);
  }

  private updateTeachers(deltaMs: number): void {
    for (const teacher of this.teachers) {
      teacher.agent.update(deltaMs);
      teacher.sprite.setPosition(teacher.agent.x, teacher.agent.y);
      teacher.sprite.setRotation(teacher.agent.facing);
      teacher.alertIcon.setPosition(teacher.agent.x, teacher.agent.y - 46);
      teacher.dangerCooldownMs = Math.max(0, teacher.dangerCooldownMs - deltaMs);

      const state = teacher.agent.currentState;
      if (state === 'WAIT' || state === 'TURN') {
        teacher.sprite.anims.pause();
        teacher.sprite.setTexture(textureKey(teacherConfig.assets.npcWait));
      } else {
        playAsset(teacher.sprite, teacherConfig.assets.npcWalk);
      }
      teacher.lastState = state;

      this.updateTeacherAudio(teacher, deltaMs);
    }
  }

  /**
   * Requirements 25 + 26: an off-screen teacher announces themselves with footsteps
   * whose volume falls off with distance and whose stereo position tells you which
   * side they are on. Nothing in the stage *depends* on hearing it - the edge markers
   * below cover a muted phone.
   */
  private updateTeacherAudio(teacher: TeacherRuntime, deltaMs: number): void {
    const audio = teacherConfig.audio;
    const dx = teacher.agent.x - this.player.x;
    const distance = Math.hypot(dx, teacher.agent.y - this.player.y);

    const area = this.map.areaAt(teacher.agent.x, teacher.agent.y);
    const kind = area?.kind ?? teacher.lastAreaKind;
    if (kind !== teacher.lastAreaKind) {
      const leftARoom = teacher.lastAreaKind !== 'corridor' && kind === 'corridor';
      teacher.lastAreaKind = kind;
      if (leftARoom && distance < audio.hearingRangePx) {
        this.context.services.playSe(teacherConfig.assets.se.door, {
          volume: this.falloff(distance) * 1.2,
          pan: this.panFor(dx),
        });
      }
    }

    if (!teacher.agent.isMoving) return;
    teacher.stepTimerMs += deltaMs;
    if (teacher.stepTimerMs < audio.teacherStepMs) return;
    teacher.stepTimerMs = 0;
    if (distance > audio.hearingRangePx) return;

    this.context.services.playSe(teacherConfig.assets.se.teacherStep, {
      volume: this.falloff(distance),
      pan: this.panFor(dx),
    });
  }

  private falloff(distance: number): number {
    const audio = teacherConfig.audio;
    const ratio = 1 - Math.min(1, distance / audio.hearingRangePx);
    return audio.maxVolume * ratio * ratio;
  }

  private panFor(dx: number): number {
    return Phaser.Math.Clamp((dx / teacherConfig.audio.hearingRangePx) * 2, -1, 1);
  }

  private updateDetection(deltaMs: number): void {
    if (this.cleared) return;
    const immune = this.isFrozen || this.graceRemainingMs > 0;
    const playerPoint = { x: this.player.x, y: this.player.y };

    for (const teacher of this.teachers) {
      const sight = immune
        ? { visible: false, closeness: 0 }
        : canSee(teacher.agent.position, playerPoint, teacher.agent.cone, this.map);

      const result = teacher.meter.update(deltaMs, sight.visible, sight.closeness);
      const level = teacher.meter.value;

      teacher.alertIcon.setAlpha(level > 0.15 ? Math.min(1, level * 1.4) : 0);
      teacher.alertIcon.setScale(0.8 + level * 0.5);
      if (teacher.meter.isAlert) {
        teacher.sprite.setTexture(textureKey(teacherConfig.assets.npcAlert));
        teacher.sprite.anims.pause();
      }

      if (result.alert) {
        this.detectionCount += 1;
        this.score.setMetric('detectionCount', this.detectionCount);
        this.context.services.playSe(teacherConfig.assets.se.detect, { volume: 0.7 });
        this.context.services.vibrate(HAPTIC_PATTERNS.tap);
        // They walk over to look. This is what makes a corner a real escape rather
        // than a reset button.
        teacher.agent.investigate(playerPoint);
      }

      if (result.caught) {
        this.onCaught(teacher);
        return;
      }
    }
  }

  /**
   * Danger bonus (requirements 32, 34): brushing past a teacher who is on the move
   * and facing your way pays once. The payout key includes the objective index, so
   * circling someone can never farm it - you have to make progress to earn it again.
   */
  private updateDanger(deltaMs: number): void {
    if (this.cleared || this.isFrozen) return;
    const danger = teacherConfig.danger;
    const half = degToRad(danger.maxFacingAngleDeg) / 2;

    for (const teacher of this.teachers) {
      if (teacher.dangerCooldownMs > 0) continue;
      if (!teacher.agent.isMoving) continue;

      const dx = this.player.x - teacher.agent.x;
      const dy = this.player.y - teacher.agent.y;
      const distance = Math.hypot(dx, dy);
      if (distance > danger.distancePx) continue;
      if (Math.abs(angleDelta(teacher.agent.facing, Math.atan2(dy, dx))) > half) continue;
      if (
        !this.map.hasLineOfSight(teacher.agent.position, { x: this.player.x, y: this.player.y })
      ) {
        continue;
      }

      const key = `${teacher.agent.id}:${this.progress.completed}`;
      if (this.dangerPaid.has(key)) continue;
      this.dangerPaid.add(key);
      teacher.dangerCooldownMs = danger.cooldownMs;

      this.dangerPassCount += 1;
      const event = this.score.award(
        'danger',
        (mutate) => mutate.set('dangerPassCount', this.dangerPassCount),
        { combo: 'keep', label: 'CLOSE CALL' },
      );
      this.worldPopup(this.player.x, this.player.y - 34, `CLOSE CALL +${event.delta}`, {
        color: fx.FX_COLORS.gain,
        size: 22,
      });
    }
    void deltaMs;
  }

  private updateCheckpoints(): void {
    if (this.cleared || this.isFrozen) return;

    const collected = this.progress.tryCollect(
      this.player.x,
      this.player.y,
      teacherConfig.player.checkpointRadiusPx,
    );
    if (!collected) return;

    this.safeRespawn = { x: collected.x, y: collected.y };

    if (this.progress.isComplete) {
      this.onCleared(collected);
      return;
    }

    const event = this.score.award(
      'checkpoint',
      (mutate) => mutate.set('checkpointsCompleted', this.progress.completed),
      { combo: 'keep', label: collected.name },
    );
    this.context.services.playSe(teacherConfig.assets.se.checkpoint);
    this.context.services.vibrate(HAPTIC_PATTERNS.success);
    this.worldPopup(collected.x, collected.y - 40, `${collected.name} +${event.delta}`, {
      color: fx.FX_COLORS.combo,
      size: 24,
    });
    this.refreshMarker();
    this.refreshHudText();

    // Requirement 54: the run turns into an escape once the list is done.
    if (this.progress.isFinalLeg) {
      this.hud.banner('EXIT!', { color: '#7be0a4', durationMs: 700 });
    }
  }

  private updateCamera(deltaMs: number): void {
    // Look-ahead (requirement 27): on a tall phone screen the player needs to see
    // where they are going, not where they have been.
    const speed = Math.hypot(this.velocityX, this.velocityY);
    const ratio = speed > 1 ? Math.min(1, speed / teacherConfig.player.speedPxPerSec) : 0;
    const lead = teacherConfig.map.lookAheadPx * ratio;
    const targetX = speed > 1 ? (-this.velocityX / Math.max(1, speed)) * lead : 0;
    const targetY = speed > 1 ? (-this.velocityY / Math.max(1, speed)) * lead : 0;

    const follow = this.cameras.main.followOffset;
    follow.x = DragController.ease(follow.x, targetX, 0.06, deltaMs);
    follow.y = DragController.ease(follow.y, targetY, 0.06, deltaMs);
  }

  // -- feedback ------------------------------------------------------------

  private onCaught(teacher: TeacherRuntime): void {
    this.freezeRemainingMs = teacherConfig.caught.freezeMs;
    this.pendingRespawn = true;
    this.velocityX = 0;
    this.velocityY = 0;
    this.drag.end();
    this.activePointerId = null;

    const event = this.score.award('caught', (mutate) => mutate.add('caughtCount'), {
      combo: 'break',
      label: 'CAUGHT',
    });

    this.hud.banner('おい！', {
      color: '#ff8a7a',
      durationMs: teacherConfig.caught.bannerMs,
    });
    this.worldPopup(this.player.x, this.player.y - 40, `${event.delta}`, {
      color: fx.FX_COLORS.loss,
      size: 30,
    });
    // Kept mild on purpose: this is a stealth game and the player still has to read
    // the corridor through the effect (requirement 57).
    fx.flash(this, 0xff5b4a, 140);
    fx.shake(this, 0.006, 180);
    this.context.services.playSe(teacherConfig.assets.se.caught);
    this.context.services.vibrate(HAPTIC_PATTERNS.caught);

    for (const other of this.teachers) {
      other.meter.reset();
      other.agent.resetToPatrol();
      other.alertIcon.setAlpha(0);
    }
    void teacher;
  }

  private onCleared(exitCheckpoint: MapCheckpoint): void {
    this.cleared = true;
    const remaining = this.clock.remainingSec(teacherConfig.timeLimitMs);

    this.score.award(
      'clear',
      (mutate) => {
        mutate.set('checkpointsCompleted', this.progress.completed);
        mutate.set('cleared', 1);
        mutate.set('timeRemainingSec', remaining);
      },
      { combo: 'keep', label: 'ESCAPE' },
    );

    this.hud.banner('脱出成功！', { color: '#ffd45e', durationMs: 900 });
    this.worldPopup(exitCheckpoint.x, exitCheckpoint.y - 44, 'ESCAPE!', {
      color: fx.FX_COLORS.gain,
      size: 30,
    });
    this.context.services.playSe(teacherConfig.assets.se.clear);
    this.context.services.vibrate(HAPTIC_PATTERNS.success);
    this.objectiveMarker.setVisible(false);
    this.compass.setAlpha(0);
    this.finish('cleared');
  }

  /** A score popup that lives in the world layer, so the UI camera ignores it. */
  private worldPopup(
    x: number,
    y: number,
    text: string,
    options: { color?: string; size?: number },
  ): void {
    const label = this.add
      .text(x, y, text, {
        fontFamily: FONT_STACK,
        resolution: TEXT_RESOLUTION,
        fontStyle: 'bold',
        fontSize: `${options.size ?? 24}px`,
        color: options.color ?? fx.FX_COLORS.gain,
        stroke: '#1c2028',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overhead);
    this.worldLayer.add(label);

    this.tweens.add({
      targets: label,
      y: y - 54,
      alpha: { from: 1, to: 0 },
      duration: 720,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  // -- rendering -----------------------------------------------------------

  /**
   * Faint vision cones (requirement 18), clipped by the walls that actually block
   * them - a cone that visibly stops at a corner is what teaches the player that
   * corners are safe.
   *
   * Only teachers near the viewport are drawn, and each cone is a handful of rays,
   * so this stays cheap on a phone (requirement 49).
   */
  private drawVisionCones(): void {
    this.coneGraphics.clear();
    if (!this.showVisionCone) return;

    const view = this.cameras.main.worldView;
    const segments = teacherConfig.vision.coneSegments;

    for (const teacher of this.teachers) {
      const { agent } = teacher;
      const reach = agent.type.viewDistancePx;
      if (
        agent.x + reach < view.x ||
        agent.x - reach > view.right ||
        agent.y + reach < view.y ||
        agent.y - reach > view.bottom
      ) {
        continue;
      }

      const nearby = this.map.walls.filter(
        (rect) =>
          rect.x - reach <= agent.x &&
          rect.x + rect.width + reach >= agent.x &&
          rect.y - reach <= agent.y &&
          rect.y + rect.height + reach >= agent.y,
      );

      const cone = agent.cone;
      const points: Phaser.Types.Math.Vector2Like[] = [{ x: agent.x, y: agent.y }];
      for (let i = 0; i <= segments; i++) {
        const angle = cone.facing - cone.halfAngleRad + (i / segments) * cone.halfAngleRad * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const endX = agent.x + dirX * reach;
        const endY = agent.y + dirY * reach;

        let nearest = 1;
        for (const rect of nearby) {
          const hit = segmentHitT(agent.x, agent.y, endX, endY, rect);
          if (hit !== null && hit < nearest) nearest = hit;
        }
        points.push({ x: agent.x + dirX * reach * nearest, y: agent.y + dirY * reach * nearest });
      }

      const level = teacher.meter.value;
      const colour = level > 0.05 ? 0xff6b5e : 0xffe6a8;
      this.coneGraphics.fillStyle(
        colour,
        teacherConfig.vision.coneAlpha + level * teacherConfig.vision.coneAlpha * 2,
      );
      this.coneGraphics.fillPoints(points, true);
    }
  }

  private updateHud(): void {
    let peak = 0;
    for (const teacher of this.teachers) peak = Math.max(peak, teacher.meter.value);

    this.detectionBar.width = this.detectionBarBg.width * peak;
    this.detectionBar.fillColor = peak >= teacherConfig.detection.alertRatio ? 0xf2685e : 0xf2c14e;
    this.detectionBarBg.setAlpha(peak > 0.02 ? 1 : 0.25);

    this.updateCompass();
    this.updateOffscreenMarkers();
  }

  private updateCompass(): void {
    const target = this.progress.current;
    if (!target || this.cleared) {
      this.compass.setAlpha(0);
      return;
    }

    const screen = this.toScreen(target.x, target.y);
    const margin = teacherConfig.hud.compassHideMarginPx;
    const onScreen =
      screen.x > margin &&
      screen.x < this.scale.width - margin &&
      screen.y > margin &&
      screen.y < this.scale.height - margin;

    if (onScreen) {
      this.compass.setAlpha(0);
      return;
    }

    const player = this.toScreen(this.player.x, this.player.y);
    const angle = Math.atan2(screen.y - player.y, screen.x - player.x);
    const radius = teacherConfig.hud.compassRadiusPx;

    this.compass
      .setPosition(player.x + Math.cos(angle) * radius, player.y + Math.sin(angle) * radius)
      .setRotation(angle + Math.PI / 2)
      .setAlpha(0.92);
  }

  /**
   * Requirement 24/26: no full minimap. Only teachers close enough to be *heard* get
   * a dot on the screen edge, so the player who muted their phone still has the
   * information the footsteps carry - and no more.
   */
  private updateOffscreenMarkers(): void {
    if (!teacherConfig.audio.showOffscreenMarkers) return;

    while (this.offscreenMarkers.length < this.teachers.length) {
      const dot = this.add.circle(0, 0, 5, 0xff8a7a, 0.85).setAlpha(0);
      this.uiLayer.add(dot);
      this.offscreenMarkers.push(dot);
    }

    const { width, height } = this.scale;
    const edge = 16;
    const player = this.toScreen(this.player.x, this.player.y);

    this.teachers.forEach((teacher, index) => {
      const dot = this.offscreenMarkers[index];
      if (!dot) return;

      const distance = Math.hypot(teacher.agent.x - this.player.x, teacher.agent.y - this.player.y);
      const screen = this.toScreen(teacher.agent.x, teacher.agent.y);
      const visible = screen.x > 0 && screen.x < width && screen.y > 0 && screen.y < height;

      if (visible || distance > teacherConfig.audio.hearingRangePx) {
        dot.setAlpha(0);
        return;
      }

      const angle = Math.atan2(screen.y - player.y, screen.x - player.x);
      dot
        .setPosition(
          Phaser.Math.Clamp(player.x + Math.cos(angle) * width, edge, width - edge),
          Phaser.Math.Clamp(player.y + Math.sin(angle) * height, edge, height - edge),
        )
        .setAlpha(0.3 + 0.5 * (1 - distance / teacherConfig.audio.hearingRangePx));
    });
  }

  private toScreen(worldX: number, worldY: number): { x: number; y: number } {
    const camera = this.cameras.main;
    return {
      x: (worldX - camera.worldView.x) * camera.zoom,
      y: (worldY - camera.worldView.y) * camera.zoom,
    };
  }

  private refreshMarker(): void {
    const target = this.progress.current;
    if (!target) {
      this.objectiveMarker.setVisible(false);
      return;
    }
    this.objectiveMarker
      .setVisible(true)
      .setPosition(target.x, target.y)
      .setTexture(
        textureKey(
          target.kind === 'exit'
            ? teacherConfig.assets.exitMarker
            : teacherConfig.assets.objectiveMarker,
        ),
      );
  }

  private refreshHudText(): void {
    const target = this.progress.current;
    this.missionText.setText(target ? `NEXT  ${target.name}` : 'NEXT  -');
    this.statusText.setText(
      `${this.mission.label}  ${this.progress.completed}/${this.progress.total}` +
        `   CAUGHT ${this.score.getMetric('caughtCount')}`,
    );
  }

  private drawDebug(): void {
    const graphics = this.debugGraphics;
    if (!graphics) return;
    graphics.clear();

    // Player collision circle.
    graphics.lineStyle(1, 0x64d38a, 0.9);
    graphics.strokeCircle(this.player.x, this.player.y, teacherConfig.player.radiusPx);

    // Patrol graph.
    graphics.lineStyle(1, 0x3a4a6a, 0.5);
    for (const [from, to] of this.mapData.edges) {
      const a = this.map.waypoint(from);
      const b = this.map.waypoint(to);
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }

    for (const teacher of this.teachers) {
      // Where they are heading.
      const target = this.map.waypoint(teacher.agent.targetWaypointId);
      graphics.lineStyle(2, 0xffd45e, 0.8);
      graphics.lineBetween(teacher.agent.x, teacher.agent.y, target.x, target.y);

      // Line-of-sight ray: green when the player is actually visible.
      const sight = canSee(
        teacher.agent.position,
        { x: this.player.x, y: this.player.y },
        teacher.agent.cone,
        this.map,
      );
      graphics.lineStyle(1, sight.visible ? 0xff5b4a : 0x5a6480, sight.visible ? 0.95 : 0.35);
      graphics.lineBetween(teacher.agent.x, teacher.agent.y, this.player.x, this.player.y);
    }
  }

  private onResize(): void {
    const { width, height } = this.scale;
    this.uiCamera?.setSize(width, height);
    const insets = hudInsets();
    const top = insets.top + 78;
    this.missionText?.setPosition(width / 2, top);
    this.statusText?.setPosition(width / 2, top + 26);
    this.detectionBarBg?.setPosition(width / 2, top + 52);
    this.detectionBar?.setPosition(width / 2 - this.detectionBarBg.width / 2, top + 52);
  }

  // -- lifecycle -----------------------------------------------------------

  override pauseStage(): void {
    // A pointer held down across a pause would otherwise resume as a stale drag.
    this.drag.end();
    this.activePointerId = null;
    super.pauseStage();
  }

  protected finalizeMetrics(_reason: StageEndReason): void {
    this.score.setMetric('cleared', this.cleared ? 1 : 0);
    this.score.setMetric('checkpointsCompleted', this.progress.completed);
    this.score.setMetric('caughtCount', this.score.getMetric('caughtCount'));
    this.score.setMetric('detectionCount', this.detectionCount);
    this.score.setMetric('dangerPassCount', this.dangerPassCount);
    this.score.setMetric(
      'perfectStealth',
      this.detectionCount === 0 && this.score.getMetric('caughtCount') === 0 ? 1 : 0,
    );
    this.score.setMetric('routeDistance', Math.round(this.routeDistancePx));
    this.score.setMetric('idleTimeMs', Math.round(Math.min(this.idleTimeMs, this.clock.elapsedMs)));
    if (!this.cleared) this.score.setMetric('timeRemainingSec', 0);
  }

  protected debugState(): { state?: string; extra?: Record<string, string | number> } {
    const states = this.teachers
      .map((teacher) => `${teacher.agent.id}:${teacher.agent.currentState}`)
      .join(' ');
    const peak = this.teachers.reduce((max, teacher) => Math.max(max, teacher.meter.value), 0);

    return {
      state: this.cleared ? 'cleared' : this.isFrozen ? 'caught' : 'running',
      extra: {
        mission: `${this.mission.patternId} ${this.progress.completed}/${this.progress.total}`,
        next: this.progress.current?.id ?? '-',
        map: this.mapData.id,
        seed: this.context.seed,
        detect: peak.toFixed(2),
        caught: this.score.getMetric('caughtCount'),
        spotted: this.detectionCount,
        danger: this.dangerPassCount,
        distance: Math.round(this.routeDistancePx),
        teachers: states,
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

export const createTeacherScene: StageSceneFactory = (context) => new TeacherScene(context);
