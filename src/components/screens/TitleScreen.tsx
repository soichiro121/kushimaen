/**
 * Title screen.
 *
 * The START button is also the audio unlock moment: mobile browsers only allow an
 * AudioContext to start inside a user gesture, so `unlock()` is called here before
 * anything else happens.
 */
import { useState } from 'react';
import { GAME_CONFIG } from '@/config/game';
import { assetUrl } from '@/assets/assetRegistry';
import { audioService } from '@/services/audio/AudioService';
import { currentBackendMode } from '@/services/backendMode';
import { useRunStore } from '@/stores/runStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { playableStages } from '@/game/stages';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { SettingsSheet } from '@/components/screens/SettingsSheet';
import styles from './TitleScreen.module.css';

export function TitleScreen() {
  const requestStart = useRunStore((state) => state.requestStart);
  const showLeaderboard = useRunStore((state) => state.showLeaderboard);
  const nickname = useSettingsStore((state) => state.nickname);
  const applyToServices = useSettingsStore((state) => state.applyToServices);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const stages = playableStages();

  async function handleStart(): Promise<void> {
    if (starting) return;
    setStarting(true);
    // Must happen inside the gesture, before any await that could break the chain.
    await audioService.unlock();
    applyToServices();
    audioService.playSe('common.se.start');
    requestStart();
  }

  return (
    <Screen centered>
      <div className={styles.wrap}>
        <img
          className={styles.logo}
          src={assetUrl('common.ui.logo')}
          alt={GAME_CONFIG.title}
          width={720}
          height={320}
        />
        <p className={styles.subtitle}>{GAME_CONFIG.subtitle}</p>

        <ol className={styles.stageList}>
          {stages.map((stage, index) => (
            <li key={stage.id}>
              <span className={styles.stageIndex}>{index + 1}</span>
              <span className={styles.stageName}>{stage.label}</span>
              <span className={styles.stageTagline}>{stage.tagline}</span>
            </li>
          ))}
        </ol>

        <div className={styles.actions}>
          <Button large block sound={false} onClick={() => void handleStart()} disabled={starting}>
            {starting ? '準備中…' : 'START'}
          </Button>
          <div className={styles.secondaryRow}>
            <Button variant="secondary" onClick={showLeaderboard}>
              ランキング
            </Button>
            <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
              設定
            </Button>
          </div>
        </div>

        <p className={styles.meta}>
          {nickname ? `プレイヤー: ${nickname}` : 'はじめる前にニックネームを入力します'}
          {currentBackendMode() === 'local' ? ' ・ LOCAL MODE' : ''}
        </p>
      </div>

      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
    </Screen>
  );
}
