import { useMemo, useRef, useState, useEffect } from "react";
import {
  Crosshair,
  Upload,
  FileImage,
  Check,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Calendar,
  Hash,
  Shield,
  ArrowRight,
  ArrowLeft,
  Layers,
  Cpu,
  CheckCheck,
  X,
  Flame,
  Swords,
  ChevronRight,
  Sparkles,
} from "lucide-react";

/**
 * VALORANT MATCH ANALYZER — Tactical Esports Analytics UI v3
 *
 * Professional, high-density competitive gaming statistics interface.
 * Preserves 100% of existing canonical contracts, local OCR, SQLite, and Google Sheets integration.
 */

const CONFIG = {
  ANALYZE_ENDPOINT: "/api/analyze-scoreboard",
  SHEETS_ENDPOINT: "/api/push-match",
  NEXT_ID_ENDPOINT: "/api/next-match-id",
  TEAMS_ENDPOINT: "/api/teams",
  FALLBACK_TEAMS: [
    "TEAM PTSD",
    "TEAM UltraViolence",
    "TEAM We Mind Esp",
    "TEAM Redline",
    "TEAM Hexa",
    "TEAM JBGD",
    "TEAM Plastic Gng",
  ],
};

const FIELDS = [
  { key: "name", label: "PLAYER", type: "text", width: "160px", align: "left" },
  { key: "agent", label: "AGENT", type: "text", width: "120px", align: "left" },
  { key: "acs", label: "ACS", type: "number", width: "75px", align: "center" },
  { key: "kda", label: "K / D / A", type: "text", width: "105px", align: "center" },
  { key: "econ", label: "ECON", type: "number", width: "75px", align: "center" },
  { key: "firstBloods", label: "FB", type: "number", width: "65px", align: "center" },
  { key: "plants", label: "PLT", type: "number", width: "65px", align: "center" },
  { key: "defuses", label: "DEF", type: "number", width: "65px", align: "center" },
];

const emptyPlayer = () => ({
  name: "",
  agent: "",
  acs: "",
  kda: "",
  econ: "",
  firstBloods: "",
  plants: "",
  defuses: "",
});

const emptyTeam = (color) => ({
  color,
  players: Array.from({ length: 5 }, emptyPlayer),
});

function normalizePlayers(players = []) {
  return Array.from({ length: 5 }, (_, i) => ({
    ...emptyPlayer(),
    ...(players[i] || {}),
  }));
}

function normalizeResult(data) {
  return {
    teamA: {
      color: data?.teamA?.color || data?.teamA?.detectedColor || "red",
      players: normalizePlayers(data?.teamA?.players),
    },
    teamB: {
      color: data?.teamB?.color || data?.teamB?.detectedColor || "teal",
      players: normalizePlayers(data?.teamB?.players),
    },
  };
}

function isMissing(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function validatePlayers(team) {
  const errors = [];
  team.players.forEach((p, index) => {
    const row = index + 1;
    if (isMissing(p.name)) errors.push(`Player ${row}: Name is required.`);
    if (isMissing(p.agent)) errors.push(`Player ${row}: Agent is required.`);
    if (isMissing(p.acs)) errors.push(`Player ${row}: ACS is required.`);
    if (isMissing(p.kda) || !/^\d+\/\d+\/\d+$/.test(String(p.kda).trim())) {
      errors.push(`Player ${row}: K/D/A must be formatted as XX/XX/XX (e.g. 20/15/4).`);
    }
    if (isMissing(p.econ)) errors.push(`Player ${row}: ECON is required.`);
    if (isMissing(p.firstBloods)) errors.push(`Player ${row}: FB is required.`);
    if (isMissing(p.plants)) errors.push(`Player ${row}: PLT is required.`);
    if (isMissing(p.defuses)) errors.push(`Player ${row}: DEF is required.`);
  });
  return errors;
}

function cleanForApi(team) {
  return {
    detectedColor: team.color || "unknown",
    players: team.players.map((p) => ({
      name: String(p.name).trim(),
      agent: String(p.agent).trim(),
      acs: Number(p.acs),
      kda: String(p.kda).trim(),
      econ: Number(p.econ),
      firstBloods: Number(p.firstBloods),
      plants: Number(p.plants),
      defuses: Number(p.defuses),
    })),
  };
}

/* ==========================================================================
   SUB-COMPONENTS: HEADER, STEPPER, PILLS
   ========================================================================== */

function TacticalHeader({ onReset }) {
  return (
    <header style={{
      borderBottom: "1px solid var(--border-subtle)",
      background: "rgba(10, 14, 20, 0.75)",
      backdropFilter: "blur(12px)",
      padding: "16px 28px",
      position: "sticky",
      top: 0,
      zIndex: 40,
    }}>
      <div style={{
        maxWidth: 1440,
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 38,
            height: 38,
            background: "linear-gradient(135deg, var(--val-red) 0%, #901C25 100%)",
            borderRadius: 6,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 0 16px var(--val-red-glow)",
          }}>
            <Crosshair size={22} color="#FFFFFF" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{
              fontFamily: "var(--font-heading)",
              fontSize: 20,
              fontWeight: 900,
              letterSpacing: 2,
              color: "#FFFFFF",
              lineHeight: 1.1,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              VALORANT <span style={{ color: "var(--val-red)" }}>ANALYZER</span>
            </div>
            <div style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: 1.5,
              color: "var(--text-muted)",
              marginTop: 3,
              textTransform: "uppercase",
            }}>
              Local Scoreboard Vision & Tournament Manager
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 999,
            background: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.25)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.2,
            color: "var(--val-green)",
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--val-green)",
              boxShadow: "0 0 8px var(--val-green)",
            }} className="pulsing-indicator" />
            LOCAL ENGINE ONLINE
          </div>

          <button
            onClick={onReset}
            title="Start New Match / Reset"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--bg-card)",
              border: "1px solid var(--border-medium)",
              color: "var(--text-secondary)",
              padding: "7px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "var(--text-secondary)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "var(--border-medium)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <RefreshCw size={13} />
            NEW SESSION
          </button>
        </div>
      </div>
    </header>
  );
}

