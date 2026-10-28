const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const context = canvas.getContext("2d");
const placeholder = document.querySelector("#camera-placeholder");
const cameraMessageTitle = document.querySelector("#camera-message-title");
const cameraMessage = document.querySelector("#camera-message");
const cameraLabel = document.querySelector("#camera-label");
const cameraSelect = document.querySelector("#camera-select");
const cameraConnect = document.querySelector("#camera-connect");
const cameraRetry = document.querySelector("#camera-retry");
const recenterButton = document.querySelector("#recenter-button");
const vrToggle = document.querySelector("#vr-toggle");
const vrState = document.querySelector("#vr-state");
const fpsLabel = document.querySelector("#fps-label");
const pinchMeter = document.querySelector("#pinch-meter-fill");
const pinchState = document.querySelector("#pinch-state");
const driverStatus = document.querySelector("#driver-status");
const driverStatusLabel = document.querySelector("#driver-status-label");
const toast = document.querySelector("#toast");

const MODEL_URLS = {
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
  hands: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
};
const PACKET_FIELDS = 29;
const MAX_INFERENCE_FPS = 8;
const CAMERA_FRAME_TIMEOUT_MS = 5000;
const CAMERA_MUTE_GRACE_MS = 10000;
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];
const FACE_KEYPOINTS = [1, 33, 133, 263, 362, 61, 291, 199];

let trackingWorker;
let trackingWorkerReady = false;
let workerBusy = false;
let stream;
let cameraTrack;
let cameraTrackHandlers;
let modelsReady = false;
let cameraConnecting = false;
let trackingError = false;
let cameraLost = true;
let trackingLoopRunning = false;
let trackingEnabled = false;
let driverConnected = false;
let reference = null;
let toastTimeout;
let lastVideoTime = -1;
let lastFrameAt = performance.now();
let lastVideoFrameAt = 0;
let lastInferenceAt = 0;
let frameCount = 0;
let cameraMuteTimeout;
const lastKnownHands = { left: null, right: null };
let current = {
  head: null,
  left: null,
  right: null,
  rightPinch: 0
};

window.camvr?.onDriverStatus((connected) => {
  driverConnected = connected;
  driverStatus.dataset.state = connected ? "connected" : "disconnected";
  driverStatusLabel.textContent = connected
    ? "Driver SteamVR conectado"
    : "Driver SteamVR desconectado";
  if (connected) {
    showToast("Driver SteamVR conectado. O rastreamento está pronto para enviar poses.");
  }
});

function showToast(message) {
  toast.textContent = message;
  toast.dataset.visible = "true";
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.dataset.visible = "false";
  }, 4500);
}

function getCameraErrorMessage(error) {
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return {
      title: "Acesso à câmera bloqueado",
      message: "Feche e abra o CamVR novamente. No Windows, confira Configurações > Privacidade e segurança > Câmera e permita o acesso para aplicativos da área de trabalho."
    };
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return {
      title: "Nenhuma câmera encontrada",
      message: "Abra o DroidCam no celular e no PC, conecte os dois e verifique se o DroidCam aparece como câmera no Windows. Depois clique em Tentar novamente."
    };
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return {
      title: "Câmera ocupada ou indisponível",
      message: "Feche outros apps que usam a câmera, confira se o DroidCam está conectado e clique em Tentar novamente."
    };
  }
  if (error.name === "OverconstrainedError") {
    return {
      title: "Não foi possível abrir essa câmera",
      message: "Escolha outra fonte de vídeo ou a opção Câmera padrão e tente novamente."
    };
  }
  return {
    title: "Falha ao abrir a câmera",
    message: `${error.message || error.name}. Confira o DroidCam e as permissões de câmera do Windows; depois tente novamente.`
  };
}

