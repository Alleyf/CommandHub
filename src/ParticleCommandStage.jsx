import { useEffect, useMemo, useRef, useState } from "react";

const TAU = Math.PI * 2;
const COMMAND_NODE_COUNT_FLOOR = 12;
const SELECT_RADIUS = 44;
const DWELL_MS = 280;
const ACTION_COOLDOWN_MS = 900;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
const WRIST = 0;
const INDEX_KNUCKLE = 5;
const PINKY_KNUCKLE = 17;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0), (a?.z || 0) - (b?.z || 0));
}

function classifyHandGesture(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length <= PINKY_TIP) {
    return "tracking";
  }

  const wrist = landmarks[WRIST];
  const palmSpan = Math.max(distance(landmarks[INDEX_KNUCKLE], landmarks[PINKY_KNUCKLE]), 0.01);
  const averageTipDistance =
    [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP].reduce((sum, index) => sum + distance(wrist, landmarks[index]), 0) / 4;
  const openness = averageTipDistance / palmSpan;

  if (openness >= 2.15) return "open";
  if (openness <= 1.45) return "fist";
  return "tracking";
}

function createCommandNodes(commands) {
  const count = Math.max(commands.length, COMMAND_NODE_COUNT_FLOOR);
  return commands.map((command, index) => {
    const progress = (index + 0.5) / count;
    const theta = Math.acos(1 - 2 * progress);
    const phi = (index * Math.PI * (3 - Math.sqrt(5))) % TAU;
    const radius = 160 + (index % 5) * 24;

    return {
      id: command.id,
      radius,
      theta,
      phi,
      phase: index * 0.37,
      orbitSpeed: 0.0016 + (index % 7) * 0.00017,
      lift: 0.22 + (index % 4) * 0.05
    };
  });
}

function projectNode(node, width, height, time) {
  const phi = node.phi + time * node.orbitSpeed;
  const theta = node.theta + Math.sin(time * 0.001 + node.phase) * node.lift;
  const x = node.radius * Math.sin(theta) * Math.cos(phi);
  const y = node.radius * Math.cos(theta) * 0.66;
  const z = node.radius * Math.sin(theta) * Math.sin(phi);
  const depth = 420 / (420 + z + 220);
  const screenX = width / 2 + x * depth;
  const screenY = height / 2 + y * depth;
  return { x, y, z, depth, screenX, screenY };
}

function GestureHud({ tx, gestureEnabled, trackerMode, trackerMessage, selectedName, gestureState, onStart, onStop, selectedCommand }) {
  const statusClass =
    gestureState === "open" ? "gesture-open" : gestureState === "fist" ? "gesture-fist" : "gesture-idle";

  const gestureText =
    gestureState === "open"
      ? tx("particleGestureStateOpen")
      : gestureState === "fist"
        ? tx("particleGestureStateFist")
        : gestureEnabled
          ? trackerMode === "simulated"
            ? tx("particleGestureStateSimulated")
            : tx("particleGestureStateTracking")
          : tx("particleGestureStateIdle");

  return (
    <div className="particle-hud">
      <div className="particle-copy">
        <div className="section-title">{tx("particleStageTitle")}</div>
        <div className="section-copy">{tx("particleStageDesc")}</div>
      </div>
      <div className="particle-status-row">
        <span className={`particle-state-pill ${statusClass}`}>{gestureText}</span>
        <span className="particle-state-pill subtle">{trackerMessage}</span>
      </div>
      <div className="particle-status-row">
        <span className="particle-selection">
          {selectedName ? tx("particleSelected", { name: selectedName }) : tx("particleNoSelection")}
        </span>
      </div>
      <div className="particle-status-row">
        <div className="particle-shortcuts">{gestureEnabled ? tx("particleHintSelect") : tx("particleHintFallback")}</div>
      </div>
      <div className="particle-actions">
        <button className="btn btn-sm teal" onClick={() => selectedCommand && onStart(selectedCommand)} disabled={!selectedCommand}>
          {tx("particleStartAction")}
        </button>
        <button className="btn btn-sm secondary" onClick={() => selectedCommand && onStop(selectedCommand.id)} disabled={!selectedCommand}>
          {tx("particleStopAction")}
        </button>
      </div>
    </div>
  );
}