function WorkflowStepper({ step }) {
  const steps = [
    { num: 1, label: "UPLOAD SCOREBOARD" },
    { num: 2, label: "REVIEW STATS" },
    { num: 3, label: "ASSIGN MATCH" },
    { num: 4, label: "FINAL CONFIRMATION" },
    { num: 5, label: "SYNCED" },
  ];

  return (
    <nav style={{
      maxWidth: 1440,
      margin: "24px auto 28px",
      padding: "0 24px",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        padding: "10px 18px",
        overflowX: "auto",
        gap: 12,
      }}>
        {steps.map((s, i) => {
          const isComplete = step > s.num;
          const isActive = step === s.num;

          return (
            <div key={s.num} style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  background: isComplete
                    ? "var(--val-green)"
                    : isActive
                      ? "var(--val-red)"
                      : "var(--bg-card)",
                  color: isComplete || isActive ? "#FFFFFF" : "var(--text-muted)",
                  border: `1px solid ${isComplete
                      ? "var(--val-green)"
                      : isActive
                        ? "var(--val-red)"
                        : "var(--border-medium)"
                    }`,
                  boxShadow: isActive ? "0 0 12px var(--val-red-glow)" : "none",
                  transition: "all 0.2s ease",
                }}>
                  {isComplete ? <Check size={14} strokeWidth={3} /> : s.num}
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  fontFamily: "var(--font-heading)",
                  color: isActive ? "#FFFFFF" : isComplete ? "var(--text-primary)" : "var(--text-muted)",
                }}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div style={{
                  width: 24,
                  height: 1,
                  background: isComplete ? "rgba(52, 211, 153, 0.4)" : "var(--border-subtle)",
                  marginLeft: 4,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/* ==========================================================================
   STEP 1: UPLOAD & IMAGE METADATA CARD
   ========================================================================== */

function UploadZone({ onFileSelected, dragging, setDragging, inputRef }) {
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.[0]) onFileSelected(e.dataTransfer.files[0]);
      }}
      style={{
        maxWidth: 1000,
        margin: "40px auto",
        padding: "60px 32px",
        background: dragging ? "var(--val-red-bg)" : "var(--bg-surface)",
        border: `2px dashed ${dragging ? "var(--val-red)" : "var(--border-medium)"}`,
        borderRadius: 12,
        textAlign: "center",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "all 0.2s ease",
        boxShadow: dragging ? "0 0 30px var(--val-red-glow)" : "none",
      }}
    >
      {/* Corner crosshairs */}
      <div style={{ position: "absolute", top: 12, left: 12, width: 12, height: 12, borderTop: "2px solid var(--val-red)", borderLeft: "2px solid var(--val-red)" }} />
      <div style={{ position: "absolute", top: 12, right: 12, width: 12, height: 12, borderTop: "2px solid var(--val-red)", borderRight: "2px solid var(--val-red)" }} />
      <div style={{ position: "absolute", bottom: 12, left: 12, width: 12, height: 12, borderBottom: "2px solid var(--val-red)", borderLeft: "2px solid var(--val-red)" }} />
      <div style={{ position: "absolute", bottom: 12, right: 12, width: 12, height: 12, borderBottom: "2px solid var(--val-red)", borderRight: "2px solid var(--val-red)" }} />

      <div style={{
        width: 64,
        height: 64,
        margin: "0 auto 20px",
        background: "var(--bg-card)",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        border: "1px solid var(--border-medium)",
        color: "var(--val-red)",
      }}>
        <Upload size={28} />
      </div>

      <div style={{
        fontFamily: "var(--font-heading)",
        fontSize: 22,
        fontWeight: 800,
        letterSpacing: 2,
        color: "#FFFFFF",
        marginBottom: 8,
      }}>
        DROP VALORANT SCOREBOARD HERE
      </div>

      <div style={{
        fontSize: 13,
        color: "var(--text-secondary)",
        maxWidth: 480,
        margin: "0 auto 16px",
        lineHeight: 1.5,
      }}>
        Upload any endgame scoreboard screenshot. Our local vision engine will detect the 10 player rows and extract full combat stats.
      </div>

      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        background: "var(--bg-input)",
        border: "1px solid var(--border-subtle)",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
      }}>
        PNG · JPG · WEBP · 1080p / 1440p / 4K
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
        style={{ display: "none" }}
      />
    </div>
  );
}

