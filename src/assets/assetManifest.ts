/**
 * THE ASSET MANIFEST - the one place in the project that knows about files.
 *
 * HOW TO REPLACE ARTWORK
 *
 *   A) Keep the filename: overwrite the file in `public/assets/...`.
 *      Then set `status: 'final'` and correct the size fields if they changed.
 *
 *   B) New filename or format: drop the file into `public/assets/...` and edit
 *      only the `src` of the entry below.
 *
 * In BOTH cases no stage, scene or React component changes. See `docs/ASSETS.md`
 * for the full table with recommended sizes.
 *
 * Everything marked `status: 'placeholder'` is TODO_ASSET - generated art from
 * `npm run assets:placeholders`, waiting for the real thing.
 */
import { bgm, img, sfx, sheet } from './define';

/** Keeps the 18 bread entries below to one readable line each. */
function breadImage(file: string, label: string) {
  return {
    src: `/assets/bread/${file}.png`,
    status: 'placeholder',
    usage: `商品画像: ${label}`,
    recommendedSize: { width: 192, height: 192 },
    transparent: true,
    notes: '正方形・背景透過。中央に商品が収まるように。',
  } as const;
}

export const assetManifest = {
  /** Loaded before the title screen. Keep this bundle small. */
  common: {
    ui: {
      logo: img({
        src: '/assets/common/ui-logo.png',
        status: 'placeholder',
        usage: 'タイトル画面のロゴ',
        recommendedSize: { width: 720, height: 320 },
        transparent: true,
        notes: '横長。上下に余白を持たせると小さい端末でも綺麗に収まります。',
      }),
      /** Shown whenever another asset fails to load. Intentionally not a placeholder. */
      fallback: img({
        src: '/assets/common/ui-fallback.png',
        status: 'final',
        usage: '読み込み失敗時に表示される代替テクスチャ（差し替え不要）',
        recommendedSize: { width: 128, height: 128 },
        transparent: false,
      }),
    },
    fx: {
      spark: img({
        src: '/assets/common/fx-spark.png',
        status: 'placeholder',
        usage: 'スコアポップやコンボ時のパーティクル',
        recommendedSize: { width: 24, height: 24 },
        transparent: true,
      }),
      ring: img({
        src: '/assets/common/fx-ring.png',
        status: 'placeholder',
        usage: 'ニアミス／正解時に広がるリングエフェクト',
        recommendedSize: { width: 96, height: 96 },
        transparent: true,
      }),
    },
    se: {
      click: sfx({
        src: '/assets/common/se-click.wav',
        status: 'placeholder',
        usage: 'UIボタンのタップ音',
        approxDurationSec: 0.08,
      }),
      start: sfx({
        src: '/assets/common/se-start.wav',
        status: 'placeholder',
        usage: 'ゲーム開始・ステージ開始の合図',
        approxDurationSec: 0.5,
      }),
      countdown: sfx({
        src: '/assets/common/se-countdown.wav',
        status: 'placeholder',
        usage: 'ステージ開始前の 3・2・1 カウント音',
        approxDurationSec: 0.2,
      }),
      result: sfx({
        src: '/assets/common/se-result.wav',
        status: 'placeholder',
        usage: 'リザルト画面のスコア確定音',
        approxDurationSec: 0.7,
      }),
      success: sfx({
        src: '/assets/common/se-success.wav',
        status: 'placeholder',
        usage: '汎用の成功音',
        approxDurationSec: 0.35,
      }),
      error: sfx({
        src: '/assets/common/se-error.wav',
        status: 'placeholder',
        usage: '汎用の失敗音',
        approxDurationSec: 0.3,
      }),
    },
    bgm: {
      title: bgm({
        src: '/assets/common/bgm-title.wav',
        status: 'placeholder',
        usage: 'タイトル／メニューのBGM',
        approxDurationSec: 4,
        notes: '本番は 60〜90 秒のシームレスループ（.m4a と .ogg 推奨）に差し替え。',
      }),
    },
  },

  /** STAGE 1 - 遅刻回避. Preloaded together with `common`. */
  late: {
    background: {
      privateRoad: img({
        src: '/assets/late/bg-private-road.png',
        status: 'placeholder',
        usage: '私道の背景。縦方向にシームレスタイリングします',
        recommendedSize: { width: 720, height: 1280 },
        transparent: false,
        notes: '【重要】上端と下端が繋がるように作ってください（縦ループ）。',
      }),
      gate: img({
        src: '/assets/late/bg-gate.png',
        status: 'placeholder',
        usage: 'ゴール地点の校門',
        recommendedSize: { width: 720, height: 420 },
        transparent: true,
      }),
    },
    prop: {
      roadside: img({
        src: '/assets/late/prop-roadside.png',
        status: 'placeholder',
        usage: '道の左右に並ぶ塀・植え込み',
        recommendedSize: { width: 96, height: 200 },
        transparent: true,
      }),
    },
    player: {
      run: sheet({
        src: '/assets/late/player-run.png',
        status: 'placeholder',
        usage: '主人公の走行アニメーション',
        frameSize: { width: 128, height: 160 },
        frameCount: 6,
        frameRate: 12,
        loop: true,
        transparent: true,
        notes: '横一列のスプライトシート。足元が frame 下端に来るように。',
      }),
      hit: sheet({
        src: '/assets/late/player-hit.png',
        status: 'placeholder',
        usage: '生徒に衝突した瞬間のリアクション',
        frameSize: { width: 128, height: 160 },
        frameCount: 2,
        frameRate: 10,
        loop: false,
        transparent: true,
      }),
    },
    student: {
      normal01: sheet({
        src: '/assets/late/student-normal01.png',
        status: 'placeholder',
        usage: '普通に歩く生徒A',
        frameSize: { width: 112, height: 150 },
        frameCount: 4,
        frameRate: 6,
        loop: true,
        transparent: true,
      }),
      normal02: sheet({
        src: '/assets/late/student-normal02.png',
        status: 'placeholder',
        usage: '普通に歩く生徒B（配色違い）',
        frameSize: { width: 112, height: 150 },
        frameCount: 4,
        frameRate: 6,
        loop: true,
        transparent: true,
      }),
      hurry: sheet({
        src: '/assets/late/student-hurry.png',
        status: 'placeholder',
        usage: '小走りする生徒',
        frameSize: { width: 112, height: 150 },
        frameCount: 4,
        frameRate: 11,
        loop: true,
        transparent: true,
      }),
      wanderer: sheet({
        src: '/assets/late/student-wanderer.png',
        status: 'placeholder',
        usage: '左右にふらふら動く生徒',
        frameSize: { width: 112, height: 150 },
        frameCount: 4,
        frameRate: 7,
        loop: true,
        transparent: true,
      }),
      swerve: sheet({
        src: '/assets/late/student-swerve.png',
        status: 'placeholder',
        usage: '突然進路変更する生徒（スマホを見ている等）',
        frameSize: { width: 112, height: 150 },
        frameCount: 4,
        frameRate: 8,
        loop: true,
        transparent: true,
      }),
      pair: img({
        src: '/assets/late/student-pair.png',
        status: 'placeholder',
        usage: '横並びの二人組',
        recommendedSize: { width: 200, height: 150 },
        transparent: true,
      }),
      trio: img({
        src: '/assets/late/student-trio.png',
        status: 'placeholder',
        usage: '横並びの三人組',
        recommendedSize: { width: 288, height: 150 },
        transparent: true,
      }),
    },
    se: {
      nearMiss: sfx({
        src: '/assets/late/se-near-miss.wav',
        status: 'placeholder',
        usage: 'ニアミス成立時のヒュッという音',
        approxDurationSec: 0.25,
      }),
      collision: sfx({
        src: '/assets/late/se-collision.wav',
        status: 'placeholder',
        usage: '生徒に衝突した音',
        approxDurationSec: 0.4,
      }),
      combo: sfx({
        src: '/assets/late/se-combo.wav',
        status: 'placeholder',
        usage: 'コンボが伸びたときの上昇音',
        approxDurationSec: 0.3,
      }),
      goal: sfx({
        src: '/assets/late/se-goal.wav',
        status: 'placeholder',
        usage: '校門に到達した歓声／チャイム',
        approxDurationSec: 0.9,
      }),
    },
    bgm: {
      main: bgm({
        src: '/assets/late/bgm-main.wav',
        status: 'placeholder',
        usage: '遅刻回避ステージのBGM（焦り感のある疾走曲）',
        approxDurationSec: 4,
      }),
    },
  },

  /** STAGE 2 - 羽沢パン購入RTA. Background-preloaded during the title screen. */
  bread: {
    background: {
      shop: img({
        src: '/assets/bread/bg-shop.png',
        status: 'placeholder',
        usage: '購買（羽沢）の店内背景',
        recommendedSize: { width: 720, height: 1280 },
        transparent: false,
      }),
    },
    ui: {
      tray: img({
        src: '/assets/bread/ui-tray.png',
        status: 'placeholder',
        usage: 'パンが並ぶトレー／棚の板',
        recommendedSize: { width: 640, height: 96 },
        transparent: true,
      }),
      tag: img({
        src: '/assets/bread/ui-tag.png',
        status: 'placeholder',
        usage: '注文表示パネルの背景',
        recommendedSize: { width: 640, height: 160 },
        transparent: true,
      }),
    },
    /**
     * One entry per product. Adding a bread = add an image here + one row in
     * `src/config/stages/bread.ts`. No stage logic changes. See docs/ASSETS.md.
     */
    item: {
      curry: img(breadImage('item-curry', 'カレーパン')),
      curryHot: img(breadImage('item-curry-hot', '辛口カレーパン')),
      melon: img(breadImage('item-melon', 'メロンパン')),
      melonWhip: img(breadImage('item-melon-whip', 'ホイップメロンパン')),
      an: img(breadImage('item-an', 'あんパン')),
      anUguisu: img(breadImage('item-an-uguisu', 'うぐいすあんパン')),
      cream: img(breadImage('item-cream', 'クリームパン')),
      croissant: img(breadImage('item-croissant', 'クロワッサン')),
      chocoCorone: img(breadImage('item-choco-corone', 'チョココロネ')),
      chocoChip: img(breadImage('item-choco-chip', 'チョコチップパン')),
      yakisoba: img(breadImage('item-yakisoba', '焼きそばパン')),
      koppe: img(breadImage('item-koppe', 'コッペパン')),
      katsuSand: img(breadImage('item-katsu-sand', 'カツサンド')),
      tamagoSand: img(breadImage('item-tamago-sand', 'たまごサンド')),
      hamCheese: img(breadImage('item-ham-cheese', 'ハムチーズサンド')),
      pizza: img(breadImage('item-pizza', 'ピザパン')),
      sugarTwist: img(breadImage('item-sugar-twist', 'シュガーツイスト')),
      milkFrance: img(breadImage('item-milk-france', 'ミルクフランス')),
    },
    se: {
      correct: sfx({
        src: '/assets/bread/se-correct.wav',
        status: 'placeholder',
        usage: '正解時のピンポン音',
        approxDurationSec: 0.3,
      }),
      wrong: sfx({
        src: '/assets/bread/se-wrong.wav',
        status: 'placeholder',
        usage: '誤答時のブブー音',
        approxDurationSec: 0.35,
      }),
      order: sfx({
        src: '/assets/bread/se-order.wav',
        status: 'placeholder',
        usage: '新しい注文が出たときの通知音',
        approxDurationSec: 0.25,
      }),
      combo: sfx({
        src: '/assets/bread/se-combo.wav',
        status: 'placeholder',
        usage: '連続正解時の上昇音',
        approxDurationSec: 0.3,
      }),
    },
    bgm: {
      main: bgm({
        src: '/assets/bread/bgm-main.wav',
        status: 'placeholder',
        usage: 'パン購入RTAのBGM（急かすテンポの曲）',
        approxDurationSec: 4,
      }),
    },
  },

  /**
   * STAGE 3 - 放課後ステルス（見下ろし2D）. Background-preloaded during stage 1.
   *
   * Everything here is drawn TOP-DOWN (真上から見た図). Characters face +X in the
   * source image and are rotated in code, so one direction is all the artwork needs.
   * Floors and the wall are tiled across the map, so they must be seamless.
   */
  teacher: {
    map: {
      floorCorridor: img({
        src: '/assets/teacher/map-floor-corridor.png',
        status: 'placeholder',
        usage: '廊下の床タイル（見下ろし・全面に敷き詰め）',
        recommendedSize: { width: 128, height: 128 },
        transparent: false,
        notes: '【重要】上下左右がシームレスに繋がること。柄が強すぎると先生が見づらくなります。',
      }),
      floorClassroom: img({
        src: '/assets/teacher/map-floor-classroom.png',
        status: 'placeholder',
        usage: '教室の床タイル（見下ろし）',
        recommendedSize: { width: 128, height: 128 },
        transparent: false,
        notes: 'シームレスタイル。廊下と色味を変えて区別できるように。',
      }),
      floorRoom: img({
        src: '/assets/teacher/map-floor-room.png',
        status: 'placeholder',
        usage: '職員室・図書室・ロッカー室などの床タイル（見下ろし）',
        recommendedSize: { width: 128, height: 128 },
        transparent: false,
        notes: 'シームレスタイル。',
      }),
      floorStairs: img({
        src: '/assets/teacher/map-floor-stairs.png',
        status: 'placeholder',
        usage: '階段の床タイル（見下ろし）',
        recommendedSize: { width: 128, height: 128 },
        transparent: false,
        notes: 'シームレスタイル。段が横方向に並ぶ柄を推奨。',
      }),
      floorLobby: img({
        src: '/assets/teacher/map-floor-lobby.png',
        status: 'placeholder',
        usage: '昇降口（ゴール地点）の床タイル（見下ろし）',
        recommendedSize: { width: 128, height: 128 },
        transparent: false,
        notes: 'シームレスタイル。',
      }),
      wall: img({
        src: '/assets/teacher/map-wall.png',
        status: 'placeholder',
        usage: '壁・立入禁止エリアのタイル。視線を遮る場所すべてに敷かれます',
        recommendedSize: { width: 64, height: 64 },
        transparent: false,
        notes: '【重要】床よりはっきり暗く。「ここは通れない／見られない」が一目で分かること。',
      }),
    },
    player: {
      idle: sheet({
        src: '/assets/teacher/player-idle.png',
        status: 'placeholder',
        usage: '主人公（見下ろし・停止中）',
        frameSize: { width: 64, height: 64 },
        frameCount: 2,
        frameRate: 3,
        loop: true,
        transparent: true,
        notes: '真上から見た図。画像内では右（+X）を向き、ゲーム側で回転させます。',
      }),
      walk: sheet({
        src: '/assets/teacher/player-walk.png',
        status: 'placeholder',
        usage: '主人公（見下ろし・歩行）',
        frameSize: { width: 64, height: 64 },
        frameCount: 4,
        frameRate: 10,
        loop: true,
        transparent: true,
        notes: '真上から見た図。画像内では右（+X）を向くこと。',
      }),
    },
    npc: {
      walk: sheet({
        src: '/assets/teacher/npc-walk.png',
        status: 'placeholder',
        usage: '巡回中の先生（見下ろし・歩行）',
        frameSize: { width: 72, height: 72 },
        frameCount: 4,
        frameRate: 8,
        loop: true,
        transparent: true,
        notes: '真上から見た図。右（+X）向き。先生の種類は色（tint）で描き分けます。',
      }),
      wait: img({
        src: '/assets/teacher/npc-wait.png',
        status: 'placeholder',
        usage: '立ち止まって見回している先生（見下ろし）',
        recommendedSize: { width: 72, height: 72 },
        transparent: true,
        notes: '真上から見た図。右（+X）向き。',
      }),
      alert: img({
        src: '/assets/teacher/npc-alert.png',
        status: 'placeholder',
        usage: 'こちらに気づきかけている先生（見下ろし）',
        recommendedSize: { width: 72, height: 72 },
        transparent: true,
        notes: '真上から見た図。歩行版と区別がつく配色に。',
      }),
    },
    objective: {
      marker: img({
        src: '/assets/teacher/objective-marker.png',
        status: 'placeholder',
        usage: '次の目的地マーカー（床に置かれる）',
        recommendedSize: { width: 72, height: 72 },
        transparent: true,
      }),
      exit: img({
        src: '/assets/teacher/objective-exit.png',
        status: 'placeholder',
        usage: '最後に戻る出口（昇降口）のマーカー',
        recommendedSize: { width: 72, height: 72 },
        transparent: true,
      }),
    },
    fx: {
      alert: img({
        src: '/assets/teacher/fx-alert.png',
        status: 'placeholder',
        usage: '発見されかけたときに先生の頭上に出る「!」',
        recommendedSize: { width: 48, height: 48 },
        transparent: true,
      }),
    },
    se: {
      footstep: sfx({
        src: '/assets/teacher/se-footstep.wav',
        status: 'placeholder',
        usage: '主人公の足音（小さめ）',
        approxDurationSec: 0.18,
      }),
      teacherFootstep: sfx({
        src: '/assets/teacher/se-teacher-footstep.wav',
        status: 'placeholder',
        usage: '先生の足音。画面外の先生の位置を音で知らせる重要な手がかりです',
        approxDurationSec: 0.26,
        notes: '距離で音量、左右方向でパンを付けて再生されます。主人公の足音と聞き分けられること。',
      }),
      door: sfx({
        src: '/assets/teacher/se-door.wav',
        status: 'placeholder',
        usage: '先生が部屋から廊下へ出るときのドア音（予兆）',
        approxDurationSec: 0.4,
      }),
      detect: sfx({
        src: '/assets/teacher/se-detect.wav',
        status: 'placeholder',
        usage: '視界に入って検知メーターが動き出した合図',
        approxDurationSec: 0.3,
      }),
      caught: sfx({
        src: '/assets/teacher/se-caught.wav',
        status: 'placeholder',
        usage: '先生に見つかった音（「おい」）',
        approxDurationSec: 0.6,
      }),
      checkpoint: sfx({
        src: '/assets/teacher/se-checkpoint.wav',
        status: 'placeholder',
        usage: '目的地に到達した音',
        approxDurationSec: 0.35,
      }),
      clear: sfx({
        src: '/assets/teacher/se-clear.wav',
        status: 'placeholder',
        usage: '脱出成功（ステージクリア）の音',
        approxDurationSec: 0.9,
      }),
    },
    bgm: {
      main: bgm({
        src: '/assets/teacher/bgm-main.wav',
        status: 'placeholder',
        usage: 'ステルスステージのBGM（緊張感のある静かな曲）',
        approxDurationSec: 4,
      }),
    },
  },
} as const;

export type AssetManifest = typeof assetManifest;
