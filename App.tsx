import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Text,
  StyleSheet,
  Button,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  View,
  TouchableOpacity,
  Dimensions,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import * as ort from 'onnxruntime-react-native';
import RNFS from 'react-native-fs';
import { launchImageLibrary } from 'react-native-image-picker';
import FaceDetection from '@react-native-ml-kit/face-detection';
import jpeg from 'jpeg-js';
import { Buffer } from 'buffer';
import {
  Camera,
  useCameraDevices,
  useFrameProcessor,
  runOnUI,
  runOnJS,
} from 'react-native-vision-camera';

const INPUT_WIDTH = 160;
const INPUT_HEIGHT = 160;
const REFERENCE_IMAGE_URL = 'https://ctrlfaceapiimages.s3.ap-south-1.amazonaws.com/2.jpeg';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const App = () => {
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [refEmbedding, setRefEmbedding] = useState<Float32Array | null>(null);
  const [refFaceUri, setRefFaceUri] = useState<string | null>(null);
  const [userFaceUri, setUserFaceUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<string>('not-determined');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const [isProcessing, setIsProcessing] = useState(false);
  const [flashMode, setFlashMode] = useState<'off' | 'on'>('off');
  const [realTimeMatching, setRealTimeMatching] = useState(false);
  const [lastMatchResult, setLastMatchResult] = useState<string | null>(null);

  const devices = useCameraDevices();
  const device = cameraPosition === 'front' ? devices.front : devices.back;
  const cameraRef = useRef<Camera>(null);

  useEffect(() => {
    requestCameraPermission();
    initializeModel();
  }, []);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'This app needs camera access for face recognition',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      setCameraPermission(granted === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
    } else {
      const permission = await Camera.requestCameraPermission();
      setCameraPermission(permission);
    }
  };

  const initializeModel = async () => {
    try {
      const modelName = 'faceNet.onnx';
      const modelPath = `${RNFS.DocumentDirectoryPath}/${modelName}`;
      if (!(await RNFS.exists(modelPath))) {
        await RNFS.copyFileAssets(modelName, modelPath);
      }
      const loaded = await ort.InferenceSession.create(modelPath);
      setSession(loaded);
      console.log('✅ ONNX model loaded');

      const refPath = `${RNFS.DocumentDirectoryPath}/ref.jpg`;
      await RNFS.downloadFile({ fromUrl: REFERENCE_IMAGE_URL, toFile: refPath }).promise;

      const embedding = await detectAndRun(loaded, refPath, setRefFaceUri);
      if (embedding) setRefEmbedding(embedding);
    } catch (err) {
      console.error('❌ Init failed', err);
    }
  };

  const processFrameForFaceMatch = useCallback(async (imagePath: string) => {
    if (!session || !refEmbedding || isProcessing) return;
    
    setIsProcessing(true);
    try {
      const userEmbedding = await detectAndRun(session, imagePath, () => {});
      if (userEmbedding) {
        const similarity = cosineSimilarity(userEmbedding, refEmbedding);
        const isMatch = similarity > 0.7;
        const result = isMatch ? '✅ Match Found!' : '❌ No Match';
        setLastMatchResult(`${result} (${similarity.toFixed(3)})`);
        
        if (isMatch && realTimeMatching) {
          Alert.alert('✅ Face Matched!', `Similarity: ${similarity.toFixed(3)}`);
        }
      }
    } catch (error) {
      console.log('Frame processing error:', error);
    }
    setIsProcessing(false);
  }, [session, refEmbedding, isProcessing, realTimeMatching]);

  const takePicture = async () => {
    if (!cameraRef.current) return;
    
    try {
      setLoading(true);
      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'balanced',
        flash: flashMode,
      });
      
      const userEmbedding = await detectAndRun(session!, photo.path, setUserFaceUri);
      if (userEmbedding && refEmbedding) {
        const sim = cosineSimilarity(userEmbedding, refEmbedding);
        console.log('Similarity:', sim);
        Alert.alert(
          sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched',
          `Similarity Score: ${sim.toFixed(3)}`
        );
      }
    } catch (error) {
      console.error('Take picture error:', error);
      Alert.alert('Error', 'Failed to take picture');
    } finally {
      setLoading(false);
    }
  };
    const res = await launchImageLibrary({ mediaType: 'photo' });
    const uri = res.assets?.[0]?.uri;
    if (!uri || !session || !refEmbedding) return;

    setLoading(true);
    const userEmbedding = await detectAndRun(session, uri, setUserFaceUri);
    setLoading(false);

    if (userEmbedding) {
      const sim = cosineSimilarity(userEmbedding, refEmbedding);
      console.log('Similarity:', sim);
      Alert.alert(sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched', `Similarity Score: ${sim.toFixed(3)}`);
    }
  };

  const captureFromCamera = async () => {
    const res = await launchCamera({ mediaType: 'photo' });
    const uri = res.assets?.[0]?.uri;
    if (!uri || !session || !refEmbedding) return;

    setLoading(true);
    const userEmbedding = await detectAndRun(session, uri, setUserFaceUri);
    setLoading(false);

    if (userEmbedding) {
      const sim = cosineSimilarity(userEmbedding, refEmbedding);
      console.log('Similarity:', sim);
      Alert.alert(
        sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched',
        `Similarity Score: ${sim.toFixed(3)}`
      );
    }
  };

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

      // const croppedName = `cropped_${Date.now()}.jpg`;
      // const croppedPath = `${RNFS.CachesDirectoryPath}/${croppedName}`;

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

  const cosineSimilarity = (a: Float32Array, b: Float32Array) => {
    const dot = a.reduce((acc, val, i) => acc + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((acc, val) => acc + val * val, 0));
    const magB = Math.sqrt(b.reduce((acc, val) => acc + val * val, 0));
    return dot / (magA * magB);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>🧠 Face Match (ONNX)</Text>
      {refFaceUri && <Image source={{ uri: refFaceUri }} style={styles.image} />}
      {userFaceUri && <Image source={{ uri: userFaceUri }} style={styles.image} />}
      <Button title="Pick Image from Gallery" onPress={pickUserImage} />
      <Button title="Capture from Camera" onPress={captureFromCamera} />
      {loading && <ActivityIndicator size="large" color="#00f" style={{ marginTop: 20 }} />}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, marginBottom: 16 },
  image: { width: 160, height: 160, margin: 8, borderRadius: 8 },
});

export default App;
