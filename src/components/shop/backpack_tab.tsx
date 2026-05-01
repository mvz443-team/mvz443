import React, { useEffect, useState } from "react";
import Stuff, { StuffResourceKey } from "../../constants/stuffs";
import { useLocaleMessages } from "../../hooks/useLocaleMessages";
import i18n from "../../i18n";
import { getItemIcon } from "./assets";
import { item } from "./types";

interface BackpackTabProps {
  myItems: item[];
}

function getCurrentLocaleStuffDescription(type: number) {
  const itemKey = StuffResourceKey(type);
  if (!itemKey) return "";

  const bundle = i18n.getResourceBundle(i18n.resolvedLanguage || i18n.language, "translation") as {
    stuff?: Record<string, unknown>
  } | undefined;
  const stuffMessages = bundle?.stuff;
  if (!stuffMessages) return "";

  const flatDescription = stuffMessages[`${itemKey}.DESCRIPTION`];
  if (typeof flatDescription === "string") return flatDescription;

  const nestedItem = stuffMessages[itemKey];
  if (
    nestedItem &&
    typeof nestedItem === "object" &&
    "DESCRIPTION" in nestedItem &&
    typeof (nestedItem as { DESCRIPTION?: unknown }).DESCRIPTION === "string"
  ) {
    return (nestedItem as { DESCRIPTION: string }).DESCRIPTION;
  }

  return "";
}

export default function BackpackTab({ myItems }: BackpackTabProps) {
  const { translate } = useLocaleMessages();
  const [selectedType, setSelectedType] = useState<number | null>(myItems[0]?.type ?? null);
  const selectedItem = myItems.find(item => item.type === selectedType) ?? myItems[0] ?? null;
  const selectedDescription = selectedItem ? getCurrentLocaleStuffDescription(selectedItem.type) : "";

  useEffect(() => {
    if (myItems.length === 0) {
      setSelectedType(null);
      return;
    }
    if (!myItems.some(item => item.type === selectedType)) {
      setSelectedType(myItems[0].type);
    }
  }, [myItems, selectedType]);

  return (
    <div style={{
      height: "100%",
      color: "#fff",
      display: "flex",
      gap: "16px",
      minHeight: 0
    }}>
      <div style={{
        width: "42%",
        minWidth: "260px",
        height: "100%",
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))",
        alignContent: "start",
        gap: "8px",
        padding: "4px",
        borderRight: "1px solid #444",
        paddingRight: "14px",
        scrollbarWidth: "thin",
        scrollbarColor: "#888 #333"
      }}>
        {myItems.length === 0 ? (
          <div style={{ color: "#999", padding: "16px" }}>背包为空</div>
        ) : myItems.map(item => {
          const isSelected = selectedItem?.type === item.type;
          const name = Stuff(item.type, translate);
          return (
            <button
              key={item.type}
              onClick={() => setSelectedType(item.type)}
              title={name}
              style={{
                position: "relative",
                height: "58px",
                border: isSelected ? "2px solid #fff" : "1px solid #555",
                borderRadius: "6px",
                background: isSelected ? "#3f5360" : "#303030",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0
              }}
            >
              <img
                src={getItemIcon(item.type)}
                alt={name}
                style={{ width: "38px", height: "38px", objectFit: "contain" }}
                draggable="false"
              />
              <span style={{
                position: "absolute",
                right: "4px",
                bottom: "2px",
                color: "#fff",
                fontSize: "11px",
                fontWeight: 700,
                textShadow: "0 1px 2px #000"
              }}>{item.count}</span>
            </button>
          );
        })}
      </div>

      <div style={{
        flex: 1,
        height: "100%",
        minHeight: 0,
        padding: "4px 4px 4px 0",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflow: "hidden"
      }}>
        {selectedItem ? (
          <>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flex: "0 0 auto"
            }}>
              <img
                src={getItemIcon(selectedItem.type)}
                alt={Stuff(selectedItem.type, translate)}
                style={{
                  width: "72px",
                  height: "72px",
                  objectFit: "contain",
                  flex: "0 0 auto"
                }}
                draggable="false"
              />
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: "0 0 8px", fontSize: "22px" }}>
                  {Stuff(selectedItem.type, translate)}
                </h2>
                <div style={{ color: "#d6d6d6", fontSize: "15px" }}>
                  数量: {selectedItem.count}
                </div>
                <div style={{ color: "#9e9e9e", fontSize: "13px", marginTop: "4px" }}>
                  Type ID: {selectedItem.type}
                </div>
              </div>
            </div>
            <div style={{
              color: selectedDescription ? "#ededed" : "#999",
              fontSize: "14px",
              lineHeight: 1.5,
              paddingRight: "6px",
              whiteSpace: "pre-wrap",
              overflowY: "auto",
              minHeight: 0,
              flex: "1 1 auto",
              scrollbarWidth: "thin",
              scrollbarColor: "#888 #333"
            }}>
              {selectedDescription || "暂无描述"}
            </div>
          </>
        ) : (
          <div style={{ color: "#999" }}>没有可显示的物品</div>
        )}
      </div>
    </div>
  );
}