export default function ParticleCommandStage({
  commands,
  statuses,
  selectedId,
  onSelect,
  onStart,
  onStop,
  gestureEnabled,
  copy,
  format
}) {
  const canvasRef = useRef(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5, active: false, source: "pointer" });
  const dwellRef = useRef({ id: "", at: 0 });
  const frameRef = useRef(0);
  const actionRef = useRef({ lastGesture: "idle", lastActionAt: 0 });
  const trackerRef = useRef({ stream: null, detector: null, video: null, timer: 0 });
  const nearestRef = useRef("");
  const tx = (key, values) => {
    const template = copy[key] || key;
    return values ? format(template, values) : template;
  };
  const nodes = useMemo(() => createCommandNodes(commands), [commands]);
  const selectedCommand = useMemo(() => commands.find((item) => item.id === selectedId) || null, [commands, selectedId]);
  const [trackerMode, setTrackerMode] = useState("off");
  const [trackerMessage, setTrackerMessage] = useState(tx("particleGestureOff"));
  const [gestureState, setGestureState] = useState("idle");

  useEffect(() => {
    setTrackerMessage(gestureEnabled ? tx("particleGestureReady") : tx("particleGestureOff"));
  }, [gestureEnabled, copy, format]);

  useEffect(() => {
    if (!gestureEnabled) {
      setTrackerMode("off");
      setGestureState("idle");
      return undefined;
    }

    function setSimulatedMode(messageKey) {
      setTrackerMode("simulated");
      setTrackerMessage(tx(messageKey));
      setGestureState("idle");
    }

    function handleGestureAction(nextState) {
      const now = Date.now();
      const selected = commands.find((item) => item.id === selectedId);
      if (!selected) return;
      if (nextState === actionRef.current.lastGesture && now - actionRef.current.lastActionAt < ACTION_COOLDOWN_MS) {
        return;
      }

      actionRef.current.lastGesture = nextState;
      actionRef.current.lastActionAt = now;
      if (nextState === "open") onStart(selected);
      if (nextState === "fist") onStop(selected.id);
    }

    const onKeyDown = (event) => {
      if (event.repeat) return;
      const key = String(event.key || "").toLowerCase();
      if (key === "o") {
        setGestureState("open");
        handleGestureAction("open");
      } else if (key === "f") {
        setGestureState("fist");
        handleGestureAction("fist");
      }
    };

    const onKeyUp = (event) => {
      const key = String(event.key || "").toLowerCase();
      if (key === "o" || key === "f") {
        setGestureState("idle");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    if (!window.navigator?.mediaDevices?.getUserMedia || !("HandDetector" in window)) {
      setSimulatedMode("particleGestureUnsupported");
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      };
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    async function startTracking() {
      try {
        const detector = new window.HandDetector({ maxHands: 1, modelType: "full" });
        const stream = await window.navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        trackerRef.current = { stream, detector, video, timer: 0 };
        video.srcObject = stream;
        await video.play();
        setTrackerMode("camera");
        setTrackerMessage(tx("particleGestureCamera"));

        const tick = async () => {
          if (cancelled) return;
          try {
            const hands = await detector.detect(video);
            const hand = Array.isArray(hands) ? hands[0] : null;

            if (hand?.landmarks?.length > INDEX_TIP) {
              const point = hand.landmarks[INDEX_TIP];
              pointerRef.current = {
                x: clamp(1 - point.x / video.videoWidth, 0, 1),
                y: clamp(point.y / video.videoHeight, 0, 1),
                active: true,
                source: "gesture"
              };
              const nextState = classifyHandGesture(hand.landmarks);
              setGestureState(nextState);
              if (nextState === "open" || nextState === "fist") {
                handleGestureAction(nextState);
              }
            } else {
              pointerRef.current.active = false;
              setGestureState("idle");
            }
          } catch {
            setSimulatedMode("particleGestureUnsupported");
            return;
          }

          trackerRef.current.timer = window.setTimeout(tick, 90);
        };

        tick();
      } catch {
        setSimulatedMode("particleGestureDenied");
      }
    }

    startTracking();

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (trackerRef.current.timer) window.clearTimeout(trackerRef.current.timer);
      trackerRef.current.stream?.getTracks?.().forEach((track) => track.stop());
      trackerRef.current = { stream: null, detector: null, video: null, timer: 0 };
    };
  }, [commands, gestureEnabled, onStart, onStop, selectedId, copy, format]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let cancelled = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    const render = (timestamp) => {
      if (cancelled) return;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || 1;
      const height = rect.height || 1;
      context.clearRect(0, 0, width, height);

      const gradient = context.createRadialGradient(width * 0.5, height * 0.5, 10, width * 0.5, height * 0.5, Math.max(width, height) * 0.7);
      gradient.addColorStop(0, "rgba(102, 217, 232, 0.16)");
      gradient.addColorStop(0.5, "rgba(12, 24, 34, 0.12)");
      gradient.addColorStop(1, "rgba(5, 11, 16, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const pointer = pointerRef.current.active
        ? { x: pointerRef.current.x * width, y: pointerRef.current.y * height, active: true }
        : null;

      let nearest = null;
      const projectedNodes = nodes
        .map((node) => {
          const projection = projectNode(node, width, height, timestamp);
          const command = commands.find((item) => item.id === node.id);
          const status = statuses[node.id]?.state || "stopped";
          const radius = 6 + projection.depth * 16 + (selectedId === node.id ? 5 : 0);

          if (pointer?.active) {
            const delta = Math.hypot(pointer.x - projection.screenX, pointer.y - projection.screenY);
            if (delta <= SELECT_RADIUS && (!nearest || delta < nearest.delta)) {
              nearest = { id: node.id, delta };
            }
          }

          return {
            ...projection,
            id: node.id,
            name: command?.name || node.id,
            status,
            radius
          };
        })
        .sort((a, b) => a.depth - b.depth);

      if (nearest) {
        nearestRef.current = nearest.id;
        if (dwellRef.current.id !== nearest.id) {
          dwellRef.current = { id: nearest.id, at: performance.now() };
        } else if (performance.now() - dwellRef.current.at >= DWELL_MS && nearest.id !== selectedId) {
          onSelect(nearest.id);
        }
      } else {
        nearestRef.current = "";
        dwellRef.current = { id: "", at: 0 };
      }

      context.save();
      context.globalCompositeOperation = "lighter";
      projectedNodes.forEach((node) => {
        const selected = node.id === selectedId;
        const color =
          node.status === "running"
            ? "82, 214, 162"
            : node.status === "error"
              ? "245, 125, 125"
              : "244, 201, 93";

        context.beginPath();
        context.fillStyle = `rgba(${color}, ${selected ? 0.95 : 0.7})`;
        context.shadowBlur = selected ? 26 : 16;
        context.shadowColor = `rgba(${color}, 0.45)`;
        context.arc(node.screenX, node.screenY, node.radius, 0, TAU);
        context.fill();

        context.beginPath();
        context.strokeStyle = `rgba(${color}, ${selected ? 0.8 : 0.26})`;
        context.lineWidth = selected ? 2.4 : 1;
        context.arc(node.screenX, node.screenY, node.radius + 6, 0, TAU);
        context.stroke();
      });
      context.restore();

      projectedNodes.forEach((node) => {
        const selected = node.id === selectedId;
        if (!selected && node.depth < 0.6) return;
        context.font = selected ? "600 13px Segoe UI" : "500 11px Segoe UI";
        context.textAlign = "center";
        context.fillStyle = selected ? "rgba(237, 244, 248, 0.96)" : "rgba(139, 165, 181, 0.86)";
        context.fillText(node.name, node.screenX, node.screenY - node.radius - 10);
      });

      if (pointer?.active) {
        context.beginPath();
        context.strokeStyle = "rgba(102, 217, 232, 0.85)";
        context.lineWidth = 2;
        context.arc(pointer.x, pointer.y, 12, 0, TAU);
        context.stroke();
      }

      frameRef.current = window.requestAnimationFrame(render);
    };

    frameRef.current = window.requestAnimationFrame(render);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [commands, nodes, onSelect, selectedId, statuses]);

  function updatePointerFromEvent(event) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current = {
      x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
      active: true,
      source: "pointer"
    };
  }

  function handleCanvasLeave() {
    if (trackerMode !== "camera") {
      pointerRef.current.active = false;
    }
  }

  return (
    <div className="particle-stage-shell">
      <GestureHud
        tx={tx}
        gestureEnabled={gestureEnabled}
        trackerMode={trackerMode}
        trackerMessage={trackerMessage}
        selectedName={selectedCommand?.name || ""}
        gestureState={gestureState}
        onStart={onStart}
        onStop={onStop}
        selectedCommand={selectedCommand}
      />
      <div className="particle-canvas-shell">
        <canvas
          ref={canvasRef}
          className="particle-canvas"
          onMouseMove={updatePointerFromEvent}
          onMouseEnter={updatePointerFromEvent}
          onMouseLeave={handleCanvasLeave}
          onClick={(event) => {
            updatePointerFromEvent(event);
            if (nearestRef.current) onSelect(nearestRef.current);
          }}
        />
      </div>
    </div>
  );
}
