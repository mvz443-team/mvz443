import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { debounce } from '../utils/debounce';
import { changeLocale, Locale } from '../i18n';

const loadCookie = <T,>(key: string, defaultValue: T): T => {
    const value = document.cookie
        .split('; ')
        .find(row => row.startsWith(key + '='));

    return value ? JSON.parse(value.split('=')[1]) : defaultValue;
};

const storeCookie = <T,>(key: string, value: T): void => {
    document.cookie = `${key}=${JSON.stringify(value)}; path=/; max-age=31536000`;
};

interface GameSettings {
    isFullScreen: boolean;
    width: number;
    language: Locale;
    isBluePrint: boolean;
    isDebug: boolean;
    isBgm: boolean;
    isSoundAudio: boolean;
    showLevelIntroImages: boolean;
    bgmVolume: number;
    soundAudioVolume: number;
    linkOptions: {
        baseUrl: string;
        key: string;
    };
    toggleFullScreen: () => void;
    setWidth: (newWidth: number) => void;
    toggleLanguage: (lang: Locale) => void;
    setIsBluePrint: (isBluePrint: boolean) => void;
    setIsDebug: (isDebug: boolean) => void;
    setIsBgm: (isBgm: boolean) => void;
    setIsSoundAudio: (isSoundAudio: boolean) => void;
    setShowLevelIntroImages: (showLevelIntroImages: boolean) => void;
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
    const [language, setLanguage] = useState<Locale>(loadCookie('language', 'zh_CN'));
    const [isBluePrint, setIsBluePrintStatus] = useState<boolean>(loadCookie('isBluePrint', false));
    const [isDebug, setIsDebugStatus] = useState<boolean>(loadCookie('isDebug', false));
    const [showLevelIntroImages, setShowLevelIntroImagesStatus] = useState<boolean>(loadCookie('showLevelIntroImages', true));
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

    const setIsDebug = (value: boolean) => {
        debounce((newVal) => {
            setIsDebugStatus(newVal);
            storeCookie('isDebug', newVal);
        }, 50)(value);
    };

    const setShowLevelIntroImages = (value: boolean) => {
        debounce((newVal) => {
            setShowLevelIntroImagesStatus(newVal);
            storeCookie('showLevelIntroImages', newVal);
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
            language,
            isBluePrint,
            showLevelIntroImages,
            bgmVolume,
            soundAudioVolume
        });
    }, [isFullScreen, width, language, isBluePrint, showLevelIntroImages, bgmVolume, soundAudioVolume]);

    const importFromJson = (jsonString: string) => {
        const data = JSON.parse(jsonString);
        setIsFullScreen(data.isFullScreen);
        setWidth(data.width);
        setLanguage(data.language);
        changeLocale(data.language);
        setIsBluePrintStatus(data.isBluePrint);
        if (typeof data.showLevelIntroImages === 'boolean') {
            setShowLevelIntroImagesStatus(data.showLevelIntroImages);
            storeCookie('showLevelIntroImages', data.showLevelIntroImages);
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
        setLanguage(storedLanguage);
        changeLocale(storedLanguage);
        setIsBluePrintStatus(loadCookie('isBluePrint', false));
        setIsDebugStatus(loadCookie('isDebug', false));
        setShowLevelIntroImagesStatus(loadCookie('showLevelIntroImages', true));
        setBgmVolumeStatus(loadCookie('bgmVolume', loadCookie('isBgm', true) ? 1 : 0));
        setSoundAudioVolumeStatus(loadCookie('soundAudioVolume', loadCookie('isSoundAudio', true) ? 1 : 0));
        setLinkOptionsStatus(loadCookie('linkOptions', { baseUrl: '', key: '' }));
    }, []);

    const settingsValue: GameSettings = {
        isFullScreen,
        width,
        language,
        isBluePrint,
        isDebug,
        isBgm: bgmVolume > 0,
        isSoundAudio: soundAudioVolume > 0,
        showLevelIntroImages,
        bgmVolume,
        soundAudioVolume,
        linkOptions,
        toggleFullScreen,
        setWidth,
        toggleLanguage,
        setIsBluePrint,
        setIsDebug,
        setIsBgm,
        setIsSoundAudio,
        setShowLevelIntroImages,
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
