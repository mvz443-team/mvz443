// Settings.tsx
import { useState, useRef } from 'react';
import { useSaveManager } from '../../context/save_ctx';
import { useSettings } from '../../context/settings_ctx';
import { debounce } from '../../utils/debounce';
import { Locale, useLocaleMessages } from '../../hooks/useLocaleMessages';
import OnlineSettings from './settings/OnlineSettings';
import GameResourcesSettings from './settings/GameResourcesSettings';
import { showAlert } from '../../utils/uiDialog';

interface Props {
  width: number;
  height?: number;
  onBack: () => void;
}

interface SettingItemBase {
  titleKey: string;
  descriptionKey: string;
}

type SettingItem =
  | (SettingItemBase & {
    controlType: 'button';
    controlProps?: {
      onClick?: () => void;
      btnText?: string;
    };
  })
  | (SettingItemBase & {
    controlType: 'switcher';
    controlProps?: {
      value?: boolean;
      onToggle?: (value: boolean) => void;
    };
  })
  | (SettingItemBase & {
    controlType: 'input';
    controlProps?: {
      placeholder?: string;
      value?: string;
      onChange?: (value: string) => void;
    };
  })
  | (SettingItemBase & {
    controlType: 'slider';
    controlProps?: {
      value?: number;
      min?: number;
      max?: number;
      step?: number;
      onChange?: (value: number) => void;
    };
  })
  | (SettingItemBase & {
    controlType: 'selections';
    controlProps?: {
      options?: string[];
      selected?: string;
      onSelect?: (value: string) => void;
    };
  });

interface SettingPanel {
  title: string;
  items: SettingItem[];
}

