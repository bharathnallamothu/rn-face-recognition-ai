import React, { useEffect, useState } from 'react';
import {
  Text,
  StyleSheet,
  Button,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as ort from 'onnxruntime-react-native';
import RNFS from 'react-native-fs';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import FaceDetection from '@react-native-ml-kit/face-detection';
import jpeg from 'jpeg-js';
import { Buffer } from 'buffer';

const INPUT_WIDTH = 160;
const INPUT_HEIGHT = 160;

const App = () => {
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [refEmbedding, setRefEmbedding] = useState<Float32Array | null>(null);
  const [refFaceUri, setRefFaceUri] = useState<string | null>(null);
  const [userFaceUri, setUserFaceUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load ONNX model on mount
  useEffect(() => {
    (async () => {
      try {
        const modelName = 'faceNet.onnx';
        const modelPath = `${RNFS.DocumentDirectoryPath}/${modelName}`;
        if (!(await RNFS.exists(modelPath))) {
          await RNFS.copyFileAssets(modelName, modelPath);
        }
        const loaded = await ort.InferenceSession.create(modelPath);
        setSession(loaded);
        console.log('✅ ONNX model loaded');
      } catch (err) {
        console.error('❌ Model load failed', err);
      }
    })();
  }, []);

  // Pick reference image from gallery
  const pickReferenceImage = async () => {
    if (!session) return;
    setLoading(true);
    setRefEmbedding(null);
    setRefFaceUri(null);
    setUserFaceUri(null);
    try {
      const res = await launchImageLibrary({ mediaType: 'photo' });
      const uri = res.assets?.[0]?.uri;
      if (!uri) throw new Error('No image selected');
      const embedding = await detectAndRun(session, uri, setRefFaceUri);
      if (embedding) setRefEmbedding(embedding);
      else Alert.alert('Error', 'No face detected in reference image.');
    } catch (err) {
      console.error('❌ Reference image failed:', err);
      Alert.alert('Error', 'Failed to process reference image.');
    }
    setLoading(false);
  };

  // Pick user/source image from gallery
  const pickUserImage = async () => {
    if (!session || !refEmbedding) return;
    setLoading(true);
    setUserFaceUri(null);
    try {
      const res = await launchImageLibrary({ mediaType: 'photo' });
      const uri = res.assets?.[0]?.uri;
      if (!uri) throw new Error('No image selected');
      const userEmbedding = await detectAndRun(session, uri, setUserFaceUri);
      if (userEmbedding) {
        const sim = cosineSimilarity(userEmbedding, refEmbedding);
        console.log('Similarity:', sim);
        Alert.alert(sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched', `Similarity Score: ${sim.toFixed(3)}`);
      } else {
        Alert.alert('Error', 'No face detected in source image.');
      }
    } catch (err) {
      console.error('❌ Source image failed:', err);
      Alert.alert('Error', 'Failed to process source image.');
    }
    setLoading(false);
  };

  // Capture user/source image from camera
  const captureFromCamera = async () => {
    if (!session || !refEmbedding) return;
    setLoading(true);
    setUserFaceUri(null);
    try {
      const res = await launchCamera({ mediaType: 'photo' });
      const uri = res.assets?.[0]?.uri;
      if (!uri) throw new Error('No image captured');
      const userEmbedding = await detectAndRun(session, uri, setUserFaceUri);
      if (userEmbedding) {
        const sim = cosineSimilarity(userEmbedding, refEmbedding);
        console.log('Similarity:', sim);
        Alert.alert(sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched', `Similarity Score: ${sim.toFixed(3)}`);
      } else {
        Alert.alert('Error', 'No face detected in source image.');
      }
    } catch (err) {
      console.error('❌ Source image failed:', err);
      Alert.alert('Error', 'Failed to process source image.');
    }
    setLoading(false);
  };

  // Face detection and embedding
  const detectAndRun = async (
    session: ort.InferenceSession,
    imgPath: string,
    setFaceUri: (uri: string) => void
  ) => {
    try {
      const path = imgPath.startsWith('file://') ? imgPath : `file://${imgPath}`;
      const faces = await FaceDetection.detect(path);
      const face = faces?.[0];
      if (!face || !face.frame) throw new Error('No face detected');

      const { width, height, left, top } = face.frame;
      if (width <= 0 || height <= 0) throw new Error('Invalid bounding box');

      const { default: ImageEditor } = await import('@react-native-community/image-editor');
      const crop = {
        offset: { x: left, y: top },
        size: { width, height },
        displaySize: { width: INPUT_WIDTH, height: INPUT_HEIGHT },
        resizeMode: "contain" as "contain",
      };

      const cropResult = await ImageEditor.cropImage(path, crop);
      setFaceUri(cropResult.uri);

      const buf = await RNFS.readFile(cropResult.uri.replace('file://', ''), 'base64');
      const raw = jpeg.decode(Buffer.from(buf, 'base64'), { useTArray: true });

      const floatData = new Float32Array(INPUT_WIDTH * INPUT_HEIGHT * 3);
      for (let y = 0; y < INPUT_HEIGHT; y++) {
        for (let x = 0; x < INPUT_WIDTH; x++) {
          const idx = (y * INPUT_WIDTH + x) * 4;
          const r = raw.data[idx] / 255;
          const g = raw.data[idx + 1] / 255;
          const b = raw.data[idx + 2] / 255;
          const i = (y * INPUT_WIDTH + x) * 3;
          floatData[i] = r;
          floatData[i + 1] = g;
          floatData[i + 2] = b;
        }
      }

      // Use NHWC format: [1, INPUT_HEIGHT, INPUT_WIDTH, 3]
      const rearranged = floatData;
      const input = new ort.Tensor('float32', rearranged, [1, INPUT_HEIGHT, INPUT_WIDTH, 3]);

      const output = await session.run({ image_input: input });
      return output.Bottleneck_BatchNorm.data as Float32Array;
    } catch (err) {
      console.error('❌ Comparison failed:', err);
      return null;
    }
  };

  // Cosine similarity
  const cosineSimilarity = (a: Float32Array, b: Float32Array) => {
    const dot = a.reduce((acc, val, i) => acc + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((acc, val) => acc + val * val, 0));
    const magB = Math.sqrt(b.reduce((acc, val) => acc + val * val, 0));
    return dot / (magA * magB);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>🧠 Face Match (ONNX)</Text>
      <Button title="Pick Reference Image (Gallery)" onPress={pickReferenceImage} />
      {refFaceUri && (
        <>
          <Text style={{ marginTop: 8, marginBottom: 4 }}>Reference Face:</Text>
          <Image source={{ uri: refFaceUri }} style={styles.image} />
        </>
      )}
      <Button
        title="Pick Source Image (Gallery)"
        onPress={pickUserImage}
        disabled={!refEmbedding || loading}
      />
      <Button
        title="Capture Source Image (Camera)"
        onPress={captureFromCamera}
        disabled={!refEmbedding || loading}
      />
      {userFaceUri && (
        <>
          <Text style={{ marginTop: 8, marginBottom: 4 }}>Source Face:</Text>
          <Image source={{ uri: userFaceUri }} style={styles.image} />
        </>
      )}
      {loading && <ActivityIndicator size="large" color="#00f" style={{ marginTop: 20 }} />}
      <Button
        title="Try Another Match"
        onPress={() => setUserFaceUri(null)}
        disabled={!refEmbedding || loading || !userFaceUri}
      />
      <Button
        title="Reset"
        color="#d9534f"
        onPress={() => {
          setRefEmbedding(null);
          setRefFaceUri(null);
          setUserFaceUri(null);
        }}
        disabled={loading && !refFaceUri && !userFaceUri}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, marginBottom: 16 },
  image: { width: 160, height: 160, margin: 8, borderRadius: 8 },
});

export default App;