async function refreshCameraList(selectedDeviceId = "") {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  cameraSelect.replaceChildren();

  for (const [index, camera] of cameras.entries()) {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Câmera ${index + 1}`;
    cameraSelect.append(option);
  }

  if (selectedDeviceId && cameras.some((camera) => camera.deviceId === selectedDeviceId)) {
    cameraSelect.value = selectedDeviceId;
  } else if (!cameraSelect.value && cameras.length > 0) {
    cameraSelect.selectedIndex = 0;
  }

  cameraSelect.disabled = cameras.length === 0 || cameraConnecting;
}

async function connectCamera() {
  if (cameraConnecting) {
    return false;
  }

  cameraConnecting = true;
  cameraConnect.disabled = true;
  cameraRetry.disabled = true;
  cameraSelect.disabled = true;
  cameraConnect.textContent = "Conectando...";
  cameraRetry.textContent = "Conectando...";
  cameraMessageTitle.textContent = "Conectando à câmera...";
  cameraMessage.textContent = "Aceite o acesso à câmera se o Windows solicitar. A lista de câmeras aparece depois da primeira autorização.";
  placeholder.hidden = false;
  cameraLabel.textContent = "CONECTANDO CÂMERA";
  cameraLabel.dataset.state = "waiting";
  cameraLost = true;
  trackingLoopRunning = false;
  clearTimeout(cameraMuteTimeout);
  lastKnownHands.left = null;
  lastKnownHands.right = null;

  if (stream) {
    removeCameraTrackListeners();
    for (const track of stream.getTracks()) {
      track.stop();
    }
    stream = null;
  }

  video.srcObject = null;
  current = { head: null, left: null, right: null, rightPinch: 0 };

  try {
    const selectedDeviceId = cameraSelect.value;
    const constraints = {
      audio: false,
      video: {
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        width: { ideal: 320, max: 640 },
        height: { ideal: 240, max: 480 },
        frameRate: { ideal: 15, max: 20 }
      }
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    cameraTrack = stream.getVideoTracks()[0];
    cameraTrackHandlers = {
      mute: handleCameraMuted,
      unmute: handleCameraUnmuted,
      ended: () => handleCameraLost("A câmera foi desconectada. Confira o DroidCam e tente reconectar.")
    };
    cameraTrack.addEventListener("mute", cameraTrackHandlers.mute);
    cameraTrack.addEventListener("unmute", cameraTrackHandlers.unmute);
    cameraTrack.addEventListener("ended", cameraTrackHandlers.ended);
    cameraLost = false;
    lastVideoFrameAt = performance.now();
    lastInferenceAt = 0;
    lastVideoTime = -1;
    frameCount = 0;
    lastFrameAt = performance.now();
    placeholder.hidden = true;
    cameraLabel.textContent = "CÂMERA CONECTADA";
    cameraLabel.dataset.state = "active";
    cameraConnect.textContent = "Trocar câmera";
    cameraRetry.textContent = "Trocar câmera";
    const activeDeviceId = stream.getVideoTracks()[0].getSettings().deviceId;
    await refreshCameraList(activeDeviceId);
    if (modelsReady) {
      startTrackingLoop();
    }
    return true;
  } catch (error) {
    const message = getCameraErrorMessage(error);
    cameraMessageTitle.textContent = message.title;
    cameraMessage.textContent = message.message;
    placeholder.hidden = false;
    cameraLabel.textContent = "CÂMERA DESCONECTADA";
    cameraLabel.dataset.state = "waiting";
    cameraConnect.textContent = "Tentar novamente";
    cameraRetry.textContent = "Tentar novamente";
    fpsLabel.textContent = message.title;
    showToast(message.message);
    console.error("Falha ao abrir webcam ou DroidCam:", error);
    return false;
  } finally {
    cameraConnecting = false;
    cameraConnect.disabled = false;
    cameraRetry.disabled = false;
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    cameraSelect.disabled = devices.filter((device) => device.kind === "videoinput").length === 0;
  }
}

function removeCameraTrackListeners() {
  if (!cameraTrack || !cameraTrackHandlers) {
    return;
  }
  cameraTrack.removeEventListener("mute", cameraTrackHandlers.mute);
  cameraTrack.removeEventListener("unmute", cameraTrackHandlers.unmute);
  cameraTrack.removeEventListener("ended", cameraTrackHandlers.ended);
  cameraTrack = null;
  cameraTrackHandlers = null;
}

function handleCameraMuted() {
  cameraLabel.textContent = "SINAL DA CÂMERA PAUSADO";
  cameraLabel.dataset.state = "waiting";
  clearTimeout(cameraMuteTimeout);
  cameraMuteTimeout = setTimeout(() => {
    if (cameraTrack?.muted) {
      handleCameraLost("O sinal da câmera permaneceu pausado. Confira a webcam ou o cliente do DroidCam.");
    }
  }, CAMERA_MUTE_GRACE_MS);
}

function handleCameraUnmuted() {
  clearTimeout(cameraMuteTimeout);
  lastVideoTime = video.currentTime;
  lastVideoFrameAt = performance.now();
  lastInferenceAt = 0;
  cameraLabel.textContent = "CÂMERA CONECTADA";
  cameraLabel.dataset.state = "active";
  if (modelsReady) {
    startTrackingLoop();
  }
}

function handleCameraLost(message) {
  if (cameraLost) {
    return;
  }
  cameraLost = true;
  trackingEnabled = false;
  current = { head: null, left: null, right: null, rightPinch: 0 };
  lastKnownHands.left = null;
  lastKnownHands.right = null;
  cameraLabel.textContent = "CÂMERA DESCONECTADA";
  cameraLabel.dataset.state = "waiting";
  cameraMessageTitle.textContent = "O vídeo da câmera foi interrompido";
  cameraMessage.textContent = `${message} Se o celular caiu ou desconectou, coloque-o de volta, reabra o vídeo no DroidCam e tente novamente.`;
  cameraConnect.textContent = "Reconectar câmera";
  cameraRetry.textContent = "Reconectar câmera";
  placeholder.hidden = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  fpsLabel.textContent = "Câmera desconectada · rastreamento pausado";
  trackingLoopRunning = false;
  clearTimeout(cameraMuteTimeout);
  removeCameraTrackListeners();

  if (stream) {
    const disconnectedStream = stream;
    stream = null;
    video.srcObject = null;
    for (const track of disconnectedStream.getTracks()) {
      track.stop();
    }
  }

  updateUi(false, performance.now());
  showToast(message);
}

function setTrackingRow(id, active, label) {
  const row = document.querySelector(`#${id}-row`);
  row.dataset.state = active ? "active" : "waiting";
  document.querySelector(`#${id}-state`).textContent = label;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function normalizeQuaternion(quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length
  };
}

function multiplyQuaternions(a, b) {
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  });
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function quaternionFromMatrix(xAxis, yAxis, zAxis) {
  const m00 = xAxis.x;
  const m01 = yAxis.x;
  const m02 = zAxis.x;
  const m10 = xAxis.y;
  const m11 = yAxis.y;
  const m12 = zAxis.y;
  const m20 = xAxis.z;
  const m21 = yAxis.z;
  const m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  let x;
  let y;
  let z;
  let w;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = 0.25 * scale;
    x = (m21 - m12) / scale;
    y = (m02 - m20) / scale;
    z = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / scale;
    x = 0.25 * scale;
    y = (m01 + m10) / scale;
    z = (m02 + m20) / scale;
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / scale;
    x = (m01 + m10) / scale;
    y = 0.25 * scale;
    z = (m12 + m21) / scale;
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / scale;
    x = (m02 + m20) / scale;
    y = (m12 + m21) / scale;
    z = 0.25 * scale;
  }

  return normalizeQuaternion({ x, y, z, w });
}

