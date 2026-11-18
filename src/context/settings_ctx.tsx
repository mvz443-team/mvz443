import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { debounce } from '../utils/debounce';
import { changeLocale, Locale } from '../i18n';
import {
  isDbgCommandsEnabled,
  isNetDebugEnabled,
  isUnlockAllEnabled,
  setDbgCommandsEnabled,
  setNetDebugEnabled,
  setUnlockAllEnabled,
} from '../utils/debugFlags';

const loadCookie = <T,>(key: string, defaultValue: T): T => {
  const value = document.cookie
    .split('; ')
    .find(row => row.startsWith(key + '='));

  return value ? JSON.parse(value.split('=')[1]) : defaultValue;
};

const storeCookie = <T,>(key: string, value: T): void => {
  document.cookie = `${key}=${JSON.stringify(value)}; path=/; max-age=31536000`;
};

const clampFps = (value: number): number => {
  if (!Number.isFinite(value)) return 60;
  return Math.max(30, Math.min(120, Math.round(value)));
};

interface GameSettings {
  isFullScreen: boolean;
  width: number;
  fps: number;
  language: Locale;
  isBluePrint: boolean;
  /** 旧“显示调试信息”：Rapier 物理体与当前帧号。 */
  basicDebug: boolean;
  netDebug: boolean;
  dbgCommands: boolean;
  unlockAll: boolean;
  isBgm: boolean;
  isSoundAudio: boolean;
  showLevelIntroImages: boolean;
  showCardLevelInGame: boolean;
  bgmVolume: number;
  soundAudioVolume: number;
  linkOptions: {
    baseUrl: string;
    key: string;
  };
  toggleFullScreen: () => void;
  setWidth: (newWidth: number) => void;
  setFps: (newFps: number) => void;
  toggleLanguage: (lang: Locale) => void;
  setIsBluePrint: (isBluePrint: boolean) => void;
  setBasicDebug: (basicDebug: boolean) => void;
  setNetDebug: (netDebug: boolean) => void;
  setDbgCommands: (dbgCommands: boolean) => void;
  setUnlockAll: (unlockAll: boolean) => void;
  setIsBgm: (isBgm: boolean) => void;
  setIsSoundAudio: (isSoundAudio: boolean) => void;
  setShowLevelIntroImages: (showLevelIntroImages: boolean) => void;
  setShowCardLevelInGame: (showCardLevelInGame: boolean) => void;
  setBgmVolume: (volume: number) => void;
  setSoundAudioVolume: (volume: number) => void;
  setLinkOptions: (baseUrl: string, key: string) => void;
  exportAsJson: () => string;
  importFromJson: (jsonString: string) => void;
}

const SettingsContext = createContext<GameSettings | undefined>(undefined);

interface Props {
  children: ReactNode
}