interface BackpackListProps {
  myItems: item[];
  selectedType: number | null;
  selectedItem: item | null;
  onSelectType: (type: number) => void;
}

interface BackpackDetailProps {
  selectedItem: item | null;
}

export function useBackpackSelection(myItems: item[]) {
  const [selectedType, setSelectedType] = useState<number | null>(myItems[0]?.type ?? null);
  const selectedItem = myItems.find(item => item.type === selectedType) ?? myItems[0] ?? null;

  useEffect(() => {
    if (myItems.length === 0) {
      setSelectedType(null);
      return;
    }
    if (!myItems.some(item => item.type === selectedType)) {
      setSelectedType(myItems[0].type);
    }
  }, [myItems, selectedType]);

  return { selectedType, selectedItem, setSelectedType };
}

export function BackpackList({ myItems, selectedItem, onSelectType }: BackpackListProps) {
  const { translate } = useLocaleMessages();

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))",
      alignContent: "start",
      gap: "8px",
      padding: "10px",
      scrollbarWidth: "thin",
      scrollbarColor: "#888 #333"
    }}>
      {myItems.length === 0 ? (
        <div style={{ color: "#999", padding: "16px" }}>背包为空</div>
      ) : myItems.map(item => {
        const isSelected = selectedItem?.type === item.type;
        const name = Stuff(item.type, translate);
        return (
          <button
            key={item.type}
            onClick={() => onSelectType(item.type)}
            title={name}
            style={{
              position: "relative",
              height: "58px",
              border: isSelected ? "2px solid #fff" : "1px solid #555",
              borderRadius: "6px",
              background: isSelected ? "#3f5360" : "#303030",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0
            }}
          >
            <img
              src={getItemIcon(item.type)}
              alt={name}
              style={{ width: "38px", height: "38px", objectFit: "contain" }}
              draggable="false"
            />
            <span style={{
              position: "absolute",
              right: "4px",
              bottom: "2px",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              textShadow: "0 1px 2px #000"
            }}>{item.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BackpackDetail({ selectedItem }: BackpackDetailProps) {
  const { translate } = useLocaleMessages();
  const selectedDescription = selectedItem ? getCurrentLocaleStuffDescription(selectedItem.type) : "";

  return (
    <div style={{
      height: "100%",
      minHeight: 0,
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
      scrollbarWidth: "thin",
      overflowX: "hidden",
      overflowY: "auto",
      scrollbarColor: "#888 #333"
    }}>
      {selectedItem ? (
        <>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flex: "0 0 auto",
          }}>
            <img
              src={getItemIcon(selectedItem.type)}
              alt={Stuff(selectedItem.type, translate)}
              style={{
                width: "84px",
                height: "84px",
                objectFit: "contain",
                flex: "0 0 auto"
              }}
              draggable="false"
            />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: "0 0 8px", fontSize: "24px" }}>
                {Stuff(selectedItem.type, translate)}
              </h2>
              <div style={{ color: "#d6d6d6", fontSize: "15px" }}>
                数量: {selectedItem.count}
              </div>
              <div style={{ color: "#9e9e9e", fontSize: "13px", marginTop: "4px" }}>
                Type ID: {selectedItem.type}
              </div>
            </div>
          </div>
          <div style={{
            color: selectedDescription ? "#ededed" : "#999",
            fontSize: "15px",
            lineHeight: 1.6,
            paddingRight: "8px",
            whiteSpace: "pre-wrap",
            minHeight: 0,
            flex: "1 1 auto",
          }}>
            {selectedDescription || "暂无描述"}
          </div>
        </>
      ) : (
        <div style={{ color: "#999" }}>没有可显示的物品</div>
      )
      }
    </div >
  );
}