function quaternionFromEuler(pitch, yaw, roll) {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy
  };
}

function getFacePose(landmarks, matrices) {
  const nose = landmarks[1];
  const eyeLeft = landmarks[33];
  const eyeRight = landmarks[263];
  const width = Math.hypot(eyeRight.x - eyeLeft.x, eyeRight.y - eyeLeft.y);
  const matrix = matrices?.[0]?.data;
  let rotation = { x: 0, y: 0, z: 0, w: 1 };

  if (matrix?.length === 16) {
    const pitch = Math.asin(clamp(-matrix[9], -1, 1));
    const yaw = Math.atan2(matrix[8], matrix[10]);
    const roll = Math.atan2(matrix[1], matrix[5]);
    rotation = quaternionFromEuler(pitch, yaw, roll);
  }

  if (!reference) {
    reference = { x: nose.x, y: nose.y, width, rotation };
  }
  const inverseReference = {
    x: -reference.rotation.x,
    y: -reference.rotation.y,
    z: -reference.rotation.z,
    w: reference.rotation.w
  };

  return {
    position: [
      clamp((reference.x - nose.x) * 1.2, -0.45, 0.45),
      1.6 + clamp((reference.y - nose.y) * 1.2, -0.4, 0.4),
      clamp((reference.width / Math.max(width, 0.001) - 1) * 0.45, -0.35, 0.35)
    ],
    rotation: multiplyQuaternions(inverseReference, rotation)
  };
}