export function SettingsProvider(props: Props) {
  const { children } = props;

  const [isFullScreen, setIsFullScreen] = useState<boolean>(loadCookie('isFullScreen', false));
  const [width, setWidth] = useState<number>(loadCookie('width', 800));
  const [fps, setFpsStatus] = useState<number>(clampFps(loadCookie('fps', 60)));
  const [language, setLanguage] = useState<Locale>(loadCookie('language', 'zh_CN'));
  const [isBluePrint, setIsBluePrintStatus] = useState<boolean>(loadCookie('isBluePrint', false));
  const [basicDebug, setBasicDebugStatus] = useState<boolean>(loadCookie('isDebug', false));
  const [netDebug, setNetDebugStatus] = useState<boolean>(isNetDebugEnabled());
  const [dbgCommands, setDbgCommandsStatus] = useState<boolean>(isDbgCommandsEnabled());
  const [unlockAll, setUnlockAllStatus] = useState<boolean>(isUnlockAllEnabled());
  const [showLevelIntroImages, setShowLevelIntroImagesStatus] = useState<boolean>(loadCookie('showLevelIntroImages', true));
  const [showCardLevelInGame, setShowCardLevelInGameStatus] = useState<boolean>(loadCookie('showCardLevelInGame', true));
  const [bgmVolume, setBgmVolumeStatus] = useState<number>(loadCookie('bgmVolume', loadCookie('isBgm', true) ? 1 : 0));
  const [soundAudioVolume, setSoundAudioVolumeStatus] = useState<number>(loadCookie('soundAudioVolume', loadCookie('isSoundAudio', true) ? 1 : 0));
  const [linkOptions, setLinkOptionsStatus] = useState<{ baseUrl: string; key: string }>(
    loadCookie('linkOptions', { baseUrl: '', key: '' })
  );

  const setIsBluePrint = (value: boolean) => {
    debounce((newVal) => {
      setIsBluePrintStatus(newVal);
      storeCookie('isBluePrint', newVal);
    }, 50)(value);
  };

  const setFps = (value: number) => {
    const nextFps = clampFps(value);
    setFpsStatus(nextFps);
    storeCookie('fps', nextFps);
  };

  const setBasicDebug = (value: boolean) => {
    debounce((newVal) => {
      setBasicDebugStatus(newVal);
      storeCookie('isDebug', newVal);
    }, 50)(value);
  };

  const setNetDebug = (value: boolean) => {
    debounce((newVal) => {
      setNetDebugStatus(newVal);
      setNetDebugEnabled(newVal);
    }, 50)(value);
  };

  const setDbgCommands = (value: boolean) => {
    debounce((newVal) => {
      setDbgCommandsStatus(newVal);
      setDbgCommandsEnabled(newVal);
    }, 50)(value);
  };

  const setUnlockAll = (value: boolean) => {
    debounce((newVal) => {
      setUnlockAllStatus(newVal);
      setUnlockAllEnabled(newVal);
    }, 50)(value);
  };

  const setShowLevelIntroImages = (value: boolean) => {
    debounce((newVal) => {
      setShowLevelIntroImagesStatus(newVal);
      storeCookie('showLevelIntroImages', newVal);
    }, 50)(value);
  };

  const setShowCardLevelInGame = (value: boolean) => {
    debounce((newVal) => {
      setShowCardLevelInGameStatus(newVal);
      storeCookie('showCardLevelInGame', newVal);
    }, 50)(value);
  };

  const setIsBgm = (value: boolean) => {
    debounce((newVal: boolean) => {
      const volume = newVal ? 1 : 0;
      setBgmVolumeStatus(volume);
      storeCookie('bgmVolume', volume);
      storeCookie('isBgm', newVal);
    }, 50)(value);
  };

  const setIsSoundAudio = (value: boolean) => {
    debounce((newVal: boolean) => {
      const volume = newVal ? 1 : 0;
      setSoundAudioVolumeStatus(volume);
      storeCookie('soundAudioVolume', volume);
      storeCookie('isSoundAudio', newVal);
    }, 50)(value);
  };

  const clampVolume = (volume: number) => Math.max(0, Math.min(1, volume));

  const setBgmVolume = (value: number) => {
    debounce((newVal: number) => {
      const volume = clampVolume(newVal);
      setBgmVolumeStatus(volume);
      storeCookie('bgmVolume', volume);
      storeCookie('isBgm', volume > 0);
    }, 50)(value);
  };

  const setSoundAudioVolume = (value: number) => {
    debounce((newVal: number) => {
      const volume = clampVolume(newVal);
      setSoundAudioVolumeStatus(volume);
      storeCookie('soundAudioVolume', volume);
      storeCookie('isSoundAudio', volume > 0);
    }, 50)(value);
  };

  const setLinkOptions = (baseUrl: string, key: string) => {
    debounce((newBaseUrl, newKey) => {
      setLinkOptionsStatus({ baseUrl: newBaseUrl, key: newKey });
      storeCookie('linkOptions', { baseUrl: newBaseUrl, key: newKey });
    }, 50)(baseUrl, key);
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullScreen(true);
        storeCookie('isFullScreen', true);
      }).catch(err => {
        console.error('Failed to enter fullscreen:', err);
      });
      return;
    }

    document.exitFullscreen().then(() => {
      setIsFullScreen(false);
      storeCookie('isFullScreen', false);
    }).catch(err => {
      console.error('Failed to exit fullscreen:', err);
    });
  };

  const toggleLanguage = (lang: Locale) => {
    setLanguage(lang);
    storeCookie('language', lang);
    changeLocale(lang);
  };

  const exportAsJson = useCallback(() => {
    return JSON.stringify({
      isFullScreen,
      width,
      fps,
      language,
      isBluePrint,
      basicDebug,
      netDebug,
      dbgCommands,
      unlockAll,
      showLevelIntroImages,
      showCardLevelInGame,
      bgmVolume,
      soundAudioVolume
    });
  }, [isFullScreen, width, fps, language, isBluePrint, basicDebug, netDebug, dbgCommands, unlockAll, showLevelIntroImages, showCardLevelInGame, bgmVolume, soundAudioVolume]);

  const importFromJson = (jsonString: string) => {
    const data = JSON.parse(jsonString);
    setIsFullScreen(data.isFullScreen);
    setWidth(data.width);
    if (typeof data.fps === 'number') setFpsStatus(clampFps(data.fps));
    setLanguage(data.language);
    changeLocale(data.language);
    setIsBluePrintStatus(data.isBluePrint);
    if (typeof data.basicDebug === 'boolean') {
      setBasicDebugStatus(data.basicDebug);
      storeCookie('isDebug', data.basicDebug);
    }
    if (typeof data.netDebug === 'boolean') setNetDebugStatus(setNetDebugEnabled(data.netDebug));
    if (typeof data.dbgCommands === 'boolean') setDbgCommandsStatus(setDbgCommandsEnabled(data.dbgCommands));
    if (typeof data.unlockAll === 'boolean') setUnlockAllStatus(setUnlockAllEnabled(data.unlockAll));
    if (typeof data.showLevelIntroImages === 'boolean') {
      setShowLevelIntroImagesStatus(data.showLevelIntroImages);
      storeCookie('showLevelIntroImages', data.showLevelIntroImages);
    }
    if (typeof data.showCardLevelInGame === 'boolean') {
      setShowCardLevelInGameStatus(data.showCardLevelInGame);
      storeCookie('showCardLevelInGame', data.showCardLevelInGame);
    }
    if (typeof data.bgmVolume === 'number') {
      setBgmVolumeStatus(clampVolume(data.bgmVolume));
    }
    if (typeof data.soundAudioVolume === 'number') {
      setSoundAudioVolumeStatus(clampVolume(data.soundAudioVolume));
    }
  };

  useEffect(() => {
    const storedLanguage = loadCookie<Locale>('language', 'zh_CN');
    setIsFullScreen(loadCookie('isFullScreen', false));
    setWidth(loadCookie('width', 800));
    setFpsStatus(clampFps(loadCookie('fps', 60)));
    setLanguage(storedLanguage);
    changeLocale(storedLanguage);
    setIsBluePrintStatus(loadCookie('isBluePrint', false));
    setBasicDebugStatus(loadCookie('isDebug', false));
    setNetDebugStatus(isNetDebugEnabled());
    setDbgCommandsStatus(isDbgCommandsEnabled());
    setUnlockAllStatus(isUnlockAllEnabled());
    setShowLevelIntroImagesStatus(loadCookie('showLevelIntroImages', true));
    setShowCardLevelInGameStatus(loadCookie('showCardLevelInGame', true));
    setBgmVolumeStatus(loadCookie('bgmVolume', loadCookie('isBgm', true) ? 1 : 0));
    setSoundAudioVolumeStatus(loadCookie('soundAudioVolume', loadCookie('isSoundAudio', true) ? 1 : 0));
    setLinkOptionsStatus(loadCookie('linkOptions', { baseUrl: '', key: '' }));
  }, []);

  const settingsValue: GameSettings = {
    isFullScreen,
    width,
    fps,
    language,
    isBluePrint,
    basicDebug,
    netDebug,
    dbgCommands,
    unlockAll,
    isBgm: bgmVolume > 0,
    isSoundAudio: soundAudioVolume > 0,
    showLevelIntroImages,
    showCardLevelInGame,
    bgmVolume,
    soundAudioVolume,
    linkOptions,
    toggleFullScreen,
    setWidth,
    setFps,
    toggleLanguage,
    setIsBluePrint,
    setBasicDebug,
    setNetDebug,
    setDbgCommands,
    setUnlockAll,
    setIsBgm,
    setIsSoundAudio,
    setShowLevelIntroImages,
    setShowCardLevelInGame,
    setBgmVolume,
    setSoundAudioVolume,
    setLinkOptions,
    exportAsJson,
    importFromJson,
  };

  return (
    <SettingsContext.Provider value={settingsValue}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = (): GameSettings => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
};
