/**
 * Asset browser (`/dev/assets`).
 *
 * This is the page the artwork swap is verified on. For every Asset ID it shows:
 *   - the image as the game will load it (on a checkerboard, so transparency is
 *     obvious and a missing alpha channel is immediately visible),
 *   - the file it currently points at,
 *   - the recommended size versus the size actually on disk,
 *   - whether it is still a placeholder,
 *   - spritesheets split into their individual frames,
 *   - a play button for every sound.
 *
 * A red card means the file failed to load - i.e. the manifest points at something
 * that is not there.
 */
import { useEffect, useMemo, useState } from 'react';
import { allAssets, assetStats, assetUrl, type AssetId } from '@/assets/assetRegistry';
import type { AssetBundleId, AssetDefinition } from '@/assets/assetTypes';
import { audioService } from '@/services/audio/AudioService';
import { Button } from '@/components/ui/Button';
import { Screen, ScreenBody, ScreenTitle } from '@/components/ui/Screen';
import styles from './Dev.module.css';

type Filter = 'all' | 'placeholder' | 'final' | 'broken';

interface Measurement {
  width: number;
  height: number;
  ok: boolean;
}

export function AssetBrowser() {
  const assets = useMemo(() => allAssets(), []);
  const stats = useMemo(() => assetStats(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [measured, setMeasured] = useState<Record<string, Measurement>>({});

  // Measure the real file dimensions so a mismatch with the manifest is visible.
  useEffect(() => {
    let cancelled = false;
    const imageAssets = assets.filter((asset) => asset.definition.kind !== 'audio');

    for (const asset of imageAssets) {
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        setMeasured((current) => ({
          ...current,
          [asset.id]: { width: image.naturalWidth, height: image.naturalHeight, ok: true },
        }));
      };
      image.onerror = () => {
        if (cancelled) return;
        console.error(`Missing asset: ${asset.id} (${assetUrl(asset.id as AssetId)})`);
        setMeasured((current) => ({ ...current, [asset.id]: { width: 0, height: 0, ok: false } }));
      };
      image.src = assetUrl(asset.id as AssetId);
    }

    return () => {
      cancelled = true;
    };
  }, [assets]);

  const visible = assets.filter((asset) => {
    if (filter === 'all') return true;
    if (filter === 'broken') return measured[asset.id]?.ok === false;
    return asset.definition.status === filter;
  });

  const bundles = [...new Set(visible.map((asset) => asset.bundle))] as AssetBundleId[];

  return (
    <Screen>
      <ScreenTitle
        subtitle={`${stats.total} 件 / placeholder ${stats.placeholder} 件。差し替え手順は docs/ASSETS.md を参照。`}
      >
        DEV / Assets
      </ScreenTitle>

      <div className={styles.filters}>
        {(['all', 'placeholder', 'final', 'broken'] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`${styles.filter} ${filter === option ? styles.filterActive : ''}`}
            onClick={() => setFilter(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <ScreenBody scroll>
        {bundles.map((bundle) => (
          <section key={bundle} className={styles.block}>
            <h2 className={styles.bundleHeading}>{bundle}</h2>
            <div className={styles.grid}>
              {visible
                .filter((asset) => asset.bundle === bundle)
                .map((asset) => (
                  <AssetCard
                    key={asset.id}
                    id={asset.id}
                    definition={asset.definition}
                    measurement={measured[asset.id]}
                  />
                ))}
            </div>
          </section>
        ))}
        {visible.length === 0 ? (
          <p className={styles.empty}>該当するアセットはありません。</p>
        ) : null}
      </ScreenBody>
    </Screen>
  );
}

function AssetCard({
  id,
  definition,
  measurement,
}: {
  id: string;
  definition: AssetDefinition;
  measurement?: Measurement;
}) {
  const url = assetUrl(id as AssetId);
  const broken = measurement?.ok === false;

  return (
    <article className={`${styles.card} ${broken ? styles.cardBroken : ''}`}>
      <div className={styles.preview}>
        {definition.kind === 'audio' ? (
          <AudioPreview id={id as AssetId} />
        ) : definition.kind === 'spritesheet' ? (
          <SpritesheetPreview url={url} definition={definition} />
        ) : (
          <img className={styles.image} src={url} alt={id} loading="lazy" />
        )}
      </div>

      <p className={styles.cardId}>{id}</p>
      <p className={styles.cardUsage}>{definition.usage}</p>

      <dl className={styles.cardMeta}>
        <div>
          <dt>file</dt>
          <dd className={styles.mono}>{definition.src}</dd>
        </div>
        <div>
          <dt>status</dt>
          <dd className={definition.status === 'placeholder' ? styles.todo : styles.final}>
            {definition.status === 'placeholder' ? 'TODO_ASSET' : 'final'}
          </dd>
        </div>
        {definition.kind === 'image' ? (
          <div>
            <dt>size</dt>
            <dd className={styles.mono}>
              {measurement ? `${measurement.width}x${measurement.height}` : '…'} / 推奨{' '}
              {definition.recommendedSize.width}x{definition.recommendedSize.height}
              {definition.transparent ? ' ・透過必須' : ''}
            </dd>
          </div>
        ) : null}
        {definition.kind === 'spritesheet' ? (
          <div>
            <dt>frames</dt>
            <dd className={styles.mono}>
              {definition.frameCount} frames @ {definition.frameSize.width}x
              {definition.frameSize.height} ・ {definition.frameRate}fps
              {measurement ? ` / 実ファイル ${measurement.width}x${measurement.height}` : ''}
            </dd>
          </div>
        ) : null}
        {definition.notes ? (
          <div>
            <dt>note</dt>
            <dd>{definition.notes}</dd>
          </div>
        ) : null}
      </dl>

      {broken ? <p className={styles.brokenLabel}>読み込み失敗（ファイルが存在しません）</p> : null}
    </article>
  );
}

/** Splits a sheet into frames using background-position, so frame errors are obvious. */
function SpritesheetPreview({
  url,
  definition,
}: {
  url: string;
  definition: Extract<AssetDefinition, { kind: 'spritesheet' }>;
}) {
  const display = 64;
  const scale = display / definition.frameSize.width;

  return (
    <div className={styles.frames}>
      {Array.from({ length: definition.frameCount }, (_, index) => (
        <span
          key={index}
          className={styles.frame}
          style={{
            width: display,
            height: definition.frameSize.height * scale,
            backgroundImage: `url(${url})`,
            backgroundSize: `${definition.frameSize.width * definition.frameCount * scale}px ${definition.frameSize.height * scale}px`,
            backgroundPosition: `-${index * display}px 0`,
          }}
        />
      ))}
    </div>
  );
}

function AudioPreview({ id }: { id: AssetId }) {
  return (
    <Button
      variant="secondary"
      sound={false}
      onClick={() => {
        void audioService.unlock().then(() => audioService.playSe(id));
      }}
    >
      ▶ 再生
    </Button>
  );
}