function getHandPose(landmarks) {
  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const middleMcp = landmarks[9];
  const pinkyMcp = landmarks[17];
  const horizontal = normalize({
    x: indexMcp.x - pinkyMcp.x,
    y: indexMcp.y - pinkyMcp.y,
    z: indexMcp.z - pinkyMcp.z
  });
  const vertical = normalize({
    x: wrist.x - middleMcp.x,
    y: wrist.y - middleMcp.y,
    z: wrist.z - middleMcp.z
  });
  const normal = normalize(cross(horizontal, vertical));
  const correctedVertical = normalize(cross(normal, horizontal));
  const palmWidth = Math.max(distance3(indexMcp, pinkyMcp), 0.001);
  const pinchRatio = distance3(landmarks[4], landmarks[8]) / palmWidth;
  const trigger = clamp((0.75 - pinchRatio) / 0.48, 0, 1);

  return {
    position: [
      clamp((0.5 - wrist.x) * 1.8, -0.8, 0.8),
      1.6 + clamp((0.5 - wrist.y) * 1.5, -0.8, 0.8),
      clamp(-0.45 + wrist.z * 1.4, -1.2, 0.2)
    ],
    rotation: quaternionFromMatrix(horizontal, correctedVertical, normal),
    trigger,
    grip: clamp((distance3(landmarks[0], landmarks[12]) / palmWidth - 0.7) / 0.7, 0, 1)
  };
}

function sideFromHand(result, index) {
  const category = result.handedness?.[index]?.[0]?.categoryName?.toLowerCase();
  if (category === "left") {
    return "right";
  }
  if (category === "right") {
    return "left";
  }

  return result.landmarks[index][0].x > 0.5 ? "left" : "right";
}

function drawConnections(landmarks, connections, width, height) {
  for (const connection of connections) {
    const start = landmarks[connection.start];
    const end = landmarks[connection.end];
    if (!start || !end) {
      continue;
    }

    context.beginPath();
    context.moveTo(start.x * width, start.y * height);
    context.lineTo(end.x * width, end.y * height);
    context.stroke();
  }
}

