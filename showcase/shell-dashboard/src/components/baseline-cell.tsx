"use client";

import {
  STATUS_CONFIG,
  TAG_BADGE_CONFIG,
  type BaselineStatus,
  type BaselineTag,
} from "@/lib/baseline-types";

/* ------------------------------------------------------------------ */
/*  TagBadge — single 13x13px colored letter badge                     */
/* ------------------------------------------------------------------ */

function TagBadge({ tag }: { tag: BaselineTag }) {
  const cfg = TAG_BADGE_CONFIG[tag];
  return (
    <span
      data-tag={tag}
      data-testid={`tag-badge-${tag}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 13,
        height: 13,
        borderRadius: 2,
        backgroundColor: cfg.bgColor,
        color: cfg.color,
        fontSize: 7,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  BaselineCellView                                                    */
/* ------------------------------------------------------------------ */

interface BaselineCellViewProps {
  status: BaselineStatus;
  tags: BaselineTag[];
  editing?: boolean;
  onClick?: () => void;
}

export function BaselineCellView({
  status,
  tags,
  editing,
  onClick,
}: BaselineCellViewProps) {
  const statusCfg = STATUS_CONFIG[status];

  return (
    <div
      className={editing ? "cursor-pointer" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: tags.length > 0 ? 3 : 0,
      }}
      onClick={editing ? onClick : undefined}
      onMouseOver={
        editing
          ? (e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "var(--bg-muted)";
            }
          : undefined
      }
      onMouseOut={
        editing
          ? (e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "";
            }
          : undefined
      }
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>{statusCfg.emoji}</span>

      {tags.length > 0 && (
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 1 }}
        >
          {tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </span>
      )}
    </div>
  );
}
