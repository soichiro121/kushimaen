/**
 * Generates `docs/ASSETS.md` from the manifest.
 *
 *   npm run assets:docs
 *
 * The asset guide is generated rather than hand-written so it can never drift from
 * the code. Whoever produces the real artwork reads that file; whoever edits
 * `assetManifest.ts` regenerates it.
 *
 * Run through vite-node so it sees the same TypeScript, aliases and manifest the app
 * does. BUILD-TIME ONLY.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allAssets, assetStats } from '../src/assets/assetRegistry';
import { BREAD_ITEMS } from '../src/config/stages/bread';
import type { AssetBundleId, AssetDefinition } from '../src/assets/assetTypes';

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, 'public');
const OUTPUT = join(ROOT, 'docs', 'ASSETS.md');

const BUNDLE_TITLES: Record<AssetBundleId, string> = {
  common: '共通（UI・エフェクト・共通SE/BGM）',
  late: 'ステージ1: 遅刻回避',
  bread: 'ステージ2: 羽沢パン購入RTA',
  teacher: 'ステージ3: 放課後ステルス（見下ろし2D）',
};

/** Reads width/height from a PNG header, so the table shows what is really there. */
function pngSize(path: string): string {
  if (!existsSync(path)) return '**ファイルなし**';
  const buffer = readFileSync(path);
  const isPng = buffer
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return '-';
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

function requirement(definition: AssetDefinition): string {
  switch (definition.kind) {
    case 'image':
      return (
        `${definition.recommendedSize.width}x${definition.recommendedSize.height}` +
        (definition.transparent ? ' / 透過必須' : ' / 透過不要')
      );
    case 'spritesheet':
      return (
        `${definition.frameCount} frames x ${definition.frameSize.width}x${definition.frameSize.height}` +
        ` / 横一列 / ${definition.frameRate}fps` +
        (definition.loop ? ' / ループ' : ' / 単発') +
        (definition.transparent ? ' / 透過必須' : '')
      );
    case 'audio':
      return (
        `${definition.channel.toUpperCase()}` +
        (definition.approxDurationSec ? ` / 約${definition.approxDurationSec}秒` : '') +
        (definition.loop ? ' / ループ' : '')
      );
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function build(): string {
  const assets = allAssets();
  const stats = assetStats();
  const lines: string[] = [];

  lines.push('# アセット差し替えガイド');
  lines.push('');
  lines.push('> **このファイルは自動生成です。** `npm run assets:docs` で再生成してください。');
  lines.push('> 元データは [`src/assets/assetManifest.ts`](../src/assets/assetManifest.ts) です。');
  lines.push('');
  lines.push(
    `現在 **${stats.total}** 件のアセットがあり、うち **${stats.placeholder}** 件が仮素材（TODO_ASSET）です。`,
  );
  lines.push('');

  lines.push('## 差し替え方法（コードの知識は不要です）');
  lines.push('');
  lines.push('### 方法A: ファイルを上書きする（いちばん簡単）');
  lines.push('');
  lines.push('1. 下の表から差し替えたい行を探します。');
  lines.push('2. 「現在のファイル」の場所に、**同じファイル名で**新しい画像/音声を置きます。');
  lines.push('   例: `public/assets/late/bg-private-road.png` を本物の私道写真に置き換える。');
  lines.push("3. `src/assets/assetManifest.ts` の該当エントリで `status: 'placeholder'` を");
  lines.push(
    "   `status: 'final'` に変更します。サイズが変わった場合は推奨サイズの数値も直します。",
  );
  lines.push('4. `npm run assets:docs` を実行してこの表を更新します。');
  lines.push('');
  lines.push('### 方法A2: 写真から作る（背景の白抜きを自動でやります）');
  lines.push('');
  lines.push('商品や人物の**写真**を渡す場合は、白背景で撮った元画像を `assets-src/` に');
  lines.push('置いて、テーブルを1行足すだけです。');
  lines.push('');
  lines.push('```bash');
  lines.push('cp 新しい写真.jpg assets-src/bread-anpan.jpg');
  lines.push('# scripts/lib/source-assets.mjs に1行追加してから');
  lines.push('npm run assets:source');
  lines.push('```');
  lines.push('');
  lines.push('背景の白は**画像の縁から繋がっている部分だけ**が消えます。パッケージに');
  lines.push('印刷された白いラベルは囲まれているので穴が空きません。切り抜きの縁は');
  lines.push('ぼかされ、被写体の色をにじませてあるので白フチも出ません。');
  lines.push('');
  lines.push('元画像はリポジトリに残るので、サイズを変えたくなったら再生成できます。');
  lines.push('`npm run assets:placeholders` は**写真由来のファイルを上書きしません**。');
  lines.push('');

  lines.push('### 方法B: 別のファイル名・別の形式にする');
  lines.push('');
  lines.push(
    '1. 新しいファイルを `public/assets/<バンドル>/` に置きます（`.webp` や `.avif` も可）。',
  );
  lines.push('2. `src/assets/assetManifest.ts` の該当エントリの **`src` だけ** を書き換えます。');
  lines.push('');
  lines.push('```ts');
  lines.push('late: {');
  lines.push('  background: {');
  lines.push('    privateRoad: img({');
  lines.push("      src: '/assets/late/private-road.webp', // ← ここだけ変更");
  lines.push("      status: 'final',                       // ← 仮素材でなくなったら変更");
  lines.push('      // ...');
  lines.push('    }),');
  lines.push('  },');
  lines.push('},');
  lines.push('```');
  lines.push('');
  lines.push(
    '**どちらの方法でも、ゲームのコード（ステージ・シーン・React）を触る必要はありません。**',
  );
  lines.push('ゲーム側は `late.background.privateRoad` という Asset ID しか知らないためです。');
  lines.push('');

  lines.push('## 確認方法');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run assets   # 仮素材 → 写真 → この表、をまとめて再生成');
  lines.push('npm run dev');
  lines.push('```');
  lines.push('');
  lines.push(
    '- <http://localhost:5173/dev/assets> … 全アセットの一覧。市松模様の背景に表示されるので、',
  );
  lines.push('  透過の有無・切り抜き漏れ・アスペクト比がひと目で分かります。読み込みに失敗した');
  lines.push('  アセットは赤く表示されます。');
  lines.push(
    '- <http://localhost:5173/dev> … 各ステージを単体で起動して実際の見た目を確認できます。',
  );
  lines.push('');
  lines.push(
    '`npm test` でも、マニフェストの宣言サイズと実ファイルのサイズが一致するか検証されます。',
  );
  lines.push('');

  lines.push('## 用語');
  lines.push('');
  lines.push('| 用語 | 意味 |');
  lines.push('| --- | --- |');
  lines.push('| Asset ID | ゲーム内部での論理名。ファイル名が変わっても ID は変わりません。 |');
  lines.push('| TODO_ASSET | 仮素材。本物に差し替える対象です。 |');
  lines.push('| spritesheet | コマを**横一列**に並べた1枚の画像。左端が1コマ目。 |');
  lines.push('| 透過必須 | 背景が透明な PNG / WebP が必要（キャラクターなど）。 |');
  lines.push('');

  for (const bundle of ['common', 'late', 'bread', 'teacher'] as AssetBundleId[]) {
    const group = assets.filter((asset) => asset.bundle === bundle);
    if (group.length === 0) continue;

    const bundleStats = stats.byBundle[bundle];
    lines.push(`## ${BUNDLE_TITLES[bundle]}`);
    lines.push('');
    lines.push(`${group.length} 件（仮素材 ${bundleStats?.placeholder ?? 0} 件）`);
    lines.push('');
    lines.push('| Asset ID | 用途 | 現在のファイル | 実サイズ | 必要な仕様 | 状態 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');

    for (const asset of group) {
      const { definition } = asset;
      const actual =
        definition.kind === 'audio'
          ? '-'
          : pngSize(join(PUBLIC_DIR, definition.src.replace(/^\//, '')));
      const status = definition.status === 'placeholder' ? '**TODO_ASSET**' : 'final';
      lines.push(
        `| \`${asset.id}\` | ${escapeCell(definition.usage)} | \`${definition.src}\` | ${actual} | ${escapeCell(requirement(definition))} | ${status} |`,
      );
    }
    lines.push('');

    const notes = group.filter((asset) => asset.definition.notes);
    if (notes.length > 0) {
      lines.push('### 制作上の注意');
      lines.push('');
      for (const asset of notes) {
        lines.push(`- \`${asset.id}\` … ${asset.definition.notes}`);
      }
      lines.push('');
    }
  }

  lines.push('## ステージ3の校内マップを差し替える');
  lines.push('');
  lines.push('ステージ3は**背景画像1枚**ではなく、床タイルを敷いた見下ろしマップです。');
  lines.push('校舎の形そのものは画像ではなく**データ**なので、差し替えは2段階に分かれます。');
  lines.push('');
  lines.push('### 見た目だけ変える');
  lines.push('');
  lines.push('上の表の `teacher.map.*` を差し替えます。床と壁はマップ全面にタイリングされる');
  lines.push('ので、**上下左右がシームレスに繋がる**画像にしてください。');
  lines.push('');
  lines.push('### 校舎の形も変える');
  lines.push('');
  lines.push('```text');
  lines.push('src/config/stages/teacher/maps/');
  lines.push('  komabaPlaceholder.ts   ← 今の仮マップ');
  lines.push('  index.ts               ← ここに1行足して DEFAULT_MAP_ID を向ける');
  lines.push('```');
  lines.push('');
  lines.push('マップは軸平行な矩形だけで書きます（`bounds` / `areas` / `walls` /');
  lines.push('`waypoints` / `edges` / `checkpoints` / `patrols` / `missions`）。');
  lines.push('**ゲームのコードは特定のマップを知りません。** 詳細は');
  lines.push('[GAME_DESIGN.md](./GAME_DESIGN.md) の「マップを差し替える」を参照してください。');
  lines.push('');
  lines.push('`npm test` が、壁に埋まった目的地・壁を突っ切る巡回ルート・出口に到達しない');
  lines.push('ミッションをすべて検出します。');
  lines.push('');

  lines.push('## パンを追加する');
  lines.push('');
  lines.push('ステージ2の商品はデータ駆動です。ゲームロジックの変更は不要です。');
  lines.push('');
  lines.push('1. 画像を `public/assets/bread/item-<id>.png`（192x192・透過）に置く。');
  lines.push('2. `src/assets/assetManifest.ts` の `bread.item` に1行追加する。');
  lines.push('3. `src/config/stages/bread.ts` の `BREAD_ITEMS` に1行追加する。');
  lines.push('');
  lines.push('```ts');
  lines.push("{ id: 'shioPan', name: '塩パン', assetId: 'bread.item.shioPan',");
  lines.push("  family: 'long', tags: ['パン'], difficulty: 2 },");
  lines.push('```');
  lines.push('');
  lines.push('`family` が同じ商品は「見分けにくい商品」として後半の問題に混ぜられます。');
  lines.push('');
  lines.push(`現在の商品は ${BREAD_ITEMS.length} 種類です。`);
  lines.push('');
  lines.push('| id | 商品名 | Asset ID | family | 難易度 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of BREAD_ITEMS) {
    lines.push(
      `| \`${item.id}\` | ${item.name} | \`${item.assetId}\` | ${item.family} | ${item.difficulty} |`,
    );
  }
  lines.push('');

  lines.push('## 本番用の書き出し設定');
  lines.push('');
  lines.push('| 種類 | 推奨形式 | 備考 |');
  lines.push('| --- | --- | --- |');
  lines.push('| 背景 | WebP（または AVIF） | 品質80前後。巨大な元データをそのまま置かないこと。 |');
  lines.push(
    '| キャラクター・UI | WebP（透過）または PNG-8/24 | 透過が必要なものは必ずアルファ付きで。 |',
  );
  lines.push('| スプライトシート | PNG または WebP | コマを横一列に。余白サイズは全コマ共通に。 |');
  lines.push('| SE | .m4a（AAC）+ .ogg | 44.1kHz / モノラルで十分。 |');
  lines.push('| BGM | .m4a（AAC）+ .ogg | 60〜90秒のシームレスループ。128kbps 程度。 |');
  lines.push('');
  lines.push(
    '> 現在の仮素材は PNG と非圧縮 WAV です。WAV は本番では必ず圧縮形式に差し替えてください。',
  );
  lines.push('');
  lines.push('## 読み込みに失敗したとき');
  lines.push('');
  lines.push(
    '`src` の指すファイルが無い場合でもゲームは落ちません。代替テクスチャ（マゼンタの市松模様）が',
  );
  lines.push('表示され、コンソールに次のログが出ます。');
  lines.push('');
  lines.push('```text');
  lines.push('Missing asset: late.student.normal01 (/assets/late/student-normal01.png)');
  lines.push('```');
  lines.push('');
  lines.push(
    '`?debug=1` を付けて起動すると、読み込みに失敗した Asset ID が画面にも一覧表示されます。',
  );
  lines.push('');

  return lines.join('\n');
}

writeFileSync(OUTPUT, build(), 'utf8');
console.info(`[assets:docs] wrote ${OUTPUT}`);