function ImagePreviewCard({ preview, fileMeta, onAnalyze, onClear, loading }) {
  return (
    <div style={{
      maxWidth: 1100,
      margin: "0 auto 32px",
      background: "var(--bg-surface)",
      border: "1px solid var(--border-medium)",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        background: "var(--bg-card)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FileImage size={18} color="var(--val-red)" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, color: "#FFFFFF" }}>
            {fileMeta.name || "Scoreboard Screenshot"}
          </span>
          {fileMeta.size && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              ({fileMeta.size})
            </span>
          )}
          {fileMeta.dimensions && (
            <span style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              padding: "2px 8px",
              borderRadius: 4,
              background: "var(--bg-input)",
              color: "var(--val-teal)",
              border: "1px solid var(--border-subtle)",
            }}>
              {fileMeta.dimensions}
            </span>
          )}
        </div>

        <button
          onClick={onClear}
          disabled={loading}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <X size={14} /> CLEAR
        </button>
      </div>

      <div style={{
        position: "relative",
        background: "#070A0E",
        display: "grid",
        placeItems: "center",
        padding: 12,
        maxHeight: 520,
        overflow: "hidden",
      }}>
        <img
          src={preview}
          alt="Scoreboard source"
          style={{
            maxWidth: "100%",
            maxHeight: 480,
            objectFit: "contain",
            borderRadius: 6,
            display: "block",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        />

        {loading && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "rgba(9, 12, 16, 0.88)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 10,
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "2px solid var(--val-red-dim)",
              borderTopColor: "var(--val-red)",
              marginBottom: 18,
            }} className="radar-spinner" />

            <div style={{
              fontFamily: "var(--font-heading)",
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: 2,
              color: "#FFFFFF",
              marginBottom: 8,
            }}>
              LOCAL VISION ENGINE AT WORK
            </div>

            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxWidth: 360,
              width: "100%",
              margin: "12px auto 0",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--val-green)" }}>✓</span> Row detection & geometry cropping
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--val-teal)" }}>●</span> OCR text recognition (ACS, K/D/A, ECON)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--val-red)" }}>●</span> Color classification (Red vs Teal sides)
              </div>
            </div>
          </div>
        )}
      </div>

      {!loading && (
        <div style={{
          padding: "16px 20px",
          background: "var(--bg-card)",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
        }}>
          <button
            onClick={onClear}
            style={{
              background: "transparent",
              border: "1px solid var(--border-medium)",
              color: "var(--text-secondary)",
              padding: "11px 18px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            CHANGE IMAGE
          </button>
          <button
            onClick={onAnalyze}
            style={{
              background: "linear-gradient(135deg, var(--val-red) 0%, #D12E3C 100%)",
              border: "none",
              color: "#FFFFFF",
              padding: "11px 26px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 1.5,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 0 16px var(--val-red-glow)",
              transition: "transform 0.1s ease",
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.98)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <Cpu size={16} /> ANALYZE SCOREBOARD
          </button>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   STEP 2: OCR REVIEW — EDITABLE TEAM SCOREBOARD
   ========================================================================== */

function TeamScoreboard({ team, teamLabel, detectedColor, onChange, onFocusField }) {
  const isRed = detectedColor === "red";
  const accentColor = isRed ? "var(--val-red)" : "var(--val-teal)";
  const accentDim = isRed ? "var(--val-red-dim)" : "var(--val-teal-dim)";
  const accentBg = isRed ? "var(--val-red-bg)" : "var(--val-teal-bg)";
  const glow = isRed ? "var(--val-red-glow)" : "var(--val-teal-glow)";

  return (
    <div style={{
      background: "var(--bg-card)",
      border: `1px solid var(--border-medium)`,
      borderTop: `3px solid ${accentColor}`,
      borderRadius: 8,
      overflow: "hidden",
      flex: 1,
      minWidth: 520,
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Team Header Bar */}
      <div style={{
        padding: "12px 18px",
        background: `linear-gradient(90deg, ${accentBg} 0%, rgba(20, 27, 36, 0.4) 100%)`,
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={18} color={accentColor} />
          <div>
            <div style={{
              fontFamily: "var(--font-heading)",
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: 2,
              color: "#FFFFFF",
            }}>
              {teamLabel}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase" }}>
              Detected Side: <strong style={{ color: accentColor }}>{detectedColor}</strong>
            </div>
          </div>
        </div>

        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 4,
          background: "var(--bg-input)",
          border: `1px solid ${accentDim}`,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          color: accentColor,
        }}>
          5 / 5 PLAYERS
        </div>
      </div>

      {/* Editable Table */}
      <div style={{ overflowX: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580 }}>
          <thead>
            <tr style={{ background: "var(--bg-input)", borderBottom: "1px solid var(--border-subtle)" }}>
              <th style={{ width: "32px", padding: "8px 6px", textAlign: "center", fontSize: 9, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>#</th>
              {FIELDS.map((f) => (
                <th
                  key={f.key}
                  style={{
                    width: f.width,
                    padding: "8px 6px",
                    textAlign: f.align,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-heading)",
                  }}
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.players.map((p, rowIndex) => {
              const isKdaInvalid = p.kda && !/^\d+\/\d+\/\d+$/.test(String(p.kda).trim());
              const isPlayerMissing = isMissing(p.name);

              return (
                <tr
                  key={rowIndex}
                  style={{
                    background: rowIndex % 2 === 0 ? "rgba(14, 19, 27, 0.6)" : "transparent",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <td style={{
                    textAlign: "center",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 500,
                    color: "var(--text-muted)",
                    padding: "4px 4px",
                  }}>
                    {rowIndex + 1}
                  </td>

                  {FIELDS.map((f) => {
                    const val = p[f.key] ?? "";
                    const missing = isMissing(val);
                    const hasError = (f.key === "kda" && isKdaInvalid) || missing;

                    return (
                      <td key={f.key} style={{ padding: "4px 4px" }}>
                        <input
                          type={f.type}
                          inputMode={f.type === "number" ? "numeric" : "text"}
                          value={val}
                          placeholder={missing ? "[ — ]" : ""}
                          onChange={(e) => onChange(rowIndex, f.key, e.target.value)}
                          onFocus={() => onFocusField && onFocusField(rowIndex, f.key)}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "6px 7px",
                            background: missing ? "rgba(255, 70, 85, 0.05)" : "var(--bg-input)",
                            border: `1px solid ${hasError ? "rgba(255, 70, 85, 0.5)" : "var(--border-subtle)"}`,
                            borderRadius: 4,
                            color: f.key === "agent" ? accentColor : f.key === "kda" ? "#FFFFFF" : "var(--text-primary)",
                            fontSize: 12,
                            fontWeight: f.key === "name" || f.key === "kda" ? 700 : 500,
                            fontFamily: f.type === "number" || f.key === "kda" ? "var(--font-mono)" : "var(--font-body)",
                            fontVariantNumeric: f.type === "number" || f.key === "kda" ? "tabular-nums" : "normal",
                            textAlign: f.align,
                            outline: "none",
                            transition: "border-color 0.15s ease",
                          }}
                          onFocus={(e) => {
                            e.target.style.borderColor = accentColor;
                            e.target.style.boxShadow = `0 0 8px ${glow}`;
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = hasError ? "rgba(255, 70, 85, 0.5)" : "var(--border-subtle)";
                            e.target.style.boxShadow = "none";
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ==========================================================================
   STEP 3: MATCH CONFIGURATION PANEL
   ========================================================================== */

function MatchConfigSection({
  teamAName,
  setTeamAName,
  teamBName,
  setTeamBName,
  teamsList,
  matchId,
  setMatchId,
  matchDate,
  setMatchDate,
  onProceed,
  isValid,
}) {
  const isMatchIdValid = /^M\d+$/.test(matchId);

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: "1px solid var(--border-medium)",
      borderRadius: 10,
      padding: 24,
      marginTop: 24,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--border-subtle)",
        paddingBottom: 14,
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Swords size={20} color="var(--val-red)" />
          <span style={{
            fontFamily: "var(--font-heading)",
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 2,
            color: "#FFFFFF",
          }}>
            MATCH CONFIGURATION & TEAM ASSIGNMENT
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Select the active tournament teams for both detected sides
        </span>
      </div>

      {/* Team Selection VS Layout */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 20,
      }}>
        {/* Team A Picker */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <label style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "var(--font-heading)",
            letterSpacing: 1.5,
            color: "var(--val-red)",
            marginBottom: 8,
          }}>
            TEAM A (DETECTED RED SIDE)
          </label>
          <select
            value={teamAName}
            onChange={(e) => setTeamAName(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "var(--bg-input)",
              border: `1px solid ${!teamAName ? "rgba(255,70,85,0.4)" : "var(--border-medium)"}`,
              borderRadius: 6,
              color: teamAName ? "#FFFFFF" : "var(--text-muted)",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <option value="">Select official team…</option>
            {teamsList.map((t) => (
              <option key={t} value={t} disabled={t === teamBName}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* VS Badge */}
        <div style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-heading)",
          fontWeight: 900,
          fontSize: 14,
          letterSpacing: 1,
          color: "var(--text-muted)",
          marginTop: 18,
          flexShrink: 0,
        }}>
          VS
        </div>

        {/* Team B Picker */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <label style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "var(--font-heading)",
            letterSpacing: 1.5,
            color: "var(--val-teal)",
            marginBottom: 8,
          }}>
            TEAM B (DETECTED TEAL SIDE)
          </label>
          <select
            value={teamBName}
            onChange={(e) => setTeamBName(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "var(--bg-input)",
              border: `1px solid ${!teamBName ? "rgba(0,245,212,0.4)" : "var(--border-medium)"}`,
              borderRadius: 6,
              color: teamBName ? "#FFFFFF" : "var(--text-muted)",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <option value="">Select official team…</option>
            {teamsList.map((t) => (
              <option key={t} value={t} disabled={t === teamAName}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Match ID and Date Row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 16,
        marginBottom: 20,
      }}>
        {/* Match ID Field */}
        <div>
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "var(--font-heading)",
            letterSpacing: 1.5,
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}>
            <Hash size={13} /> MATCH ID (USER-EDITABLE)
          </label>
          <input
            type="text"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value.trim())}
            placeholder="e.g. M001, M025"
            style={{
              width: "100%",
              padding: "11px 14px",
              background: "var(--bg-input)",
              border: `1px solid ${isMatchIdValid ? "var(--border-medium)" : "var(--val-red)"}`,
              borderRadius: 6,
              color: "#FFFFFF",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 700,
              letterSpacing: 1,
            }}
          />
          {!isMatchIdValid ? (
            <div style={{ color: "var(--val-red)", fontSize: 11, marginTop: 5 }}>
              Must follow format: M + digits (e.g. M001, M025)
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 5 }}>
              Auto-suggested from SQLite. You may customize it before final submission.
            </div>
          )}
        </div>

        {/* Match Date Field */}
        <div>
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "var(--font-heading)",
            letterSpacing: 1.5,
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}>
            <Calendar size={13} /> OFFICIAL MATCH DATE
          </label>
          <input
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            style={{
              width: "100%",
              padding: "11px 14px",
              background: "var(--bg-input)",
              border: "1px solid var(--border-medium)",
              borderRadius: 6,
              color: "#FFFFFF",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
            }}
          />
        </div>
      </div>

      {/* Target Destination Indicator */}
      <div style={{
        padding: "12px 16px",
        borderRadius: 6,
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        fontSize: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Layers size={14} color="var(--text-muted)" />
          <span style={{ color: "var(--text-muted)" }}>Target Tabs in Spreadsheet:</span>
          <strong style={{ color: teamAName ? "var(--val-red)" : "var(--text-muted)" }}>
            {teamAName ? `[${teamAName}]` : "Team A (Unassigned)"}
          </strong>
          <span style={{ color: "var(--text-muted)" }}>&</span>
          <strong style={{ color: teamBName ? "var(--val-teal)" : "var(--text-muted)" }}>
            {teamBName ? `[${teamBName}]` : "Team B (Unassigned)"}
          </strong>
        </div>

        <button
          onClick={onProceed}
          disabled={!isValid}
          style={{
            background: isValid
              ? "linear-gradient(135deg, var(--val-red) 0%, #D12E3C 100%)"
              : "var(--bg-input)",
            border: `1px solid ${isValid ? "var(--val-red)" : "var(--border-subtle)"}`,
            color: isValid ? "#FFFFFF" : "var(--text-muted)",
            padding: "10px 22px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 800,
            fontFamily: "var(--font-heading)",
            letterSpacing: 1.5,
            cursor: isValid ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            boxShadow: isValid ? "0 0 16px var(--val-red-glow)" : "none",
          }}
        >
          PROCEED TO FINAL REVIEW <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ==========================================================================
   STEP 4: FINAL PREVIEW & SUMMARY
   ========================================================================== */

function FinalPreviewSection({
  matchId,
  matchDate,
  teamAName,
  teamBName,
  teamA,
  teamB,
  onBack,
  onSubmit,
  isPushing,
}) {
  return (
    <div style={{
      maxWidth: 1400,
      margin: "0 auto 32px",
    }}>
      {/* Top Banner */}
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-medium)",
        borderRadius: 10,
        padding: "20px 24px",
        marginBottom: 20,
      }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}>
          <div>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--val-gold)",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 2,
              marginBottom: 4,
            }}>
              <Sparkles size={13} /> READY FOR SPREADSHEET SYNC
            </div>
            <div style={{
              fontFamily: "var(--font-heading)",
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: 3,
              color: "#FFFFFF",
            }}>
              MATCH {matchId} SUMMARY
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
              Verify all edited player rows and combat statistics before committing to Google Sheets.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              padding: "8px 14px",
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              textAlign: "right",
            }}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--text-muted)", fontWeight: 700 }}>DATE</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "#FFFFFF" }}>{matchDate}</div>
            </div>
            <div style={{
              padding: "8px 14px",
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              textAlign: "right",
            }}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--text-muted)", fontWeight: 700 }}>MATCH ID</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--val-teal)" }}>{matchId}</div>
            </div>
          </div>
        </div>
      </div>

      {/* VS Match Preview Block */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(520px, 1fr))",
        gap: 20,
        marginBottom: 20,
      }}>
        {/* Team A Card */}
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          borderTop: "3px solid var(--val-red)",
          borderRadius: 8,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 18px",
            background: "var(--val-red-bg)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 1.5, color: "#FFFFFF" }}>{teamAName}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Opponent: <span style={{ color: "#FFFFFF" }}>{teamBName}</span></div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 4, background: "rgba(255,70,85,0.2)", color: "var(--val-red)" }}>TEAM A</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-input)", borderBottom: "1px solid var(--border-subtle)" }}>
                {FIELDS.map(f => (
                  <th key={f.key} style={{ padding: "8px 6px", fontSize: 9, fontWeight: 800, color: "var(--text-secondary)", textAlign: f.align }}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamA.players.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: i % 2 === 0 ? "rgba(14, 19, 27, 0.4)" : "transparent" }}>
                  <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: "#FFFFFF" }}>{p.name}</td>
                  <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 500, color: "var(--val-red)" }}>{p.agent}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.acs}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#FFFFFF" }}>{p.kda}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.econ}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.firstBloods}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.plants}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.defuses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Team B Card */}
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          borderTop: "3px solid var(--val-teal)",
          borderRadius: 8,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 18px",
            background: "var(--val-teal-bg)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 1.5, color: "#FFFFFF" }}>{teamBName}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Opponent: <span style={{ color: "#FFFFFF" }}>{teamAName}</span></div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 4, background: "rgba(0,245,212,0.2)", color: "var(--val-teal)" }}>TEAM B</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-input)", borderBottom: "1px solid var(--border-subtle)" }}>
                {FIELDS.map(f => (
                  <th key={f.key} style={{ padding: "8px 6px", fontSize: 9, fontWeight: 800, color: "var(--text-secondary)", textAlign: f.align }}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamB.players.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: i % 2 === 0 ? "rgba(14, 19, 27, 0.4)" : "transparent" }}>
                  <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: "#FFFFFF" }}>{p.name}</td>
                  <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 500, color: "var(--val-teal)" }}>{p.agent}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.acs}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#FFFFFF" }}>{p.kda}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.econ}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.firstBloods}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.plants}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{p.defuses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Actions Bar */}
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 14,
      }}>
        <button
          onClick={onBack}
          disabled={isPushing}
          style={{
            background: "transparent",
            border: "1px solid var(--border-medium)",
            color: "var(--text-secondary)",
            padding: "12px 20px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            cursor: isPushing ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeft size={15} /> EDIT DATA
        </button>

        <button
          onClick={onSubmit}
          disabled={isPushing}
          style={{
            background: isPushing
              ? "var(--bg-input)"
              : "linear-gradient(135deg, #10B981 0%, #059669 100%)",
            border: "none",
            color: "#FFFFFF",
            padding: "13px 32px",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 900,
            fontFamily: "var(--font-heading)",
            letterSpacing: 2,
            cursor: isPushing ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            boxShadow: isPushing ? "none" : "0 0 20px rgba(16, 185, 129, 0.3)",
          }}
        >
          {isPushing ? (
            <>
              <RefreshCw size={16} className="radar-spinner" />
              COMMITTING TO GOOGLE SHEETS…
            </>
          ) : (
            <>
              <CheckCheck size={18} />
              COMMIT MATCH TO GOOGLE SHEETS
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ==========================================================================
   STEP 5: SUCCESS STATE SCREEN
   ========================================================================== */

function SuccessScreen({ matchId, teamAName, teamBName, onNewMatch }) {
  return (
    <div style={{
      maxWidth: 720,
      margin: "48px auto",
      background: "var(--bg-surface)",
      border: "1px solid rgba(52, 211, 153, 0.35)",
      borderRadius: 12,
      padding: "48px 36px",
      textAlign: "center",
      boxShadow: "0 0 30px rgba(52, 211, 153, 0.1)",
    }}>
      <div style={{
        width: 68,
        height: 68,
        borderRadius: "50%",
        background: "rgba(52, 211, 153, 0.1)",
        border: "2px solid var(--val-green)",
        display: "grid",
        placeItems: "center",
        margin: "0 auto 20px",
        color: "var(--val-green)",
        boxShadow: "0 0 20px rgba(52, 211, 153, 0.3)",
      }}>
        <CheckCircle2 size={36} />
      </div>

      <div style={{
        fontFamily: "var(--font-heading)",
        fontSize: 28,
        fontWeight: 900,
        letterSpacing: 2,
        color: "#FFFFFF",
        marginBottom: 8,
      }}>
        MATCH {matchId} COMMITTED
      </div>

      <div style={{
        fontSize: 14,
        color: "var(--text-secondary)",
        maxWidth: 520,
        margin: "0 auto 24px",
        lineHeight: 1.6,
      }}>
        Match statistics were successfully written to your production Google Spreadsheet and recorded in local SQLite audit history.
      </div>

      {/* Teams Confirmed Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        maxWidth: 500,
        margin: "0 auto 32px",
      }}>
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          borderTop: "3px solid var(--val-red)",
          borderRadius: 8,
          padding: 14,
          textAlign: "left",
        }}>
          <div style={{ fontSize: 10, color: "var(--val-red)", fontWeight: 800 }}>TEAM A UPDATED</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#FFFFFF", marginTop: 2 }}>{teamAName}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>5 players logged</div>
        </div>

        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          borderTop: "3px solid var(--val-teal)",
          borderRadius: 8,
          padding: 14,
          textAlign: "left",
        }}>
          <div style={{ fontSize: 10, color: "var(--val-teal)", fontWeight: 800 }}>TEAM B UPDATED</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#FFFFFF", marginTop: 2 }}>{teamBName}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>5 players logged</div>
        </div>
      </div>

      <button
        onClick={onNewMatch}
        style={{
          background: "linear-gradient(135deg, var(--val-red) 0%, #D12E3C 100%)",
          border: "none",
          color: "#FFFFFF",
          padding: "14px 36px",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 900,
          fontFamily: "var(--font-heading)",
          letterSpacing: 2,
          cursor: "pointer",
          boxShadow: "0 0 20px var(--val-red-glow)",
        }}
      >
        PROCESS NEXT SCOREBOARD
      </button>
    </div>
  );
}

/* ==========================================================================
   ERROR BANNER
   ========================================================================== */

function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div style={{
      maxWidth: 1400,
      margin: "0 auto 20px",
      background: "rgba(61, 18, 24, 0.95)",
      border: "1px solid var(--val-red)",
      borderRadius: 8,
      padding: "14px 18px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      boxShadow: "0 4px 16px rgba(255, 70, 85, 0.15)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <AlertTriangle size={18} color="var(--val-red)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#FFA1A8", letterSpacing: 1 }}>
            SYSTEM ALERT
          </div>
          <div style={{ fontSize: 13, color: "#FFE4E6", marginTop: 2, lineHeight: 1.5 }}>
            {error}
          </div>
        </div>
      </div>

      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: "transparent",
            border: "none",
            color: "#FFA1A8",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

/* ==========================================================================
   MAIN EXPORT COMPONENT
   ========================================================================== */

export default function ValorantAnalyzerV2() {
  const inputRef = useRef(null);

  // Upload state
  const [preview, setPreview] = useState(null);
  const [b64, setB64] = useState(null);
  const [mimeType, setMimeType] = useState("image/png");
  const [fileMeta, setFileMeta] = useState({});
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  // Extracted data & user edits
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Configuration
  const [teamAName, setTeamAName] = useState("");
  const [teamBName, setTeamBName] = useState("");
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [matchId, setMatchId] = useState("M001");
  const [teamsList, setTeamsList] = useState(CONFIG.FALLBACK_TEAMS);

  // Workflow steps
  const [showPreview, setShowPreview] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [success, setSuccess] = useState(false);

  // Fetch initial data
  const fetchMatchId = async () => {
    try {
      const res = await fetch(CONFIG.NEXT_ID_ENDPOINT);
      const data = await res.json();
      if (data?.matchId) {
        setMatchId(data.matchId);
      }
    } catch (err) {
      console.warn("[INIT] Could not fetch next match ID:", err.message);
    }
  };

  const fetchTeams = async () => {
    try {
      const res = await fetch(CONFIG.TEAMS_ENDPOINT);
      const data = await res.json();
      if (Array.isArray(data?.teams) && data.teams.length > 0) {
        setTeamsList(data.teams);
      }
    } catch (err) {
      console.warn("[INIT] Could not fetch dynamic team list:", err.message);
    }
  };

  useEffect(() => {
    fetchMatchId();
    fetchTeams();
  }, []);

  // Compute current step (1 to 5)
  const currentStep = success ? 5 : showPreview ? 4 : result ? (teamAName && teamBName ? 3 : 2) : 1;

  // Validation rules
  const validation = useMemo(() => {
    if (!result) return { valid: false, errors: [] };
    const errors = [];
    if (!matchId || !/^M\d+$/.test(String(matchId).trim())) {
      errors.push("Match ID must be formatted as M + digits (e.g. M001, M025).");
    }
    if (!teamAName) errors.push("Assign Team A.");
    if (!teamBName) errors.push("Assign Team B.");
    if (teamAName && teamBName && teamAName === teamBName) {
      errors.push("Team A and Team B cannot be the same team.");
    }
    if (!matchDate) errors.push("Match date is required.");
    if ((result.teamA?.players || []).length !== 5) errors.push("Team A must contain 5 players.");
    if ((result.teamB?.players || []).length !== 5) errors.push("Team B must contain 5 players.");
    errors.push(...validatePlayers(result.teamA || emptyTeam("red")).map((e) => `Team A — ${e}`));
    errors.push(...validatePlayers(result.teamB || emptyTeam("teal")).map((e) => `Team B — ${e}`));

    return { valid: errors.length === 0, errors };
  }, [result, teamAName, teamBName, matchDate, matchId]);

  // Handle image selection
  const handleFileSelected = (file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Please upload a valid image file (PNG, JPG, or WEBP).");
      return;
    }

    setMimeType(file.type || "image/png");
    const formattedSize = file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(file.size / 1024)} KB`;

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setFileMeta({
        name: file.name,
        size: formattedSize,
        dimensions: `${img.naturalWidth} × ${img.naturalHeight} px`,
      });
    };
    img.src = objectUrl;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(objectUrl);
      setB64(ev.target.result.split(",")[1]);
      setResult(null);
      setError(null);
      setSuccess(false);
      setShowPreview(false);
      fetchMatchId();
    };
    reader.readAsDataURL(file);
  };

  // Run OCR analysis
  const runAnalysis = async () => {
    if (!b64) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(CONFIG.ANALYZE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Local OCR scoreboard analysis failed.");
      }
      setResult(normalizeResult(data));
    } catch (err) {
      setError(err.message || "Failed to analyze scoreboard. Ensure Tesseract and Python are running locally.");
    } finally {
      setLoading(false);
    }
  };

  // Edit player field
  const handleUpdatePlayer = (teamKey, rowIndex, field, value) => {
    setResult((current) => ({
      ...current,
      [teamKey]: {
        ...current[teamKey],
        players: current[teamKey].players.map((p, i) => (i === rowIndex ? { ...p, [field]: value } : p)),
      },
    }));
    setShowPreview(false);
  };

  // Proceed to Final Review
  const handleOpenPreview = () => {
    setError(null);
    if (!validation.valid) {
      setError(validation.errors.slice(0, 4).join(" · "));
      return;
    }
    setShowPreview(true);
  };

  // Submit match to Google Sheets
  const handleSubmitMatch = async () => {
    if (!validation.valid) return;
    setPushing(true);
    setError(null);

    try {
      const payload = {
        matchId,
        matchDate,
        teamA: { name: teamAName, ...cleanForApi(result.teamA) },
        teamB: { name: teamBName, ...cleanForApi(result.teamB) },
      };

      const res = await fetch(CONFIG.SHEETS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Failed to submit match to Google Sheets.");
      }

      setSuccess(true);
      fetchMatchId();
    } catch (err) {
      setError(err.message || "Match submission failed. Check console or backend connection.");
    } finally {
      setPushing(false);
    }
  };

  // Reset / Clear
  const handleReset = () => {
    setPreview(null);
    setB64(null);
    setResult(null);
    setError(null);
    setFileMeta({});
    setDragging(false);
    setTeamAName("");
    setTeamBName("");
    setShowPreview(false);
    setSuccess(false);
    fetchMatchId();
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-core)", color: "var(--text-primary)" }}>
      {/* 1. Header */}
      <TacticalHeader onReset={handleReset} />

      {/* 2. Step Bar */}
      <WorkflowStepper step={currentStep} />

      {/* Main Content Area */}
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "0 24px 60px" }}>
        {/* Error Alert Banner */}
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {/* STEP 1: Upload Dropzone */}
        {!preview && !success && (
          <UploadZone
            onFileSelected={handleFileSelected}
            dragging={dragging}
            setDragging={setDragging}
            inputRef={inputRef}
          />
        )}

        {/* Image Preview & OCR Trigger */}
        {preview && !result && !success && (
          <ImagePreviewCard
            preview={preview}
            fileMeta={fileMeta}
            onAnalyze={runAnalysis}
            onClear={handleReset}
            loading={loading}
          />
        )}

        {/* STEP 2 & 3: Review Extracted Stats & Configure Match */}
        {result && !showPreview && !success && (
          <>
            {/* Extraction Overview Pill */}
            <div style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-medium)",
              borderRadius: 8,
              padding: "12px 18px",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img
                  src={preview}
                  alt="Thumbnail"
                  style={{ width: 56, height: 32, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border-subtle)" }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#FFFFFF" }}>
                    SCOREBOARD EXTRACTION COMPLETE
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Review player statistics below. You can directly edit any field before tournament assignment.
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  background: "rgba(52, 211, 153, 0.1)",
                  border: "1px solid rgba(52, 211, 153, 0.3)",
                  color: "var(--val-green)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                }}>
                  10 / 10 PLAYERS DETECTED
                </span>
                <button
                  onClick={handleReset}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                    padding: "5px 12px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  NEW IMAGE
                </button>
              </div>
            </div>

            {/* Team Scoreboard Grid */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <TeamScoreboard
                team={result.teamA}
                teamLabel="TEAM A"
                detectedColor={result.teamA.color}
                onChange={(r, f, v) => handleUpdatePlayer("teamA", r, f, v)}
              />
              <TeamScoreboard
                team={result.teamB}
                teamLabel="TEAM B"
                detectedColor={result.teamB.color}
                onChange={(r, f, v) => handleUpdatePlayer("teamB", r, f, v)}
              />
            </div>

            {/* Match Configuration */}
            <MatchConfigSection
              teamAName={teamAName}
              setTeamAName={setTeamAName}
              teamBName={teamBName}
              setTeamBName={setTeamBName}
              teamsList={teamsList}
              matchId={matchId}
              setMatchId={setMatchId}
              matchDate={matchDate}
              setMatchDate={setMatchDate}
              onProceed={handleOpenPreview}
              isValid={validation.valid}
            />
          </>
        )}

        {/* STEP 4: Final Review */}
        {showPreview && !success && result && (
          <FinalPreviewSection
            matchId={matchId}
            matchDate={matchDate}
            teamAName={teamAName}
            teamBName={teamBName}
            teamA={result.teamA}
            teamB={result.teamB}
            onBack={() => setShowPreview(false)}
            onSubmit={handleSubmitMatch}
            isPushing={pushing}
          />
        )}

        {/* STEP 5: Success State */}
        {success && (
          <SuccessScreen
            matchId={matchId}
            teamAName={teamAName}
            teamBName={teamBName}
            onNewMatch={handleReset}
          />
        )}
      </main>
    </div>
  );
}
