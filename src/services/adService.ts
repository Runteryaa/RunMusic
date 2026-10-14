import mobileAds, {
  MaxAdContentRating,
  TestIds,
  InterstitialAd,
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import TrackPlayer, { State } from 'react-native-track-player';

/**
 * AdMob Ad Unit IDs
 * When moving to real production AdMob ads, replace these test IDs with your AdMob Ad Unit IDs.
 */
export const AD_UNIT_IDS = {
  // Adaptive Banner Ad
  BANNER: TestIds.ADAPTIVE_BANNER,
  // Standard Interstitial Ad
  INTERSTITIAL: TestIds.INTERSTITIAL,
  // Rewarded Video Ad (Theme unlock, etc.)
  REWARDED: TestIds.REWARDED,
};

let isInitialized = false;
let interstitialInstance: InterstitialAd | null = null;
let isInterstitialLoaded = false;
let lastInterstitialTime = 0;
const INTERSTITIAL_COOLDOWN_MS = 180000; // 3 minutes cooldown between interstitials

let rewardedInstance: RewardedAd | null = null;
let isRewardedLoaded = false;
let isRewardedLoading = false;

/**
 * Initializes Google Mobile Ads SDK safely
 */
export async function initAdService(): Promise<void> {
  if (isInitialized) return;
  try {
    await mobileAds().setRequestConfiguration({
      maxAdContentRating: MaxAdContentRating.G,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
    await mobileAds().initialize();
    isInitialized = true;
    console.log('[AdService] Google Mobile Ads initialized successfully');
    preloadInterstitial();
    preloadRewardedAd();
  } catch (err) {
    console.warn('[AdService] Failed to initialize Mobile Ads:', err);
  }
}

/**
 * Preload interstitial ad in the background
 */
export function preloadInterstitial(): void {
  try {
    if (interstitialInstance) {
      interstitialInstance.removeAllListeners();
      interstitialInstance = null;
    }

    const interstitial = InterstitialAd.createForAdRequest(AD_UNIT_IDS.INTERSTITIAL, {
      requestNonPersonalizedAdsOnly: true,
    });

    interstitial.addAdEventListener(AdEventType.LOADED, () => {
      isInterstitialLoaded = true;
    });

    interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      isInterstitialLoaded = false;
      interstitialInstance = null;
      // Preload next one
      setTimeout(() => {
        preloadInterstitial();
      }, 5000);
    });

    interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
      console.log('[AdService] Interstitial error:', error);
      isInterstitialLoaded = false;
      interstitialInstance = null;
    });

    interstitialInstance = interstitial;
    interstitial.load();
  } catch (err) {
    console.warn('[AdService] Error preloading interstitial:', err);
  }
}

/**
 * Shows an interstitial ad if loaded and cooldown period has passed.
 * Returns true if the ad was shown.
 */
export function showInterstitialIfReady(): boolean {
  const now = Date.now();
  if (!isInterstitialLoaded || !interstitialInstance) {
    preloadInterstitial();
    return false;
  }

  if (now - lastInterstitialTime < INTERSTITIAL_COOLDOWN_MS) {
    return false;
  }

  try {
    interstitialInstance.show();
    lastInterstitialTime = now;
    return true;
  } catch (err) {
    console.warn('[AdService] Failed to show interstitial ad:', err);
    return false;
  }
}

/**
 * Force shows the preloaded test interstitial ad (ignoring cooldown) for testing purposes
 */
export function showTestInterstitial(): boolean {
  if (interstitialInstance && isInterstitialLoaded) {
    try {
      interstitialInstance.show();
      lastInterstitialTime = Date.now();
      return true;
    } catch (err) {
      console.warn('[AdService] Error showing test interstitial:', err);
      return false;
    }
  }
  preloadInterstitial();
  return false;
}

/**
 * Preload rewarded ad in the background
 */
