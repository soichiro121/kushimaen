/**
 * Stage select (`/dev`).
 *
 * Launches any mini-game directly, which is the fastest way to check a stage after
 * swapping its artwork. Disabled stages are listed too, marked as such, so a feature
 * flag can be verified without editing the build.
 */
import { useState } from 'react';
import { allStageModules, playableStages } from '@/game/stages';
import { SCHOOL_MAPS, DEFAULT_MAP_ID, getSchoolMap } from '@/config/stages/teacher';
import { setTeacherOverrides, teacherOverrides } from '@/dev/stageOverrides';
import { GAME_CONFIG } from '@/config/game';
import { assetStats } from '@/assets/assetRegistry';
import { audioService } from '@/services/audio/AudioService';
import { useRunStore } from '@/stores/runStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Screen, ScreenBody, ScreenTitle } from '@/components/ui/Screen';
import styles from './Dev.module.css';

export function StageSelect({ onLaunch }: { onLaunch(): void }) {
  const startDevStage = useRunStore((state) => state.startDevStage);
  const [overrides, setOverrides] = useState(() => ({ ...teacherOverrides() }));
  const setNickname = useSettingsStore((state) => state.setNickname);
  const nickname = useSettingsStore((state) => state.nickname);
  const stats = assetStats();
  const playable = playableStages();

  async function launch(index: number): Promise<void> {
    await audioService.unlock();
    useSettingsStore.getState().applyToServices();
    if (!nickname) setNickname('DEV');
    // Await the run before swapping in the app shell, otherwise the loading screen
    // mounts first and its completion would bounce us back to the title.
    await startDevStage(index);
    onLaunch();
  }

  return (
    <Screen>
      <ScreenTitle subtitle="開発用。production build には含まれません。">
        DEV / Stage Select
      </ScreenTitle>

      <ScreenBody scroll>
        <Panel heading="ステージ" className={styles.block}>
          <div className={styles.list}>
            {allStageModules().map((stage) => {
              const index = playable.findIndex((candidate) => candidate.id === stage.id);
              const enabled = index >= 0;
              return (
                <div key={stage.id} className={styles.row}>
                  <div>
                    <p className={styles.rowTitle}>
                      {stage.label}
                      {enabled ? '' : '（無効）'}
                    </p>
                    <p className={styles.rowMeta}>
                      id: {stage.id} ・ bundles: {stage.bundles.join(', ')}
                    </p>
                  </div>
                  <Button
                    variant={enabled ? 'primary' : 'secondary'}
                    disabled={!enabled}
                    onClick={() => void launch(index)}
                  >
                    起動
                  </Button>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel heading="Round 3 オプション（開発用）" className={styles.block}>
          <Round3Options
            value={overrides}
            onChange={(next) => {
              setTeacherOverrides(next);
              setOverrides({ ...teacherOverrides() });
            }}
          />
        </Panel>

        <Panel heading="ビルド情報" className={styles.block}>
          <dl className={styles.info}>
            <div>
              <dt>title</dt>
              <dd>{GAME_CONFIG.title}</dd>
            </div>
            <div>
              <dt>configVersion</dt>
              <dd>{GAME_CONFIG.configVersion}</dd>
            </div>
            <div>
              <dt>difficultyScale</dt>
              <dd>{GAME_CONFIG.difficultyScale}</dd>
            </div>
            <div>
              <dt>assets</dt>
              <dd>
                {stats.total} 件（placeholder {stats.placeholder} / final {stats.final}）
              </dd>
            </div>
          </dl>
        </Panel>

        <div className={styles.links}>
          <a className={styles.link} href="./assets">
            /dev/assets — アセット一覧
          </a>
          <a className={styles.link} href="../?debug=1">
            通常プレイ（debug オーバーレイ付き）
          </a>
        </div>
      </ScreenBody>
    </Screen>
  );
}

/**
 * Round 3 dev switches (requirement 51): pick the map, force a mission pattern, pin
 * the seed, thin out the teachers, toggle the vision cones.
 *
 * These write into `stageOverrides`, which is inert in a production build - so none
 * of this can be used to fish for an easy seed on the live site.
 */
function Round3Options({
  value,
  onChange,
}: {
  value: ReturnType<typeof teacherOverrides>;
  onChange(next: Record<string, unknown>): void;
}) {
  const mapId = value.mapId ?? DEFAULT_MAP_ID;
  const map = getSchoolMap(mapId);

  return (
    <div className={styles.list}>
      <label className={styles.row}>
        <span className={styles.rowTitle}>マップ</span>
        <select value={mapId} onChange={(event) => onChange({ mapId: event.target.value })}>
          {Object.values(SCHOOL_MAPS).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.row}>
        <span className={styles.rowTitle}>ミッション</span>
        <select
          value={value.missionId ?? ''}
          onChange={(event) => onChange({ missionId: event.target.value || undefined })}
        >
          <option value="">seed まかせ</option>
          {map.missions.map((mission) => (
            <option key={mission.id} value={mission.id}>
              {mission.id} — {mission.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.row}>
        <span className={styles.rowTitle}>seed 固定</span>
        <input
          type="number"
          min={0}
          placeholder="空欄 = ランダム"
          value={value.seed ?? ''}
          onChange={(event) =>
            onChange({ seed: event.target.value === '' ? undefined : Number(event.target.value) })
          }
        />
      </label>

      <label className={styles.row}>
        <span className={styles.rowTitle}>先生の人数</span>
        <select
          value={value.teacherCount ?? map.patrols.length}
          onChange={(event) => onChange({ teacherCount: Number(event.target.value) })}
        >
          {Array.from({ length: map.patrols.length + 1 }, (_, count) => (
            <option key={count} value={count}>
              {count} 人
            </option>
          ))}
        </select>
      </label>

      <label className={styles.row}>
        <span className={styles.rowTitle}>視界を表示</span>
        <input
          type="checkbox"
          checked={value.showVisionCone ?? true}
          onChange={(event) => onChange({ showVisionCone: event.target.checked })}
        />
      </label>

      <p className={styles.rowMeta}>
        URL でも指定できます:{' '}
        <code>?t3map= / ?t3mission= / ?t3seed= / ?t3teachers= / ?t3cone=</code>
      </p>
    </div>
  );
}
