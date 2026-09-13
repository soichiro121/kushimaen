/**
 * Audio service (Web Audio).
 *
 * Deliberately independent of Phaser's sound manager so the React UI and the game
 * share one mixer, one unlock moment and one set of settings.
 *
 * Autoplay policy: mobile browsers refuse to start an AudioContext until a user
 * gesture. `unlock()` is called from the first START tap; before that, playback
 * requests are simply dropped (never queued - a burst of delayed sounds after the
 * first tap sounds broken).
 */
import { getAudioAsset, assetUrl, type AssetId } from '@/assets/assetRegistry';
import type { AssetBundleId } from '@/assets/assetTypes';
import { allAssets } from '@/assets/assetRegistry';

interface Channels {
  bgm: GainNode;
  se: GainNode;
}

const BGM_FADE_MS = 350;

export class AudioService {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels: Channels | null = null;

  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  private readonly missing = new Set<string>();

  private currentBgmId: AssetId | null = null;
  private currentBgmSource: AudioBufferSourceNode | null = null;
  private currentBgmGain: GainNode | null = null;

  private bgmEnabled = true;
  private seEnabled = true;
  private unlocked = false;

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /**
   * Must be called synchronously inside a user-gesture handler (the START tap).
   * Safe to call repeatedly.
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return;

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no Web Audio: the game stays fully playable, just silent

    if (!this.context) {
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);

      const bgm = this.context.createGain();
      const se = this.context.createGain();
      bgm.gain.value = this.bgmEnabled ? 0.45 : 0;
      se.gain.value = this.seEnabled ? 0.85 : 0;
      bgm.connect(this.master);
      se.connect(this.master);
      this.channels = { bgm, se };
    }

    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => undefined);
    }
    // iOS needs an actual (silent) buffer played inside the gesture to fully unlock.
    const silent = this.context.createBuffer(1, 1, this.context.sampleRate);
    const source = this.context.createBufferSource();
    source.buffer = silent;
    source.connect(this.context.destination);
    source.start(0);

    this.unlocked = this.context.state === 'running';
  }

  setBgmEnabled(enabled: boolean): void {
    this.bgmEnabled = enabled;
    if (this.channels) this.rampTo(this.channels.bgm, enabled ? 0.45 : 0);
    if (!enabled) this.stopBgm(200);
    else if (this.currentBgmId) this.playBgm(this.currentBgmId);
  }

  setSeEnabled(enabled: boolean): void {
    this.seEnabled = enabled;
    if (this.channels) this.rampTo(this.channels.se, enabled ? 0.85 : 0);
  }

  /** Fetch + decode. Failures are logged once and then silently ignored. */
  private async load(id: AssetId): Promise<AudioBuffer | null> {
    if (this.buffers.has(id)) return this.buffers.get(id) ?? null;
    if (this.missing.has(id)) return null;

    const existing = this.pending.get(id);
    if (existing) return existing;

    const context = this.context;
    if (!context) return null;

    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(assetUrl(id));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        this.buffers.set(id, buffer);
        return buffer;
      } catch (error) {
        this.missing.add(id);
        console.error(`Missing asset: ${id} (${assetUrl(id)})`, error);
        return null;
      } finally {
        this.pending.delete(id);
      }
    })();

    this.pending.set(id, task);
    return task;
  }

  /** Warms the decode cache for a bundle. Never rejects. */
  async preloadBundle(bundle: AssetBundleId): Promise<void> {
    if (!this.context) return;
    const audioIds = allAssets()
      .filter((asset) => asset.bundle === bundle && asset.definition.kind === 'audio')
      .map((asset) => asset.id as AssetId);
    await Promise.all(audioIds.map((id) => this.load(id)));
  }

  /**
   * `pan` (-1 left .. 1 right) is what lets stage 3 place an off-screen teacher's
   * footsteps. It degrades to plain mono where `StereoPannerNode` is missing, and
   * no gameplay ever depends on hearing it (requirement 26).
   */
  playSe(id: AssetId, options: { volume?: number; rate?: number; pan?: number } = {}): void {
    if (!this.unlocked || !this.seEnabled || !this.context || !this.channels) return;
    void this.playBuffered(id, this.channels.se, {
      loop: false,
      volume: options.volume ?? 1,
      rate: options.rate ?? 1,
      pan: options.pan ?? 0,
    });
  }

  playBgm(id: AssetId): void {
    const asset = getAudioAsset(id);
    if (asset.channel !== 'bgm') {
      console.warn(`playBgm("${id}") was given an SE asset.`);
    }
    this.currentBgmId = id;
    if (!this.unlocked || !this.bgmEnabled || !this.context || !this.channels) return;

    this.stopBgm(BGM_FADE_MS);
    const gain = this.context.createGain();
    gain.gain.value = 1;
    gain.connect(this.channels.bgm);
    void this.playBuffered(id, gain, { loop: true, volume: 1, rate: 1 }).then((source) => {
      if (!source) {
        gain.disconnect();
        return;
      }
      // A newer track may have started while this one was decoding.
      if (this.currentBgmId !== id) {
        try {
          source.stop();
        } catch {
          /* not started */
        }
        gain.disconnect();
        return;
      }
      this.currentBgmSource = source;
      this.currentBgmGain = gain;
    });
  }

  stopBgm(fadeMs = BGM_FADE_MS): void {
    const source = this.currentBgmSource;
    const gain = this.currentBgmGain;
    if (!source || !this.context) return;
    this.currentBgmSource = null;
    this.currentBgmGain = null;

    const stopAt = this.context.currentTime + fadeMs / 1000;
    if (gain) {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, this.context.currentTime);
      gain.gain.linearRampToValueAtTime(0, stopAt);
    }
    try {
      source.stop(stopAt);
    } catch {
      /* already stopped */
    }
    source.onended = () => gain?.disconnect();
  }

  /** Pauses everything when the app goes to the background. */
  suspend(): void {
    void this.context?.suspend().catch(() => undefined);
  }

  resume(): void {
    void this.context?.resume().catch(() => undefined);
  }

  private async playBuffered(
    id: AssetId,
    destination: GainNode,
    options: { loop: boolean; volume: number; rate: number; pan?: number },
  ): Promise<AudioBufferSourceNode | null> {
    const context = this.context;
    if (!context) return null;

    const buffer = await this.load(id);
    if (!buffer || !this.context) return null;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop;
    source.playbackRate.value = options.rate;

    let node: AudioNode = source;
    if (options.volume !== 1) {
      const gain = context.createGain();
      gain.gain.value = options.volume;
      node.connect(gain);
      node = gain;
    }
    const pan = options.pan ?? 0;
    if (pan !== 0 && typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      node = panner;
    }
    node.connect(destination);
    source.start(0);
    return source;
  }

  private rampTo(node: GainNode, value: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(value, now + 0.12);
  }
}

/** One mixer for the whole app. */
export const audioService = new AudioService();
