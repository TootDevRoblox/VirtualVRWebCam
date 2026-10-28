importScripts("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.js");

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const { FaceLandmarker, FilesetResolver, HandLandmarker } = self.Vision;

let faceLandmarker;
let handLandmarker;

self.onmessage = async ({ data }) => {
  if (data.type === "initialize") {
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      [faceLandmarker, handLandmarker] = await Promise.all([
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: data.models.face, delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        }),
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: data.models.hands, delegate: "CPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        })
      ]);
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: error.message });
    }
    return;
  }

  if (data.type !== "frame" || !faceLandmarker || !handLandmarker) {
    data.frame?.close();
    return;
  }

  try {
    const faceResult = faceLandmarker.detectForVideo(data.frame, data.timestamp);
    const handResult = handLandmarker.detectForVideo(data.frame, data.timestamp);
    self.postMessage({
      type: "result",
      faceLandmarks: faceResult.faceLandmarks,
      facialTransformationMatrixes: faceResult.facialTransformationMatrixes?.map((matrix) => ({
        data: matrix.data
      })),
      handLandmarks: handResult.landmarks,
      handedness: handResult.handedness
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  } finally {
    data.frame.close();
  }
};