export default function Settings({ width, height, onBack: onBackOriginal }: Props) {
  if (height === undefined) {
    height = width * 3 / 4;
  }

  const settingManager = useSettings();

  const [selectedCategory, setSelectedCategory] = useState('general');
  const [isFullscreen, setIsFullscreen] = useState(document.fullscreenElement !== null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveManager = useSaveManager();

  const { translate } = useLocaleMessages();

  const onBack = async () => {
    onBackOriginal();
    try {
      await saveManager.saveProgress();
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  // 处理导入存档
  const handleImportSave = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result as string;
        try {
          await saveManager.importSave(content);
          console.log('导入存档:', content);
        } catch (error) {
          console.error('导入失败:', error);
        }
      };
      reader.readAsText(file);
    } else {
      void showAlert('请上传有效的 JSON 文件');
    }
    // 重置 input 以允许重复选择同一文件
    event.target.value = '';
  };

  // 处理导出存档
  const handleExportSave = async () => {
    try {
      const jsonString = await saveManager.exportSave();
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `save_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败:', error);
    }
  };

  // 设置类别和对应的面板数据
  const settingsData: { [key: string]: (SettingPanel | null)[] } = {
    general: [
      {
        title: "menu.settings_general_display",
        items: [
          {
            titleKey: "menu.settings_general_fullscreen",
            descriptionKey: "menu.settings_general_fullscreen_t",
            controlType: "switcher",
            controlProps: {
              value: isFullscreen, onToggle: (_val) => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().then(() => setIsFullscreen(true));
                } else {
                  document.exitFullscreen().then(() => setIsFullscreen(false));
                }
              }
            }
          },
          {
            titleKey: "menu.settings_general_resolution",
            descriptionKey: "menu.settings_general_resolution_t",
            controlType: "selections",
            controlProps: {
              options: ["800x600", "924x693", "1024x768", "1200x900"], selected: `${settingManager.width}x${settingManager.width / 4 * 3}`, onSelect: (val) => {
                let twidth = parseInt(val);
                settingManager.setWidth(twidth);
              }
            }
          },
          {
            titleKey: "menu.settings_general_fps",
            descriptionKey: "menu.settings_general_fps_t",
            controlType: "selections",
            controlProps: {
              options: ["30", "45", "60", "90", "120"],
              selected: String(settingManager.fps),
              onSelect: (val) => settingManager.setFps(Number(val)),
            }
          },
          {
            titleKey: "menu.settings_general_language",
            descriptionKey: "menu.settings_general_language_t",
            controlType: "selections",
            controlProps: {
              options: ["zh_CN", "en_US"], selected: settingManager.language, onSelect: (val) => {
                if (!val) {
                  return;
                }
                settingManager.toggleLanguage(val as Locale);
              }
            }
          }
        ],
      },
      {
        title: "menu.settings_general_saves",
        items: [
          {
            titleKey: "menu.settings_general_save_progress",
            descriptionKey: "menu.settings_general_save_progress_t",
            controlType: "button",
            controlProps: {
              onClick: async () => {
                try {
                  await saveManager.saveProgress();
                } catch (error) {
                  console.error('保存失败:', error);
                }
              },
              btnText: "menu.settings_save"
            }
          },
          {
            titleKey: "menu.settings_general_import_save",
            descriptionKey: "menu.settings_general_import_save_t",
            controlType: "button",
            controlProps: { onClick: handleImportSave, btnText: "menu.settings_import" }
          },
          {
            titleKey: "menu.settings_general_export_save",
            descriptionKey: "menu.settings_general_export_save_t",
            controlType: "button",
            controlProps: { onClick: handleExportSave, btnText: "menu.settings_export" }
          }
        ]
      }
    ], game: [
      {
        title: "menu.settings_gaming_gamesettings",
        items: [
          {
            titleKey: "menu.settings_gaming_private_blueprints",
            descriptionKey: "menu.settings_gaming_private_blueprints_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.isBluePrint, onToggle: (val) => {
                debounce((newVal) => settingManager.setIsBluePrint(newVal), 50)(val);
              }
            }
          },
          {
            titleKey: "menu.settings_gaming_level_intro_images",
            descriptionKey: "menu.settings_gaming_level_intro_images_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.showLevelIntroImages, onToggle: (val) => {
                debounce((newVal) => settingManager.setShowLevelIntroImages(newVal), 50)(val);
              }
            }
          },
          {
            titleKey: "menu.settings_gaming_show_card_levels",
            descriptionKey: "menu.settings_gaming_show_card_levels_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.showCardLevelInGame, onToggle: (val) => {
                debounce((newVal) => settingManager.setShowCardLevelInGame(newVal), 50)(val);
              }
            }
          },
          {
            titleKey: "menu.settings_gaming_background_music",
            descriptionKey: "menu.settings_gaming_background_music_t",
            controlType: "slider",
            controlProps: {
              value: settingManager.bgmVolume, min: 0, max: 1, step: 0.01, onChange: (val) => {
                debounce((newVal) => settingManager.setBgmVolume(newVal), 50)(val);
              }
            }
          },
          {
            titleKey: "menu.settings_gaming_sound_effects",
            descriptionKey: "menu.settings_gaming_sound_effects_t",
            controlType: "slider",
            controlProps: {
              value: settingManager.soundAudioVolume, min: 0, max: 1, step: 0.01, onChange: (val) => {
                debounce((newVal) => settingManager.setSoundAudioVolume(newVal), 50)(val);
              }
            }
          }
        ]
      }
    ],
    online: [],
    resources: [],
    debug: [
      {
        title: "menu.settings_debug_title",
        items: [
          {
            titleKey: "menu.settings_debug_basic",
            descriptionKey: "menu.settings_debug_basic_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.basicDebug, onToggle: (val) => settingManager.setBasicDebug(val)
            }
          },
          {
            titleKey: "menu.settings_debug_net",
            descriptionKey: "menu.settings_debug_net_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.netDebug, onToggle: (val) => settingManager.setNetDebug(val)
            }
          },
          {
            titleKey: "menu.settings_debug_dbg",
            descriptionKey: "menu.settings_debug_dbg_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.dbgCommands, onToggle: (val) => settingManager.setDbgCommands(val)
            }
          },
          {
            titleKey: "menu.settings_debug_unlockall",
            descriptionKey: "menu.settings_debug_unlockall_t",
            controlType: "switcher",
            controlProps: {
              value: settingManager.unlockAll, onToggle: (val) => settingManager.setUnlockAll(val)
            }
          }
        ]
      }
    ],
  };

  const menuItems = [
    { name: "menu.settings_general", key: "general" },
    { name: "menu.settings_gaming", key: "game" },
    { name: "menu.settings_online", key: "online" },
    { name: "menu.settings_resources", key: "resources" },
    { name: "menu.settings_debug", key: "debug" }
  ];
  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
      position: "relative",
      overflow: "hidden",
      border: "2px solid #444",
      boxShadow: "0 0 15px rgba(0, 0, 0, 0.5)",
      animation: "frameFadeIn 0.5s ease-out"
    }}>
      {/* Left menu */}
      <div style={{
        width: "25%",
        height: "100%",
        position: "absolute",
        left: 0,
        top: 0,
        background: "rgba(20, 20, 20, 0.85)",
        backdropFilter: "blur(5px)",
        overflowY: "auto",
        overflowX: 'hidden',
        scrollbarWidth: "thin",
        scrollbarColor: "#666 #333",
        borderRight: "1px solid rgba(100, 100, 100, 0.3)"
      }}>
        <button
          className='backbutton'
          style={{
            background: "none",
            border: "none",
            color: "#ddd",
            textAlign: "center",
            cursor: "pointer",
            fontSize: "16px",
            transition: "all 0.3s ease",
            position: "relative",
            margin: "5px 0",
            boxShadow: "inset 0 0 0 2px rgba(100, 100, 100, 0.3)"
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            e.currentTarget.style.boxShadow = "inset 0 0 0 2px #00ccff, 0 0 8px rgba(0, 204, 255, 0.5)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.boxShadow = "inset 0 0 0 2px rgba(100, 100, 100, 0.3)";
            e.currentTarget.style.color = "#ddd";
          }}
          onClick={onBack}
        >
          {translate("menu.back")}
        </button>
        {menuItems.map((item) => (
          <button
            key={item.key}
            className='menubutton'
            style={{
              background: selectedCategory === item.key ? "rgba(255, 255, 255, 0.1)" : "none",
              boxShadow: selectedCategory === item.key
                ? "inset 0 0 0 2px #00ccff, 0 0 8px rgba(0, 204, 255, 0.5)"
                : "inset 0 0 0 2px rgba(100, 100, 100, 0.3)"
            }}
            onMouseOver={(e) => {
              if (selectedCategory !== item.key) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                e.currentTarget.style.boxShadow = "inset 0 0 0 2px #00ccff, 0 0 8px rgba(0, 204, 255, 0.5)";
                e.currentTarget.style.color = "#fff";
              }
            }}
            onMouseOut={(e) => {
              if (selectedCategory !== item.key) {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.boxShadow = "inset 0 0 0 2px rgba(100, 100, 100, 0.3)";
                e.currentTarget.style.color = "#ddd";
              }
            }}
            onClick={() => setSelectedCategory(item.key)}
          >
            {translate(item.name)}
          </button>
        ))}
      </div>

      {/* Right settings page */}
      <div style={{
        width: "70%",
        height: "100%",
        position: "absolute",
        right: 0,
        top: 0,
        padding: "20px",
        color: "#ddd",
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: "#666 #333",
        background: "rgba(30, 30, 30, 0.9)"
      }}>
        {selectedCategory === 'online' && <OnlineSettings />}
        {selectedCategory === 'resources' && <GameResourcesSettings />}
        {settingsData[selectedCategory].filter(panel => panel !== null).map((panel, index) => (
          <div key={index} style={{
            marginBottom: "30px",
            border: "1px solid rgba(100, 100, 100, 0.5)",
            padding: "15px",
            borderRadius: "5px"
          }}>
            <h3 style={{ marginBottom: "15px", color: "#fff" }}>{translate(panel.title)}</h3>
            {panel.items.map((item, idx) => (
              <div key={idx} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: idx < panel.items.length - 1 ? "1px solid rgba(100, 100, 100, 0.3)" : "none"
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", color: "#fff" }}>{translate(item.titleKey)}</div>
                  <div style={{ fontSize: "12px", color: "#aaa" }}>{translate(item.descriptionKey)}</div>
                </div>
                <div style={{ width: "200px", textAlign: "right" }}>
                  {item.controlType === 'button' && (
                    <button
                      style={{
                        padding: "5px 15px",
                        background: "none",
                        border: "1px solid #666",
                        color: "#ddd",
                        cursor: "pointer",
                        transition: "all 0.3s ease"
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                        e.currentTarget.style.borderColor = "#00ccff";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = "none";
                        e.currentTarget.style.borderColor = "#666";
                      }}
                      onClick={item.controlProps?.onClick}
                    >
                      {translate(item.controlProps?.btnText!) || "执行"}
                    </button>
                  )}
                  {item.controlType === 'switcher' && (
                    <label style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="checkbox"
                        checked={item.controlProps?.value}
                        onChange={(e) => item.controlProps?.onToggle?.(e.target.checked)}
                        style={{ display: "none" }}
                      />
                      <div style={{
                        width: "40px",
                        height: "20px",
                        background: item.controlProps?.value ? "#00ccff" : "#666",
                        borderRadius: "10px",
                        position: "relative",
                        cursor: "pointer",
                        transition: "background 0.3s ease"
                      }}
                        onClick={() => item.controlProps?.onToggle?.(!item.controlProps?.value)}>
                        <div style={{
                          width: "16px",
                          height: "16px",
                          background: "#fff",
                          borderRadius: "50%",
                          position: "absolute",
                          top: "2px",
                          left: item.controlProps?.value ? "22px" : "2px",
                          transition: "left 0.3s ease"
                        }}></div>
                      </div>
                    </label>
                  )}
                  {item.controlType === 'input' && (
                    <input
                      type="text"
                      placeholder={item.controlProps?.placeholder}
                      value={item.controlProps?.value ?? ''}
                      onChange={(e) => item.controlProps?.onChange?.(e.target.value)}
                      style={{
                        padding: "5px",
                        background: "rgba(255, 255, 255, 0.1)",
                        border: "1px solid #666",
                        color: "#ddd",
                        width: "100%",
                        borderRadius: "3px"
                      }}
                    />
                  )}
                  {item.controlType === 'slider' && (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="range"
                        min={item.controlProps?.min ?? 0}
                        max={item.controlProps?.max ?? 1}
                        step={item.controlProps?.step ?? 0.01}
                        value={item.controlProps?.value ?? 0}
                        onChange={(e) => item.controlProps?.onChange?.(Number(e.target.value))}
                        style={{
                          flex: 1,
                          accentColor: "#00ccff",
                          cursor: "pointer"
                        }}
                      />
                      <span style={{ width: "44px", color: "#ddd", fontSize: "13px", textAlign: "right" }}>
                        {Math.round((item.controlProps?.value ?? 0) * 100)}%
                      </span>
                    </div>
                  )}
                  {item.controlType === 'selections' && (
                    <select
                      value={item.controlProps?.selected}
                      onChange={(e) => item.controlProps?.onSelect?.(e.target.value)}
                      style={{
                        padding: "5px",
                        background: "rgba(255, 255, 255, 0.1)",
                        border: "1px solid #666",
                        color: "#ddd",
                        width: "100%",
                        borderRadius: "3px"
                      }}
                    >
                      {item.controlProps?.options?.map((option) => (
                        <option key={option} value={option} style={{ background: "#333", color: "#ddd" }}>
                          {option}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        {selectedCategory === 'general' && (
          <div style={{
            marginBottom: '30px',
            border: '1px solid rgba(100, 100, 100, 0.5)',
            padding: '15px',
            borderRadius: '5px',
          }}>
            <h3 style={{ marginBottom: '15px', color: '#fff' }}>
              {translate('resources.category_title')}
            </h3>
            <GameResourcesSettings />
          </div>
        )}
        {/* 隐藏的文件输入框 */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".json"
          onChange={handleFileChange}
        />
      </div>

      <style>
        {`
                    @keyframes frameFadeIn {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                `}
      </style>
    </div>
  );
}