export function preloadRewardedAd(): void {
  if (isRewardedLoaded || isRewardedLoading) return;
  try {
    isRewardedLoading = true;
    if (rewardedInstance) {
      rewardedInstance.removeAllListeners();
      rewardedInstance = null;
    }

    const rewarded = RewardedAd.createForAdRequest(AD_UNIT_IDS.REWARDED, {
      requestNonPersonalizedAdsOnly: true,
    });

    rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      isRewardedLoaded = true;
      isRewardedLoading = false;
      console.log('[AdService] Rewarded ad loaded');
    });

    rewarded.addAdEventListener(AdEventType.CLOSED, () => {
      isRewardedLoaded = false;
      isRewardedLoading = false;
      rewardedInstance = null;
      // Preload next one after a short delay
      setTimeout(() => {
        preloadRewardedAd();
      }, 3000);
    });

    rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
      console.warn('[AdService] Rewarded ad error:', error);
      isRewardedLoaded = false;
      isRewardedLoading = false;
      rewardedInstance = null;
    });

    rewardedInstance = rewarded;
    rewarded.load();
  } catch (err) {
    console.warn('[AdService] Error preloading rewarded ad:', err);
    isRewardedLoading = false;
    isRewardedLoaded = false;
  }
}

/**
 * Returns true if a rewarded ad is already loaded and ready to display
 */
export function isRewardedAdReady(): boolean {
  return isRewardedLoaded && rewardedInstance !== null;
}

export interface ShowRewardedOptions {
  onRewarded: () => void;
  onClosed?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Shows the preloaded rewarded ad, or loads one on demand if not ready yet.
 * Automatically pauses and resumes music playback to avoid audio collision.
 */
export async function showRewardedAd(options: ShowRewardedOptions): Promise<boolean> {
  const { onRewarded, onClosed, onError } = options;

  let wasPlaying = false;
  const pausePlayback = async () => {
    try {
      const state = await TrackPlayer.getPlaybackState();
      if (state.state === State.Playing) {
        wasPlaying = true;
        await TrackPlayer.pause();
      }
    } catch {
      // ignore
    }
  };

  const resumePlayback = async () => {
    if (wasPlaying) {
      try {
        await TrackPlayer.play();
      } catch {
        // ignore
      }
    }
  };

  // 1. If an ad is already loaded, show it immediately!
  if (rewardedInstance && isRewardedLoaded) {
    const ad = rewardedInstance;
    await pausePlayback();

    ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      try {
        onRewarded();
      } catch (e) {
        console.warn('[AdService] onRewarded callback error:', e);
      }
    });

    ad.addAdEventListener(AdEventType.CLOSED, async () => {
      isRewardedLoaded = false;
      rewardedInstance = null;
      await resumePlayback();
      onClosed?.();
      setTimeout(() => {
        preloadRewardedAd();
      }, 2000);
    });

    try {
      await ad.show();
      return true;
    } catch (err: any) {
      isRewardedLoaded = false;
      rewardedInstance = null;
      await resumePlayback();
      const errorObj = err instanceof Error ? err : new Error(String(err));
      onError?.(errorObj);
      preloadRewardedAd();
      return false;
    }
  }

  // 2. If not preloaded yet, load on-demand with a safety timeout
  return new Promise(async (resolve) => {
    try {
      const ad = RewardedAd.createForAdRequest(AD_UNIT_IDS.REWARDED, {
        requestNonPersonalizedAdsOnly: true,
      });

      let timeout: any = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
      };

      timeout = setTimeout(async () => {
        cleanup();
        ad.removeAllListeners();
        onError?.(new Error('Reklam yükleme zaman aşımına uğradı.'));
        resolve(false);
      }, 15000);

      ad.addAdEventListener(RewardedAdEventType.LOADED, async () => {
        cleanup();
        await pausePlayback();
        try {
          await ad.show();
          resolve(true);
        } catch (err: any) {
          await resumePlayback();
          onError?.(err instanceof Error ? err : new Error(String(err)));
          resolve(false);
        }
      });

      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        try {
          onRewarded();
        } catch (e) {
          console.warn('[AdService] onRewarded error:', e);
        }
      });

      ad.addAdEventListener(AdEventType.CLOSED, async () => {
        await resumePlayback();
        onClosed?.();
        setTimeout(() => {
          preloadRewardedAd();
        }, 2000);
      });

      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        cleanup();
        onError?.(new Error(error.message || 'Reklam yüklenemedi.'));
        resolve(false);
      });

      ad.load();
    } catch (err: any) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      resolve(false);
    }
  });
}