function drawHands(hands, face) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    return;
  }

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  if (face) {
    context.save();
    context.fillStyle = "#7bdcff";
    context.shadowBlur = 5;
    context.shadowColor = "rgba(119, 216, 244, 0.75)";
    for (const index of FACE_KEYPOINTS) {
      const point = face[index];
      if (!point) {
        continue;
      }
      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(2.5, width / 400), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  for (const hand of hands) {
    context.save();
    context.strokeStyle = "#6ef2b2";
    context.fillStyle = "#eafff3";
    context.lineWidth = Math.max(2, width / 550);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = "rgba(85, 255, 174, 0.9)";
    context.shadowBlur = 8;
    drawConnections(hand, HAND_CONNECTIONS, width, height);

    for (const point of hand) {
      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(3.5, width / 300), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function makePacket() {
  const values = [
    Number(trackingEnabled),
    Number(Boolean(current.head)),
    Number(Boolean(current.left || lastKnownHands.left)),
    Number(Boolean(current.right || lastKnownHands.right))
  ];
  const appendPose = (pose) => {
    values.push(...(pose?.position ?? [0, 0, 0]));
    const rotation = pose?.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    values.push(rotation.x, rotation.y, rotation.z, rotation.w);
  };

  appendPose(current.head);
  for (const side of ["left", "right"]) {
    const hand = current[side];
    appendPose(hand ?? lastKnownHands[side]);
    values.push(hand?.trigger ?? 0, hand?.grip ?? 0);
  }

  if (values.length !== PACKET_FIELDS || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Pacote de rastreamento inválido.");
  }

  window.camvr?.sendPacket(values.join(","));
}

function updateUi(faceDetected, now) {
  const leftTracked = Boolean(current.left);
  const rightTracked = Boolean(current.right);
  setTrackingRow("head", faceDetected, faceDetected ? "Rosto rastreado" : "Aguardando rosto");
  setTrackingRow("left", leftTracked, leftTracked ? "Mão rastreada" : "Aguardando mão");
  setTrackingRow("right", rightTracked, rightTracked ? "Mão rastreada" : "Aguardando mão");

  const pinch = current.rightPinch;
  pinchMeter.dataset.level = String(Math.round(pinch * 10));
  pinchState.textContent = pinch >= 0.65 ? "MÃO DIREITA · PINÇA" : "MÃO DIREITA · SOLTA";

  const ready = faceDetected && leftTracked && rightTracked;
  vrState.textContent = trackingEnabled
    ? !driverConnected
      ? "Ligado neste app · SteamVR desconectado"
      : ready
        ? "Enviando rastreamento ao SteamVR"
        : "SteamVR conectado · aguardando rosto e mãos"
    : ready && driverConnected
      ? "Rastreamento pronto para ligar"
      : !driverConnected
        ? "Driver SteamVR não conectado"
        : "Aguardando rosto e mãos";

  vrToggle.textContent = trackingEnabled ? "Desligar VR" : "Ligar VR";
  vrToggle.classList.toggle("is-active", trackingEnabled);
  if (!cameraTrack?.muted) {
    cameraLabel.textContent = cameraLost
      ? "CÂMERA DESCONECTADA"
      : ready
        ? "RASTREAMENTO ATIVO"
        : "PROCURANDO ROSTO E MÃOS";
    cameraLabel.dataset.state = ready && !cameraLost ? "active" : "waiting";
  }

  makePacket();
}

async function initializeTracking() {
  try {
    cameraMessageTitle.textContent = "Carregando rastreamento...";
    cameraMessage.textContent = "Carregando os detectores em segundo plano para manter a interface responsiva.";
    trackingWorker = new Worker(new URL("./tracking-worker.js", import.meta.url));
    trackingWorker.onmessage = handleTrackingWorkerMessage;
    trackingWorker.onerror = (error) => {
      handleTrackingFailure(new Error(error.message || "Falha no worker de rastreamento."));
    };
    trackingWorker.postMessage({
      type: "initialize",
      models: MODEL_URLS
    });
  } catch (error) {
    handleTrackingFailure(error);
  }
}

function handleTrackingFailure(error) {
  trackingLoopRunning = false;
  trackingWorkerReady = false;
  workerBusy = false;
  trackingError = true;
  trackingEnabled = false;
  cameraLabel.textContent = "ERRO NO RASTREAMENTO";
  cameraLabel.dataset.state = "waiting";
  cameraMessageTitle.textContent = "O rastreamento foi interrompido";
  cameraMessage.textContent = `${error.message}. Reinicie o app para carregar os modelos novamente.`;
  cameraConnect.textContent = "Reiniciar rastreamento";
  cameraRetry.textContent = "Reiniciar rastreamento";
  placeholder.hidden = false;
  vrState.textContent = "Reinicie o app para retomar o rastreamento";
  vrToggle.textContent = "VR desligado";
  vrToggle.classList.remove("is-active");
  fpsLabel.textContent = "O rastreamento foi interrompido";
  showToast(`O rastreamento foi interrompido: ${error.message}. Feche e abra o CamVR para tentar novamente.`);
  console.error("Falha no worker de rastreamento:", error);
}

function handleTrackingWorkerMessage({ data }) {
  if (data.type === "error") {
    handleTrackingFailure(new Error(data.message));
    return;
  }

  if (data.type === "ready") {
    modelsReady = true;
    trackingWorkerReady = true;
    fpsLabel.textContent = "Detectores prontos · análise econômica";
    if (!cameraLost) {
      startTrackingLoop();
    }
    return;
  }

  if (data.type !== "result") {
    return;
  }

  workerBusy = false;
  if (cameraLost) {
    return;
  }

  const face = data.faceLandmarks?.[0];
  current.head = face ? getFacePose(face, data.facialTransformationMatrixes) : null;
  current.left = null;
  current.right = null;
  current.rightPinch = 0;

  for (let index = 0; index < (data.handLandmarks?.length ?? 0); index += 1) {
    const result = { handedness: data.handedness, landmarks: data.handLandmarks };
    const side = sideFromHand(result, index);
    const handPose = getHandPose(data.handLandmarks[index]);
    current[side] = handPose;
    lastKnownHands[side] = handPose;
    if (side === "right") {
      current.rightPinch = handPose.trigger;
    }
  }

  drawHands(data.handLandmarks ?? [], face);
  updateUi(Boolean(face), performance.now());
  frameCount += 1;
  const now = performance.now();
  if (now - lastFrameAt >= 1000) {
    fpsLabel.textContent = `${frameCount} análises/s · modo econômico`;
    frameCount = 0;
    lastFrameAt = now;
  }
}

function startTrackingLoop() {
  if (!trackingWorkerReady || cameraLost || trackingLoopRunning) {
    return;
  }
  trackingLoopRunning = true;
  requestAnimationFrame(trackFrame);
}

function trackFrame(now) {
  if (!trackingLoopRunning || cameraLost) {
    return;
  }

  if (!video.srcObject || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    requestAnimationFrame(trackFrame);
    return;
  }

  const videoTime = video.currentTime;
  if (videoTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    lastVideoFrameAt = now;
  }

  if (!cameraTrack?.muted && now - lastVideoFrameAt >= CAMERA_FRAME_TIMEOUT_MS) {
    handleCameraLost("O DroidCam nao envia novos quadros de video.");
    return;
  }

  if (videoTime !== 0 && !workerBusy && now - lastInferenceAt >= 1000 / MAX_INFERENCE_FPS) {
    lastInferenceAt = now;
    try {
      workerBusy = true;
      createImageBitmap(video, {
        resizeWidth: 320,
        resizeHeight: 240,
        resizeQuality: "low"
      }).then((frame) => {
        if (!trackingLoopRunning || cameraLost) {
          frame.close();
          workerBusy = false;
          return;
        }
        trackingWorker.postMessage({
          type: "frame",
          frame,
          timestamp: now
        }, [frame]);
      }).catch((error) => {
        workerBusy = false;
        console.error("Falha ao preparar frame para rastreamento:", error);
      });
    } catch (error) {
      workerBusy = false;
      handleTrackingFailure(error);
      return;
    }
  }

  if (trackingLoopRunning && !cameraLost) {
    requestAnimationFrame(trackFrame);
  }
}

vrToggle.addEventListener("click", () => {
  trackingEnabled = !trackingEnabled;
  updateUi(Boolean(current.head), performance.now());

  if (!trackingEnabled) {
    showToast("Rastreamento VR desligado. A câmera continua ativa.");
  } else if (!driverConnected) {
    showToast("Modo ligado no app, mas o driver SteamVR não está conectado. Jogos ainda não receberão VR.");
  } else if (!current.head || !current.left || !current.right) {
    showToast("Modo VR ligado. Mostre o rosto e as duas mãos para começar o rastreamento.");
  } else {
    showToast("Rastreamento enviado ao SteamVR.");
  }
});

recenterButton.addEventListener("click", () => {
  if (!current.head) {
    showToast("Ainda não encontrei seu rosto. Olhe para a câmera e tente novamente.");
    return;
  }

  reference = null;
  showToast("Centro redefinido. Mantenha a cabeça em posição neutra por um instante.");
});

async function startCameraAndTracking() {
  if (trackingError) {
    window.location.reload();
    return;
  }

  const connected = await connectCamera();
  if (connected && !modelsReady) {
    await initializeTracking();
  }
}

cameraConnect.addEventListener("click", startCameraAndTracking);
cameraRetry.addEventListener("click", startCameraAndTracking);
cameraSelect.addEventListener("change", async () => {
  const connected = await connectCamera();
  if (connected && !modelsReady) {
    await initializeTracking();
  }
});

window.addEventListener("beforeunload", () => {
  trackingEnabled = false;
  if (stream) {
    removeCameraTrackListeners();
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
});

startCameraAndTracking();
