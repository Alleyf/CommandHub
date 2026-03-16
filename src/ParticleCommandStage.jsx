import { useEffect, useMemo, useRef, useState } from "react";

// MediaPipe 手势检测 - 使用 FilesetResolver 方式加载
let FilesetResolver = null;
let HandLandmarker = null;

const TAU = Math.PI * 2;
const COMMAND_NODE_COUNT_FLOOR = 12;
const SELECT_RADIUS = 44;
const DWELL_MS = 280;
const ACTION_COOLDOWN_MS = 900;

// 手势状态更新节流时间
const GESTURE_STATE_THROTTLE = 200;
const POINTER_UPDATE_THROTTLE = 66;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  const ax = a?.x || 0;
  const ay = a?.y || 0;
  const bx = b?.x || 0;
  const by = b?.y || 0;
  return Math.hypot(ax - bx, ay - by);
}

// MediaPipe 手势分类
function classifyHandGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return "tracking";
  }

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];
  const indexMCP = landmarks[5];
  const pinkyMCP = landmarks[17];

  const palmWidth = distance(indexMCP, pinkyMCP);
  const wristToIndex = distance(wrist, indexTip);
  const wristToMiddle = distance(wrist, middleTip);
  const wristToRing = distance(wrist, ringTip);
  const wristToPinky = distance(wrist, pinkyTip);

  const avgFingerExtension = (wristToIndex + wristToMiddle + wristToRing + wristToPinky) / 4;
  const openness = avgFingerExtension / palmWidth;

  const thumbIndexDistance = distance(thumbTip, indexTip);
  const pinchThreshold = palmWidth * 0.3;

  if (thumbIndexDistance < pinchThreshold) {
    return "pinch";
  }

  if (openness >= 2.0) return "open";
  if (openness <= 1.3) return "fist";
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
  const screenY = height * 0.35 + y * depth;
  return { x, y, z, depth, screenX, screenY };
}

function GestureHud({ tx, gestureEnabled, trackerMode, trackerMessage, selectedName, gestureState, onStart, onStop, selectedCommand }) {
  const statusClass =
    gestureState === "open" ? "gesture-open" : gestureState === "fist" ? "gesture-fist" : gestureState === "pinch" ? "gesture-pinch" : "gesture-idle";

  const gestureText =
    gestureState === "open"
      ? tx("particleGestureStateOpen")
      : gestureState === "fist"
        ? tx("particleGestureStateFist")
        : gestureState === "pinch"
          ? tx("particleGestureStatePinch")
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
  const previewVideoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5, active: false, source: "pointer" });
  const smoothedPointerRef = useRef({ x: 0.5, y: 0.5 });
  const gestureStateRef = useRef("idle");
  const dwellRef = useRef({ id: "", at: 0 });
  const frameRef = useRef(0);
  const actionRef = useRef({ lastGesture: "idle", lastActionAt: 0 });
  const handDataRef = useRef(null);
  const nearestRef = useRef("");

  const lastGestureUpdateRef = useRef(0);
  const lastPointerUpdateRef = useRef(0);
  const pendingGestureRef = useRef(null);
  const pendingPointerRef = useRef(null);

  const tx = (key, values) => {
    const template = copy[key] || key;
    return values ? format(template, values) : template;
  };
  const nodes = useMemo(() => createCommandNodes(commands), [commands]);
  const commandMap = useMemo(() => new Map(commands.map((item) => [item.id, item])), [commands]);
  const selectedCommand = useMemo(() => commands.find((item) => item.id === selectedId) || null, [commands, selectedId]);
  const [trackerMode, setTrackerMode] = useState("off");
  const [trackerMessage, setTrackerMessage] = useState(tx("particleGestureOff"));
  const [gestureState, setGestureState] = useState("idle");
  const [isDragging, setIsDragging] = useState(false);

  const updateGestureStateThrottled = (newState, pointer) => {
    const now = Date.now();

    pendingGestureRef.current = newState;
    if (pointer) {
      pendingPointerRef.current = pointer;
    }

    if (now - lastGestureUpdateRef.current >= GESTURE_STATE_THROTTLE) {
      lastGestureUpdateRef.current = now;
      if (pendingGestureRef.current !== null) {
        setGestureState(pendingGestureRef.current);
        pendingGestureRef.current = null;
      }
      if (pendingPointerRef.current) {
        pointerRef.current = { ...pendingPointerRef.current, source: "gesture" };
        smoothedPointerRef.current = { x: pendingPointerRef.current.x, y: pendingPointerRef.current.y };
        pendingPointerRef.current = null;
      }
    }
  };

  const updatePointerThrottled = (pointer) => {
    const now = Date.now();

    if (now - lastPointerUpdateRef.current >= POINTER_UPDATE_THROTTLE) {
      lastPointerUpdateRef.current = now;
      pointerRef.current = { ...pointer, source: "gesture" };
      smoothedPointerRef.current = { x: pointer.x, y: pointer.y };
    }
  };

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
      if (nextState === "fist") onStart(selected);
      if (nextState === "open") onStop(selected.id);
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
      } else if (key === "p") {
        setIsDragging(true);
        setGestureState("pinch");
      }
    };

    const onKeyUp = (event) => {
      const key = String(event.key || "").toLowerCase();
      if (key === "o" || key === "f") {
        setGestureState("idle");
      } else if (key === "p") {
        setIsDragging(false);
        setGestureState("idle");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    if (!window.navigator?.mediaDevices?.getUserMedia) {
      setSimulatedMode("particleGestureUnsupported");
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      };
    }

    let cancelled = false;
    let landmarker = null;
    let videoEl = null;
    let animationId = null;
    let stream = null;

    async function startTracking() {
      try {
        setTrackerMessage("加载 MediaPipe 模型...");

        // 动态导入 MediaPipe
        const vision = await import("@mediapipe/tasks-vision");
        FilesetResolver = vision.FilesetResolver;
        HandLandmarker = vision.HandLandmarker;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        landmarker = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        console.log("MediaPipe HandLandmarker loaded");

        if (cancelled) return;

        setTrackerMessage("启动摄像头...");

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 320,
            height: 240,
            facingMode: 'user'
          }
        });

        console.log("Camera stream obtained");

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        videoEl = previewVideoRef.current;
        if (!videoEl) {
          setSimulatedMode("particleGestureDenied");
          return;
        }

        videoEl.srcObject = stream;

        // 等待视频加载
        await new Promise((resolve) => {
          videoEl.onloadedmetadata = () => {
            console.log("Video metadata loaded:", videoEl.videoWidth, videoEl.videoHeight);
            videoEl.play().then(() => {
              console.log("Video playing");
              resolve();
            }).catch(resolve);
          };
          setTimeout(resolve, 2000);
        });

        // 额外等待确保视频帧可用
        await new Promise(resolve => setTimeout(resolve, 500));

        if (cancelled) return;

        console.log("Starting detection, video readyState:", videoEl.readyState);

        setTrackerMode("camera");
        setTrackerMessage(tx("particleGestureCamera"));

        let lastProcessTime = 0;
        let frameCount = 0;

        const detect = async (timestamp) => {
          if (cancelled || !landmarker || !videoEl) return;

          // 控制检测频率，约 15 FPS
          const now = Date.now();
          if (now - lastProcessTime < 66) {
            animationId = requestAnimationFrame(detect);
            return;
          }
          lastProcessTime = now;
          frameCount++;

          try {
            if (videoEl.readyState >= 2) {
              // 每60帧打印一次状态
              if (frameCount % 60 === 0) {
                console.log("Detecting... readyState:", videoEl.readyState, "videoWidth:", videoEl.videoWidth);
              }

              const results = landmarker.detectForVideo(videoEl, timestamp || performance.now());

              // 每60帧打印一次检测结果
              if (frameCount % 60 === 0) {
                console.log("Detection results:", results ? 'has results' : 'no results',
                  results?.handLandmarks?.length ? results.handLandmarks.length + ' hands' : 'no hands');
              }

              if (results && results.handLandmarks && results.handLandmarks.length > 0) {
                const landmarks = results.handLandmarks[0];
                handDataRef.current = { landmarks };

                // 使用食指指尖位置
                const indexTip = landmarks[8];
                const rawX = clamp(1 - indexTip.x, 0, 1);
                const rawY = clamp(indexTip.y, 0, 1);

                const threshold = 0.02;
                const lastX = smoothedPointerRef.current.x;
                const lastY = smoothedPointerRef.current.y;

                if (Math.abs(rawX - lastX) > threshold || Math.abs(rawY - lastY) > threshold) {
                  const smoothing = 0.2;
                  const newX = smoothedPointerRef.current.x + (rawX - smoothedPointerRef.current.x) * smoothing;
                  const newY = smoothedPointerRef.current.y + (rawY - smoothedPointerRef.current.y) * smoothing;

                  updatePointerThrottled({ x: newX, y: newY, active: true });
                }

                const nextState = classifyHandGesture(landmarks);

                if (nextState !== gestureStateRef.current) {
                  if (nextState === "pinch") {
                    setIsDragging(true);
                  } else if (gestureStateRef.current === "pinch" && nextState !== "pinch") {
                    setIsDragging(false);
                  }

                  gestureStateRef.current = nextState;
                  updateGestureStateThrottled(nextState, {
                    x: smoothedPointerRef.current.x,
                    y: smoothedPointerRef.current.y,
                    active: true
                  });

                  if (nextState === "fist") {
                    handleGestureAction("fist");
                  } else if (nextState === "open") {
                    handleGestureAction("open");
                  }
                }
              } else {
                if (gestureStateRef.current !== "idle") {
                  gestureStateRef.current = "idle";
                  setGestureState("idle");
                  setIsDragging(false);
                  pointerRef.current.active = false;
                }
              }
            }
          } catch (err) {
            console.warn("Detection error:", err);
          }

          if (!cancelled) {
            animationId = requestAnimationFrame(detect);
          }
        };

        detect(performance.now());

      } catch (err) {
        console.error("Hand tracking error:", err);
        setTrackerMessage("错误: " + err.message);
        setSimulatedMode("particleGestureDenied");
      }
    }

    startTracking();

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (landmarker) {
        landmarker.close();
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [commands, gestureEnabled, onStart, onStop, selectedId, copy, format]);

  useEffect(() => {
    const preview = previewVideoRef.current;
    if (!preview) return;

    return () => {
      if (preview.srcObject) {
        preview.srcObject.getTracks().forEach(track => track.stop());
        preview.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const preview = previewVideoRef.current;
    if (!canvas || !preview) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let cancelled = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || 320;
      const height = rect.height || 240;
      canvas.width = width;
      canvas.height = height;
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    const draw = () => {
      if (cancelled) return;

      if (canvas.width === 0 || canvas.height === 0) {
        resize();
      }

      const width = canvas.width;
      const height = canvas.height;

      context.clearRect(0, 0, width, height);

      const hand = handDataRef.current;
      if (hand?.landmarks && hand.landmarks.length > 0) {
        const landmarks = hand.landmarks;

        landmarks.forEach((point, index) => {
          const x = (1 - point.x) * width;
          const y = point.y * height;

          if (index === 8) {
            context.beginPath();
            context.arc(x, y, 6, 0, TAU);
            context.fillStyle = "#66d9e8";
            context.fill();
          } else if (index === 4) {
            context.beginPath();
            context.arc(x, y, 5, 0, TAU);
            context.fillStyle = "#f4c95d";
            context.fill();
          } else {
            context.beginPath();
            context.arc(x, y, 3, 0, TAU);
            context.fillStyle = "rgba(255, 255, 255, 0.7)";
            context.fill();
          }
        });

        const connections = [
          [0, 1, 2, 3, 4],
          [0, 5, 6, 7, 8],
          [0, 9, 10, 11, 12],
          [0, 13, 14, 15, 16],
          [0, 17, 18, 19, 20],
          [5, 9, 13, 17]
        ];

        context.strokeStyle = "rgba(102, 217, 232, 0.5)";
        context.lineWidth = 1.5;
        connections.forEach((chain) => {
          context.beginPath();
          chain.forEach((idx, i) => {
            const point = landmarks[idx];
            const x = (1 - point.x) * width;
            const y = point.y * height;
            if (i === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          });
          context.stroke();
        });

        const currentGesture = classifyHandGesture(landmarks);
        const gestureLabel = currentGesture === "open" ? "张手" : currentGesture === "fist" ? "握拳" : currentGesture === "pinch" ? "捏住" : "跟踪中";

        context.font = "bold 14px Segoe UI";
        context.fillStyle = currentGesture === "open" ? "#52d6a2" : currentGesture === "fist" ? "#f57d7d" : currentGesture === "pinch" ? "#66d9e8" : "#f4c95d";
        context.textAlign = "left";
        context.fillText(gestureLabel, 8, 20);
      } else {
        context.font = "12px Segoe UI";
        context.fillStyle = "rgba(255, 255, 255, 0.5)";
        context.textAlign = "center";
        context.fillText("等待手势...", width / 2, height / 2);
      }

      requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [trackerMode, gestureEnabled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let cancelled = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    let lastPaintAt = 0;
    const render = (timestamp) => {
      if (cancelled) return;
      if (timestamp - lastPaintAt < 33) {
        frameRef.current = window.requestAnimationFrame(render);
        return;
      }
      lastPaintAt = timestamp;
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
          const command = commandMap.get(node.id);
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

        let drawX = node.screenX;
        let drawY = node.screenY;
        if (selected && isDragging && pointer) {
          drawX = pointer.x;
          drawY = pointer.y;
        }

        context.beginPath();
        context.fillStyle = `rgba(${color}, ${selected ? 0.95 : 0.7})`;
        context.shadowBlur = selected ? 26 : 16;
        context.shadowColor = `rgba(${color}, 0.45)`;
        context.arc(drawX, drawY, node.radius, 0, TAU);
        context.fill();

        context.beginPath();
        context.strokeStyle = `rgba(${color}, ${selected ? 0.8 : 0.26})`;
        context.lineWidth = selected ? 2.4 : 1;
        context.arc(drawX, drawY, node.radius + 6, 0, TAU);
        context.stroke();
      });
      context.restore();

      projectedNodes.forEach((node) => {
        const selected = node.id === selectedId;
        if (!selected && node.depth < 0.6) return;

        let drawX = node.screenX;
        let drawY = node.screenY;
        if (selected && isDragging && pointer) {
          drawX = pointer.x;
          drawY = pointer.y;
        }

        context.font = selected ? "600 13px Segoe UI" : "500 11px Segoe UI";
        context.textAlign = "center";
        context.fillStyle = selected ? "rgba(237, 244, 248, 0.96)" : "rgba(139, 165, 181, 0.86)";
        context.fillText(node.name, drawX, drawY - node.radius - 10);
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
  }, [commandMap, nodes, onSelect, selectedId, statuses, isDragging]);

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
        {gestureEnabled && (
          <div className={`particle-camera-preview ${trackerMode === "camera" ? "live" : "idle"}`}>
            <div className="particle-camera-head">
              <span>{tx("particleCameraPreviewTitle")}</span>
              <span className={`particle-camera-badge ${trackerMode === "camera" ? "live" : "idle"}`}>
                {trackerMode === "camera" ? tx("particleCameraLive") : tx("particleCameraFallback")}
              </span>
            </div>
            <div className="particle-camera-viewport">
              {trackerMode === "camera" ? (
                <div className="particle-camera-stack">
                  <video ref={previewVideoRef} className="particle-camera-video" autoPlay muted playsInline />
                  <canvas ref={previewCanvasRef} className="particle-camera-overlay" />
                </div>
              ) : (
                <div className="particle-camera-placeholder">{tx("particleCameraUnavailable")}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
